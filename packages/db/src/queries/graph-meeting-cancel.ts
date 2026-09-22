import { createHash } from "node:crypto";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { BadRequestError, EventSchema, MicrosoftSeriesCancellationRequestSchema, type Event, type MicrosoftSeriesCancellationRequest } from "@musubi/types";
import { db } from "..";
import { events, externalEvents, calendarEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";
import { readOrganizerSourceInTransaction } from "./provider-organizer";
import { appendEventOutbox, type EventOutboxRow } from "./event-outbox";
import { providerStateVersion } from "./provider-reminders";
import { sameCaldavScopeContext as same } from "./caldav-series-scope";
import type { GraphFamilyObservation } from "./graph-family";

function refuse(): never { throw new BadRequestError("The Outlook meeting series changed. Sync and reopen it before cancelling."); }
const canonical = (v: unknown): unknown => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
export const graphMeetingVersion = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
type Address = { actorID: string; calendarID: string; eventID: string };
async function lock(tx: DbTransaction, address: Address) {
  await lockUserLifecycle(tx, [address.actorID], "shared");
  await lockCalendarLifecycle(tx, [address.calendarID], "exclusive");
}
/** Both canonical families and provider-expanded rows retain their own model.
 * Calendar admission prevents sync from introducing a new sibling mid-commit. */
async function contextInTransaction(tx: DbTransaction, address: Address, excludedOperationID?: string) {
  const link = await readOrganizerSourceInTransaction(tx, address.actorID, address.calendarID, "microsoft");
  const [selected] = await tx.select().from(externalEvents).where(and(eq(externalEvents.eventID, address.eventID), eq(externalEvents.calendarID, address.calendarID)));
  if (!selected || selected.provider !== "microsoft") refuse();
  const masterID = selected.externalSeriesID ?? selected.externalEventID;
  const nativeMaps = await tx.select().from(externalEvents).where(and(eq(externalEvents.provider, "microsoft"), eq(externalEvents.calendarID, address.calendarID), or(eq(externalEvents.externalEventID, masterID), eq(externalEvents.externalSeriesID, masterID)))).orderBy(externalEvents.id);
  const rootID = nativeMaps.find(m => m.externalEventID === masterID)?.eventID;
  // Parent-before-child ordering agrees with recurrence editors. The exclusive
  // calendar fence also excludes provider pull and link lifecycle mutations.
  if (rootID) await tx.select().from(events).where(eq(events.id, rootID)).for("update");
  const family = await tx.select().from(events).where(or(inArray(events.id, nativeMaps.map(m => m.eventID)), rootID ? eq(events.seriesID, rootID) : undefined)).orderBy(events.id).for("update");
  const ids = family.map(e => e.id);
  if (!ids.length || !ids.includes(address.eventID) || family.some(e => e.creatorID !== address.actorID || e.originCalendarID !== address.calendarID || e.hasAttendees)) refuse();
  const memberships = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, ids)).orderBy(calendarEvents.eventID).for("share");
  if (memberships.length !== ids.length || new Set(memberships.map(m => m.eventID)).size !== ids.length || memberships.some(m => m.calendarID !== address.calendarID)) refuse();
  const mappings = await tx.select().from(externalEvents).where(inArray(externalEvents.eventID, ids)).orderBy(externalEvents.id).for("update");
  if (mappings.length !== nativeMaps.length || !same(mappings, nativeMaps) || new Set(mappings.map(m => m.eventID)).size !== mappings.length || mappings.some(m => m.externalCalendarID !== link.externalCalendarID || !m.etag || !m.icalUid || m.readRedactionRevision !== null)) refuse();
  const root = family.find(e => e.id === rootID);
  if (root ? !root.recurrence || root.seriesID || root.originalStart || root.isCanceled || root.deletedAt : family.some(e => e.seriesID || e.originalStart || e.recurrence)) refuse();
  for (const e of family) {
    const m = mappings.find(m => m.eventID === e.id);
    if (e.id === rootID) { if (!m || m.externalSeriesID || m.originalStart) refuse(); continue; }
    if (root && (e.seriesID !== rootID || !e.originalStart || e.recurrence)) refuse();
    if ((!e.deletedAt && !e.isCanceled && !m) || (m && (m.externalSeriesID !== masterID || !m.originalStart || root && !same(m.originalStart, e.originalStart)))) refuse();
  }
  const pending = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(
    excludedOperationID ? ne(eventOutbox.id, excludedOperationID) : undefined,
    sql`${eventOutbox.status} not in ('completed', 'not-needed') and not (${eventOutbox.payload}->'graphMeetingCancellation' is not null and ${eventOutbox.payload}->'graphMeetingCancellation'->'dispatch' is null and ${eventOutbox.status} in ('conflict', 'blocked', 'cancelled'))`,
    or(inArray(eventOutbox.eventID, ids), and(eq(eventOutbox.externalCalendarLinkID, link.id), sql`(${eventOutbox.payload}->'graphSeriesCreate' is not null or ${eventOutbox.payload}->'graphMeetingCancellation' is not null)`)),
  )).limit(1);
  if (pending.length) refuse();
  // Refresh timestamps and sync cursors are not authority or content changes.
  return { address, masterID, rootID: rootID ?? null, family,
    mappings: mappings.map(({ providerStateObservedAt: _observed, ...m }) => m),
    link: { id: link.id, accountID: link.accountID, externalCalendarID: link.externalCalendarID, providerAccessRevision: link.providerAccessRevision, providerAccessRole: link.providerAccessRole },
  };
}
export type GraphMeetingContext = Awaited<ReturnType<typeof contextInTransaction>>;
export type GraphMeetingCancellation = {
  version: 1; context: GraphMeetingContext; request: MicrosoftSeriesCancellationRequest;
  baseline: GraphFamilyObservation; targetID: string; template: Event;
  identity: { oauthAccountID: string; graphUserID: string; calendarID: string; selfAddress: string };
  dispatch?: { startedAt: string; acceptedAt?: string };
};
export async function readGraphMeetingContext(address: Address) {
  return db.transaction(async tx => { await lock(tx, address); return contextInTransaction(tx, address); });
}
export function assertGraphMeetingRequest(context: GraphMeetingContext, request: MicrosoftSeriesCancellationRequest) {
  const event = context.family.find(e => e.id === request.eventID);
  const mapping = context.mappings.find(m => m.eventID === request.eventID);
  if (!event || !mapping || event.deletedAt || event.isCanceled || event.revision !== request.expectedRevision || providerStateVersion(mapping) !== request.expectedStateVersion || request.calendarID !== context.address.calendarID || request.eventID !== context.address.eventID || request.scope === "occurrence" && !mapping.externalSeriesID) refuse();
}
const receipt = (row: EventOutboxRow, replayed: boolean) => ({ operationID: row.id, eventID: row.eventID, replayed, status: row.status, localCommitted: true as const, notificationDelivery: "unknown" as const });
export async function findGraphMeetingCancellation(actorID: string, request: MicrosoftSeriesCancellationRequest) {
  return db.transaction(async tx => {
    await lock(tx, { actorID, ...request });
    const link = await readOrganizerSourceInTransaction(tx, actorID, request.calendarID, "microsoft");
    const [row] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, request.operationID));
    if (!row) return undefined;
    if (row.actorID !== actorID || row.externalCalendarLinkID !== link.id || !same(row.payload.graphMeetingCancellation?.request, request)) refuse();
    return receipt(row, true);
  });
}
export async function saveGraphMeetingCancellation(saved: GraphMeetingCancellation) {
  return db.transaction(async tx => {
    await lock(tx, saved.context.address);
    const link = await readOrganizerSourceInTransaction(tx, saved.context.address.actorID, saved.context.address.calendarID, "microsoft");
    const [previous] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, saved.request.operationID));
    if (previous) {
      if (previous.actorID !== saved.context.address.actorID || previous.externalCalendarLinkID !== link.id || !same(previous.payload.graphMeetingCancellation?.request, saved.request)) refuse();
      return receipt(previous, true);
    }
    const current = await contextInTransaction(tx, saved.context.address);
    if (!same(current, saved.context)) refuse();
    assertGraphMeetingRequest(current, saved.request);
    const event = EventSchema.parse({ ...current.family.find(e => e.id === saved.request.eventID), calendars: [current.address.calendarID] });
    const mapping = current.mappings.find(m => m.eventID === event.id)!;
    await appendEventOutbox(tx, event, [{ id: saved.request.operationID, actorID: current.address.actorID, mutationID: saved.request.operationID, position: 0,
      eventID: event.id, calendarID: current.address.calendarID, externalCalendarLinkID: current.link.id, provider: "microsoft", userID: current.address.actorID,
      accountID: current.link.accountID, externalCalendarID: current.link.externalCalendarID, externalEventID: mapping.externalEventID,
      expectedEtag: mapping.etag, icalUid: mapping.icalUid, action: "delete", payload: { event, graphMeetingCancellation: saved } }]);
    const [row] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, saved.request.operationID));
    return receipt(row!, false);
  });
}
async function withLease<T>(row: EventOutboxRow, action: (tx: DbTransaction, saved: GraphMeetingCancellation, current: EventOutboxRow) => Promise<T>) {
  return db.transaction(async tx => {
    const initial = row.payload.graphMeetingCancellation;
    if (!initial || initial.version !== 1 || row.provider !== "microsoft" || row.action !== "delete" || row.actorID !== initial.context.address.actorID || row.userID !== row.actorID) refuse();
    MicrosoftSeriesCancellationRequestSchema.parse(initial.request);
    await lock(tx, initial.context.address);
    const context = await contextInTransaction(tx, initial.context.address, row.id);
    if (!same(context, initial.context)) refuse();
    const [current] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, row.id), eq(eventOutbox.status, "attempting"), eq(eventOutbox.leaseToken, row.leaseToken!), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
    const saved = current?.payload.graphMeetingCancellation;
    if (!saved || !same({ ...saved, dispatch: undefined }, { ...initial, dispatch: undefined }) || current.externalCalendarLinkID !== context.link.id || current.accountID !== context.link.accountID || current.externalCalendarID !== context.link.externalCalendarID || current.calendarID !== context.address.calendarID || current.eventID !== context.address.eventID || current.revision !== context.family.find(e => e.id === current.eventID)?.revision) refuse();
    return action(tx, saved, current);
  });
}
export const confirmGraphMeetingCancellation = (row: EventOutboxRow) => withLease(row, async () => undefined);
export const markGraphMeetingCancellation = (row: EventOutboxRow, accepted = false) => withLease(row, async (tx, saved, current) => {
  if (accepted ? !saved.dispatch : !!saved.dispatch) refuse();
  const dispatch = accepted ? { ...saved.dispatch!, acceptedAt: new Date().toISOString() } : { startedAt: new Date().toISOString() };
  await tx.update(eventOutbox).set({ payload: { ...current.payload, graphMeetingCancellation: { ...saved, dispatch } }, uncertain: true }).where(eq(eventOutbox.id, row.id));
});
export const completeGraphMeetingCancellation = (row: EventOutboxRow, observation: GraphFamilyObservation | null) => withLease(row, async (tx, saved) => {
  if (!saved.dispatch?.acceptedAt || (saved.request.scope === "series") !== (observation === null)) refuse();
  const now = new Date();
  for (const event of saved.context.family) {
    const mapping = saved.context.mappings.find(m => m.eventID === event.id);
    if (saved.request.scope === "series" || mapping?.externalEventID === saved.targetID) {
      await tx.update(events).set({ isCanceled: event.id === saved.context.rootID ? event.isCanceled : true, deletedAt: saved.request.scope === "occurrence" && event.seriesID ? null : now, revision: sql`${events.revision} + 1`, updatedAt: now }).where(eq(events.id, event.id));
    } else if (mapping && observation) {
      const native = [observation.master, ...observation.instances].find(e => e.externalID === mapping.externalEventID);
      if (native) await tx.update(externalEvents).set({ etag: native.etag, providerState: native.providerState, providerStateObservedAt: now }).where(eq(externalEvents.id, mapping.id));
    }
  }
  await tx.update(eventOutbox).set({ status: "completed", errorCode: null, uncertain: false, leaseToken: null, leaseUntil: null, remoteSnapshot: null, updatedAt: now }).where(eq(eventOutbox.id, row.id));
});

/** Guard late active pulls, including unimported siblings of a cancelled root.
 * Native cancellation IDs are not resurrected from a stale calendarView page. */
export async function isCancelledGraphMeeting(tx: Pick<DbTransaction, "select">, linkID: string, externalID: string, masterID?: string) {
  const [row] = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(eq(eventOutbox.externalCalendarLinkID, linkID), eq(eventOutbox.status, "completed"),
    sql`${eventOutbox.payload}->'graphMeetingCancellation'->'dispatch'->>'acceptedAt' is not null`,
    sql`(${eventOutbox.payload}->'graphMeetingCancellation'->>'targetID' = ${externalID} or (${eventOutbox.payload}->'graphMeetingCancellation'->'request'->>'scope' = 'series' and ${eventOutbox.payload}->'graphMeetingCancellation'->'context'->>'masterID' = ${masterID ?? externalID}))`,
  )).limit(1);
  return !!row;
}

/** A permanent marker is the write boundary. Only a lease that provably never
 * crossed it can stop its intent and let a fresh synchronization proceed. */
export async function stopUndispatchedGraphMeetingCancellation(row: EventOutboxRow) {
  const stopped = await db.update(eventOutbox).set({ status: "cancelled", errorCode: "organizer-not-dispatched", uncertain: false, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(
    eq(eventOutbox.id, row.id), eq(eventOutbox.status, "attempting"), eq(eventOutbox.leaseToken, row.leaseToken!),
    sql`${eventOutbox.leaseUntil} > clock_timestamp() and ${eventOutbox.payload}->'graphMeetingCancellation' is not null and ${eventOutbox.payload}->'graphMeetingCancellation'->'dispatch' is null`,
  )).returning({ id: eventOutbox.id });
  return stopped.length === 1;
}
