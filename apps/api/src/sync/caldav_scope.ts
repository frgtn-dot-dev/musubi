import { randomUUID } from "node:crypto";
import { planEventScope } from "@musubi/calendar";
import { sameCaldavScopeContext } from "@musubi/db";
import type { CaldavSeriesContext, CaldavSeriesPrepared, CaldavSeriesDeletionPrepared } from "@musubi/db";
import { EventScopeRequestSchema, EventWriteError } from "@musubi/types";
import { caldavAdapter, prepareCaldavSeriesWrite, prepareCaldavSeriesDeletion } from "./adapters/caldav";
import { ProviderEventWriteError } from "./event_write";

export async function prepareCaldavSeries(context: CaldavSeriesContext, input: unknown): Promise<CaldavSeriesPrepared> {
  const request = EventScopeRequestSchema.parse(input);
  if (!["series", "occurrence", "following"].includes(request.scope) || (request.scope === "series" && request.action !== "update") || (request.scope === "following" && request.action !== "delete") || (request.action === "update" && (Object.keys(request.patch).some(key => !["title", "description", "location", "recurrence"].includes(key)))))
    throw new EventWriteError("event-write", "unsupported");
  const target = request.scope === "occurrence" ? context.children.find(child => sameCaldavScopeContext(child.originalStart, request.originalStart)) : undefined;
  if (request.scope === "occurrence" && ((target?.isCanceled && request.action === "delete") || (target?.revision ?? null) !== request.expectedOccurrenceRevision)) throw new EventWriteError("event-write", "unsupported");
  const newDefinition = request.scope === "occurrence" && !target ? planEventScope(context.master, context.children, request, () => context.retiredDefinitions?.find(item => sameCaldavScopeContext(item.originalStart, request.originalStart))?.id ?? randomUUID()).creates[0] : undefined;
  const planned = planEventScope(context.master, context.children, request, () => newDefinition?.id ?? randomUUID());
  if ([...planned.updates, ...planned.creates].some(next => next.seriesID === context.master.id && context.retiredDefinitions?.some(old => old.id !== next.id && sameCaldavScopeContext(old.originalStart, next.originalStart))))
    throw new EventWriteError("event-write", "unsupported", "This change collides with a retired occurrence identity. No changes were saved.");
  const root = context.mappings.find(item => item.eventID === context.master.id)!;
  const baseline = { master: context.master, children: context.children, ref: { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid } };
  try {
    const evidence = await caldavAdapter.readCaldavSeries!(context.link.userID, context.link.accountID, context.link.externalCalendarID, baseline, AbortSignal.timeout(10_000));
    for (const observed of [evidence.master, ...evidence.exceptions]) {
      const mapping = context.mappings.find(item => item.externalEventID === observed.externalId);
      if (!mapping || !sameCaldavScopeContext(mapping.originalStart, observed.originalStart ?? null)) throw new ProviderEventWriteError("provider-conflict");
    }
    return { context, write: prepareCaldavSeriesWrite(evidence, baseline, request.action === "update" ? request.patch : {}, target?.id ?? newDefinition?.id, request.action === "delete" && request.scope === "occurrence" ? true : undefined, newDefinition, request.action === "update" ? request.time : undefined, request.scope === "following" ? { originalStart: request.originalStart!, expectedOccurrenceRevision: request.expectedOccurrenceRevision! } : undefined) };
  } catch (error) {
    if (error instanceof ProviderEventWriteError || error instanceof EventWriteError) throw error;
    // Parser/decryption/transport exceptions can contain raw resource lines.
    // Do not preserve their message, stack or cause across the HTTP boundary.
    throw new ProviderEventWriteError("provider-write-failed");
  }
}

export async function prepareCaldavSeriesDelete(context: CaldavSeriesContext, input: unknown): Promise<CaldavSeriesDeletionPrepared> {
  const request = EventScopeRequestSchema.parse(input);
  if (!["series", "following"].includes(request.scope) || request.action !== "delete" || !planEventScope(context.master, context.children, request).deletes.includes(context.master.id)) throw new EventWriteError("event-write", "unsupported");
  const root = context.mappings.find(item => item.eventID === context.master.id)!;
  const baseline = { master: context.master, children: context.children, ref: { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid } };
  try {
    const evidence = await caldavAdapter.readCaldavSeriesForDelete!(context.link.userID, context.link.accountID, context.link.externalCalendarID, baseline, AbortSignal.timeout(10_000));
    for (const observed of [evidence.master, ...evidence.exceptions]) {
      const mapping = context.mappings.find(item => item.externalEventID === observed.externalId);
      if (!mapping || !sameCaldavScopeContext(mapping.originalStart, observed.originalStart ?? null)) throw new ProviderEventWriteError("provider-conflict");
    }
    return { context, deletion: prepareCaldavSeriesDeletion(evidence, baseline) };
  } catch (error) {
    if (error instanceof ProviderEventWriteError || error instanceof EventWriteError) throw error;
    throw new ProviderEventWriteError("provider-write-failed");
  }
}
