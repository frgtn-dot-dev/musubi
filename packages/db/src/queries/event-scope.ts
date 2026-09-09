import { appendCaldavSeriesDeletion, type CaldavSeriesDeletionPrepared, sameCaldavRecurrence, caldavSeriesContext, caldavSeriesDesired, appendCaldavSeries, sameCaldavScopeContext, type CaldavSeriesContext, type CaldavSeriesPrepared } from "./caldav-series-scope";
import { lockExternalEventAddress } from "./event-outbox-deletions";
import { googleOccurrenceContext, appendGoogleOccurrence, type GoogleOccurrenceContext, type GoogleOccurrencePrepared } from "./google-occurrence-scope";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { planEventScope } from "@musubi/calendar";
import { BadRequestError, can, EventSchema, EventScopeOutcomeSchema, EventScopeRequestSchema, EventWriteError, occurrenceKey, type Event, type EventScopeOutcome } from "@musubi/types";
import { db } from "..";
import { calendarEvents, calendarMembers, events, eventScopeOperations, externalCalendars, externalEvents, eventOutbox } from "../schema";
import { lockCalendarLifecycle } from "./calendar-lifecycle";

type Snapshot = typeof events.$inferSelect & { calendars: string[] };
export type LocalEventScopeResult =
  | { status: "caldav_required"; context: CaldavSeriesContext; deleteResource: boolean }
  | { status: "provider_required"; context: GoogleOccurrenceContext }
  | { status: "not_found" }
  | { status: "conflict"; current: Event }
  | { status: "replayed"; outcome: EventScopeOutcome }
  | { status: "saved"; outcome: EventScopeOutcome; previous: Event[]; events: Event[] };

/** Internal local-only scope commit. Every event, tombstone and replay receipt
 * is committed together; no provider work or user notification is sent here.
 */
export async function applyLocalEventScope(eventID: string, actorID: string, input: unknown, options: { prepareProvider?: boolean; provider?: GoogleOccurrencePrepared; caldav?: CaldavSeriesPrepared; caldavDeletion?: CaldavSeriesDeletionPrepared } = {}): Promise<LocalEventScopeResult> {
  const request = EventScopeRequestSchema.parse(input);
  eventID = eventID.toLowerCase();
  const fingerprint = createHash("sha256").update(JSON.stringify({ eventID, request })).digest("hex");
  return db.transaction(async tx => {
    // Actor+operation identity is global across target events. Same-key retries
    // serialize before any family or calendar lock is taken.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["musubi:event-scope", actorID, request.operationID])}, 0))`);
    const [receipt] = await tx.select().from(eventScopeOperations).where(and(eq(eventScopeOperations.actorID, actorID), eq(eventScopeOperations.operationID, request.operationID)));
    if (receipt && receipt.fingerprint !== fingerprint) throw new BadRequestError("This scope operation ID was already used for another request.");
    const discovered = await tx.select().from(events).where(or(eq(events.id, eventID), eq(events.seriesID, eventID)));
    const initialMaster = discovered.find(event => event.id === eventID);
    if (!initialMaster) return { status: "not_found" };
    const initialIDs = discovered.map(event => event.id);
    const initialLinks = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, initialIDs));
    const fenced = [...new Set([...initialLinks.map(link => link.calendarID), ...discovered.flatMap(event => event.originCalendarID ? [event.originCalendarID] : [])])];
    await lockCalendarLifecycle(tx, fenced, "shared");
    // Whole-resource import takes this fence before the master. Discover the
    // address first, then recheck it in the locked provider context below.
    const [caldavRoot] = initialMaster.originCalendarID ? await tx.select().from(externalEvents).where(and(eq(externalEvents.provider, "caldav"), eq(externalEvents.eventID, eventID), eq(externalEvents.calendarID, initialMaster.originCalendarID))) : [];
    if (caldavRoot) await lockExternalEventAddress(tx, "caldav", caldavRoot.calendarID, caldavRoot.externalEventID);
    const [masterRow] = await tx.select().from(events).where(eq(events.id, eventID)).for("update");
    if (!masterRow) return { status: "not_found" };
    const childRows = await tx.select().from(events).where(eq(events.seriesID, eventID)).orderBy(events.id).for("update");
    const family = [masterRow, ...childRows];
    const familyIDs = family.map(event => event.id);
    const links = await tx.select().from(calendarEvents).where(inArray(calendarEvents.eventID, familyIDs));
    const calendarIDs = (id: string) => links.filter(link => link.eventID === id).map(link => link.calendarID).sort();
    const snapshot = (event: typeof events.$inferSelect): Snapshot => ({ ...event, calendars: calendarIDs(event.id) });
    const master = snapshot(masterRow);
    const authority = master.originCalendarID ? [master.originCalendarID] : [...new Set(links.map(link => link.calendarID))];
    const grants = authority.length ? await tx.select({ calendarID: calendarMembers.calendarID, role: calendarMembers.role }).from(calendarMembers).where(and(eq(calendarMembers.userID, actorID), inArray(calendarMembers.calendarID, authority))).orderBy(calendarMembers.calendarID).for("share") : [];
    if (!(master.originCalendarID === null && master.creatorID === actorID) && !grants.some(grant => (master.originCalendarID === grant.calendarID || master.calendars.includes(grant.calendarID)) && can(grant.role, "editEvents")))
      throw new EventWriteError("event-write", "denied");
    // Legacy families have no shared origin authority. A master grant alone
    // must never authorize an exception on another, private calendar.
    if (master.originCalendarID === null && master.creatorID !== actorID && childRows.some(child => !grants.some(grant => calendarIDs(child.id).includes(grant.calendarID) && can(grant.role, "editEvents"))))
      throw new EventWriteError("event-write", "denied");
    // Replays still require current permission; they disclose no old content.
    if (receipt) return { status: "replayed", outcome: EventScopeOutcomeSchema.parse(receipt.result) };
    if (master.revision !== request.expectedRevision || master.deletedAt || master.originCalendarID !== initialMaster.originCalendarID || links.some(link => !fenced.includes(link.calendarID)) || family.some(event => event.originCalendarID && !fenced.includes(event.originCalendarID)))
      return { status: "conflict", current: EventSchema.parse(master) };
    if (childRows.some(child => child.originCalendarID !== master.originCalendarID || child.creatorID !== master.creatorID))
      throw new EventWriteError("event-write", "denied", "The family contains a different event authority.");
    const [target] = fenced.length ? await tx.select({ id: externalCalendars.id }).from(externalCalendars).where(inArray(externalCalendars.calendarID, fenced)).limit(1) : [];
    const [mapping] = await tx.select({ id: externalEvents.id }).from(externalEvents).where(inArray(externalEvents.eventID, familyIDs)).limit(1);
    const [history] = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(inArray(eventOutbox.eventID, familyIDs)).limit(1);
    let providerContext: GoogleOccurrenceContext | undefined;
    let caldavContext: CaldavSeriesContext | undefined;
    if (target || mapping || history) {
      if (caldavRoot && ["series", "occurrence", "following"].includes(request.scope) && (options.prepareProvider || options.caldav || options.caldavDeletion)) {
        if ((request.action === "update" && (Object.keys(request.patch).some(key => !["title", "description", "location", "recurrence"].includes(key)))) || (request.scope === "following" && request.action !== "delete"))
          throw new EventWriteError("event-write", "unsupported", "CalDAV scope editing supports series content/time and occurrence content/time/cancellation. No changes were saved.");
        if (request.scope === "occurrence" && request.action === "delete" && childRows.some(child => !child.deletedAt && child.isCanceled && sameCaldavScopeContext(child.originalStart, request.originalStart))) throw new EventWriteError("event-write", "unsupported");
        if (request.action === "update" && request.patch.recurrence !== undefined && (!request.patch.recurrence || !/^(?:RRULE:)?FREQ=[^\r\n]+$/i.test(request.patch.recurrence) || !/^(?:RRULE:)?FREQ=[^\r\n]+$/i.test(master.recurrence ?? ""))) throw new EventWriteError("event-write", "unsupported");
        caldavContext = await caldavSeriesContext(tx, actorID, EventSchema.parse(master), childRows.filter(child => !child.deletedAt).map(child => EventSchema.parse(snapshot(child))));
        if (options.caldavDeletion && (!["series", "following"].includes(request.scope) || request.action !== "delete" || !sameCaldavScopeContext(options.caldavDeletion.context, caldavContext) || !sameCaldavScopeContext(options.caldavDeletion.deletion.baseline.master, caldavContext.master) || !sameCaldavScopeContext(options.caldavDeletion.deletion.baseline.children, caldavContext.children))) return { status: "conflict", current: EventSchema.parse(master) };
        if (options.caldav && (request.scope === "following" ? request.action !== "delete" || !sameCaldavScopeContext(options.caldav.write.followingDelete, { originalStart: request.originalStart, expectedOccurrenceRevision: request.expectedOccurrenceRevision }) : options.caldav.write.followingDelete !== undefined)) throw new EventWriteError("event-write", "unsupported");
        if (options.caldav && request.scope === "series" && request.action === "delete") throw new EventWriteError("event-write", "unsupported");
        if (options.caldav && (!sameCaldavScopeContext(options.caldav.write.baseline.master, caldavContext.master) || !sameCaldavScopeContext(options.caldav.write.baseline.children, caldavContext.children)))
          return { status: "conflict", current: EventSchema.parse(master) };
        if (caldavContext.mappings.find(item => item.eventID === eventID)?.externalEventID !== caldavRoot.externalEventID || options.caldav && !sameCaldavScopeContext(options.caldav.context, caldavContext))
          return { status: "conflict", current: EventSchema.parse(master) };
      } else {
        if ((!options.prepareProvider && !options.provider) || request.scope !== "occurrence") throw new EventWriteError("event-write", "unsupported", "This family requires a provider-aware scope operation. No changes were saved.");
        providerContext = await googleOccurrenceContext(tx, actorID, EventSchema.parse(master), childRows.filter(child => !child.deletedAt).map(child => EventSchema.parse(snapshot(child))));
        if (options.provider && (options.provider.context.link.id !== providerContext.link.id || options.provider.context.link.accountID !== providerContext.link.accountID || options.provider.context.mapping.id !== providerContext.mapping.id || options.provider.context.mapping.etag !== providerContext.mapping.etag))
        return { status: "conflict", current: EventSchema.parse(master) };
      }
    }
    const liveChildren = childRows.filter(child => !child.deletedAt).map(child => EventSchema.parse(snapshot(child)));
    const existing = request.originalStart ? liveChildren.find(child => child.originalStart && occurrenceKey({ seriesId: eventID, originalStart: child.originalStart }) === occurrenceKey({ seriesId: eventID, originalStart: request.originalStart! })) : undefined;
    if (request.scope !== "series" && (existing?.revision ?? null) !== request.expectedOccurrenceRevision)
      return { status: "conflict", current: EventSchema.parse(master) };
    // The unique original-start index includes tombstones. Reusing a deleted
    // definition's ID preserves identity when that generated slot is edited again.
    const revival = request.scope === "occurrence" ? childRows.find(child => child.deletedAt && child.originalStart && occurrenceKey({ seriesId: eventID, originalStart: child.originalStart }) === occurrenceKey({ seriesId: eventID, originalStart: request.originalStart! })) : undefined;
    let plan;
    try {
      let plannedRequest = request;
      if (options.caldav && request.action === "update" && request.patch.recurrence !== undefined) {
        if (!sameCaldavRecurrence(request.patch.recurrence, options.caldav.write.patch.recurrence)) throw new EventWriteError("event-write", "unsupported");
        plannedRequest = { ...request, patch: { ...request.patch, recurrence: options.caldav.write.patch.recurrence } };
      }
      plan = planEventScope(EventSchema.parse(master), liveChildren, plannedRequest, () => revival?.id ?? options.caldav?.write.newDefinition?.id ?? randomUUID());
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Invalid scope operation.");
    }
    if (providerContext && (request.action === "update" && request.patch.url !== undefined || [...plan.creates, ...plan.updates].some(event => event.seriesID === master.id && (!["zoned", "all-day"].includes(event.timeModel?.kind ?? "") || event.timeModel?.kind !== master.timeModel?.kind))))
      throw new EventWriteError("event-write", "unsupported", "Google occurrence editing requires a supported time kind and provider content. No changes were saved.");
    if (caldavContext && [...plan.updates, ...plan.creates].some(next => next.seriesID === master.id && childRows.some(old => old.deletedAt && old.id !== next.id && sameCaldavScopeContext(old.originalStart, next.originalStart))))
      throw new EventWriteError("event-write", "unsupported", "This change collides with a retired occurrence identity. No changes were saved.");
    if (caldavContext && !options.caldav && !options.caldavDeletion) return { status: "caldav_required", context: caldavContext, deleteResource: plan.deletes.includes(master.id) };
    if (providerContext && !options.provider) return { status: "provider_required", context: providerContext };
    const outcome: EventScopeOutcome = { operationID: request.operationID, changed: false, events: [], deleted: [] };
    const previous: Event[] = [];
    const saved: Event[] = [];
    const byID = new Map(family.map(event => [event.id, event]));
    const changedFamily = plan.creates.length || plan.deletes.length || plan.updates.some(event => event.id !== master.id || JSON.stringify(event) !== JSON.stringify(EventSchema.parse(master)));
    // Validate final family identity, not intermediate positions when adjacent
    // exceptions shift into one another’s old slots. Other writers stay immediate.
    await tx.execute(sql`SET CONSTRAINTS events_series_original_start_unique DEFERRED`);
    // Creates come first so a following split can reparent children under the
    // new master while the non-deferrable series FK remains valid.
    for (const event of [...plan.creates, ...plan.updates]) {
      const current = byID.get(event.id);
      const { calendars: eventCalendars, revision: _revision, ...content } = event;
      const old = current ? EventSchema.parse(snapshot(current)) : undefined;
      const equal = old && JSON.stringify(old) === JSON.stringify(event);
      if (current && !current.deletedAt && equal && !(event.id === master.id && changedFamily)) continue;
      if (old && !current!.deletedAt) previous.push(old);
      let row;
      if (current) {
        [row] = await tx.update(events).set({ ...content, deletedAt: null, revision: sql`${events.revision} + 1` }).where(eq(events.id, event.id)).returning();
      } else {
        [row] = await tx.insert(events).values({ ...content, revision: 1 }).returning();
      }
      if (!current || current.deletedAt) {
        if (current) await tx.delete(calendarEvents).where(eq(calendarEvents.eventID, event.id));
        for (const calendarID of eventCalendars) await tx.insert(calendarEvents).values({ eventID: event.id, calendarID }).onConflictDoNothing();
      }
      const result = EventSchema.parse({ ...row, calendars: current && !current.deletedAt ? calendarIDs(event.id) : eventCalendars });
      saved.push(result);
      outcome.events.push({ id: row.id, revision: row.revision });
    }
    for (const id of plan.deletes) {
      const current = byID.get(id);
      if (!current || current.deletedAt) continue;
      previous.push(EventSchema.parse(snapshot(current)));
      const [row] = await tx.update(events).set({ deletedAt: new Date(), revision: sql`${events.revision} + 1` }).where(eq(events.id, id)).returning();
      outcome.deleted.push({ id: row.id, revision: row.revision });
    }
    if (providerContext && options.provider) {
      for (const event of saved.filter(event => event.seriesID === master.id))
        await appendGoogleOccurrence(tx, actorID, request.operationID, { ...providerContext, master: saved.find(item => item.id === master.id) ?? providerContext.master }, options.provider, event);
    }
    if (caldavContext && options.caldavDeletion) {
      const trackedFamily = [caldavContext.master, ...caldavContext.children];
      if (saved.length || outcome.deleted.length !== trackedFamily.length || !trackedFamily.every(event => outcome.deleted.some(item => item.id === event.id))) throw new EventWriteError("event-write", "unsupported");
      const tombstones = await tx.select().from(events).where(inArray(events.id, trackedFamily.map(item => item.id)));
      const deletedMaster = tombstones.find(item => item.id === master.id)!;
      const deletedChildren = tombstones.filter(item => item.id !== master.id).sort((a, b) => a.id.localeCompare(b.id));
      await appendCaldavSeriesDeletion(tx, actorID, request.operationID, { ...options.caldavDeletion, context: { ...caldavContext, master: EventSchema.parse(snapshot(deletedMaster)), children: deletedChildren.map(item => EventSchema.parse(snapshot(item))) } });
    }
    if (caldavContext && options.caldav) {
      const changedMaster = saved.find(event => event.id === master.id);
      if (changedMaster) {
        // The provider preparation must describe exactly this planner result.
        const desired = caldavSeriesDesired(options.caldav.write);
        let actualChildren = [...caldavContext.children.map(child => saved.find(item => item.id === child.id) ?? child), ...saved.filter(child => child.seriesID === master.id && !caldavContext.children.some(existing => existing.id === child.id))].sort((a, b) => a.id.localeCompare(b.id));
        const removedIDs = options.caldav.write.followingDelete ? caldavContext.children.filter(child => !desired.children.some(item => item.id === child.id)).map(child => child.id) : [];
        if (outcome.deleted.length !== removedIDs.length || outcome.deleted.some(item => !removedIDs.includes(item.id))) throw new EventWriteError("event-write", "unsupported");
        if (removedIDs.length) {
          const removedRows = await tx.select().from(events).where(inArray(events.id, removedIDs));
          actualChildren = actualChildren.map(child => { const row = removedRows.find(item => item.id === child.id); return row ? EventSchema.parse(snapshot(row)) : child; });
        }
        const retainedChildren = actualChildren.filter(child => !removedIDs.includes(child.id));
        if (!sameCaldavScopeContext(EventSchema.parse({ ...desired.master, revision: changedMaster.revision }), changedMaster) || saved.some(item => item.id !== master.id && !desired.children.some(child => child.id === item.id)) || desired.children.length !== retainedChildren.length || desired.children.some(child => {
          const actual = retainedChildren.find(item => item.id === child.id);
          return !actual || !sameCaldavScopeContext(EventSchema.parse({ ...child, revision: actual.revision }), actual);
        })) throw new EventWriteError("event-write", "unsupported", "CalDAV preparation no longer matches the scope plan.");
        if (options.caldav.write.newDefinition) {
          const child = saved.find(item => item.id === options.caldav!.write.newDefinition!.id)!;
          const root = caldavContext.mappings.find(item => item.eventID === master.id)!;
          await tx.insert(externalEvents).values({
            provider: "caldav", eventID: child.id, calendarID: root.calendarID,
            externalCalendarID: root.externalCalendarID,
            externalEventID: root.externalEventID + "#musubi-original=" + encodeURIComponent(JSON.stringify(child.originalStart)),
            externalSeriesID: root.externalEventID, originalStart: child.originalStart,
            icalUid: root.icalUid, etag: root.etag,
          });
        }
        const remapped = caldavContext.mappings.flatMap(mapping => {
          const child = actualChildren.find(item => item.id === mapping.eventID);
          return child && !sameCaldavScopeContext(mapping.originalStart, child.originalStart) ? [{ mapping, child }] : [];
        });
        // Adjacent recurrence identities can move into one another's old URL
        // suffixes. Reserve temporary addresses inside this transaction first.
        for (const { mapping } of remapped) await tx.update(externalEvents).set({ externalEventID: mapping.externalSeriesID! + "#musubi-pending=" + randomUUID() }).where(eq(externalEvents.id, mapping.id));
        for (const { mapping, child } of remapped) await tx.update(externalEvents).set({ externalEventID: mapping.externalSeriesID! + "#musubi-original=" + encodeURIComponent(JSON.stringify(child.originalStart)), originalStart: child.originalStart }).where(eq(externalEvents.id, mapping.id));
        const queuedContext = await caldavSeriesContext(tx, actorID, changedMaster, actualChildren);
        await appendCaldavSeries(tx, actorID, request.operationID, { ...options.caldav, context: queuedContext }, changedMaster);
      }
    }
    outcome.changed = outcome.events.length + outcome.deleted.length > 0;
    await tx.insert(eventScopeOperations).values({ actorID, operationID: request.operationID, eventID, fingerprint, result: outcome });
    return { status: "saved", outcome, previous, events: saved };
  });
}
