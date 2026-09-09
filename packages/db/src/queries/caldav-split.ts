import { randomUUID } from "node:crypto";
import { planEventScope } from "@musubi/calendar";
import { EventSchema, EventScopeRequestSchema, EventWriteError, type Event, type EventScopeRequest } from "@musubi/types";
import { eq } from "drizzle-orm";
import { eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { appendEventOutbox } from "./event-outbox";
import { caldavSeriesDesired, sameCaldavRecurrence, sameCaldavScopeContext, type CaldavSeriesContext, type CaldavSeriesWriteIntent } from "./caldav-series-scope";

/** Private full-resource evidence. Neither this input nor the journal is a DTO. */
export type CaldavSeriesSplitIntent = {
  source: CaldavSeriesWriteIntent;
  request: EventScopeRequest;
  creation: CaldavSeriesWriteIntent["baseline"] & { data: string };
};
export type CaldavSplitPrepared = { context: CaldavSeriesContext; split: CaldavSeriesSplitIntent };
export type CaldavSplitJournal = {
  prepared: CaldavSplitPrepared;
  sourceOperationID: string;
  creationOperationID: string;
  after: { source: Event; retained: Event[]; head: Event; moved: Event[] };
};
function refuse(): never { throw new EventWriteError("event-write", "unsupported", "CalDAV split preparation no longer matches the complete family."); }

/** Reconstruct canonical intent independently of the native serialization. */
export function caldavSplitPlan(prepared: CaldavSplitPrepared) {
  const { context, split } = prepared;
  const baseline = split.source.baseline;
  const request = EventScopeRequestSchema.parse(split.request);
  const id = split.creation.master.id;
  const root = context.mappings.find(item => item.eventID === context.master.id);
  if (!root || request.scope !== "following" || request.action !== "update" ||
      Object.keys(request.patch).some(key => !["title", "description", "location", "recurrence"].includes(key)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ||
      [context.master, ...context.children, ...(context.retiredDefinitions ?? [])].some(item => item.id === id) ||
      !sameCaldavScopeContext(baseline, { master: context.master, children: context.children, ref: { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid } }) ||
      !sameCaldavScopeContext(split.source.followingDelete, { originalStart: request.originalStart, expectedOccurrenceRevision: request.expectedOccurrenceRevision }) ||
      split.creation.ref.etag != null || split.creation.ref.icalUid !== id ||
      split.creation.ref.externalEventId !== new URL(`musubi-${id}.ics`, root.externalEventID).href) refuse();
  let planned = request;
  if (request.patch.recurrence !== undefined) {
    if (!sameCaldavRecurrence(request.patch.recurrence, split.creation.master.recurrence)) refuse();
    planned = { ...request, patch: { ...request.patch, recurrence: split.creation.master.recurrence } };
  }
  const plan = planEventScope(context.master, context.children, planned, () => id);
  const source = caldavSeriesDesired(split.source);
  if (plan.creates.length !== 1 || plan.deletes.length || !plan.updates.some(item => item.id === context.master.id) ||
      !sameCaldavScopeContext(plan.creates[0], split.creation.master) ||
      !sameCaldavScopeContext(plan.updates.filter(item => item.seriesID === id), split.creation.children) ||
      !sameCaldavScopeContext(plan.updates.find(item => item.id === context.master.id), source.master) ||
      !sameCaldavScopeContext(context.children.filter(item => !split.creation.children.some(child => child.id === item.id)), source.children)) refuse();
  const head = plan.creates[0]!;
  if (head.timeModel?.kind !== context.master.timeModel?.kind || head.timeModel?.kind === "zoned" && (context.master.timeModel?.kind !== "zoned" || head.timeModel.timeZone !== context.master.timeModel.timeZone)) refuse();
  return plan;
}

/** Called after the local planner saves both families in the same transaction.
 * The second row depends on the first across event IDs, not just timestamps. */
export async function appendCaldavSplit(tx: DbTransaction, actorID: string, operationID: string, prepared: CaldavSplitPrepared, saved: Event[]) {
  const plan = caldavSplitPlan(prepared);
  const { context, split } = prepared;
  const expected = [...plan.creates, ...plan.updates].map(event => EventSchema.parse({ ...event, revision: event.id === split.creation.master.id ? 1 : [context.master, ...context.children].find(item => item.id === event.id)!.revision! + 1 }));
  if (actorID !== context.link.userID || operationID !== split.request.operationID || saved.length !== expected.length ||
      expected.some(event => !sameCaldavScopeContext(event, saved.find(item => item.id === event.id)))) refuse();
  const after = {
    source: saved.find(item => item.id === context.master.id)!,
    retained: context.children.filter(item => !split.creation.children.some(child => child.id === item.id)),
    head: saved.find(item => item.id === split.creation.master.id)!,
    moved: split.creation.children.map(child => saved.find(item => item.id === child.id)!),
  };
  // Sharing a UUID with the new event makes the existing unmapped-delete URL
  // fence recognize this create before any mapping can exist.
  const journal: CaldavSplitJournal = { prepared, after, sourceOperationID: randomUUID(), creationOperationID: after.head.id };
  for (const [position, event, ref, action, id] of [
    [0, after.source, split.source.baseline.ref, "update", journal.sourceOperationID],
    [1, after.head, split.creation.ref, "create", journal.creationOperationID],
  ] as const) await appendEventOutbox(tx, event, [{
    id, actorID, mutationID: operationID, position, eventID: event.id,
    calendarID: context.link.calendarID, externalCalendarLinkID: context.link.id, provider: "caldav", userID: actorID,
    accountID: context.link.accountID, externalCalendarID: context.link.externalCalendarID,
    externalEventID: ref.externalEventId, expectedEtag: ref.etag ?? null, icalUid: ref.icalUid ?? null,
    action, payload: { event, caldavSplit: journal },
  }]);
  await tx.update(eventOutbox).set({ predecessorID: journal.sourceOperationID }).where(eq(eventOutbox.id, journal.creationOperationID));
}
