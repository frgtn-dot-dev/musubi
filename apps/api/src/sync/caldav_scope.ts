import { sameCaldavScopeContext } from "@musubi/db";
import type { CaldavSeriesContext, CaldavSeriesPrepared } from "@musubi/db";
import { EventScopeRequestSchema, EventWriteError } from "@musubi/types";
import { caldavAdapter, prepareCaldavSeriesWrite } from "./adapters/caldav";
import { ProviderEventWriteError } from "./event_write";

export async function prepareCaldavSeries(context: CaldavSeriesContext, input: unknown): Promise<CaldavSeriesPrepared> {
  const request = EventScopeRequestSchema.parse(input);
  if (request.scope !== "series" || request.action !== "update" || request.time !== undefined || Object.keys(request.patch).some(key => !["title", "description", "location"].includes(key)))
    throw new EventWriteError("event-write", "unsupported");
  const root = context.mappings.find(item => item.eventID === context.master.id)!;
  const baseline = { master: context.master, children: context.children, ref: { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid } };
  try {
    const evidence = await caldavAdapter.readCaldavSeries!(context.link.userID, context.link.accountID, context.link.externalCalendarID, baseline, AbortSignal.timeout(10_000));
    for (const observed of [evidence.master, ...evidence.exceptions]) {
      const mapping = context.mappings.find(item => item.externalEventID === observed.externalId);
      if (!mapping || !sameCaldavScopeContext(mapping.originalStart, observed.originalStart ?? null)) throw new ProviderEventWriteError("provider-conflict");
    }
    return { context, write: prepareCaldavSeriesWrite(evidence, baseline, request.patch) };
  } catch (error) {
    if (error instanceof ProviderEventWriteError || error instanceof EventWriteError) throw error;
    // Parser/decryption/transport exceptions can contain raw resource lines.
    // Do not preserve their message, stack or cause across the HTTP boundary.
    throw new ProviderEventWriteError("provider-write-failed");
  }
}
