import { planEventScope, resolveEventTimeEdit } from "@musubi/calendar";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { EventSchema, EventWriteError, can, type Event, type EventScopeRequest, type EventTimeEdit, type OccurrenceStart } from "@musubi/types";
import { db } from "..";
import { calendarMembers, calendarEvents, events, externalCalendars, externalEvents, externalEventTombstones, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { appendEventOutbox } from "./event-outbox";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { lockExternalEventIdentity } from "./event-outbox-deletions";

type Ref = { externalEventId: string; etag?: string | null; icalUid?: string | null };
export type CaldavSeriesContext = {
  master: Event;
  children: Event[];
  retiredDefinitions?: Pick<Event, "id" | "revision" | "originalStart">[];
  link: Pick<typeof externalCalendars.$inferSelect, "id" | "userID" | "provider" | "accountID" | "externalCalendarID" | "disabled" | "supportsEvents"> & { calendarID: string };
  mappings: Pick<typeof externalEvents.$inferSelect, "id" | "provider" | "eventID" | "calendarID" | "externalCalendarID" | "externalEventID" | "icalUid" | "externalSeriesID" | "originalStart" | "etag">[];
};
/** Private server-only resource input. Never project this into a public DTO. */
export type CaldavSeriesWriteIntent = {
  baseline: { ref: Ref; master: Event; children: Event[] };
  patch: Pick<Partial<Event>, "title" | "description" | "location" | "recurrence">;
  targetEventID?: string;
  cancelTarget?: true;
  newDefinition?: Event;
  time?: EventTimeEdit;
  followingDelete?: { originalStart: OccurrenceStart; expectedOccurrenceRevision: number | null };
  before: string;
  after: string;
};
export type CaldavSeriesDeletionIntent = { baseline: CaldavSeriesWriteIntent["baseline"]; before: string };
export type CaldavSeriesDeletionPrepared = { context: CaldavSeriesContext; deletion: CaldavSeriesDeletionIntent };
export type CaldavSeriesPrepared = { context: CaldavSeriesContext; write: CaldavSeriesWriteIntent };

/** Stable across Date/string JSONB round trips and JSONB object-key ordering. */
export function sameCaldavScopeContext(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
const unsupported = () => new EventWriteError("event-write", "unsupported", "Reconcile the complete CalDAV family before another series change. No changes were saved.");
const strong = (value: unknown): value is string => typeof value === "string" && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);

/** Caller holds lifecycle, resource, master and sorted child locks, in that order. */
export async function caldavSeriesContext(tx: DbTransaction, actorID: string, master: Event, children: Event[], ownOperationID?: string, readOnly = false): Promise<CaldavSeriesContext> {
  const family = [master, ...children];
  if (!master.originCalendarID || master.seriesID || master.originalStart || !master.recurrence || master.isCanceled ||
      family.some(event => event.creatorID !== actorID || event.originCalendarID !== master.originCalendarID || event.calendars.length !== 1 || event.calendars[0] !== master.originCalendarID || !["zoned", "floating", "all-day"].includes(event.timeModel?.kind ?? ""))) throw unsupported();
  const grantQuery = tx.select({ role: calendarMembers.role }).from(calendarMembers).where(and(eq(calendarMembers.calendarID, master.originCalendarID), eq(calendarMembers.userID, actorID)));
  const [grant] = await (readOnly ? grantQuery : grantQuery.for("share"));
  if (!grant || !can(grant.role, "editEvents")) throw new EventWriteError("event-write", "denied");
  const linkQuery = tx.select().from(externalCalendars).where(eq(externalCalendars.calendarID, master.originCalendarID));
  const [link] = await (readOnly ? linkQuery : linkQuery.for("share"));
  if (!link || link.provider !== "caldav" || link.userID !== actorID || link.disabled || !link.supportsEvents) throw unsupported();
  const ids = family.map(event => event.id);
  const mappingQuery = tx.select().from(externalEvents).where(inArray(externalEvents.eventID, ids)).orderBy(externalEvents.eventID, externalEvents.id);
  const mappings = await (readOnly ? mappingQuery : mappingQuery.for("update"));
  const root = mappings.find(item => item.eventID === master.id);
  if (!root || !root.icalUid || !strong(root.etag) || root.externalSeriesID || root.originalStart || mappings.length !== family.length ||
      new Set(mappings.map(item => item.eventID)).size !== family.length || mappings.some(item => item.provider !== "caldav" || item.calendarID !== link.calendarID || item.externalCalendarID !== link.externalCalendarID || item.icalUid !== root.icalUid || item.etag !== root.etag ||
        (item !== root && (item.externalSeriesID !== root.externalEventID || !sameCaldavScopeContext(item.originalStart, family.find(event => event.id === item.eventID)?.originalStart))))) throw unsupported();
  const resourceMaps = await tx.select({ id: externalEvents.id }).from(externalEvents).where(and(eq(externalEvents.provider, "caldav"), eq(externalEvents.calendarID, master.originCalendarID), or(eq(externalEvents.externalEventID, root.externalEventID), eq(externalEvents.externalSeriesID, root.externalEventID))));
  if (resourceMaps.length !== mappings.length || resourceMaps.some(item => !mappings.some(mapping => mapping.id === item.id))) throw unsupported();
  const pending = await tx.select().from(eventOutbox).where(and(inArray(eventOutbox.eventID, ids), sql`${eventOutbox.status} not in ('completed', 'not-needed')`));
  const own = pending.find(item => item.id === ownOperationID);
  const replaced = new Set(own?.payload.resolution?.replacedOperationIDs ?? []);
  if (pending.some(item => item.id !== ownOperationID && !(replaced.has(item.id) && item.status === "cancelled" && item.errorCode === "superseded-by-resolution" && item.eventID === master.id && item.externalCalendarLinkID === link.id && item.userID === actorID && item.payload.caldavSeries))) throw unsupported();
  const tombstones = await tx.select({ id: externalEventTombstones.id }).from(externalEventTombstones).where(and(eq(externalEventTombstones.externalCalendarLinkID, link.id), inArray(externalEventTombstones.externalEventID, mappings.map(item => item.externalEventID)))).limit(1);
  if (tombstones.length) throw unsupported();
  const retiredQuery = tx.select().from(events).where(and(eq(events.seriesID, master.id), sql`${events.deletedAt} is not null`)).orderBy(events.id);
  const retiredRows = await (readOnly ? retiredQuery : retiredQuery.for("share"));
  const retired = retiredRows.filter(item => !ids.includes(item.id));
  if (retired.some(item => item.creatorID !== actorID || item.originCalendarID !== master.originCalendarID || !item.originalStart)) throw unsupported();
  return { master, children, ...(retired.length ? { retiredDefinitions: retired.map(({ id, revision, originalStart }) => ({ id, revision, originalStart })) } : {}), link: { id: link.id, userID: link.userID, provider: link.provider, accountID: link.accountID, externalCalendarID: link.externalCalendarID, disabled: link.disabled, supportsEvents: link.supportsEvents, calendarID: master.originCalendarID }, mappings: mappings.map(({ id, provider, eventID, calendarID, externalCalendarID, externalEventID, icalUid, externalSeriesID, originalStart, etag }) => ({ id, provider, eventID, calendarID, externalCalendarID, externalEventID, icalUid, externalSeriesID, originalStart, etag })) };
}

export async function appendCaldavSeries(tx: DbTransaction, actorID: string, operationID: string, prepared: CaldavSeriesPrepared, event: Event) {
  const context = prepared.context;
  const root = context.mappings.find(item => item.eventID === context.master.id)!;
  if (!sameCaldavScopeContext(prepared.write.baseline.ref, { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid })) throw unsupported();
  await appendEventOutbox(tx, event, [{
    id: crypto.randomUUID(), actorID, mutationID: operationID, position: 0, eventID: event.id,
    calendarID: context.link.calendarID, externalCalendarLinkID: context.link.id, provider: "caldav", userID: actorID,
    accountID: context.link.accountID, externalCalendarID: context.link.externalCalendarID, externalEventID: root.externalEventID,
    expectedEtag: root.etag, icalUid: root.icalUid, action: "update", payload: { event, caldavSeries: prepared },
  }]);
}

/** Compare single RRULE syntax without losing duplicate/unknown clauses. */
export function sameCaldavRecurrence(left: unknown, right: unknown): boolean {
  const clauses = (value: unknown) => {
    if (typeof value !== "string" || !/^(?:RRULE:)?FREQ=[^\r\n]+$/i.test(value)) return null;
    const parts = value.replace(/^RRULE:/i, "").toUpperCase().split(";");
    if (new Set(parts.map(part => part.split("=")[0])).size !== parts.length) return null;
    // ICAL omits these RFC defaults. Preserve every other clause verbatim.
    return parts.filter(part => part !== "INTERVAL=1" && part !== "WKST=MO").sort().join(";");
  };
  const expected = clauses(left);
  return expected !== null && expected === clauses(right);
}

/** Keep routing, native preflight and commit consistent for supported spelling
 * differences/default clauses. This does not guess equivalence of arbitrary rules. */
export function normalizeCaldavScopeRequest(master: Event, request: EventScopeRequest): EventScopeRequest {
  return request.action === "update" && request.patch.recurrence !== undefined && sameCaldavRecurrence(request.patch.recurrence, master.recurrence)
    ? { ...request, patch: { ...request.patch, recurrence: master.recurrence } }
    : request;
}

/** Reconstruct the only permitted canonical change from the private input. */
export function caldavSeriesDesired(write: Pick<CaldavSeriesWriteIntent, "baseline" | "patch" | "targetEventID" | "cancelTarget" | "newDefinition" | "time" | "followingDelete">): CaldavSeriesWriteIntent["baseline"] {
  if (!write.patch || typeof write.patch !== "object" || Array.isArray(write.patch) || Object.keys(write.patch).some(key => !["title", "description", "location", "recurrence"].includes(key))) throw unsupported();
  const { baseline, targetEventID } = write;
  if (write.followingDelete) {
    if (targetEventID || write.cancelTarget || write.newDefinition || write.time || Object.keys(write.patch).length) throw unsupported();
    const plan = planEventScope(baseline.master, baseline.children, { operationID: baseline.master.id, scope: "following", action: "delete", expectedRevision: baseline.master.revision, ...write.followingDelete });
    // The first occurrence removes the whole resource and needs the DELETE path.
    if (plan.creates.length || plan.updates.length !== 1 || plan.updates[0]!.id !== baseline.master.id || plan.deletes.includes(baseline.master.id)) throw unsupported();
    return { ...baseline, master: plan.updates[0]!, children: baseline.children.filter(child => !plan.deletes.includes(child.id)) };
  }
  if (write.cancelTarget !== undefined && (write.cancelTarget !== true || !targetEventID || Object.keys(write.patch).length)) throw unsupported();
  if (write.patch.recurrence !== undefined && (targetEventID || !write.patch.recurrence || !/^(?:RRULE:)?FREQ=[^\r\n]+$/i.test(write.patch.recurrence) || !/^(?:RRULE:)?FREQ=[^\r\n]+$/i.test(baseline.master.recurrence ?? ""))) throw unsupported();
  if (write.time !== undefined && write.cancelTarget) throw unsupported();
  const time = write.time === undefined ? undefined : resolveEventTimeEdit(write.time);
  const currentModel = write.newDefinition || !targetEventID ? baseline.master.timeModel : baseline.children.find(child => child.id === targetEventID)?.timeModel;
  if (time && (time.timeModel.kind !== currentModel?.kind || time.timeModel.kind === "zoned" && (currentModel?.kind !== "zoned" || time.timeModel.timeZone !== currentModel.timeZone))) throw unsupported();
  if (write.newDefinition) {
    const definition = EventSchema.parse(write.newDefinition);
    if (targetEventID !== definition.id || !definition.originalStart || [baseline.master, ...baseline.children].some(item => item.id === definition.id)) throw unsupported();
    const common = { operationID: definition.id, scope: "occurrence" as const, expectedRevision: baseline.master.revision!, originalStart: definition.originalStart, expectedOccurrenceRevision: null };
    const request = write.cancelTarget ? { ...common, action: "delete" as const } : { ...common, action: "update" as const, patch: write.patch, ensureDefinition: true, time: write.time };
    const plan = planEventScope(baseline.master, baseline.children, request, () => definition.id);
    if (plan.creates.length !== 1 || plan.deletes.length || !sameCaldavScopeContext(plan.creates[0], definition)) throw unsupported();
    return { ...baseline, children: [...baseline.children, definition] };
  }
  if (!targetEventID) {
    if (!time && write.patch.recurrence === undefined) return { ...baseline, master: EventSchema.parse({ ...baseline.master, ...write.patch }) };
    const plan = planEventScope(baseline.master, baseline.children, { operationID: baseline.master.id, scope: "series", action: "update", expectedRevision: baseline.master.revision, patch: write.patch, time: write.time });
    if (plan.creates.length || plan.deletes.length) throw unsupported();
    return { ...baseline, master: plan.updates.find(item => item.id === baseline.master.id) ?? baseline.master, children: baseline.children.map(child => plan.updates.find(item => item.id === child.id) ?? child) };
  }
  const target = baseline.children.filter(child => child.id === targetEventID);
  if (target.length !== 1 || (target[0]!.isCanceled && write.cancelTarget) || !target[0]!.originalStart) throw unsupported();
  return { ...baseline, children: baseline.children.map(child => child.id === targetEventID ? EventSchema.parse({ ...child, ...write.patch, ...time, isCanceled: write.cancelTarget === true }) : child) };
}

class CaldavLeaseLost extends Error {}
/** Short transaction, no provider calls. All component validators and the lease
 * receipt advance together, or every mapping update rolls back. */
export async function confirmCaldavSeriesOutbox(id: string, token: string, result?: Ref): Promise<boolean> {
  try {
    return await db.transaction(async tx => {
      const [address] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, id));
      if (!address?.payload.caldavSeries || !address.externalEventID) return false;
      await lockCalendarLifecycle(tx, [address.calendarID], "shared");
      await lockExternalEventIdentity(tx, address.externalCalendarLinkID, address.externalEventID);
      const [master] = await tx.select().from(events).where(eq(events.id, address.eventID)).for("update");
      const allChildren = await tx.select().from(events).where(eq(events.seriesID, address.eventID)).orderBy(events.id).for("update");
      const trackedIDs = new Set(address.payload.caldavSeries.context.children.map(child => child.id));
      const children = allChildren.filter(child => !child.deletedAt || trackedIDs.has(child.id));
      if (!master || master.deletedAt) return false;
      const desired = caldavSeriesDesired(address.payload.caldavSeries.write);
      const removed = address.payload.caldavSeries.write.followingDelete ? address.payload.caldavSeries.write.baseline.children.filter(child => !desired.children.some(item => item.id === child.id)) : [];
      const removedIDs = new Set(removed.map(child => child.id));
      if (children.some(child => !!child.deletedAt !== removedIDs.has(child.id)) || removed.some(old => {
        const current = children.find(item => item.id === old.id);
        return !current || current.revision !== old.revision! + 1;
      })) return false;
      const links = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, [master.id, ...children.map(child => child.id)]));
      const snapshot = (event: typeof master) => EventSchema.parse({ ...event, calendars: links.filter(link => link.eventID === event.id).map(link => link.calendarID).sort() });
      let current: CaldavSeriesContext;
      try { current = await caldavSeriesContext(tx, address.userID, snapshot(master), children.map(snapshot), address.id); }
      catch (error) { if (error instanceof EventWriteError) return false; throw error; }
      const expected = { ...address.payload.caldavSeries.context, master: EventSchema.parse(address.payload.event) };
      const retained = current.children.filter(child => !removedIDs.has(child.id));
      if (removed.some(old => { const actual = current.children.find(item => item.id === old.id); return !actual || !sameCaldavScopeContext(EventSchema.parse({ ...old, revision: actual.revision }), actual); })) return false;
      if (!sameCaldavScopeContext(EventSchema.parse({ ...desired.master, revision: current.master.revision }), current.master) ||
          desired.children.length !== retained.length || desired.children.some(child => {
            const actual = retained.find(item => item.id === child.id);
            return !actual || !sameCaldavScopeContext(EventSchema.parse({ ...child, revision: actual.revision }), actual);
          })) return false;
      if (!sameCaldavScopeContext(current, expected) || address.provider !== "caldav" || address.action !== "update" || address.revision !== master.revision ||
          address.externalCalendarLinkID !== current.link.id || address.calendarID !== current.link.calendarID || address.accountID !== current.link.accountID || address.externalCalendarID !== current.link.externalCalendarID) return false;
      const [row] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), eq(eventOutbox.status, "attempting"), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
      if (!row || row.remoteSnapshot && !row.remoteSnapshot.isEcho) return false;
      const root = current.mappings.find(item => item.eventID === master.id)!;
      if (root.externalEventID !== row.externalEventID || root.etag !== row.expectedEtag || root.icalUid !== row.icalUid) return false;
      if (!sameCaldavScopeContext(address.payload.caldavSeries.write.baseline.ref, { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid })) return false;
      if (!result) return true;
      if (result.externalEventId !== row.externalEventID || result.icalUid !== row.icalUid || !strong(result.etag)) return false;
      const removedMappings = current.mappings.filter(item => removedIDs.has(item.eventID));
      if (removedMappings.length) await tx.delete(externalEvents).where(inArray(externalEvents.id, removedMappings.map(item => item.id)));
      await tx.update(externalEvents).set({ etag: result.etag }).where(inArray(externalEvents.id, current.mappings.filter(item => !removedIDs.has(item.eventID)).map(item => item.id)));
      const [completed] = await tx.update(eventOutbox).set({ status: "completed", errorCode: null, resultRef: result, uncertain: false, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).returning({ id: eventOutbox.id });
      if (!completed) throw new CaldavLeaseLost();
      const replaced = row.payload.resolution?.replacedOperationIDs ?? [];
      if (replaced.length) await tx.update(eventOutbox).set({ status: "not-needed", updatedAt: new Date() }).where(and(inArray(eventOutbox.id, replaced), eq(eventOutbox.eventID, row.eventID), eq(eventOutbox.externalCalendarLinkID, row.externalCalendarLinkID), eq(eventOutbox.status, "cancelled"), eq(eventOutbox.errorCode, "superseded-by-resolution")));
      return true;
    });
  } catch (error) { if (error instanceof CaldavLeaseLost) return false; throw error; }
}

/** The root deletion intent owns all local tombstones and mapping removal. */
export async function appendCaldavSeriesDeletion(tx: DbTransaction, actorID: string, operationID: string, prepared: CaldavSeriesDeletionPrepared) {
  const { context } = prepared;
  const root = context.mappings.find(item => item.eventID === context.master.id)!;
  if (!sameCaldavScopeContext(prepared.deletion.baseline.ref, { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid })) throw unsupported();
  await appendEventOutbox(tx, context.master, [{ id: crypto.randomUUID(), actorID, mutationID: operationID, position: 0, eventID: context.master.id,
    calendarID: context.link.calendarID, externalCalendarLinkID: context.link.id, provider: "caldav", userID: actorID, accountID: context.link.accountID,
    externalCalendarID: context.link.externalCalendarID, externalEventID: root.externalEventID, expectedEtag: root.etag, icalUid: root.icalUid,
    action: "delete", payload: { event: context.master, caldavSeriesDeletion: prepared } }]);
}

export async function confirmCaldavSeriesDeletionOutbox(id: string, token: string, result?: Ref): Promise<boolean> {
  try {
    return await db.transaction(async tx => {
      const [address] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, id));
      if (!address?.payload.caldavSeriesDeletion || !address.externalEventID || address.action !== "delete" || address.provider !== "caldav" || address.payload.caldavSeries || address.payload.googleOccurrence || address.payload.rsvp || address.payload.reminderEdit) return false;
      await lockCalendarLifecycle(tx, [address.calendarID], "shared");
      await lockExternalEventIdentity(tx, address.externalCalendarLinkID, address.externalEventID);
      const [master] = await tx.select().from(events).where(eq(events.id, address.eventID)).for("update");
      const allChildren = await tx.select().from(events).where(eq(events.seriesID, address.eventID)).orderBy(events.id).for("update");
      const trackedIDs = new Set(address.payload.caldavSeriesDeletion.context.children.map(child => child.id));
      const children = allChildren.filter(child => !child.deletedAt || trackedIDs.has(child.id));
      if (!master?.deletedAt || children.some(child => !child.deletedAt)) return false;
      const links = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, [master.id, ...children.map(child => child.id)]));
      const snapshot = (event: typeof master) => EventSchema.parse({ ...event, calendars: links.filter(link => link.eventID === event.id).map(link => link.calendarID).sort() });
      let current: CaldavSeriesContext;
      try { current = await caldavSeriesContext(tx, address.userID, snapshot(master), children.map(snapshot), address.id); }
      catch (error) { if (error instanceof EventWriteError) return false; throw error; }
      const prepared = address.payload.caldavSeriesDeletion;
      if (!sameCaldavScopeContext(current, prepared.context) || !sameCaldavScopeContext(current.master, EventSchema.parse(address.payload.event)) || address.revision !== master.revision ||
        address.externalCalendarLinkID !== current.link.id || address.calendarID !== current.link.calendarID || address.accountID !== current.link.accountID || address.externalCalendarID !== current.link.externalCalendarID) return false;
      const baseline = prepared.deletion.baseline;
      if (baseline.children.length !== current.children.length || [baseline.master, ...baseline.children].some(old => {
        const actual = [current.master, ...current.children].find(item => item.id === old.id);
        return !actual || actual.revision !== old.revision! + 1 || !sameCaldavScopeContext(EventSchema.parse({ ...old, revision: actual.revision }), actual);
      })) return false;
      const root = current.mappings.find(item => item.eventID === master.id)!;
      if (root.externalEventID !== address.externalEventID || root.etag !== address.expectedEtag || root.icalUid !== address.icalUid || !sameCaldavScopeContext(baseline.ref, { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid })) return false;
      const [row] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), eq(eventOutbox.status, "attempting"), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
      if (!row || row.remoteSnapshot && !row.remoteSnapshot.isEcho) return false;
      if (!result) return true;
      if (!sameCaldavScopeContext(result, baseline.ref)) return false;
      await tx.delete(externalEvents).where(inArray(externalEvents.id, current.mappings.map(item => item.id)));
      const [completed] = await tx.update(eventOutbox).set({ status: "completed", errorCode: null, resultRef: result, uncertain: false, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).returning({ id: eventOutbox.id });
      if (!completed) throw new CaldavLeaseLost();
      return true;
    });
  } catch (error) { if (error instanceof CaldavLeaseLost) return false; throw error; }
}
