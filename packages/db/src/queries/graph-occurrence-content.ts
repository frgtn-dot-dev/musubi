import { and, eq, sql } from "drizzle-orm";
import { BadRequestError, EventSchema, MicrosoftOccurrenceContentRequestSchema, type MicrosoftOccurrenceContentRequest, type Event } from "@musubi/types";
import { db } from "..";
import { events, externalEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { readOrganizerSourceInTransaction } from "./provider-organizer";
import { appendEventOutbox, type EventOutboxRow } from "./event-outbox";
import { lockGraphMeetingContext, graphMeetingContextInTransaction, assertGraphMeetingRequest, graphMeetingVersion, type GraphMeetingContext } from "./graph-meeting-cancel";
import { sameCaldavScopeContext as same } from "./caldav-series-scope";
import type { GraphFamilyObservation } from "./graph-family";

function refuse(): never { throw new BadRequestError("The Outlook occurrence changed. Sync and reopen it before editing."); }
export type GraphOccurrenceContent = {
  version: 1; context: GraphMeetingContext; request: MicrosoftOccurrenceContentRequest;
  baseline: GraphFamilyObservation; targetID: string; template: Event; native: Record<string, unknown>;
  identity: { oauthAccountID: string; graphUserID: string; calendarID: string; selfAddress: string };
  dispatch?: { startedAt: string; acceptedAt?: string };
};

/** The whole bounded family must survive, including moved and cancelled slots.
 * Ignore change tokens, but never ignore guests, time or unrelated content. */
export function graphOccurrenceContentObserved(saved: Pick<GraphOccurrenceContent, "baseline" | "targetID" | "request">, after: GraphFamilyObservation | null) {
  if (!after) return false;
  const before = saved.baseline.instances.find(n => n.externalID === saved.targetID);
  const target = after.instances.find(n => n.externalID === saved.targetID);
  if (!before || !target || !target.etag || after.instances.length !== saved.baseline.instances.length || after.instances.filter(n => n.externalID === saved.targetID).length !== 1) return false;
  const content = ({ etag: _etag, ...value }: GraphFamilyObservation["master"]) => value;
  const patch = saved.request.patch;
  const values = { ...before.values,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
    ...(patch.location !== undefined ? { location: patch.location?.trim() || null } : {}),
  };
  // The reader deliberately marks exception time as legacy-unknown instead of
  // inferring its authoring zone from the master's rule. Native UTC instants and
  // original slot still match; the stored local time model is never overwritten.
  if (before.providerState.eventType === "occurrence" && target.providerState.eventType === "exception" && target.values.timeModel.kind === "legacy-unknown") values.timeModel = target.values.timeModel;
  const eventType = before.providerState.eventType === "occurrence" && target.providerState.eventType === "exception" ? "exception" : before.providerState.eventType;
  return same(content(after.master), content(saved.baseline.master)) &&
    same(after.instances.filter(n => n.externalID !== saved.targetID).map(content), saved.baseline.instances.filter(n => n.externalID !== saved.targetID).map(content)) &&
    same(after.cancelled, saved.baseline.cancelled) &&
    same(content(target), content({ ...before, values, providerState: { ...before.providerState, eventType } }));
}
function assertBoundContent(saved: GraphOccurrenceContent) {
  MicrosoftOccurrenceContentRequestSchema.parse(saved.request);
  assertGraphMeetingRequest(saved.context, saved.request);
  const mapping = saved.context.mappings.find(m => m.eventID === saved.request.eventID)!;
  const target = saved.baseline.instances.find(n => n.externalID === saved.targetID);
  if (saved.version !== 1 || mapping.externalSeriesID !== saved.context.masterID || mapping.externalEventID !== saved.targetID ||
    target?.etag !== mapping.etag || target.icalUid !== mapping.icalUid || saved.native.id !== saved.targetID || saved.native.etag !== mapping.etag || saved.native.iCalUId !== mapping.icalUid ||
    saved.identity.oauthAccountID !== saved.context.link.accountID || saved.identity.calendarID !== saved.context.link.externalCalendarID ||
    saved.request.expectedSeriesVersion !== graphMeetingVersion({ context: saved.context, baseline: saved.baseline, identity: saved.identity, native: saved.native })) refuse();
}
const receipt = (row: EventOutboxRow, replayed: boolean) => ({ operationID: row.id, eventID: row.eventID, replayed, status: row.status, localCommitted: true as const, notificationDelivery: "unknown" as const });
export async function findGraphOccurrenceContent(actorID: string, request: MicrosoftOccurrenceContentRequest) {
  return db.transaction(async tx => {
    await lockGraphMeetingContext(tx, { actorID, ...request });
    const link = await readOrganizerSourceInTransaction(tx, actorID, request.calendarID, "microsoft");
    const [row] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, request.operationID));
    if (!row) return undefined;
    if (row.actorID !== actorID || row.externalCalendarLinkID !== link.id || !same(row.payload.graphOccurrenceContent?.request, request)) refuse();
    return receipt(row, true);
  });
}
export async function saveGraphOccurrenceContent(saved: GraphOccurrenceContent) {
  saved = structuredClone(saved);
  assertBoundContent(saved);
  return db.transaction(async tx => {
    await lockGraphMeetingContext(tx, saved.context.address);
    const link = await readOrganizerSourceInTransaction(tx, saved.context.address.actorID, saved.context.address.calendarID, "microsoft");
    const [previous] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, saved.request.operationID));
    if (previous) {
      if (previous.actorID !== saved.context.address.actorID || previous.externalCalendarLinkID !== link.id || !same(previous.payload.graphOccurrenceContent?.request, saved.request)) refuse();
      return receipt(previous, true);
    }
    const current = await graphMeetingContextInTransaction(tx, saved.context.address);
    if (!same(current, saved.context)) refuse();
    assertGraphMeetingRequest(current, saved.request);
    const event = EventSchema.parse({ ...current.family.find(e => e.id === saved.request.eventID), calendars: [current.address.calendarID] });
    const mapping = current.mappings.find(m => m.eventID === event.id)!;
    await appendEventOutbox(tx, event, [{ id: saved.request.operationID, actorID: current.address.actorID, mutationID: saved.request.operationID, position: 0,
      eventID: event.id, calendarID: current.address.calendarID, externalCalendarLinkID: current.link.id, provider: "microsoft", userID: current.address.actorID,
      accountID: current.link.accountID, externalCalendarID: current.link.externalCalendarID, externalEventID: mapping.externalEventID,
      expectedEtag: mapping.etag, icalUid: mapping.icalUid, action: "update", payload: { event, graphOccurrenceContent: saved } }]);
    const [row] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, saved.request.operationID));
    return receipt(row!, false);
  });
}
async function withLease<T>(row: EventOutboxRow, action: (tx: DbTransaction, saved: GraphOccurrenceContent, current: EventOutboxRow) => Promise<T>) {
  return db.transaction(async tx => {
    const initial = row.payload.graphOccurrenceContent;
    if (!initial || initial.version !== 1 || row.provider !== "microsoft" || row.action !== "update" || row.actorID !== initial.context.address.actorID || row.userID !== row.actorID) refuse();
    assertBoundContent(initial);
    await lockGraphMeetingContext(tx, initial.context.address);
    const context = await graphMeetingContextInTransaction(tx, initial.context.address, row.id);
    if (!same(context, initial.context)) refuse();
    const [current] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, row.id), eq(eventOutbox.status, "attempting"), eq(eventOutbox.leaseToken, row.leaseToken!), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
    const saved = current?.payload.graphOccurrenceContent;
    if (!saved || !same({ ...saved, dispatch: undefined }, { ...initial, dispatch: undefined }) || current.externalCalendarLinkID !== context.link.id || current.accountID !== context.link.accountID || current.externalCalendarID !== context.link.externalCalendarID || current.calendarID !== context.address.calendarID || current.eventID !== context.address.eventID || current.id !== saved.request.operationID || current.externalEventID !== saved.targetID || current.expectedEtag !== saved.native.etag || current.icalUid !== saved.native.iCalUId || current.revision !== context.family.find(e => e.id === current.eventID)?.revision) refuse();
    return action(tx, saved, current);
  });
}
export const confirmGraphOccurrenceContent = (row: EventOutboxRow) => withLease(row, async () => undefined);
export const markGraphOccurrenceContent = (row: EventOutboxRow, accepted = false) => withLease(row, async (tx, saved, current) => {
  if (accepted ? !saved.dispatch : !!saved.dispatch) refuse();
  const dispatch = accepted ? { ...saved.dispatch!, acceptedAt: new Date().toISOString() } : { startedAt: new Date().toISOString() };
  await tx.update(eventOutbox).set({ payload: { ...current.payload, graphOccurrenceContent: { ...saved, dispatch } }, uncertain: true }).where(eq(eventOutbox.id, row.id));
});
export const completeGraphOccurrenceContent = (row: EventOutboxRow, observation: GraphFamilyObservation) => withLease(row, async (tx, saved) => {
  if ((!saved.dispatch?.acceptedAt && (saved.dispatch || !same(saved.baseline, observation))) || !graphOccurrenceContentObserved(saved, observation)) refuse();
  const now = new Date();
  const native = observation.instances.find(n => n.externalID === saved.targetID)!;
  const previous = saved.context.family.find(e => e.id === row.eventID)!;
  const content = { title: native.values.title, description: native.values.description, location: native.values.location };
  if (!same(content, { title: previous.title, description: previous.description, location: previous.location }))
    await tx.update(events).set({ ...content, revision: sql`${events.revision} + 1`, updatedAt: now }).where(eq(events.id, row.eventID));
  for (const mapping of saved.context.mappings) {
    const current = [observation.master, ...observation.instances].find(n => n.externalID === mapping.externalEventID);
    if (current) await tx.update(externalEvents).set({ etag: current.etag, providerState: current.providerState, providerStateObservedAt: now }).where(eq(externalEvents.id, mapping.id));
  }
  await tx.update(eventOutbox).set({ status: "completed", errorCode: null, resultRef: { externalEventId: native.externalID, icalUid: native.icalUid, etag: native.etag }, uncertain: false, leaseToken: null, leaseUntil: null, remoteSnapshot: null, updatedAt: now }).where(eq(eventOutbox.id, row.id));
});

/** No optimistic event mutation needs rolling back. Only definite no-write
 * outcomes release the calendar fence; uncertain dispatches retain it. */
export async function stopGraphOccurrenceContent(row: EventOutboxRow, rejected = false) {
  const stopped = await db.update(eventOutbox).set({ status: "cancelled", errorCode: rejected ? "outlook-update-rejected" : "organizer-not-dispatched", uncertain: false, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(
    eq(eventOutbox.id, row.id), eq(eventOutbox.status, "attempting"), eq(eventOutbox.leaseToken, row.leaseToken!), eq(eventOutbox.provider, "microsoft"), eq(eventOutbox.action, "update"),
    sql`${eventOutbox.leaseUntil} > clock_timestamp() and ${eventOutbox.payload}->'graphOccurrenceContent' is not null`,
    rejected ? sql`${eventOutbox.payload}->'graphOccurrenceContent'->'dispatch'->>'startedAt' is not null and ${eventOutbox.payload}->'graphOccurrenceContent'->'dispatch'->>'acceptedAt' is null`
      : sql`${eventOutbox.payload}->'graphOccurrenceContent'->'dispatch' is null`,
  )).returning({ id: eventOutbox.id });
  return stopped.length === 1;
}
