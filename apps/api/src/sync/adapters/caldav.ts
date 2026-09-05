import ICAL from "ical.js";
import { randomUUID } from "crypto";
import type { DAVCalendar, DAVCalendarObject, DAVResponse } from "tsdav";
import {
  EventWriteError,
  type Event,
  type Task,
  type TaskStatus,
} from "@musubi/types";
import { logger } from "@musubi/config";
import {
  getCaldavAccountById,
  getCaldavAccountsByUser,
  type EventContentPatch,
} from "@musubi/db";
import type {
  CalendarAdapter,
  CalendarDiscoveryResult,
  ExternalEventRef,
  ExternalTaskRef,
  FetchChangesResult,
  NormalizedChange,
  NormalizedEvent,
  NormalizedTask,
} from "../adapter";
import { createCaldavClient, createGuardedCaldavFetch } from "../caldav_client";
import { decryptSecret } from "../crypto";
import {
  assertEventWriteEvidence,
  assertEventWriteResponse,
  assertAcceptedEventEtag,
  assertProviderEventMutationResponse,
  ProviderEventWriteError,
  requireEventEtag,
  requireEventPatch,
  strongEventEtag,
} from "../event_write";
import { replaceEventProperties } from "./caldav_event_ical";
import {
  caldavAllows,
  caldavEventPrivileges,
  caldavOrganizerAddresses,
} from "../caldav_privileges";

const TASK_STATUS_BY_ICAL: Record<string, TaskStatus> = {
  "NEEDS-ACTION": "needs-action",
  "IN-PROCESS": "in-process",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

async function clientForAccount(accountId: string) {
  const acc = await getCaldavAccountById(accountId);
  if (!acc) throw new Error("CalDAV account not found");
  return createCaldavClient(
    acc.serverUrl,
    acc.username,
    decryptSecret(acc.encryptedPassword),
  );
}

// Basic-auth header for calendar-level ops (MKCALENDAR / PROPPATCH / DELETE) —
// tsdav's typed client covers objects well, but raw WebDAV keeps the Apple
// color namespace and MKCALENDAR body under our control.
const caldavFetch = createGuardedCaldavFetch();

async function basicAuthForAccount(accountId: string) {
  const acc = await getCaldavAccountById(accountId);
  if (!acc) throw new Error("CalDAV account not found");
  return `Basic ${Buffer.from(`${acc.username}:${decryptSecret(acc.encryptedPassword)}`).toString("base64")}`;
}

const escapeXml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c]!,
  );

// All-day is a tz-less date; anchor to UTC midnight (consistent with the rest of Musubi).
function utcMidnight(t: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(t.year, t.month - 1, t.day)); // ICAL.Time month is 1-based
}

function allDayTime(d: Date) {
  return ICAL.Time.fromData({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    isDate: true,
  });
}

function recurrenceDate(time: ICAL.Time) {
  const date = time.isDate ? utcMidnight(time) : time.toJSDate();
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function recurrenceFrom(component: ICAL.Component): string | null {
  const rrule = component.getFirstProperty("rrule")?.getFirstValue();
  if (!rrule) return null;
  const lines = new Set<string>([`RRULE:${rrule.toString()}`]);
  for (const propertyName of ["exdate", "rdate"] as const) {
    for (const property of component.getAllProperties(propertyName)) {
      for (const time of property.getValues() as ICAL.Time[]) {
        lines.add(`${propertyName.toUpperCase()}:${recurrenceDate(time)}`);
      }
    }
  }

  // A CalDAV resource may store detached instances beside its master. Musubi's
  // recurrence string can represent their schedule as EXDATE + RDATE while the
  // original components remain untouched on write.
  const uid = component.getFirstPropertyValue("uid");
  for (const exception of component.parent?.getAllSubcomponents(
    component.name,
  ) ?? []) {
    if (
      exception === component ||
      exception.getFirstPropertyValue("uid") !== uid
    )
      continue;
    const recurrenceId = componentTime(exception, "recurrence-id");
    if (!recurrenceId) continue;
    lines.add(`EXDATE:${recurrenceDate(recurrenceId)}`);
    if (componentString(exception, "status")?.toUpperCase() !== "CANCELLED") {
      const replacement = componentTime(exception, "dtstart");
      if (replacement) lines.add(`RDATE:${recurrenceDate(replacement)}`);
    }
  }
  return [...lines].join("\n");
}

function canonicalRecurrence(value: string | null) {
  return value
    ? [...new Set(value.split("\n").filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .join("\n")
    : null;
}

function addRecurrence(
  component: ICAL.Component,
  recurrence: string | null | undefined,
  isAllDay: boolean,
) {
  if (!recurrence) return;
  for (const line of recurrence.split("\n")) {
    if (/^(RRULE:)?FREQ=/.test(line)) {
      component.addPropertyWithValue(
        "rrule",
        ICAL.Recur.fromString(line.replace(/^RRULE:/, "")),
      );
    } else if (/^(EXDATE|RDATE):/.test(line)) {
      const [propertyName, values] = line.split(":", 2) as [
        "EXDATE" | "RDATE",
        string,
      ];
      for (const value of values.split(",")) {
        const match = value.match(
          /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/,
        );
        if (!match) continue;
        const date = new Date(
          Date.UTC(
            +match[1],
            +match[2] - 1,
            +match[3],
            +match[4],
            +match[5],
            +match[6],
          ),
        );
        component.addPropertyWithValue(
          propertyName.toLowerCase(),
          isAllDay ? allDayTime(date) : ICAL.Time.fromJSDate(date, true),
        );
      }
    }
  }
}

// VEVENT component -> normalized event fields. Shared with .ics calendar import;
// null if the component is malformed (missing dates etc.).
export function veventToFields(vevent: ICAL.Component) {
  let ev: ICAL.Event;
  let isAllDay: boolean;
  let start: Date, end: Date;
  try {
    ev = new ICAL.Event(vevent);
    isAllDay = ev.startDate.isDate;
    start = isAllDay ? utcMidnight(ev.startDate) : ev.startDate.toJSDate();
    end = isAllDay
      ? new Date(utcMidnight(ev.endDate).getTime() - 86400000) // iCal DTEND all-day is exclusive
      : ev.endDate.toJSDate();
  } catch {
    return null;
  }

  const organizer = vevent.getFirstPropertyValue("organizer");
  const recurrence = recurrenceFrom(vevent);

  return {
    title: ev.summary ?? "(untitled)",
    start,
    end,
    isAllDay,
    description: ev.description ?? null,
    location: ev.location ?? null,
    organizer:
      typeof organizer === "string" ? organizer.replace(/^mailto:/i, "") : null,
    recurrence,
  };
}

// iCal VEVENT (one calendar object) -> NormalizedEvent
export function icalToNormalized(obj: {
  url: string;
  etag?: string;
  data?: string;
}): NormalizedEvent | null {
  if (!obj.data) return null;
  let vevent: ICAL.Component | null;
  try {
    const comp = new ICAL.Component(ICAL.parse(obj.data));
    vevent = comp.getFirstSubcomponent("vevent");
  } catch {
    return null;
  }
  if (!vevent) return null;

  const fields = veventToFields(vevent);
  if (!fields) return null;
  const uid = vevent.getFirstPropertyValue("uid");

  return {
    externalId: obj.url, // CalDAV addresses events by resource URL, not UID
    status:
      componentString(vevent, "status")?.toUpperCase() === "CANCELLED"
        ? "cancelled"
        : "active",
    ...fields,
    url: null,
    etag: obj.etag ?? null,
    icalUid: typeof uid === "string" ? uid : null,
  };
}

function componentTime(
  component: ICAL.Component,
  propertyName: string,
): ICAL.Time | null {
  const value = component.getFirstPropertyValue(
    propertyName,
  ) as ICAL.Time | null;
  return value && typeof value.toJSDate === "function" ? value : null;
}

function componentDate(time: ICAL.Time | null): Date | null {
  if (!time) return null;
  return time.isDate ? utcMidnight(time) : time.toJSDate();
}

function componentString(
  component: ICAL.Component,
  propertyName: string,
): string | null {
  const value = component.getFirstPropertyValue(propertyName);
  return typeof value === "string" ? value : null;
}

function componentInteger(
  component: ICAL.Component,
  propertyName: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(component.getFirstPropertyValue(propertyName));
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : minimum;
}

export function vtodoToFields(vtodo: ICAL.Component) {
  const startTime = componentTime(vtodo, "dtstart");
  const dueTime = componentTime(vtodo, "due");
  const rawStatus = componentString(vtodo, "status")?.toUpperCase();
  const status =
    (rawStatus ? TASK_STATUS_BY_ICAL[rawStatus] : undefined) ?? "needs-action";

  return {
    title: componentString(vtodo, "summary") ?? "(untitled)",
    description: componentString(vtodo, "description"),
    status,
    start: componentDate(startTime),
    due: componentDate(dueTime),
    isAllDay: Boolean(startTime?.isDate || dueTime?.isDate),
    completedAt: componentDate(componentTime(vtodo, "completed")),
    percentComplete: componentInteger(vtodo, "percent-complete", 0, 100),
    priority: componentInteger(vtodo, "priority", 0, 9),
    recurrence: recurrenceFrom(vtodo),
    relatedTo: componentString(vtodo, "related-to"),
    sequence: componentInteger(vtodo, "sequence", 0, Number.MAX_SAFE_INTEGER),
    url: componentString(vtodo, "url"),
  };
}

export function icalToNormalizedTask(obj: {
  url: string;
  etag?: string;
  data?: string;
}): NormalizedTask | null {
  if (!obj.data) return null;
  let vtodo: ICAL.Component | null;
  try {
    const component = new ICAL.Component(ICAL.parse(obj.data));
    vtodo = component.getFirstSubcomponent("vtodo");
  } catch {
    return null;
  }
  if (!vtodo) return null;

  const uid = vtodo.getFirstPropertyValue("uid");
  return {
    externalId: obj.url,
    ...vtodoToFields(vtodo),
    etag: obj.etag ?? null,
    icalUid: typeof uid === "string" ? uid : null,
  };
}

// Musubi Event -> VEVENT component. Shared with calendar export (one VCALENDAR,
// many VEVENTs) — keep it independent of the wrapping calendar.
export type IcalEventFields = Pick<
  Event,
  | "id"
  | "title"
  | "description"
  | "location"
  | "isAllDay"
  | "start"
  | "end"
  | "recurrence"
>;

export function toVevent(
  event: IcalEventFields,
  uid = event.id,
): ICAL.Component {
  const vevent = new ICAL.Component("vevent");
  const ev = new ICAL.Event(vevent);
  ev.uid = uid;
  ev.summary = event.title;
  if (event.description) ev.description = event.description;
  if (event.location) ev.location = event.location;

  if (event.isAllDay) {
    ev.startDate = allDayTime(event.start);
    ev.endDate = allDayTime(new Date(event.end.getTime() + 86400000)); // DTEND exclusive
  } else {
    ev.startDate = ICAL.Time.fromJSDate(event.start, true);
    ev.endDate = ICAL.Time.fromJSDate(event.end, true);
  }
  // Recurrence must round-trip: omitting it here would strip it on update.
  addRecurrence(vevent, event.recurrence, event.isAllDay);

  return vevent;
}

export type IcalTaskFields = Pick<
  Task,
  | "id"
  | "title"
  | "description"
  | "status"
  | "start"
  | "due"
  | "isAllDay"
  | "completedAt"
  | "percentComplete"
  | "priority"
  | "recurrence"
  | "relatedTo"
  | "sequence"
  | "url"
>;

export function toVtodo(task: IcalTaskFields, uid = task.id): ICAL.Component {
  const vtodo = new ICAL.Component("vtodo");
  vtodo.addPropertyWithValue("uid", uid);
  vtodo.addPropertyWithValue("summary", task.title);
  vtodo.addPropertyWithValue("status", task.status.toUpperCase());
  if (task.description)
    vtodo.addPropertyWithValue("description", task.description);
  if (task.start)
    vtodo.addPropertyWithValue(
      "dtstart",
      task.isAllDay
        ? allDayTime(task.start)
        : ICAL.Time.fromJSDate(task.start, true),
    );
  if (task.due)
    vtodo.addPropertyWithValue(
      "due",
      task.isAllDay
        ? allDayTime(task.due)
        : ICAL.Time.fromJSDate(task.due, true),
    );
  if (task.completedAt)
    vtodo.addPropertyWithValue(
      "completed",
      ICAL.Time.fromJSDate(task.completedAt, true),
    );
  vtodo.addPropertyWithValue("percent-complete", task.percentComplete);
  vtodo.addPropertyWithValue("priority", task.priority);
  vtodo.addPropertyWithValue("sequence", task.sequence);
  if (task.relatedTo) vtodo.addPropertyWithValue("related-to", task.relatedTo);
  if (task.url) vtodo.addPropertyWithValue("url", task.url);
  addRecurrence(vtodo, task.recurrence, task.isAllDay);
  return vtodo;
}

function patchProperties(
  target: ICAL.Component,
  replacement: ICAL.Component,
  propertyNames: string[],
) {
  for (const name of propertyNames) {
    target.removeAllProperties(name);
    for (const property of replacement.getAllProperties(name)) {
      target.addProperty(new ICAL.Property(property.toJSON()));
    }
  }
}

function preserveTimezones(
  current: ICAL.Component,
  replacement: ICAL.Component,
  propertyNames: string[],
) {
  for (const name of propertyNames) {
    const currentProperty = current.getFirstProperty(name);
    const replacementProperty = replacement.getFirstProperty(name);
    if (!currentProperty || !replacementProperty) continue;
    const tzid = currentProperty.getParameter("tzid");
    const next = replacementProperty.getFirstValue() as ICAL.Time | undefined;
    const previous = currentProperty.getFirstValue() as ICAL.Time | undefined;
    if (!tzid || !next || !previous || next.isDate || previous.isDate) continue;
    replacementProperty.setValue(
      ICAL.Time.fromJSDate(next.toJSDate(), true).convertToZone(previous.zone),
    );
    replacementProperty.setParameter("tzid", tzid);
  }
}

function patchTaskCalendarData(
  data: string,
  componentName: "vtodo",
  uid: string,
  replacement: ICAL.Component,
  propertyNames: string[],
) {
  const calendar = new ICAL.Component(ICAL.parse(data));
  const component = calendar
    .getAllSubcomponents(componentName)
    .find(
      (candidate) =>
        !candidate.getFirstProperty("recurrence-id") &&
        candidate.getFirstPropertyValue("uid") === uid,
    );
  if (!component)
    throw new Error(`CalDAV ${componentName} master ${uid} not found`);

  preserveTimezones(component, replacement, ["dtstart", "dtend", "due"]);
  const recurrenceProperties = new Set(["rrule", "exdate", "rdate"]);
  const recurrenceChanged =
    canonicalRecurrence(recurrenceFrom(component)) !==
    canonicalRecurrence(recurrenceFrom(replacement));
  patchProperties(
    component,
    replacement,
    recurrenceChanged
      ? propertyNames
      : propertyNames.filter((name) => !recurrenceProperties.has(name)),
  );
  if (recurrenceChanged) {
    for (const candidate of calendar.getAllSubcomponents(componentName)) {
      if (
        candidate !== component &&
        candidate.getFirstProperty("recurrence-id") &&
        candidate.getFirstPropertyValue("uid") === uid
      )
        calendar.removeSubcomponent(candidate);
    }
  }
  return calendar.toString();
}

function eventMaster(data: string, uid?: string | null) {
  const calendar = new ICAL.Component(ICAL.parse(data));
  if (calendar.name !== "vcalendar")
    throw new ProviderEventWriteError("provider-write-failed");
  const events = calendar.getAllSubcomponents("vevent");
  const masters = events.filter(
    (component) =>
      !component.getFirstProperty("recurrence-id") &&
      (uid == null || component.getFirstPropertyValue("uid") === uid),
  );
  if (masters.length !== 1 || masters[0].getAllProperties("uid").length !== 1) {
    throw new ProviderEventWriteError("provider-write-failed");
  }
  const master = masters[0];
  const actualUid = componentString(master, "uid");
  if (!actualUid) throw new ProviderEventWriteError("provider-write-failed");
  return { calendar, master, uid: actualUid, index: events.indexOf(master) };
}

export function patchEventIcal(
  data: string,
  event: Event,
  uid: string,
  patch?: EventContentPatch,
) {
  const diff = requireEventPatch(patch);
  const { calendar, master, index } = eventMaster(data, uid);
  const replacement = toVevent({ ...event, ...diff }, uid);
  const names = new Set<string>();
  for (const [field, name] of [
    ["title", "summary"],
    ["description", "description"],
    ["location", "location"],
    ["start", "dtstart"],
    ["end", "dtend"],
  ] as const) {
    if (diff[field] !== undefined) names.add(name);
  }
  if (diff.isAllDay !== undefined) {
    names.add("dtstart");
    names.add("dtend");
  }
  // Materialize the intended end rather than keeping a DURATION that would
  // implicitly shift the end on a start-only edit (DTEND and DURATION exclude).
  if (
    (names.has("dtstart") || names.has("dtend")) &&
    master.hasProperty("duration")
  ) {
    names.add("dtend");
    names.add("duration");
  }
  const recurrenceChanged =
    (diff.recurrence !== undefined || diff.isAllDay !== undefined) &&
    (canonicalRecurrence(recurrenceFrom(master)) !==
      canonicalRecurrence(recurrenceFrom(replacement)) ||
      (diff.isAllDay !== undefined && master.hasProperty("rrule")));
  if (recurrenceChanged) {
    if (
      calendar
        .getAllSubcomponents("vevent")
        .some(
          (candidate) =>
            candidate.hasProperty("recurrence-id") &&
            candidate.getFirstPropertyValue("uid") === uid,
        )
    ) {
      throw new EventWriteError(
        "recurrence",
        "unsupported",
        "CalDAV recurrence changes with detached exceptions are not supported yet. No changes were saved.",
      );
    }
    for (const name of ["rrule", "exdate", "rdate"]) names.add(name);
  }
  preserveTimezones(
    master,
    replacement,
    [...names].filter((name) => name === "dtstart" || name === "dtend"),
  );
  return replaceEventProperties(
    data,
    index,
    new Map(
      [...names].map((name) => [name, replacement.getAllProperties(name)]),
    ),
  );
}

export function patchTaskIcal(data: string, task: Task, uid: string) {
  return patchTaskCalendarData(data, "vtodo", uid, toVtodo(task, uid), [
    "summary",
    "description",
    "status",
    "dtstart",
    "due",
    "completed",
    "percent-complete",
    "priority",
    "sequence",
    "related-to",
    "url",
    "rrule",
    "exdate",
    "rdate",
  ]);
}

// Musubi Event -> iCal string (single-event VCALENDAR, for CalDAV PUTs)
function toIcal(event: Event, uid = event.id): string {
  const vcal = new ICAL.Component("vcalendar");
  vcal.updatePropertyWithValue("version", "2.0");
  vcal.updatePropertyWithValue("prodid", "-//Musubi//EN");
  vcal.addSubcomponent(toVevent(event, uid));
  return vcal.toString();
}

function toTaskIcal(task: Task, uid = task.id): string {
  const vcal = new ICAL.Component("vcalendar");
  vcal.updatePropertyWithValue("version", "2.0");
  vcal.updatePropertyWithValue("prodid", "-//Musubi//EN");
  vcal.addSubcomponent(toVtodo(task, uid));
  return vcal.toString();
}

export function toCaldavTaskObject(
  externalTaskId: string,
  task: Task,
  ref?: ExternalTaskRef,
) {
  if (!ref?.etag)
    throw new Error("CalDAV task has no ETag; refusing an unsafe update");
  return {
    url: externalTaskId,
    data: toTaskIcal(task, ref.icalUid ?? task.id),
    etag: ref.etag,
  };
}

async function taskCalendarObjectForUpdate(
  client: Awaited<ReturnType<typeof clientForAccount>>,
  externalCalendarId: string,
  externalObjectId: string,
  ref: { etag?: string | null; icalUid?: string | null } | undefined,
  value: Task,
) {
  if (!ref?.etag)
    throw new Error("CalDAV task has no ETag; refusing an unsafe update");
  const [object] = await client.fetchCalendarObjects({
    calendar: { url: externalCalendarId } as DAVCalendar,
    objectUrls: [externalObjectId],
  });
  if (!object?.data)
    throw new Error("CalDAV task resource is missing; refusing an update");
  const uid = ref.icalUid ?? icalToNormalizedTask(object)?.icalUid;
  if (!uid)
    throw new Error("CalDAV task has no UID; refusing an unsafe update");
  return {
    calendarObject: {
      url: externalObjectId,
      data: patchTaskIcal(object.data, value, uid),
      etag: ref.etag,
    },
    uid,
  };
}

function absoluteDavUrl(href: string, calendarUrl: string) {
  return new URL(href, calendarUrl).href;
}

function isIcalUrl(value: string, base?: string) {
  try {
    return new URL(value, base).pathname.toLowerCase().endsWith(".ics");
  } catch {
    return false;
  }
}

function deletedObjectChanges(externalId: string): NormalizedChange[] {
  return [
    {
      kind: "event",
      data: {
        description: null,
        end: new Date(0),
        externalId,
        isAllDay: false,
        location: null,
        organizer: null,
        recurrence: null,
        start: new Date(0),
        status: "cancelled",
        title: "",
        url: null,
      },
    },
    {
      kind: "task",
      data: {
        completedAt: null,
        deleted: true,
        description: null,
        due: null,
        externalId,
        isAllDay: false,
        percentComplete: 0,
        priority: 0,
        recurrence: null,
        relatedTo: null,
        sequence: 0,
        start: null,
        status: "needs-action",
        title: "",
        url: null,
      },
    },
  ];
}

function normalizedObjectChanges(
  objects: DAVCalendarObject[],
): NormalizedChange[] {
  const changes: NormalizedChange[] = [];
  for (const object of objects) {
    const event = icalToNormalized(object);
    const task = icalToNormalizedTask(object);
    if (!event && !task) {
      try {
        const calendar = new ICAL.Component(ICAL.parse(object.data));
        if (
          calendar.getFirstSubcomponent("vevent") ||
          calendar.getFirstSubcomponent("vtodo")
        )
          throw new Error(`Invalid calendar resource: ${object.url}`);
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error(`Invalid calendar resource: ${object.url}`);
      }
    }
    if (event) changes.push({ kind: "event", data: event });
    if (task) changes.push({ kind: "task", data: task });
  }
  return changes;
}

function syncTokenFrom(responses: DAVResponse[]) {
  const token = responses.find((response) => response.raw)?.raw?.multistatus
    ?.syncToken;
  return token == null ? null : String(token);
}

async function incrementalChanges(
  client: Awaited<ReturnType<typeof clientForAccount>>,
  calendar: DAVCalendar,
  cursor: string | null,
): Promise<FetchChangesResult> {
  const responses = await client.syncCollection({
    props: { "d:getetag": {} },
    syncLevel: 1,
    syncToken: cursor ?? undefined,
    url: calendar.url,
  });
  const failed = responses.find(
    (response) => response.status !== 404 && !response.ok,
  );
  if (failed) {
    throw new Error(
      `CalDAV sync-collection failed: ${failed.status} ${failed.statusText}`,
    );
  }

  const objectResponses = responses.filter((response) => {
    if (!response.href) return false;
    try {
      return new URL(response.href, calendar.url).pathname
        .toLowerCase()
        .endsWith(".ics");
    } catch {
      return false;
    }
  });
  const changedUrls = objectResponses.flatMap((response) =>
    response.status !== 404 && response.href
      ? [absoluteDavUrl(response.href, calendar.url)]
      : [],
  );
  const objects = changedUrls.length
    ? await client.fetchCalendarObjects({
        calendar,
        objectUrls: changedUrls,
      })
    : [];
  const changes = normalizedObjectChanges(objects);
  for (const response of objectResponses) {
    if (response.status === 404) {
      changes.push(
        ...deletedObjectChanges(absoluteDavUrl(response.href!, calendar.url)),
      );
    }
  }

  const nextCursor = syncTokenFrom(responses);
  if (!nextCursor) throw new Error("CalDAV sync-collection returned no token");
  return { changes, nextCursor, reset: cursor === null };
}

async function etagAfterWrite(
  client: Awaited<ReturnType<typeof clientForAccount>>,
  externalCalendarId: string,
  externalEventId: string,
  response: Response,
) {
  const responseEtag = response.headers.get("etag");
  if (responseEtag) return responseEtag;

  try {
    const [object] = await client.fetchCalendarObjects({
      calendar: { url: externalCalendarId } as any,
      objectUrls: [externalEventId],
    });
    return object?.etag ?? null;
  } catch (error) {
    logger.warn("caldav.event.etag_refresh_failed", {
      externalCalendarId,
      externalEventId,
      error,
    });
    return null;
  }
}

/** A complete GET and its own strong ETag, checked against the version already
 * accepted into the mapping. A newer GET must not silently rebase the edit.
 */
async function readEventResource(
  authorization: string,
  externalEventId: string,
  ref?: ExternalEventRef,
) {
  const etag = requireEventEtag(ref?.etag);
  const response = await caldavFetch(externalEventId, {
    headers: {
      authorization,
      accept: "text/calendar",
      "Cache-Control": "no-cache",
    },
  });
  assertEventWriteResponse(response);
  assertAcceptedEventEtag(etag, response.headers.get("etag"));
  if (response.status !== 200 || response.headers.has("content-range")) {
    throw new ProviderEventWriteError("provider-write-failed");
  }
  // UTF-8 decoding must not replace invalid bytes and then PUT lossy text.
  const data = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(await response.arrayBuffer());
  const { master, uid, index } = eventMaster(data, ref?.icalUid);
  replaceEventProperties(data, index, new Map()); // Validate full physical structure, including DELETE preflight.
  return { data, etag, master, uid };
}

export const caldavAdapter: CalendarAdapter = {
  provider: "caldav",

  async listAccounts(userID: string): Promise<{ id: string; label: string }[]> {
    const accounts = await getCaldavAccountsByUser(userID);
    return accounts.map((a) => ({ id: a.id, label: a.username }));
  },

  async listCalendars(
    _userID: string,
    accountId: string,
  ): Promise<CalendarDiscoveryResult> {
    const client = await clientForAccount(accountId);
    const cals = await client.fetchCalendars();
    const calendars = cals
      .filter(
        (c) =>
          !c.components ||
          c.components.includes("VEVENT") ||
          c.components.includes("VTODO"),
      )
      .map((c) => ({
        externalId: c.url,
        name: typeof c.displayName === "string" ? c.displayName : "Calendar",
        color: (typeof c.calendarColor === "string"
          ? c.calendarColor
          : "#4285F4"
        ).slice(0, 7),
        supportsEvents: c.components?.includes("VEVENT") ?? true,
        supportsTasks: c.components?.includes("VTODO") ?? false,
      }));
    const authorization = await basicAuthForAccount(accountId);
    for (const calendar of calendars) {
      const privileges = await caldavEventPrivileges(
        calendar.externalId,
        authorization,
      );
      Object.assign(calendar, {
        readOnly: !["create", "update", "delete"].some(
          (action) =>
            caldavAllows(
              privileges,
              action as "create" | "update" | "delete",
            ) === true,
        ),
      });
    }
    return { calendars, taskListsComplete: true };
  },

  async fetchChanges(
    _userID,
    accountId,
    externalCalendarId,
    cursor,
  ): Promise<FetchChangesResult> {
    const client = await clientForAccount(accountId);
    const cals = await client.fetchCalendars();
    const cal = cals.find((c) => c.url === externalCalendarId);
    if (!cal) {
      logger.warn("caldav.calendar.not_found", {
        accountId,
        externalCalendarId,
        availableCalendars: cals.length,
      });
      logger.debug("caldav.calendar.not_found.details", {
        accountId,
        externalCalendarId,
        availableExternalCalendarIds: cals.map((c) => c.url),
      });
      return { changes: [], nextCursor: null };
    }

    if (cal.reports?.includes("syncCollection")) {
      try {
        return await incrementalChanges(client, cal, cursor);
      } catch (error) {
        // An expired/unsupported token must never leave stale objects behind.
        // A complete query is the compatibility fallback and resets both kinds.
        logger.warn("caldav.sync_collection_fallback", {
          accountId,
          externalCalendarId,
          error,
        });
      }
    }

    // PROPFIND lists the complete collection without iCloud's calendar-query
    // time-range requirement, so reset reconciliation never sweeps valid old or
    // far-future resources merely because they fell outside a query window.
    const listed = await client.propfind({
      depth: "1",
      props: { "d:getetag": {} },
      url: cal.url,
    });
    const failed = listed.find((response) => {
      if (!response.href || response.ok || response.status === 404)
        return false;
      try {
        return new URL(response.href, cal.url).pathname
          .toLowerCase()
          .endsWith(".ics");
      } catch {
        return false;
      }
    });
    if (failed)
      throw new Error(
        `CalDAV collection listing failed: ${failed.status} ${failed.statusText}`,
      );
    const objectUrls = listed.flatMap((response) => {
      if (!response.ok || !response.href) return [];
      const url = absoluteDavUrl(response.href, cal.url);
      return isIcalUrl(url) ? [url] : [];
    });
    const objects = objectUrls.length
      ? await client.fetchCalendarObjects({ calendar: cal, objectUrls })
      : [];
    const changes = normalizedObjectChanges(objects);
    logger.debug("caldav.objects.fetched", {
      accountId,
      externalCalendarId,
      objects: objects.length,
      parsedEvents: changes.filter((change) => change.kind === "event").length,
      parsedTasks: changes.filter((change) => change.kind === "task").length,
    });

    return { changes, nextCursor: cal.syncToken ?? null, reset: true };
  },

  async assertEventWrite(_userID, accountId, externalCalendarId, operation) {
    const authorization = await basicAuthForAccount(accountId);
    // DAV bind/unbind belong to the collection; write-content to the resource.
    const target =
      operation.action === "update" && operation.external
        ? operation.external.externalEventId
        : externalCalendarId;
    const privileges = await caldavEventPrivileges(target, authorization);
    assertEventWriteEvidence(
      caldavAllows(privileges, operation.action),
      "event-write",
    );
    if (operation.action !== "create" && operation.external) {
      {
        const { data, uid, master } = await readEventResource(
          authorization,
          operation.external.externalEventId,
          operation.external,
        );
        // Exercise the exact preserving path before any DB or provider mutation.
        if (operation.action === "update")
          patchEventIcal(data, operation.event, uid, operation.patch);
        if (
          operation.action === "update" &&
          (operation.patch?.recurrence !== undefined ||
            operation.patch?.isAllDay !== undefined) &&
          !operation.scopeEditValidated &&
          canonicalRecurrence(recurrenceFrom(master)) !==
            canonicalRecurrence(
              recurrenceFrom(
                toVevent(
                  { ...operation.event, ...requireEventPatch(operation.patch) },
                  uid,
                ),
              ),
            )
        ) {
          // A legacy recurrence PUT may be the first half of a split. Without a
          // complete intent, require the potential create right before changing it.
          const collectionPrivileges = await caldavEventPrivileges(
            externalCalendarId,
            authorization,
          );
          const canCreate = caldavAllows(collectionPrivileges, "create");
          if (canCreate !== true)
            throw new EventWriteError(
              "recurrence",
              canCreate === false ? "denied" : "unknown",
              "CalDAV recurrence changes without a complete scope edit intent require calendar create permission. No changes were saved.",
            );
        }
        const organizer = componentString(master, "organizer");
        if (organizer) {
          const addresses = await caldavOrganizerAddresses(
            externalCalendarId,
            authorization,
          );
          const self = addresses?.includes(
            organizer.replace(/^mailto:/i, "").toLowerCase(),
          );
          // Nonmatch on a shared calendar does NOT prove an attendee copy: its
          // organizer may be the collection owner rather than this principal.
          assertEventWriteEvidence(
            operation.action === "delete" && self === false ? undefined : self,
            "organizer",
          );
        }
      }
    }
  },

  async pushCreate(_userID, accountId, externalCalendarId, event: Event) {
    const client = await clientForAccount(accountId);
    const filename = `${event.id}.ics`;
    const res = await client.createCalendarObject({
      calendar: { url: externalCalendarId } as any,
      filename,
      iCalString: toIcal(event),
    });
    assertProviderEventMutationResponse(res);
    const base = externalCalendarId.endsWith("/")
      ? externalCalendarId
      : `${externalCalendarId}/`;
    const externalEventId = `${base}${filename}`;
    return {
      externalEventId,
      // RFC 4791 §5.3.4: transformed PUT cannot return a strong ETag. A
      // follow-up GET may include unseen edits; sync must accept its content.
      etag: strongEventEtag(res.headers.get("etag")),
      icalUid: event.id,
    };
  },

  async pushUpdate(
    _userID,
    accountId,
    _externalCalendarId,
    externalEventId,
    event: Event,
    ref,
    patch,
  ) {
    requireEventPatch(patch);
    requireEventEtag(ref?.etag);
    const authorization = await basicAuthForAccount(accountId);
    const current = await readEventResource(
      authorization,
      externalEventId,
      ref,
    );
    const data = patchEventIcal(current.data, event, current.uid, patch);
    if (data === current.data) return; // Known no-op; retain accepted validator.
    const res = await caldavFetch(externalEventId, {
      method: "PUT",
      headers: {
        authorization,
        "Content-Type": "text/calendar; charset=utf-8",
        "If-Match": current.etag,
      },
      body: data,
    });
    assertProviderEventMutationResponse(res);
    return {
      etag: strongEventEtag(res.headers.get("etag")),
      icalUid: current.uid,
    };
  },

  async pushDelete(
    _userID,
    accountId,
    _externalCalendarId,
    externalEventId,
    ref,
  ) {
    const etag = requireEventEtag(ref?.etag);
    const authorization = await basicAuthForAccount(accountId);
    const res = await caldavFetch(externalEventId, {
      method: "DELETE",
      headers: { authorization, "If-Match": etag },
    });
    if (res.status !== 404) assertProviderEventMutationResponse(res);
  },

  async pushTaskCreate(_userID, accountId, externalCalendarId, task: Task) {
    const client = await clientForAccount(accountId);
    const filename = `${task.id}.ics`;
    const res = await client.createCalendarObject({
      calendar: { url: externalCalendarId } as any,
      filename,
      iCalString: toTaskIcal(task),
    });
    if (!res.ok) throw new Error(`CalDAV ${res.status} ${res.statusText}`);
    const base = externalCalendarId.endsWith("/")
      ? externalCalendarId
      : `${externalCalendarId}/`;
    const externalTaskId = `${base}${filename}`;
    return {
      externalTaskId,
      etag: await etagAfterWrite(
        client,
        externalCalendarId,
        externalTaskId,
        res,
      ),
      icalUid: task.id,
    };
  },

  async pushTaskUpdate(
    _userID,
    accountId,
    externalCalendarId,
    externalTaskId,
    task: Task,
    ref,
  ) {
    const client = await clientForAccount(accountId);
    const { calendarObject, uid: icalUid } = await taskCalendarObjectForUpdate(
      client,
      externalCalendarId,
      externalTaskId,
      ref,
      task,
    );
    const res = await client.updateCalendarObject({ calendarObject });
    if (!res.ok) throw new Error(`CalDAV ${res.status} ${res.statusText}`);
    return {
      etag: await etagAfterWrite(
        client,
        externalCalendarId,
        externalTaskId,
        res,
      ),
      icalUid,
    };
  },

  async pushTaskDelete(
    _userID,
    accountId,
    _externalCalendarId,
    externalTaskId,
    ref,
  ) {
    if (!ref?.etag)
      throw new Error("CalDAV task has no ETag; refusing an unsafe delete");
    const client = await clientForAccount(accountId);
    const res = await client.deleteCalendarObject({
      calendarObject: { url: externalTaskId, etag: ref.etag },
    });
    if (!res.ok && res.status !== 404)
      throw new Error(`CalDAV ${res.status} ${res.statusText}`);
  },

  async createCalendar(_userID, accountId, { name, color }) {
    // Calendar home = parent of an existing calendar's URL (every provisioned
    // account has at least one; discovery re-derives partition hosts on iCloud).
    const client = await clientForAccount(accountId);
    const cals = await client.fetchCalendars();
    if (cals.length === 0)
      throw new Error("CalDAV: no calendar home found on this account");
    const home = new URL("..", cals[0].url).href;
    const url = `${home}${randomUUID()}/`;

    const res = await caldavFetch(url, {
      method: "MKCALENDAR",
      headers: {
        Authorization: await basicAuthForAccount(accountId),
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set><D:prop>
    <D:displayname>${escapeXml(name)}</D:displayname>
    <A:calendar-color>${escapeXml(color)}</A:calendar-color>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`,
    });
    if (!res.ok) throw new Error(`CalDAV ${res.status} ${res.statusText}`);
    return { externalId: url };
  },

  async updateCalendar(
    _userID,
    accountId,
    externalCalendarId,
    { name, color },
  ) {
    const res = await caldavFetch(externalCalendarId, {
      method: "PROPPATCH",
      headers: {
        Authorization: await basicAuthForAccount(accountId),
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/">
  <D:set><D:prop>
    <D:displayname>${escapeXml(name)}</D:displayname>
    <A:calendar-color>${escapeXml(color)}</A:calendar-color>
  </D:prop></D:set>
</D:propertyupdate>`,
    });
    // 207 multistatus counts as ok; per-prop failures (e.g. a server ignoring
    // the Apple color prop) are non-fatal — displayname is the one that matters.
    if (!res.ok && res.status !== 207)
      throw new Error(`CalDAV ${res.status} ${res.statusText}`);
  },

  async deleteCalendar(_userID, accountId, externalCalendarId) {
    const res = await caldavFetch(externalCalendarId, {
      method: "DELETE",
      headers: { Authorization: await basicAuthForAccount(accountId) },
    });
    if (!res.ok && res.status !== 404)
      throw new Error(`CalDAV ${res.status} ${res.statusText}`);
  },
};
