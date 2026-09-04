import ICAL from "ical.js";
import { randomUUID } from "crypto";
import type { Event, Task, TaskStatus } from "@musubi/types";
import { logger } from "@musubi/config";
import { getCaldavAccountById, getCaldavAccountsByUser } from "@musubi/db";
import type {
  CalendarAdapter,
  ExternalCalendarInfo,
  ExternalEventRef,
  ExternalTaskRef,
  FetchChangesResult,
  NormalizedChange,
  NormalizedEvent,
  NormalizedTask,
} from "../adapter";
import { createCaldavClient, createGuardedCaldavFetch } from "../caldav_client";
import { decryptSecret } from "../crypto";

const TASK_STATUS_BY_ICAL: Record<string, TaskStatus> = {
  "NEEDS-ACTION": "needs-action",
  "IN-PROCESS": "in-process",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const VTODO_FILTER = [
  {
    "comp-filter": {
      _attributes: { name: "VCALENDAR" },
      "comp-filter": { _attributes: { name: "VTODO" } },
    },
  },
];

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

function recurrenceFrom(component: ICAL.Component): string | null {
  const rrule = component.getFirstProperty("rrule")?.getFirstValue();
  if (!rrule) return null;
  const exdates = component
    .getAllProperties("exdate")
    .map((property) => {
      const time = property.getFirstValue() as ICAL.Time | null;
      if (!time) return null;
      const date = time.isDate ? utcMidnight(time) : time.toJSDate();
      return `EXDATE:${date
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z")}`;
    })
    .filter((line): line is string => line !== null);
  return [`RRULE:${rrule.toString()}`, ...exdates].join("\n");
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
    } else if (line.startsWith("EXDATE:")) {
      for (const value of line.slice("EXDATE:".length).split(",")) {
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
          "exdate",
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
    status: "active",
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

export function toCaldavCalendarObject(
  externalEventId: string,
  event: Event,
  ref?: ExternalEventRef,
) {
  if (!ref?.etag)
    throw new Error("CalDAV event has no ETag; refusing an unsafe update");
  return {
    url: externalEventId,
    data: toIcal(event, ref.icalUid ?? event.id),
    etag: ref.etag,
  };
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

async function uidForWrite(
  client: Awaited<ReturnType<typeof clientForAccount>>,
  externalCalendarId: string,
  externalObjectId: string,
  ref: { icalUid?: string | null } | undefined,
  kind: "event" | "task",
) {
  if (ref?.icalUid) return ref.icalUid;

  const [object] = await client.fetchCalendarObjects({
    calendar: { url: externalCalendarId } as any,
    objectUrls: [externalObjectId],
  });
  const uid = object
    ? kind === "event"
      ? icalToNormalized(object)?.icalUid
      : icalToNormalizedTask(object)?.icalUid
    : null;
  if (!uid)
    throw new Error(`CalDAV ${kind} has no UID; refusing an unsafe update`);
  return uid;
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

export const caldavAdapter: CalendarAdapter = {
  provider: "caldav",

  async listAccounts(userID: string): Promise<{ id: string; label: string }[]> {
    const accounts = await getCaldavAccountsByUser(userID);
    return accounts.map((a) => ({ id: a.id, label: a.username }));
  },

  async listCalendars(
    _userID: string,
    accountId: string,
  ): Promise<ExternalCalendarInfo[]> {
    const client = await clientForAccount(accountId);
    const cals = await client.fetchCalendars();
    return cals
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
  },

  async fetchChanges(
    _userID,
    accountId,
    externalCalendarId,
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

    // iCloud's calendar-query REPORT returns NOTHING without a time-range filter
    // (tsdav's default query gets 0 objects). Bound it to a rolling window —
    // recurring events overlapping it still come back (iCloud returns the master).
    // ponytail: window, not all-time; widen if someone needs far-past/future events.
    const now = Date.now();
    const DAY = 86_400_000;
    const timeRange = {
      start: new Date(now - 365 * DAY).toISOString(), // 1 year back
      end: new Date(now + 3 * 365 * DAY).toISOString(), // 3 years ahead
    };
    const eventObjects = await client.fetchCalendarObjects({
      calendar: cal,
      timeRange,
    });
    const taskObjects = cal.components?.includes("VTODO")
      ? await client.fetchCalendarObjects({
          calendar: cal,
          // VTODO may have no DTSTART or DUE, so a time-range would lose tasks.
          filters: VTODO_FILTER,
        })
      : [];
    const changes: NormalizedChange[] = [];
    for (const object of eventObjects) {
      const data = icalToNormalized(object);
      if (!data) throw new Error(`Invalid VEVENT resource: ${object.url}`);
      changes.push({ kind: "event", data });
    }
    for (const object of taskObjects) {
      const data = icalToNormalizedTask(object);
      if (!data) throw new Error(`Invalid VTODO resource: ${object.url}`);
      changes.push({ kind: "task", data });
    }
    logger.debug("caldav.objects.fetched", {
      accountId,
      externalCalendarId,
      eventObjects: eventObjects.length,
      taskObjects: taskObjects.length,
      parsedEvents: eventObjects.length,
      parsedTasks: taskObjects.length,
    });

    // ponytail: full fetch + reset every sync — simple and handles deletions.
    // Upgrade to WebDAV sync-collection (cursor = syncToken) if calendars grow.
    return { changes, nextCursor: cal.syncToken ?? null, reset: true };
  },

  async pushCreate(_userID, accountId, externalCalendarId, event: Event) {
    const client = await clientForAccount(accountId);
    const filename = `${event.id}.ics`;
    const res = await client.createCalendarObject({
      calendar: { url: externalCalendarId } as any,
      filename,
      iCalString: toIcal(event),
    });
    if (!res.ok) throw new Error(`CalDAV ${res.status} ${res.statusText}`);
    const base = externalCalendarId.endsWith("/")
      ? externalCalendarId
      : `${externalCalendarId}/`;
    const externalEventId = `${base}${filename}`;
    return {
      externalEventId,
      etag: await etagAfterWrite(
        client,
        externalCalendarId,
        externalEventId,
        res,
      ),
      icalUid: event.id,
    };
  },

  async pushUpdate(
    _userID,
    accountId,
    externalCalendarId,
    externalEventId,
    event: Event,
    ref,
  ) {
    const client = await clientForAccount(accountId);
    const icalUid = await uidForWrite(
      client,
      externalCalendarId,
      externalEventId,
      ref,
      "event",
    );
    const res = await client.updateCalendarObject({
      calendarObject: toCaldavCalendarObject(externalEventId, event, {
        externalEventId,
        etag: ref?.etag,
        icalUid,
      }),
    });
    if (!res.ok) throw new Error(`CalDAV ${res.status} ${res.statusText}`);
    return {
      etag: await etagAfterWrite(
        client,
        externalCalendarId,
        externalEventId,
        res,
      ),
      icalUid,
    };
  },

  async pushDelete(
    _userID,
    accountId,
    _externalCalendarId,
    externalEventId,
    ref,
  ) {
    if (!ref?.etag)
      throw new Error("CalDAV event has no ETag; refusing an unsafe delete");
    const client = await clientForAccount(accountId);
    const res = await client.deleteCalendarObject({
      calendarObject: { url: externalEventId, etag: ref.etag },
    });
    if (!res.ok && res.status !== 404)
      throw new Error(`CalDAV ${res.status} ${res.statusText}`);
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
    const icalUid = await uidForWrite(
      client,
      externalCalendarId,
      externalTaskId,
      ref,
      "task",
    );
    const res = await client.updateCalendarObject({
      calendarObject: toCaldavTaskObject(externalTaskId, task, {
        externalTaskId,
        etag: ref?.etag,
        icalUid,
      }),
    });
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
