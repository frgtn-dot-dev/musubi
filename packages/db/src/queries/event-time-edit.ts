import { expandRecurringEvents, resolveEventTimeEdit } from "@musubi/calendar";
import { BadRequestError, EventTimeModelSchema, EventTimeContentPatchSchema, EventWriteError, can } from "@musubi/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "..";
import {
  calendarEvents,
  calendarMembers,
  events,
  externalCalendars,
  externalEvents,
  eventOutbox,
} from "../schema";
import { lockCalendarLifecycle } from "./calendar-lifecycle";

type Snapshot = typeof events.$inferSelect & { calendars: string[] };
export type LocalEventTimeEditResult =
  | { status: "not_found" }
  | { status: "conflict"; current: Snapshot }
  | { status: "saved"; changed: boolean; previous: Snapshot; event: Snapshot };

/** Internal local-only writer. The API caller must preflight access and
 * publish the returned committed snapshot afterward. The actor is rechecked within the transaction.
 * Provider histories and occurrence families require the later scope/outbox path.
 */
export async function replaceLocalEventTimeAtRevision(
  eventID: string,
  expectedRevision: number,
  intent: unknown,
  actorID: string,
  contentPatch: unknown = {},
): Promise<LocalEventTimeEditResult> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new TypeError("A positive expected event revision is required");
  return db.transaction(async (tx) => {
    // Discover the complete fence before taking any event row lock. Revalidate
    // after locking rather than upgrading the fence if membership changed.
    const [discovered] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventID));
    if (!discovered) return { status: "not_found" };
    const initialLinks = await tx
      .select({ id: calendarEvents.calendarID })
      .from(calendarEvents)
      .where(eq(calendarEvents.eventID, eventID));
    const fenced = [
      ...new Set([
        ...initialLinks.map((link) => link.id),
        ...(discovered.originCalendarID ? [discovered.originCalendarID] : []),
      ]),
    ];
    await lockCalendarLifecycle(tx, fenced, "shared");
    const [current] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventID))
      .for("update");
    if (!current) return { status: "not_found" };
    const links = await tx
      .select({ id: calendarEvents.calendarID })
      .from(calendarEvents)
      .where(eq(calendarEvents.eventID, eventID));
    const calendarIDs = links.map((link) => link.id);
    const previous = { ...current, calendars: calendarIDs };
    // Recheck the authenticated actor after acquiring the lifecycle/event locks.
    // Sharing rows stay locked until commit, so concurrent revocation cannot
    // invalidate a permission check midway through the write.
    const authority = current.originCalendarID ? [current.originCalendarID] : calendarIDs;
    const grants = authority.length ? await tx.select({ role: calendarMembers.role })
      .from(calendarMembers).where(and(eq(calendarMembers.userID, actorID), inArray(calendarMembers.calendarID, authority)))
      .orderBy(calendarMembers.calendarID).for("share") : [];
    if (!(current.originCalendarID === null && current.creatorID === actorID) &&
        !grants.some(grant => can(grant.role, "editEvents")))
      throw new EventWriteError("event-write", "denied");
    if (
      current.revision !== expectedRevision ||
      current.deletedAt !== null ||
      current.originCalendarID !== discovered.originCalendarID ||
      calendarIDs.some((id) => !fenced.includes(id))
    )
      return { status: "conflict", current: previous };

    const [child] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.seriesID, eventID))
      .limit(1);
    if (current.seriesID || current.originalStart || child)
      throw new BadRequestError(
        "This time change requires an occurrence-aware scope edit. No changes were saved.",
      );
    const targets = fenced.length
      ? await tx
          .select({ id: externalCalendars.id })
          .from(externalCalendars)
          .where(inArray(externalCalendars.calendarID, fenced))
          .limit(1)
      : [];
    const [mapping] = await tx
      .select({ id: externalEvents.id })
      .from(externalEvents)
      .where(eq(externalEvents.eventID, eventID))
      .limit(1);
    const [history] = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(eq(eventOutbox.eventID, eventID))
      .limit(1);
    if (targets.length || mapping || history)
      throw new BadRequestError(
        "This time change requires a time-model-aware provider write. No changes were saved.",
      );

    // Parse inside the revision boundary and omit undefined exactly as generic
    // PATCH does. Null remains an explicit clear; omitted fields retain storage.
    const parsedPatch = EventTimeContentPatchSchema.parse(contentPatch);
    const patch = Object.fromEntries(
      Object.entries(parsedPatch).filter(([, value]) => value !== undefined),
    ) as typeof parsedPatch;
    let time: ReturnType<typeof resolveEventTimeEdit>;
    try {
      time = resolveEventTimeEdit(intent);
      // Validate even a cancelled definition against the resulting content; never
      // silently repair an embedded DTSTART or an unsupported legacy rule.
      expandRecurringEvents(
        [{ ...current, ...patch, ...time, isCanceled: false }],
        time.start,
        time.end,
        { consumerTimeZone: "UTC" },
      );
    } catch {
      throw new BadRequestError(
        "The requested time or recurrence is invalid or unsupported. No changes were saved.",
      );
    }
    const oldModel =
      current.timeModel == null
        ? null
        : EventTimeModelSchema.parse(current.timeModel);
    const changed =
      current.start.getTime() !== time.start.getTime() ||
      current.end.getTime() !== time.end.getTime() ||
      current.isAllDay !== time.isAllDay ||
      JSON.stringify(oldModel) !== JSON.stringify(time.timeModel) ||
      Object.entries(patch).some(([key, value]) => current[key as keyof typeof patch] !== value);
    if (!changed)
      return { status: "saved", changed: false, previous, event: previous };
    const [updated] = await tx
      .update(events)
      .set({ ...patch, ...time, revision: sql`${events.revision} + 1` })
      .where(and(eq(events.id, eventID), eq(events.revision, expectedRevision)))
      .returning();
    if (!updated) throw new Error("Locked event revision changed unexpectedly");
    return {
      status: "saved",
      changed: true,
      previous,
      event: { ...updated, calendars: calendarIDs },
    };
  });
}
