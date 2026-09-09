import { assertNoPendingGraphSeriesCreate } from "./graph-series-create";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { expandRecurringEvents } from "@musubi/calendar";
import { EventSchema, OccurrenceStartSchema, ProviderEventStateSchema, type EventTimeModel, type OccurrenceIdentity, type OccurrenceStart, type ProviderEventState } from "@musubi/types";
import { db } from "..";
import { account, calendarEvents, calendarMembers, events, externalCalendars, externalEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";
import { hasProviderSyncScopes } from "./oauth";

const DAY = 86_400_000;
const canonical = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const key = (value: OccurrenceStart) => JSON.stringify(OccurrenceStartSchema.parse(value));
function refuse(): never { throw new Error("The accepted Graph family changed or is unsupported. Retry complete reconciliation."); }

type Address = { userID: string; accountID: string; calendarID: string; externalMasterID: string };
type Values = Pick<typeof events.$inferSelect, "title" | "start" | "end" | "isAllDay" | "description" | "location" | "organizer" | "recurrence" | "url"> & { timeModel: EventTimeModel };
type Active = { externalID: string; icalUid: string; etag: string | null; providerState: ProviderEventState; values: Values; originalStart: OccurrenceStart };
export type GraphFamilyObservation = {
  master: Omit<Active, "originalStart">;
  instances: Active[];
  cancelled: { originalStart: OccurrenceStart; start: Date; end: Date; isAllDay: boolean; timeModel: EventTimeModel }[];
};

async function lockAddress(tx: DbTransaction, address: Address) {
  await lockUserLifecycle(tx, [address.userID], "shared");
  await lockCalendarLifecycle(tx, [address.calendarID], "exclusive");
}
async function accepted(tx: DbTransaction, address: Address) {
  const [initial] = await tx.select().from(externalEvents).where(and(eq(externalEvents.provider, "microsoft"), eq(externalEvents.calendarID, address.calendarID), eq(externalEvents.externalEventID, address.externalMasterID)));
  if (!initial) refuse();
  const [root] = await tx.select().from(events).where(eq(events.id, initial.eventID)).for("update");
  if (!root || root.isCanceled || root.seriesID || root.originalStart || !root.recurrence || !["zoned", "all-day"].includes(root.timeModel?.kind ?? "")) refuse();
  const children = await tx.select().from(events).where(eq(events.seriesID, root.id)).orderBy(events.id).for("update");
  const family = [root, ...children], ids = family.map(value => value.id);
  if (family.some(value => value.creatorID !== address.userID || value.originCalendarID !== address.calendarID)) refuse();
  const memberships = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, ids)).orderBy(calendarEvents.eventID, calendarEvents.calendarID).for("share");
  if (memberships.length !== ids.length || ids.some(id => memberships.filter(value => value.eventID === id).length !== 1) || memberships.some(value => value.calendarID !== address.calendarID)) refuse();
  const [grant] = await tx.select().from(calendarMembers).where(and(eq(calendarMembers.calendarID, address.calendarID), eq(calendarMembers.userID, address.userID))).for("share");
  const [link] = await tx.select().from(externalCalendars).where(eq(externalCalendars.calendarID, address.calendarID)).for("share");
  if (!grant || !["owner", "editor", "viewer"].includes(grant.role) || !link || link.provider !== "microsoft" || link.userID !== address.userID || link.accountID !== address.accountID || link.disabled || !link.supportsEvents || initial.externalCalendarID !== link.externalCalendarID) refuse();
  // Never include credentials in the accepted context or returned observation.
  const [connection] = await tx.select({ id: account.id, scope: account.scope, syncStatus: account.syncStatus, hasRefreshToken: sql<boolean>`coalesce(length(${account.refreshToken}), 0) > 0` }).from(account).where(and(eq(account.userId, address.userID), eq(account.providerId, "microsoft"), eq(account.accountId, address.accountID))).for("share");
  if (!connection || !connection.hasRefreshToken || connection.syncStatus !== "active" || !hasProviderSyncScopes("microsoft", connection.scope ?? "")) refuse();
  const mappings = await tx.select().from(externalEvents).where(or(inArray(externalEvents.eventID, ids), and(eq(externalEvents.provider, "microsoft"), eq(externalEvents.calendarID, address.calendarID), eq(externalEvents.externalSeriesID, address.externalMasterID)))).orderBy(externalEvents.id).for("update");
  const rootMap = mappings.find(value => value.id === initial.id);
  if (!rootMap?.icalUid || rootMap.externalSeriesID || rootMap.originalStart || mappings.filter(value => value.eventID === root.id).length !== 1 ||
      mappings.some(value => !ids.includes(value.eventID) || value.provider !== "microsoft" || value.calendarID !== address.calendarID || value.externalCalendarID !== link.externalCalendarID ||
        (value.eventID !== root.id && (value.externalSeriesID !== address.externalMasterID || !value.originalStart || !children.find(child => child.id === value.eventID)?.originalStart || key(value.originalStart) !== key(children.find(child => child.id === value.eventID)!.originalStart!)))) ||
      new Set(mappings.map(value => value.eventID)).size !== mappings.length || children.some(value => !value.originalStart || value.recurrence || (!value.deletedAt && !value.isCanceled && !mappings.some(mapping => mapping.eventID === value.id)))) refuse();
  const pending = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(inArray(eventOutbox.eventID, ids), sql`(${eventOutbox.status} not in ('completed', 'not-needed') and not (
    ${eventOutbox.status} = 'cancelled' and ${eventOutbox.errorCode} = 'superseded-by-resolution'
    and exists (select 1 from event_outbox replacement
      where replacement.event_id = ${eventOutbox.eventID}
        and replacement.external_calendar_link_id = ${eventOutbox.externalCalendarLinkID}
        and replacement.provider = ${eventOutbox.provider} and replacement.user_id = ${eventOutbox.userID}
        and replacement.account_id = ${eventOutbox.accountID} and replacement.calendar_id = ${eventOutbox.calendarID}
        and replacement.external_calendar_id = ${eventOutbox.externalCalendarID}
        and replacement.status in ('completed', 'not-needed')
        and replacement.payload->'resolution'->'replacedOperationIDs' ? ${eventOutbox.id}::text)
  ))`)).limit(1);
  if (pending.length || new Set(children.map(value => key(value.originalStart!))).size !== children.length) refuse();
  return { address, root, children, memberships, grant, link, connection, mappings };
}
export type GraphFamilyContext = Awaited<ReturnType<typeof accepted>>;

/** Private tracked-family preparation, not native discovery or create ACK. */
export async function readGraphFamilyContext(address: Address): Promise<GraphFamilyContext> {
  address = { ...address };
  return db.transaction(async tx => { await lockAddress(tx, address); return accepted(tx, address); }).catch(() => { throw new Error("Accepted Graph family could not be read."); });
}

/** Atomically replaces a previously accepted, exclusively owned Graph family.
 * Caller supplies COMPLETE finite native proof, never calendarView absence.
 * Used by tracked-family sync; native create delivery/ACK is separate. */
export async function replaceGraphFamily(context: GraphFamilyContext, observation: GraphFamilyObservation): Promise<{ changed: boolean; seenExternalIDs: string[] }> {
  context = structuredClone(context); observation = structuredClone(observation);
  return db.transaction(async tx => {
    await lockAddress(tx, context.address);
    for (const value of [...observation.instances, ...observation.cancelled]) value.originalStart = OccurrenceStartSchema.parse(value.originalStart);
    const current = await accepted(tx, context.address);
    if (!same(context, current)) refuse();
    const { root, children, mappings, address } = current;
    const rootMap = mappings.find(value => value.eventID === root.id)!;
    if (observation.master.externalID !== address.externalMasterID || observation.master.icalUid !== rootMap.icalUid || !observation.master.values.recurrence || !/(?:^|;)COUNT=[1-9]\d*(?:;|$)/.test(observation.master.values.recurrence.replace(/^RRULE:/, ""))) refuse();
    const candidate = EventSchema.parse({ ...root, ...observation.master.values, calendars: [address.calendarID] });
    if (!["zoned", "all-day"].includes(candidate.timeModel?.kind ?? "") || observation.instances.length + observation.cancelled.length > 366) refuse();
    const slots = expandRecurringEvents<typeof candidate & { occurrenceIdentity?: OccurrenceIdentity }>([candidate], candidate.start, new Date(candidate.start.getTime() + 730 * DAY), { consumerTimeZone: "UTC" });
    const count = /(?:^|;)COUNT=([1-9]\d*)(?:;|$)/.exec(candidate.recurrence!.replace(/^RRULE:/, ""));
    if (!count || Number(count[1]) !== slots.length || slots.length !== observation.instances.length + observation.cancelled.length || slots.length > 366 ||
        slots.some(value => value.end.getTime() + (value.isAllDay ? DAY : 0) > candidate.start.getTime() + 730 * DAY)) refuse();
    const footprint = new Map(slots.map(value => [key(value.occurrenceIdentity!.originalStart), value]));
    const originals = new Set<string>(), nativeIDs = new Set([address.externalMasterID]);
    for (const value of [...observation.instances, ...observation.cancelled]) {
      const original = key(value.originalStart);
      if (!footprint.has(original) || originals.has(original)) refuse();
      originals.add(original);
    }
    for (const value of observation.instances) {
      if (!value.externalID || !value.icalUid || nativeIDs.has(value.externalID) || value.values.recurrence) refuse();
      nativeIDs.add(value.externalID);
    }
    const collisions = await tx.select().from(externalEvents).where(and(eq(externalEvents.provider, "microsoft"), eq(externalEvents.calendarID, address.calendarID), inArray(externalEvents.externalEventID, [...nativeIDs]))).for("update");
    if (collisions.some(value => !mappings.some(mapping => mapping.id === value.id))) refuse();
    const fields = ["title", "start", "end", "isAllDay", "description", "location", "organizer", "recurrence", "url", "timeModel", "seriesID", "originalStart", "isCanceled", "deletedAt"] as const;
    let changed = false;
    const save = async (previous: typeof events.$inferSelect | undefined, values: typeof root) => {
      if (!previous) {
        await tx.insert(events).values({ ...values, createdAt: new Date(), updatedAt: new Date(), hasAttendees: false });
        await tx.insert(calendarEvents).values({ eventID: values.id, calendarID: address.calendarID });
        changed = true; return;
      }
      const patch = Object.fromEntries(fields.filter(field => !same(previous[field], values[field])).map(field => [field, values[field]]));
      if (Object.keys(patch).length) {
        await tx.update(events).set({ ...patch, revision: sql`${events.revision} + 1` }).where(eq(events.id, previous.id));
        changed = true;
      }
    };
    const map = async (id: string, value: Omit<Active, "originalStart">, originalStart: OccurrenceStart | null) => {
      const providerState = ProviderEventStateSchema.parse(value.providerState);
      if (providerState.provider !== "microsoft") refuse();
      const previous = mappings.find(mapping => mapping.eventID === id);
      const values = { provider: "microsoft", eventID: id, calendarID: address.calendarID, externalCalendarID: current.link.externalCalendarID, externalEventID: value.externalID, etag: value.etag, icalUid: value.icalUid, externalSeriesID: originalStart ? address.externalMasterID : null, originalStart, providerState };
      if (previous && previous.externalEventID !== value.externalID) await tx.delete(externalEvents).where(eq(externalEvents.id, previous.id));
      if (!previous || previous.externalEventID !== value.externalID) {
        await tx.insert(externalEvents).values({ ...values, providerStateObservedAt: new Date() }); changed = true;
      } else if (Object.entries(values).some(([field, value]) => !same(previous[field as keyof typeof previous], value))) {
        await tx.update(externalEvents).set({ ...values, providerStateObservedAt: new Date() }).where(eq(externalEvents.id, previous.id)); changed = true;
      }
    };
    const prepared = observation.instances.map(value => {
      const previous = children.find(child => key(child.originalStart!) === key(value.originalStart));
      const values = { ...root, ...value.values, id: previous?.id ?? randomUUID(), revision: previous?.revision ?? 1, seriesID: root.id, originalStart: value.originalStart, isCanceled: false, deletedAt: null };
      return { previous, values, native: value, event: EventSchema.parse({ ...values, calendars: [address.calendarID] }) };
    });
    // Validate the proposed family once, including moved-out definitions. Do
    // not re-expand the entire COUNT sequence separately for every child.
    expandRecurringEvents([candidate, ...prepared.map(value => value.event)], candidate.start, new Date(candidate.start.getTime() + 730 * DAY), { consumerTimeZone: "UTC", includeAllNonRecurring: true });
    await save(root, { ...root, ...observation.master.values, deletedAt: null });
    await map(root.id, observation.master, null);
    for (const value of prepared) {
      await save(value.previous, value.values); await map(value.values.id, value.native, value.values.originalStart);
    }
    for (const value of observation.cancelled) {
      const previous = children.find(child => key(child.originalStart!) === key(value.originalStart));
      const slot = footprint.get(key(value.originalStart))!;
      if (!same({ start: slot.start, end: slot.end, isAllDay: slot.isAllDay, timeModel: slot.timeModel }, { start: value.start, end: value.end, isAllDay: value.isAllDay, timeModel: value.timeModel })) refuse();
      // Preserve any previously observed exception content/time and native map.
      const values = previous ? { ...previous, originalStart: value.originalStart, isCanceled: true, deletedAt: null } : { ...root, ...observation.master.values, start: slot.start, end: slot.end, isAllDay: slot.isAllDay, timeModel: slot.timeModel!, id: randomUUID(), revision: 1, seriesID: root.id, originalStart: value.originalStart, recurrence: null, isCanceled: true, deletedAt: null };
      await save(previous, values);
    }
    for (const previous of children.filter(value => !originals.has(key(value.originalStart!)))) {
      if (!previous.deletedAt) await save(previous, { ...previous, deletedAt: new Date() });
      const removed = await tx.delete(externalEvents).where(and(eq(externalEvents.eventID, previous.id), eq(externalEvents.calendarID, address.calendarID), eq(externalEvents.provider, "microsoft"))).returning({ id: externalEvents.id });
      if (removed.length) changed = true;
    }
    const retained = await tx.select({ id: externalEvents.externalEventID }).from(externalEvents).where(and(eq(externalEvents.provider, "microsoft"), eq(externalEvents.calendarID, address.calendarID), or(eq(externalEvents.externalEventID, address.externalMasterID), eq(externalEvents.externalSeriesID, address.externalMasterID))));
    return { changed, seenExternalIDs: retained.map(value => value.id).sort() };
  }).catch(() => { throw new Error("Complete Graph family could not be persisted."); });
}

/** Already accepted native masters only; never discovers or promotes ordinary
 * provider-expanded rows into a canonical family. */
export async function listGraphFamilyContexts(userID: string, accountID: string, calendarID: string): Promise<GraphFamilyContext[]> {
  await db.transaction(async tx => { await lockUserLifecycle(tx, [userID], "shared"); await lockCalendarLifecycle(tx, [calendarID], "shared"); await assertNoPendingGraphSeriesCreate(tx, calendarID); });
  const roots = await db.select({ externalMasterID: externalEvents.externalEventID }).from(externalEvents)
    .innerJoin(events, eq(events.id, externalEvents.eventID))
    .innerJoin(externalCalendars, eq(externalCalendars.calendarID, externalEvents.calendarID))
    .where(and(eq(externalEvents.provider, "microsoft"), eq(externalEvents.calendarID, calendarID), eq(externalCalendars.provider, "microsoft"), eq(externalCalendars.userID, userID), eq(externalCalendars.accountID, accountID),
      sql`${events.seriesID} is null and ${events.recurrence} is not null and ${events.recurrence} <> '' and ${events.timeModel}->>'kind' in ('zoned', 'all-day')`)).orderBy(externalEvents.externalEventID);
  const result: GraphFamilyContext[] = [];
  for (const root of roots) result.push(await readGraphFamilyContext({ userID, accountID, calendarID, externalMasterID: root.externalMasterID }));
  return result;
}

/** Fresh negative native proof removes the whole accepted family locally.
 * Retain native maps and original UUIDs for subsequent full-proof revival. */
export async function removeGraphFamily(context: GraphFamilyContext): Promise<{ changed: boolean; seenExternalIDs: string[] }> {
  context = structuredClone(context);
  return db.transaction(async tx => {
    await lockAddress(tx, context.address);
    const current = await accepted(tx, context.address);
    if (!same(context, current)) refuse();
    let changed = false;
    for (const value of [current.root, ...current.children]) if (!value.deletedAt) {
      await tx.update(events).set({ deletedAt: new Date(), revision: sql`${events.revision} + 1` }).where(eq(events.id, value.id));
      changed = true;
    }
    return { changed, seenExternalIDs: current.mappings.map(value => value.externalEventID).sort() };
  }).catch(() => { throw new Error("Complete Graph family could not be removed."); });
}
