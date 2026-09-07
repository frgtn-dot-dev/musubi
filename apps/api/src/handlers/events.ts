import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  type AttendanceStatus,
  type NewEvent,
  createEvent,
  diffEventContent,
  forkEventAtRevision,
  getCalendarMembers,
  getEventSnapshot,
  getEventAttendees,
  getEventOrigin,
  getUsersEvents,
  patchEventAndCalendarLinks,
  setAttendance,
} from "@musubi/db";
import {
  BadRequestError,
  type Event,
  EventCreateRequestSchema,
  EventDeleteRequestSchema,
  EventUnlinkRequestSchema,
  EventLinkRequestSchema,
  EventForkRequestSchema,
  EventPatchRequestSchema,
  type EventPatchRequest,
  EventWriteError,
  NotFoundError,
} from "@musubi/types";
import { notifyCalendarMembers } from "./stream";
import {
  prepareEventWrites,
  type CalendarEventWrite,
} from "../sync/engine";
import { committedFailure } from "./event_commit";
import { assertCanViewEvent } from "../permissions";
import {
  assertEventCalendarAccess,
  assertEventContentAccess,
  hasEventCalendarAccess,
} from "../event_permissions";
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

async function currentEvent(id: string) {
  const row = await getEventSnapshot(id);
  if (!row) throw new NotFoundError("Event not found.");
  return row;
}

function conflict(res: Response, current: Event) {
  return res.status(409).json({
    error:
      "This event changed after editing began. Your draft was kept. Refresh and reconcile before saving again.",
    code: "event-revision-conflict",
    localCommitted: false,
    current,
    currentRevision: current.revision,
  });
}

async function notifyEvent(
  calendars: string[],
  type: "event_created" | "event_updated" | "event_removed",
  result: Record<string, unknown>,
) {
  const members = new Set<string>();
  for (const calendarID of new Set(calendars)) {
    for (const member of await getCalendarMembers(calendarID))
      members.add(member.userID);
  }
  notifyCalendarMembers([...members], type, result);
}

/** The local commit is final. Never claim a provider failure undid it, and never
 * expose internal account/resource identities in a collaborator's receipt. */
async function sendCommitted(
  res: Response,
  deliver: Awaited<ReturnType<typeof prepareEventWrites>>,
  event: Event,
  result: unknown,
  status = 200,
  afterCommit: () => Promise<void> = async () => {},
) {
  try {
    await afterCommit();
    await deliver(undefined, event.revision);
  } catch (error) {
    const failure = committedFailure(error, [event]);
    // Reconciliation is optional. Purge or database failure cannot erase commit truth.
    let current: Event | undefined;
    try { current = await currentEvent(event.id); } catch { /* retained receipt below */ }
    return res.status(failure.status).json({
      ...failure.body,
      ...(current ? { current, currentRevision: current.revision } : {}),
    });
  }
  return res.status(status).json(result);
}

function validateCalendars(event: Event) {
  event.id = requireUUID(event.id, "event.id");
  event.calendars = [
    ...new Set(
      event.calendars.map((id) => requireUUID(id, "event.calendars[]")),
    ),
  ];
  if (!event.calendars.length)
    throw new BadRequestError("Event needs at least one calendar.");
  if (event.originCalendarID)
    requireUUID(event.originCalendarID, "event.originCalendarID");
}

function plannedWrites(
  previous: Event,
  event: Event,
  scopeEditValidated = false,
): CalendarEventWrite[] {
  const removed = previous.calendars.filter(
    (id) => !event.calendars.includes(id),
  );
  const added = event.calendars.filter(
    (id) => !previous.calendars.includes(id),
  );
  const kept = event.calendars.filter((id) => previous.calendars.includes(id));
  const patch = diffEventContent(previous, event);
  return [
    { event: previous, calendarIDs: removed, action: "delete" },
    { event, calendarIDs: added, action: "create" },
    // A current no-op still has a CAS check, but no provider mutation.
    ...(Object.keys(patch).length
      ? [
          {
            event,
            previous,
            patch,
            calendarIDs: kept,
            action: "update" as const,
            scopeEditValidated,
          },
        ]
      : []),
  ];
}

async function prepareUpdate(
  userID: string,
  request: EventPatchRequest,
  previous: Event,
) {
  const event = { ...previous, ...request.patch };
  validateCalendars(event);
  for (const id of event.calendars.filter(
    (id) => !previous.calendars.includes(id),
  ))
    await assertEventCalendarAccess(userID, id);
  const scope = request.scopeEdit;
  let create: Event | undefined;
  if (scope) {
    const { scopeEdit: _scope, ...update } = request;
    if (JSON.stringify(scope.updates[0]) !== JSON.stringify(update))
      throw new BadRequestError(
        "Scope edit intent does not match the first update.",
      );
    create = scope.creates[0];
    if (create) {
      validateCalendars(create);
      if (
        create.id === event.id ||
        (create.originCalendarID &&
          !create.calendars.includes(create.originCalendarID))
      )
        throw new BadRequestError("Invalid scope create destination.");
      for (const id of create.calendars)
        await assertEventCalendarAccess(userID, id);
    }
  }
  const writes = plannedWrites(previous, event, Boolean(scope));
  // Even update-only recurrence intents must receive complete recurrence preflight.
  if (scope && !writes.some((write) => write.action === "update"))
    writes.push({
      event,
      previous,
      patch: {},
      calendarIDs: event.calendars,
      action: "update",
      scopeEditValidated: true,
    });
  const scopeWrites = create
    ? [
        ...writes,
        {
          event: create,
          calendarIDs: create.calendars,
          action: "create" as const,
        },
      ]
    : writes;
  if (create) await prepareEventWrites(scopeWrites); // authorize future create now; not an atomic scope operation
  return prepareEventWrites(writes);
}

export async function handlerCreateEvent(req: Request, res: Response) {
  const event = EventCreateRequestSchema.parse(req.body);
  validateCalendars(event);
  event.originCalendarID ??= event.calendars[0];
  if (!event.calendars.includes(event.originCalendarID!))
    throw new BadRequestError(
      "originCalendarID must be one of the event's calendars.",
    );
  for (const id of event.calendars)
    await assertEventCalendarAccess(req.user!.id, id);
  const deliver = await prepareEventWrites([
    { event, calendarIDs: event.calendars, action: "create" },
  ]);
  const created = await createEvent(
    { ...event, creatorID: req.user!.id },
    event.calendars,
  );

  const result = { ...created, calendars: event.calendars };

  return sendCommitted(res, deliver, result, result, 201, () =>
    notifyEvent(event.calendars, "event_created", result));
}

export async function handlerUpdateEvent(req: Request, res: Response) {
  const request = EventPatchRequestSchema.parse(req.body);

  await assertEventContentAccess(req.user!.id, request.id);
  const previous = await currentEvent(request.id);
  if (previous.revision !== request.expectedRevision || previous.deletedAt)
    return conflict(res, previous);
  const deliver = await prepareUpdate(req.user!.id, request, previous);
  const saved = await patchEventAndCalendarLinks(
    request.id,
    request.expectedRevision,
    request.patch,
  );

  if (saved.status === "not_found") throw new NotFoundError("Event not found.");
  if (saved.status === "conflict") return conflict(res, saved.current);
  return sendCommitted(res, deliver, saved.event, saved.event, 200, async () => {
  if (saved.changed) {
    await notifyEvent(
      [...saved.previous.calendars, ...saved.event.calendars],
      "event_updated",
      saved.event,
    );
    await queueEventChange(saved.previous, saved.event, req.user!.id);
  }

  });
}

export async function handlerRemoveEvent(req: Request, res: Response) {
  const request =
    req.body?.unlinkCalendarID === undefined
      ? EventDeleteRequestSchema.parse(req.body)
      : EventUnlinkRequestSchema.parse(req.body);
  const existing = await assertCanViewEvent(req.user!.id, request.id);
  const unlinkCalendarID =
    "unlinkCalendarID" in request
      ? (request.unlinkCalendarID as string)
      : undefined;

  let targets: string[];
  if (unlinkCalendarID) {
    if (!existing.includes(unlinkCalendarID))
      throw new BadRequestError("Event isn't in that calendar.");
    await assertEventCalendarAccess(req.user!.id, unlinkCalendarID);
    targets = [unlinkCalendarID];
  } else {
    const editable: string[] = [];
    for (const id of existing)
      if (await hasEventCalendarAccess(req.user!.id, id)) editable.push(id);
    if (!editable.length) throw new EventWriteError("event-write", "denied");
    const origin = (await getEventOrigin(request.id))?.originCalendarID;
    targets = origin && editable.includes(origin) ? existing : editable;
  }

  const previous = await currentEvent(request.id);
  if (previous.revision !== request.expectedRevision || previous.deletedAt)
    return conflict(res, previous);
  const deliver = await prepareEventWrites([
    { event: previous, calendarIDs: targets, action: "delete" },
  ]);
  const saved = await patchEventAndCalendarLinks(
    request.id,
    request.expectedRevision,
    { calendars: existing.filter((id) => !targets.includes(id)) },
    true,
  );
  if (saved.status === "not_found") throw new NotFoundError("Event not found.");
  if (saved.status === "conflict") return conflict(res, saved.current);
  const removed = saved.event.deletedAt !== null;

  const result = {
    id: request.id,
    revision: saved.event.revision,
    calendars: saved.event.calendars,
    removed,
    event: saved.event,
  };
  return sendCommitted(res, deliver, saved.event, result, 200, async () => {
  await notifyEvent(
    existing,
    removed ? "event_removed" : "event_updated",
    removed ? result : saved.event,
  );
  if (removed) await dropEventNotifications(request.id);

  });
}

export async function handlerLinkEvent(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const { calendarID, expectedRevision } = EventLinkRequestSchema.parse(
    req.body,
  );
  const existing = await assertCanViewEvent(req.user!.id, eventID);

  await assertEventCalendarAccess(req.user!.id, calendarID);
  const previous = await currentEvent(eventID);
  if (previous.revision !== expectedRevision || previous.deletedAt)
    return conflict(res, previous);
  const calendars = [...new Set([...existing, calendarID])];
  const deliver = await prepareEventWrites(
    existing.includes(calendarID)
      ? []
      : [
          {
            event: { ...previous, calendars },
            calendarIDs: [calendarID],
            action: "create",
          },
        ],
  );
  const saved = await patchEventAndCalendarLinks(eventID, expectedRevision, {
    calendars,
  });
  if (saved.status === "not_found") throw new NotFoundError("Event not found.");
  if (saved.status === "conflict") return conflict(res, saved.current);
  return sendCommitted(res, deliver, saved.event, saved.event, 200, async () => {
    if (saved.changed) await notifyEvent(calendars, "event_updated", saved.event);
  });
}

export async function handlerForkEvent(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const { calendarID, expectedRevision } = EventForkRequestSchema.parse(
    req.body,
  );
  const sourceCalendars = await assertCanViewEvent(req.user!.id, eventID);
  await assertEventCalendarAccess(req.user!.id, calendarID);
  if (sourceCalendars.includes(calendarID))
    throw new BadRequestError("This event is already in that calendar.");
  const source = await currentEvent(eventID);
  if (source.revision !== expectedRevision || source.deletedAt)
    return conflict(res, source);

  const newEvent: NewEvent = {
    ...EventCreateRequestSchema.parse(
      (({
        revision: _revision,
        deletedAt: _deletedAt,
        updatedAt: _updatedAt,
        createdAt: _createdAt,
        ...event
      }) => event)(source),
    ),
    id: randomUUID(),
    creatorID: req.user!.id,
    organizer: req.user!.id,
    originCalendarID: calendarID,
    isCanceled: false,
  };
  const projected = {
    ...source,
    ...newEvent,
    revision: 1,
    calendars: [calendarID],
  } as Event;
  const deliver = await prepareEventWrites([
    {
      event: projected,
      calendarIDs: [calendarID],
      action: "create",
    },
  ]);
  const saved = await forkEventAtRevision(eventID, expectedRevision, newEvent, [
    calendarID,
  ]);
  if (saved.status === "not_found") throw new NotFoundError("Event not found.");
  if (saved.status === "conflict") return conflict(res, saved.current);
  return sendCommitted(res, deliver, saved.event, saved.event, 201, () =>
    notifyEvent([calendarID], "event_created", saved.event));
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
