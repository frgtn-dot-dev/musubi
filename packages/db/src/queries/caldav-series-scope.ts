import { and, eq, inArray, or, sql } from "drizzle-orm";
import { EventSchema, EventWriteError, type Event } from "@musubi/types";
import { db } from "..";
import { calendarEvents, events, externalCalendars, externalEvents, externalEventTombstones, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { appendEventOutbox } from "./event-outbox";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { lockExternalEventIdentity } from "./event-outbox-deletions";

type Ref = { externalEventId: string; etag?: string | null; icalUid?: string | null };
export type CaldavSeriesContext = {
  master: Event;
  children: Event[];
  link: Pick<typeof externalCalendars.$inferSelect, "id" | "userID" | "provider" | "accountID" | "externalCalendarID" | "disabled" | "supportsEvents"> & { calendarID: string };
  mappings: Pick<typeof externalEvents.$inferSelect, "id" | "provider" | "eventID" | "calendarID" | "externalCalendarID" | "externalEventID" | "icalUid" | "externalSeriesID" | "originalStart" | "etag">[];
};
/** Private server-only resource input. Never project this into a public DTO. */
export type CaldavSeriesWriteIntent = {
  baseline: { ref: Ref; master: Event; children: Event[] };
  patch: Pick<Partial<Event>, "title" | "description" | "location">;
  before: string;
  after: string;
};
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
  return { master, children, link: { id: link.id, userID: link.userID, provider: link.provider, accountID: link.accountID, externalCalendarID: link.externalCalendarID, disabled: link.disabled, supportsEvents: link.supportsEvents, calendarID: master.originCalendarID }, mappings: mappings.map(({ id, provider, eventID, calendarID, externalCalendarID, externalEventID, icalUid, externalSeriesID, originalStart, etag }) => ({ id, provider, eventID, calendarID, externalCalendarID, externalEventID, icalUid, externalSeriesID, originalStart, etag })) };
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
      const children = await tx.select().from(events).where(eq(events.seriesID, address.eventID)).orderBy(events.id).for("update");
      if (!master || master.deletedAt || children.some(child => child.deletedAt)) return false;
      const links = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, [master.id, ...children.map(child => child.id)]));
      const snapshot = (event: typeof master) => EventSchema.parse({ ...event, calendars: links.filter(link => link.eventID === event.id).map(link => link.calendarID).sort() });
      let current: CaldavSeriesContext;
      try { current = await caldavSeriesContext(tx, address.userID, snapshot(master), children.map(snapshot), address.id); }
      catch (error) { if (error instanceof EventWriteError) return false; throw error; }
      const expected = { ...address.payload.caldavSeries.context, master: EventSchema.parse(address.payload.event) };
      if (!sameCaldavScopeContext(current, expected) || address.provider !== "caldav" || address.action !== "update" || address.revision !== master.revision ||
          address.externalCalendarLinkID !== current.link.id || address.calendarID !== current.link.calendarID || address.accountID !== current.link.accountID || address.externalCalendarID !== current.link.externalCalendarID) return false;
      const [row] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), eq(eventOutbox.status, "attempting"), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
      if (!row || row.remoteSnapshot && !row.remoteSnapshot.isEcho) return false;
      const root = current.mappings.find(item => item.eventID === master.id)!;
      if (root.externalEventID !== row.externalEventID || root.etag !== row.expectedEtag || root.icalUid !== row.icalUid) return false;
      if (!sameCaldavScopeContext(address.payload.caldavSeries.write.baseline.ref, { externalEventId: root.externalEventID, etag: root.etag, icalUid: root.icalUid })) return false;
      if (!result) return true;
      if (result.externalEventId !== row.externalEventID || result.icalUid !== row.icalUid || !strong(result.etag)) return false;
      await tx.update(externalEvents).set({ etag: result.etag }).where(inArray(externalEvents.id, current.mappings.map(item => item.id)));
      const [completed] = await tx.update(eventOutbox).set({ status: "completed", errorCode: null, resultRef: result, uncertain: false, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).returning({ id: eventOutbox.id });
      if (!completed) throw new CaldavLeaseLost();
      const replaced = row.payload.resolution?.replacedOperationIDs ?? [];
      if (replaced.length) await tx.update(eventOutbox).set({ status: "not-needed", updatedAt: new Date() }).where(and(inArray(eventOutbox.id, replaced), eq(eventOutbox.eventID, row.eventID), eq(eventOutbox.externalCalendarLinkID, row.externalCalendarLinkID), eq(eventOutbox.status, "cancelled"), eq(eventOutbox.errorCode, "superseded-by-resolution")));
      return true;
    });
  } catch (error) { if (error instanceof CaldavLeaseLost) return false; throw error; }
}
