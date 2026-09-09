import { randomUUID } from "node:crypto";
import { planEventScope } from "@musubi/calendar";
import { sameCaldavScopeContext } from "@musubi/db";
import type { CaldavSeriesContext, CaldavSeriesPrepared } from "@musubi/db";
import { EventScopeRequestSchema, EventWriteError } from "@musubi/types";
import { caldavAdapter, prepareCaldavSeriesWrite } from "./adapters/caldav";
import { ProviderEventWriteError } from "./event_write";

export async function prepareCaldavSeries(context: CaldavSeriesContext, input: unknown): Promise<CaldavSeriesPrepared> {
  const request = EventScopeRequestSchema.parse(input);
  if (!["series", "occurrence"].includes(request.scope) || (request.scope === "series" && request.action !== "update") || (request.action === "update" && ((request.time !== undefined && request.scope !== "occurrence") || Object.keys(request.patch).some(key => !["title", "description", "location"].includes(key)))))
    throw new EventWriteError("event-write", "unsupported");
  const target = request.scope === "occurrence" ? context.children.find(child => sameCaldavScopeContext(child.originalStart, request.originalStart)) : undefined;
  if (request.scope === "occurrence" && ((target?.isCanceled && request.action === "delete") || (target?.revision ?? null) !== request.expectedOccurrenceRevision)) throw new EventWriteError("event-write", "unsupported");
  if (request.action === "update" && request.time !== undefined && !target) throw new EventWriteError("event-write", "unsupported");
  const newDefinition = request.scope === "occurrence" && !target ? planEventScope(context.master, context.children, request, randomUUID).creates[0] : undefined;
  const root = context.mappings.find(item => item.eventID === context.master.id)!;
  const baseline = { master: context.master, children: context.children, ref: { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid } };
  try {
    const evidence = await caldavAdapter.readCaldavSeries!(context.link.userID, context.link.accountID, context.link.externalCalendarID, baseline, AbortSignal.timeout(10_000));
    for (const observed of [evidence.master, ...evidence.exceptions]) {
      const mapping = context.mappings.find(item => item.externalEventID === observed.externalId);
      if (!mapping || !sameCaldavScopeContext(mapping.originalStart, observed.originalStart ?? null)) throw new ProviderEventWriteError("provider-conflict");
    }
    return { context, write: prepareCaldavSeriesWrite(evidence, baseline, request.action === "update" ? request.patch : {}, target?.id ?? newDefinition?.id, request.action === "delete" ? true : undefined, newDefinition, request.action === "update" ? request.time : undefined) };
  } catch (error) {
    if (error instanceof ProviderEventWriteError || error instanceof EventWriteError) throw error;
    // Parser/decryption/transport exceptions can contain raw resource lines.
    // Do not preserve their message, stack or cause across the HTTP boundary.
    throw new ProviderEventWriteError("provider-write-failed");
  }
}
