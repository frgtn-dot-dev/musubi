import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  type AttendanceStatus,
  type NewEvent,
  createEvent,
  getCalendarMembers,
  getEvent,
  getEventAttendees,
  getEventCalendars,
  getEventOrigin,
  getUsersEvents,
  linkEventToCalendars,
  setAttendance,
  unlinkEventAndTombstoneIfOrphaned,
  updateEventAndCalendarLinks,
} from "@musubi/db";
import {
  BadRequestError,
  type Event,
  EventSchema,
  ScopeEditIntentSchema,
  EventWriteError,
  NotFoundError,
} from "@musubi/types";
import { notifyCalendarMembers } from "./stream";
import { prepareEventWrites, type CalendarEventWrite } from "../sync/engine";
import { assertCanViewEvent } from "../permissions";
import { assertEventCalendarAccess, assertEventContentAccess, hasEventCalendarAccess } from "../event_permissions";
import {
  dropEventNotifications,
  queueEventChange,
} from "../event_notifications";
import {
  optionalDateQuery,
  optionalDateRangeQuery,
  requireUUID,
} from "../request_validation";

const MAX_EVENT_RANGE_MS = 3 * 366 * 24 * 60 * 60 * 1000;

function parseEvent(body: unknown, message: string): Event {
  let event: Event;
  try {
    event = EventSchema.parse(body);
  } catch {
    throw new BadRequestError(message);
  }

  event.id = requireUUID(event.id, "event.id");
  event.calendars = event.calendars.map((calendarID) =>
    requireUUID(calendarID, "event.calendars[]"),
  );
  if (event.originCalendarID) {
    event.originCalendarID = requireUUID(
      event.originCalendarID,
      "event.originCalendarID",
    );
  }
  return event;
}

async function assertScopeEditIntent(userID: string, event: Event, raw: unknown): Promise<boolean> {
  if (raw === undefined) return false;
  const parsed = ScopeEditIntentSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestError("Invalid scope edit intent.");
  const update = parseEvent(parsed.data.updates[0], "Invalid scope update.");
  const create = parsed.data.creates[0] && parseEvent(parsed.data.creates[0], "Invalid scope create.");
  if (JSON.stringify(update) !== JSON.stringify(event) || create?.id === update.id) {
    throw new BadRequestError("Scope edit intent does not match the first update.");
  }
  if (create && (!create.calendars.length ||
    (create.originCalendarID && !create.calendars.includes(create.originCalendarID)))) {
    throw new BadRequestError("Invalid scope create destination.");
  }
  // Authorize EVERY proposed step before even reading provider evidence.
  await assertEventContentAccess(userID, update.id);
  const existing = await getEventCalendars(update.id);
  const previous = await getEvent(update.id);
  for (const calendarID of update.calendars.filter((id) => !existing.includes(id))) {
    await assertEventCalendarAccess(userID, calendarID);
  }
  for (const calendarID of create?.calendars ?? []) await assertEventCalendarAccess(userID, calendarID);
  const writes: CalendarEventWrite[] = [
    { event: update, calendarIDs: existing.filter((id) => !update.calendars.includes(id)), action: "delete" },
    { event: update, calendarIDs: update.calendars.filter((id) => !existing.includes(id)), action: "create" },
    { event: update, previous: { ...previous, calendars: existing }, calendarIDs: update.calendars.filter((id) => existing.includes(id)), action: "update", scopeEditValidated: true },
  ];
  if (create) writes.push({ event: create, calendarIDs: create.calendars, action: "create" });
  await prepareEventWrites(writes);
  return true;
}

export async function handlerCreateEvent(req: Request, res: Response) {
  const event = parseEvent(req.body, "Request is missing valid event data...");
  if (req.body?.scopeEdit !== undefined) throw new BadRequestError("Scope edits must begin with their update.");
  // Server-side shape guards (don't trust the client): an event needs at least
  // one calendar, and its HOME must be one of the linked calendars — those are
  // membership-verified below, which also proves they exist (clean 400/403
  // instead of an FK 500, and no smuggling a foreign calendar in as origin).
  if (event.calendars.length === 0)
    throw new BadRequestError("Event needs at least one calendar...");
  if (!event.originCalendarID) event.originCalendarID = event.calendars[0];
  if (!event.calendars.includes(event.originCalendarID)) {
    throw new BadRequestError(
      "originCalendarID must be one of the event's calendars...",
    );
  }
  const newEvent: NewEvent = {
    ...event,
    creatorID: req.user!.id,
  };
  for (const cal of event.calendars) await assertEventCalendarAccess(req.user!.id, cal);
  const deliver = await prepareEventWrites([{ event, calendarIDs: event.calendars, action: "create" }]);
  const createdEvent = await createEvent(newEvent, event.calendars);

  const result = { ...createdEvent, calendars: event.calendars };

  await deliver();

  const memberIDSeen = new Set<string>();

  for (const cal of event.calendars) {
    const members = await getCalendarMembers(cal);

    for (const member of members) {
      if (!memberIDSeen.has(member.userID)) {
        memberIDSeen.add(member.userID);
      }
    }
  }

  notifyCalendarMembers([...memberIDSeen], "event_created", result);

  res.status(201).json(result);
}

export async function handlerUpdateEvent(req: Request, res: Response) {
  const event = parseEvent(req.body, "Request missing valid event data...");

  await assertEventContentAccess(req.user!.id, event.id!); // gated by home, never by a copy
  const scopeEditValidated = await assertScopeEditIntent(req.user!.id, event, req.body?.scopeEdit);

  // Read before write: telling a guest "it moved" needs to know where from, and
  // once the update lands that is gone.
  const previous = await getEvent(event.id!);

  // Diff the calendar links: what got removed / added / kept.
  const existing = await getEventCalendars(event.id!);
  const incoming = event.calendars;
  const removed = existing.filter((c) => !incoming.includes(c));
  const added = incoming.filter((c) => !existing.includes(c));
  const kept = incoming.filter((c) => existing.includes(c));

  // Adding a link puts the event into someone's calendar — same gate as handlerLinkEvent.
  for (const cal of added) await assertEventCalendarAccess(req.user!.id, cal);
  const deliver = await prepareEventWrites([
    { event, calendarIDs: removed, action: "delete" },
    { event, calendarIDs: added, action: "create" },
    { event, previous: { ...previous, calendars: existing }, calendarIDs: kept, action: "update", scopeEditValidated },
  ]);

  // creatorID / originCalendarID are immutable — never trust them from the client
  // (creator is the permission fallback, origin governs who may edit).
  const { creatorID: _c, originCalendarID: _o, ...editable } = event;
  // Remove provider copies while their mappings still exist. Provider delivery
  // is best-effort; the local event + link reconciliation below is one DB unit.
  await deliver("delete");
  const updatedEvent = await updateEventAndCalendarLinks(
    { ...editable, id: event.id! },
    added,
    removed,
  );

  if (updatedEvent) {
    // The local transaction has committed; propagate its new state outward.
    await deliver("create");
    await deliver("update");

    const result = { ...updatedEvent, calendars: incoming };

    // Notify members of both old and new calendars (removed ones need to drop it).
    const memberIDSeen = new Set<string>();
    for (const cal of new Set([...existing, ...incoming])) {
      const members = await getCalendarMembers(cal);
      for (const member of members) memberIDSeen.add(member.userID);
    }

    notifyCalendarMembers([...memberIDSeen], "event_updated", result);

    // Guests get an email if the TIME moved or it was called off; everything
    // else is an edit, not news. Awaited so a failure is logged, not unhandled.
    if (previous) {
      await queueEventChange(previous, updatedEvent, req.user!.id);
    }

    return res.status(200).json({ ...result, calendars: incoming });
  }
  throw new NotFoundError("Request missing valid event data...");
}

export async function handlerRemoveEvent(req: Request, res: Response) {
  const event = parseEvent(req.body, "Request missing valid event data...");

  // "Delete" = unlink from every calendar the user is allowed to edit. Calendars
  // they can only view are left untouched. The event row is tombstoned only once
  // its last link is gone.
  const existing = await getEventCalendars(event.id);
  const unlinkCalendarID =
    req.body?.unlinkCalendarID === undefined
      ? undefined
      : requireUUID(req.body.unlinkCalendarID, "unlinkCalendarID");

  let targets: string[];
  if (unlinkCalendarID) {
    // Unlink from ONE calendar only (used from a non-origin calendar view).
    if (!existing.includes(unlinkCalendarID))
      throw new BadRequestError("Event isn't in that calendar...");
    if (!(await hasEventCalendarAccess(req.user!.id, unlinkCalendarID))) {
      throw new EventWriteError("event-write", "denied",
        "You can't remove this event from that calendar.",
      );
    }
    targets = [unlinkCalendarID];
  } else {
    // Delete: unlink every calendar the user can edit. If the HOME (origin) is among
    // them the delete is authoritative → cascade to ALL calendars (even viewers').
    const editable: string[] = [];
    for (const cal of existing) {
      if (await hasEventCalendarAccess(req.user!.id, cal)) editable.push(cal);
    }
    if (editable.length === 0) {
      throw new EventWriteError("event-write", "denied",
        "You can't remove this event from any of your calendars.",
      );
    }
    const origin = (await getEventOrigin(event.id))?.originCalendarID ?? null;
    targets = origin && editable.includes(origin) ? existing : editable;
  }

  const current = await getEvent(event.id);
  if (!current) throw new NotFoundError("Event not found...");
  const deliver = await prepareEventWrites([{ event: { ...current, calendars: existing }, calendarIDs: targets, action: "delete" }]);
  await deliver(); // remove from external while mapping still exists
  const { remaining, removed } = await unlinkEventAndTombstoneIfOrphaned(
    event.id,
    targets,
  );

  const result = { id: event.id, calendars: remaining, removed };

  // Notify everyone who had it: full removal → drop; partial → update their view.
  const memberIDSeen = new Set<string>();
  for (const cal of existing) {
    const members = await getCalendarMembers(cal);
    for (const member of members) memberIDSeen.add(member.userID);
  }
  notifyCalendarMembers(
    [...memberIDSeen],
    removed ? "event_removed" : "event_updated",
    removed ? result : { ...event, calendars: remaining },
  );

  // A queued "it moved" about an event that no longer exists is a message about
  // nothing. Deleting outright rather than converting to a cancellation: the
  // guest list went with it, and the SSE has already taken it off their screen.
  if (removed) await dropEventNotifications(event.id);

  return res.status(200).json(result);
}

// Propagate: add an existing event into another calendar. Anyone who can VIEW the
// event may link it into a calendar they can EDIT — no edit-on-event needed. To
// change the event itself they'd have to fork it.
export async function handlerLinkEvent(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const calendarID = requireUUID(req.body?.calendarID, "calendarID");

  // Must be able to see the event (member of some calendar it lives in).
  const existing = await assertCanViewEvent(req.user!.id, eventID);

  await assertEventCalendarAccess(req.user!.id, calendarID);
  if (!existing.includes(calendarID)) {
    const row = await getEvent(eventID);
    const deliver = await prepareEventWrites([{
      event: { ...row, calendars: [...existing, calendarID] },
      calendarIDs: [calendarID], action: "create",
    }]);
    await linkEventToCalendars(eventID, [calendarID]);
    await deliver();
  }

  const calendars = await getEventCalendars(eventID);
  const row = await getEvent(eventID);
  const result = { ...row, calendars };

  // Everyone who can see the event needs the new `calendars` list — not just
  // the target calendar's members (their open detail modal shows the links).
  const memberIDSeen = new Set<string>();
  for (const cal of calendars) {
    for (const member of await getCalendarMembers(cal))
      memberIDSeen.add(member.userID);
  }
  notifyCalendarMembers([...memberIDSeen], "event_updated", result);

  return res.status(200).json(result);
}

// Fork (claim): make an INDEPENDENT copy of the event into a calendar the user can
// edit. New id + creatorID + origin = target, no external mapping to the original.
// Detached from the previous owner — editing the fork never touches the source.
export async function handlerForkEvent(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const calendarID = requireUUID(req.body?.calendarID, "calendarID");

  // Must be able to see the source, and edit the target.
  const sourceCalendars = await assertCanViewEvent(req.user!.id, eventID);
  await assertEventCalendarAccess(req.user!.id, calendarID);
  if (sourceCalendars.includes(calendarID)) {
    throw new BadRequestError("This event is already in that calendar.");
  }

  const src = await getEvent(eventID);
  if (!src) throw new NotFoundError("Event not found...");

  const newEvent: NewEvent = {
    id: randomUUID(),
    creatorID: req.user!.id,
    title: src.title,
    color: src.color,
    start: src.start,
    end: src.end,
    isAllDay: src.isAllDay,
    hasAttendees: src.hasAttendees,
    description: src.description,
    location: src.location,
    organizer: req.user!.id, // new owner
    recurrence: src.recurrence,
    url: src.url,
    originCalendarID: calendarID, // fork's home = chosen calendar
  };
  const deliver = await prepareEventWrites([{
    event: { ...src, ...newEvent, calendars: [calendarID] } as Event,
    calendarIDs: [calendarID], action: "create",
  }]);
  const created = await createEvent(newEvent, [calendarID]);
  const result = { ...created, calendars: [calendarID] };

  await deliver(); // sync to target's provider if external

  const members = await getCalendarMembers(calendarID);
  notifyCalendarMembers(
    members.map((m) => m.userID),
    "event_created",
    result,
  );

  return res.status(201).json(result);
}

// Attendees: anyone who can view the event sees the list and can answer.
// No emails in the payload (see query).
export async function handlerGetAttendees(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  await assertCanViewEvent(req.user!.id, eventID);
  res.status(200).json(await getEventAttendees(eventID));
}

const ATTENDANCE_STATUSES = new Set(["declined", "going", "maybe", "none"]);

/**
 * What the client wants to be true.
 *
 * `{status}` is the shape everything speaks now. `{attending: boolean}` is the
 * mobile build that is already on Play — deploying the API must not wait on a
 * store review, so it keeps working and means going/withdrawn.
 */
export function parseAttendanceBody(body: unknown): AttendanceStatus | "none" {
  const input = (body ?? {}) as { attending?: unknown; status?: unknown };

  if (typeof input.status === "string") {
    if (!ATTENDANCE_STATUSES.has(input.status)) {
      throw new BadRequestError(
        "status must be going, maybe, declined or none...",
      );
    }
    return input.status as AttendanceStatus | "none";
  }
  if (typeof input.attending === "boolean")
    return input.attending ? "going" : "none";

  throw new BadRequestError(
    "status (going | maybe | declined | none) is required...",
  );
}

/**
 * Live-update open details for everyone who can see the event, and hand back the
 * list that was sent.
 */
async function notifyAttendanceChanged(
  eventID: string,
  eventCalendars: string[],
) {
  const attendees = await getEventAttendees(eventID);
  // The actor gets the frame too — it carries the same list the PUT response
  // does, harmless.
  const memberIDSeen = new Set<string>();
  for (const cal of eventCalendars) {
    for (const member of await getCalendarMembers(cal))
      memberIDSeen.add(member.userID);
  }
  notifyCalendarMembers([...memberIDSeen], "attendance_changed", {
    eventID,
    attendees,
  });

  return attendees;
}

// PUT desired state rather than POST/DELETE — retries are safe and the client
// just sends what it wants. Returns the fresh list.
export async function handlerSetAttendance(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const status = parseAttendanceBody(req.body);
  const eventCalendars = await assertCanViewEvent(req.user!.id, eventID);
  await setAttendance(eventID, req.user!.id, status);

  res.status(200).json(await notifyAttendanceChanged(eventID, eventCalendars));
}

export function parseEventReadQuery(query: Request["query"]) {
  const since = optionalDateQuery(query.since, "since");
  const range = optionalDateRangeQuery(
    query.start,
    query.end,
    MAX_EVENT_RANGE_MS,
  );
  if (since && range) {
    throw new BadRequestError("since cannot be combined with start and end.");
  }
  return { since, ...range };
}

export async function handlerGetEvents(req: Request, res: Response) {
  const eventQuery = parseEventReadQuery(req.query);
  const serverTime = new Date().toISOString(); // client stores this as its next `since`
  const rows = await getUsersEvents(req.user!.id!, eventQuery);
  const seen = new Map<string, Event>();
  const deletedIds = new Set<string>();
  for (const { event: dbEvent, calendarID } of rows) {
    if (dbEvent.deletedAt) {
      deletedIds.add(dbEvent.id);
      continue;
    } // tombstone → client drops it
    const existing = seen.get(dbEvent.id);
    if (existing) {
      existing.calendars.push(calendarID);
    } else {
      seen.set(dbEvent.id, { ...dbEvent, calendars: [calendarID] });
    }
  }
  res.status(200).json({
    events: Array.from(seen.values()),
    deletedIds: [...deletedIds],
    serverTime,
  });
}
