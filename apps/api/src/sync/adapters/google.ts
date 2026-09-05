import { config, logger } from "@musubi/config";
import { getOAuthAccountIDs, hasOAuthTaskScope, type EventContentPatch } from "@musubi/db";
import { DEFAULT_CALENDAR_COLOR } from "@musubi/types";
import type { Event, Task } from "@musubi/types";
import type {
  CalendarAdapter,
  CalendarDiscoveryResult,
  ExternalCalendarInfo,
  FetchChangesResult,
  NormalizedChange,
  NormalizedEvent,
  NormalizedTask,
} from "../adapter";
import { getOAuthAccessToken } from "../oauth";
import { isOptionalTaskError, TaskScopeMissingError } from "../errors";
import { assertEventWriteEvidence, assertEventWriteResponse, assertOAuthEventWriteGrant, assertAcceptedEventEtag, assertProviderEventMutationResponse, requireEventEtag, requireEventPatch, strongEventEtag, ProviderEventWriteError } from "../event_write";

const GCAL = "https://www.googleapis.com/calendar/v3";
const GTASKS = "https://tasks.googleapis.com/tasks/v1";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TASK_LIST_PREFIX = "musubi-google-task-list:";

export function googleTaskListExternalId(taskListId: string) {
  return `${TASK_LIST_PREFIX}${taskListId}`;
}

function googleTaskListId(externalCalendarId: string) {
  return externalCalendarId.startsWith(TASK_LIST_PREFIX)
    ? externalCalendarId.slice(TASK_LIST_PREFIX.length)
    : null;
}

// Error with Google's own message when available ("Cannot delete primary
// calendar", …) — status text alone is useless to the user.
async function googleError(res: Response): Promise<Error> {
  let detail = res.statusText;
  try {
    detail = (await res.json())?.error?.message ?? detail;
  } catch {
    /* keep statusText */
  }
  return new Error(`Google ${res.status}: ${detail}`);
}

// Calendar color lives on the per-user calendarList entry, not the calendar
// resource itself; colorRgbFormat=true accepts plain hex.
async function patchCalendarColor(
  accessToken: string,
  calendarId: string,
  color: string,
) {
  const res = await fetch(
    `${GCAL}/users/me/calendarList/${encodeURIComponent(calendarId)}?colorRgbFormat=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        backgroundColor: color,
        foregroundColor: "#000000",
      }),
    },
  );
  if (!res.ok) throw await googleError(res);
}

async function getAccessToken(
  userID: string,
  accountId: string,
  requireTasks = false,
) {
  const accessToken = await getOAuthAccessToken("google", userID, accountId, {
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    clientId: config.social.googleWebClientID,
    clientSecret: config.social.googleClientSecret,
    subtypeKey: "error_subtype",
  });
  // Refresh may return a narrower grant. Check after minting, before any Tasks
  // endpoint, including task writes that bypass discovery.
  if (requireTasks && !(await hasOAuthTaskScope(userID, "google", accountId)))
    throw new TaskScopeMissingError();
  return accessToken;
}

// "What UTC instant is <local wall-clock time> in <tz>?" — via Intl, no tz lib.
// ponytail: single-iteration approximation; can be 1h off in the hour around a
// DST transition. Good enough for exception stamps.
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
  );
  const wallAtGuess = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour % 24,
    +p.minute,
    +p.second,
  );
  return new Date(guess - (wallAtGuess - guess));
}

const toICalUTC = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

// Normalize Google's recurrence lines into what our expansion (rrule lib)
// provably handles — verified empirically:
//  - EXDATE;TZID=…  → silently IGNORED by rrule → convert to UTC EXDATE here
//  - EXDATE;VALUE=DATE:… → works (all-day, UTC-midnight anchors) → keep
//  - FREQ=YEARLY;BYMONTHDAY without BYMONTH → RFC expands monthly → anchor month
function sanitizeRecurrence(recurrence: string, start: Date): string {
  return recurrence
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      if (/^(RRULE:)?FREQ=/.test(line)) {
        if (
          /FREQ=YEARLY/.test(line) &&
          /BYMONTHDAY=/.test(line) &&
          !/BYMONTH=/.test(line)
        ) {
          return `${line};BYMONTH=${start.getUTCMonth() + 1}`;
        }
        return line;
      }
      const m = line.match(/^EXDATE;TZID=([^:;]+):(.+)$/i);
      if (m) {
        const [, tz, vals] = m;
        const utc = vals.split(",").map((v) => {
          const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
          return t
            ? toICalUTC(
                zonedToUtc(+t[1], +t[2], +t[3], +t[4], +t[5], +t[6], tz),
              )
            : v;
        });
        return `EXDATE:${utc.join(",")}`;
      }
      return line;
    })
    .join("\n");
}

// Google event JSON -> NormalizedEvent
function toNormalized(item: any): NormalizedEvent {
  if (item.status === "cancelled") {
    return {
      externalId: item.id,
      etag: strongEventEtag(item.etag),
      status: "cancelled",
      title: "",
      start: new Date(0),
      end: new Date(0),
      isAllDay: false,
      description: null,
      location: null,
      organizer: null,
      recurrence: null,
      url: null,
    };
  }

  const isAllDay = !item.start.dateTime;
  const start = new Date(item.start.dateTime ?? item.start.date);
  const end = isAllDay
    ? new Date(new Date(item.end.date).getTime() - 86400000) // -1 day, Google end.date is exclusive
    : new Date(item.end.dateTime);

  return {
    externalId: item.id,
    etag: strongEventEtag(item.etag),
    status: "active",
    title: item.summary ?? "(untitled)",
    start,
    end,
    isAllDay,
    description: item.description ?? null,
    location: item.location ?? null,
    organizer: item.organizer?.email ?? null,
    recurrence: item.recurrence
      ? sanitizeRecurrence(item.recurrence.join("\n"), start)
      : null,
    // NOT htmlLink — that's just "open in Google Calendar" noise on every event.
    // Meet link / source url are actual event URLs.
    url: item.hangoutLink ?? item.source?.url ?? null,
  };
}

// Google wants iCal lines with prefixes; our bare "FREQ=..." needs one.
// All-day series use DATE-typed dtstart, so EXDATE/UNTIL must be dates too
// (RFC 5545: exception/until value type must match DTSTART's).
function toGoogleRecurrence(recurrence: string, isAllDay: boolean): string[] {
  return recurrence
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      if (!/^(RRULE|EXDATE|RDATE|EXRULE)/.test(line)) line = `RRULE:${line}`;
      if (!isAllDay) return line;
      if (/^EXDATE:/.test(line)) {
        const dates = line
          .slice("EXDATE:".length)
          .split(",")
          .map((v) => v.slice(0, 8));
        return `EXDATE;VALUE=DATE:${dates.join(",")}`;
      }
      return line.replace(/UNTIL=(\d{8})T\d{6}Z?/, "UNTIL=$1");
    });
}

// Musubi Event -> Google event JSON
function toGoogleEvent(event: Event) {
  return {
    summary: event.title,
    description: event.description,
    location: event.location,
    // null (not undefined) so a removed recurrence clears on PATCH.
    recurrence: event.recurrence
      ? toGoogleRecurrence(event.recurrence, event.isAllDay)
      : null,
    start: event.isAllDay
      ? { date: event.start.toISOString().slice(0, 10) }
      : { dateTime: event.start.toISOString() },
    end: event.isAllDay
      ? {
          date: new Date(event.end.getTime() + 86400000)
            .toISOString()
            .slice(0, 10),
        } // +1 day, Google exclusive
      : { dateTime: event.end.toISOString() },
  };
}

/** Calendar PATCH preserves omitted properties (including HTML and rich provider state). */
function toGoogleEventPatch(event: Event, patch: EventContentPatch | undefined) {
  const diff = requireEventPatch(patch);
  const next = { ...event, ...diff };
  const full = toGoogleEvent(next);
  const result: Record<string, unknown> = {};
  for (const [field, property] of [
    ["title", "summary"], ["description", "description"], ["location", "location"],
    ["recurrence", "recurrence"], ["start", "start"], ["end", "end"],
  ] as const) {
    if (diff[field] !== undefined) result[property] = full[property];
  }
  if (diff.isAllDay !== undefined) {
    result.start = full.start;
    result.end = full.end;
    if (next.recurrence) result.recurrence = full.recurrence;
  }
  return result;
}

function googleTaskDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toNormalizedGoogleTask(item: any): NormalizedTask {
  const completed = item.status === "completed";
  return {
    completedAt: googleTaskDate(item.completed),
    deleted: item.deleted === true,
    description: item.notes ?? null,
    due: googleTaskDate(item.due),
    etag: item.etag ?? null,
    externalId: item.id,
    icalUid: null,
    isAllDay: Boolean(item.due),
    percentComplete: completed ? 100 : 0,
    priority: 0,
    recurrence: null,
    relatedTo: item.parent ?? null,
    sequence: 0,
    start: null,
    status: completed ? "completed" : "needs-action",
    title: item.title ?? "(untitled)",
    url: item.links?.find((link: any) => link?.link)?.link ?? null,
  };
}

export function toGoogleTask(task: Task) {
  return {
    due: task.due?.toISOString() ?? null,
    notes: task.description ?? null,
    status: task.status === "completed" ? "completed" : "needsAction",
    title: task.title,
  };
}

type GoogleTaskRequestOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function createGoogleTask(
  accessToken: string,
  taskListId: string,
  task: Task,
  options: GoogleTaskRequestOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GTASKS;
  const res = await fetchImpl(
    `${baseUrl}/lists/${encodeURIComponent(taskListId)}/tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toGoogleTask(task)),
    },
  );
  if (!res.ok) throw await googleError(res);
  const created = await res.json();
  return {
    etag: created.etag ?? null,
    externalTaskId: created.id,
    icalUid: null,
  };
}

export async function updateGoogleTask(
  accessToken: string,
  taskListId: string,
  externalTaskId: string,
  task: Task,
  etag: string | null | undefined,
  options: GoogleTaskRequestOptions = {},
) {
  if (!etag) throw new Error("Google task update requires an ETag");
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GTASKS;
  const res = await fetchImpl(
    `${baseUrl}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(externalTaskId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      body: JSON.stringify(toGoogleTask(task)),
    },
  );
  if (!res.ok) throw await googleError(res);
  const updated = await res.json();
  return { etag: updated.etag ?? null, icalUid: null };
}

export async function deleteGoogleTask(
  accessToken: string,
  taskListId: string,
  externalTaskId: string,
  etag: string | null | undefined,
  options: GoogleTaskRequestOptions = {},
) {
  if (!etag) throw new Error("Google task delete requires an ETag");
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GTASKS;
  const res = await fetchImpl(
    `${baseUrl}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(externalTaskId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "If-Match": etag,
      },
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw await googleError(res);
  }
}

export async function fetchGoogleTaskChanges(
  accessToken: string,
  taskListId: string,
  options: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<FetchChangesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GTASKS;
  const changes: NormalizedChange[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showDeleted: "true",
      showHidden: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetchImpl(
      `${baseUrl}/lists/${encodeURIComponent(taskListId)}/tasks?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok)
      throw new Error(`Google Tasks ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const item of data.items ?? []) {
      changes.push({ kind: "task", data: toNormalizedGoogleTask(item) });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Google Tasks has no collection sync token. A complete, paginated read is
  // the only safe way to notice removals that have aged out of its tombstones.
  return { changes, nextCursor: null, reset: true };
}

export function toExternalGoogleTaskList(list: any): ExternalCalendarInfo {
  return {
    color: DEFAULT_CALENDAR_COLOR,
    externalId: googleTaskListExternalId(list.id),
    name: list.title ?? "Tasks",
    supportsEvents: false,
    supportsTasks: true,
  };
}

async function listGoogleTaskLists(accessToken: string) {
  const lists: any[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${GTASKS}/users/@me/lists?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw await googleError(res);
    const data = await res.json();
    lists.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return lists;
}

export async function fetchGoogleChanges(
  accessToken: string,
  externalCalendarId: string,
  cursor: string | null,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
  } = {},
): Promise<FetchChangesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GCAL;
  const changes: NormalizedChange[] = [];
  let currentCursor = cursor;
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let reset = false;
  let done = false;

  while (!done) {
    const params = new URLSearchParams();
    if (currentCursor) params.set("syncToken", currentCursor);
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetchImpl(
      `${baseUrl}/calendars/${encodeURIComponent(externalCalendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    // Cursor expired → discard any partial incremental pages and restart as a
    // full set. The engine will sweep provider mappings absent from that set.
    if (res.status === 410) {
      reset = true;
      currentCursor = null;
      pageToken = undefined;
      changes.length = 0;
      continue;
    }
    if (!res.ok) throw new Error(`Google ${res.status} ${res.statusText}`);

    const data = await res.json();
    for (const item of data.items ?? [])
      changes.push({ kind: "event", data: toNormalized(item) });

    if (data.nextPageToken) {
      pageToken = data.nextPageToken;
    } else {
      nextSyncToken = data.nextSyncToken;
      done = true;
    }
  }

  return { changes, nextCursor: nextSyncToken ?? currentCursor, reset };
}

export const googleAdapter: CalendarAdapter = {
  provider: "google",

  async listAccounts(
    userID: string,
    accountId?: string,
  ): Promise<{ id: string; label: string }[]> {
    const ids = await getOAuthAccountIDs(userID, "google", accountId);
    return Promise.all(
      ids.map(async (id) => {
        let label = id;
        try {
          const accessToken = await getAccessToken(userID, id);
          const res = await fetch(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          );
          if (res.ok) {
            const d = await res.json();
            label = d.email ?? d.name ?? id;
          }
        } catch {
          /* fall back to id */
        }
        return { id, label };
      }),
    );
  },

  async listCalendars(
    userID: string,
    accountId: string,
  ): Promise<CalendarDiscoveryResult> {
    const accessToken = await getAccessToken(userID, accountId);
    const calendars: ExternalCalendarInfo[] = [];
    let pageToken: string | undefined;
    // The engine sweeps absent mirrors only after this complete discovery.
    do {
      const params = new URLSearchParams();
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`${GCAL}/users/me/calendarList?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw await googleError(res);
      const data = await res.json();
      for (const c of data.items ?? [])
        calendars.push({
          externalId: c.id,
          name: c.summary,
          color: c.backgroundColor,
          readOnly: c.accessRole !== "owner" && c.accessRole !== "writer",
          supportsEvents: true,
          supportsTasks: false,
        });
      pageToken = data.nextPageToken;
    } while (pageToken);
    if (!(await hasOAuthTaskScope(userID, "google", accountId))) {
      return { calendars, taskListsComplete: false };
    }
    try {
      const taskLists = await listGoogleTaskLists(accessToken);
      return {
        calendars: [...calendars, ...taskLists.map(toExternalGoogleTaskList)],
        taskListsComplete: true,
      };
    } catch (error) {
      if (!isOptionalTaskError(error)) throw error;
      logger.warn("sync.tasks.discovery_unavailable", {
        provider: "google",
        userId: userID,
        accountId,
      });
      return { calendars, taskListsComplete: false };
    }
  },

  async fetchChanges(
    userID,
    accountId,
    externalCalendarId,
    cursor,
  ): Promise<FetchChangesResult> {
    const accessToken = await getAccessToken(userID, accountId);
    const taskListId = googleTaskListId(externalCalendarId);
    if (taskListId && !(await hasOAuthTaskScope(userID, "google", accountId)))
      throw new TaskScopeMissingError();
    return taskListId
      ? fetchGoogleTaskChanges(accessToken, taskListId)
      : fetchGoogleChanges(accessToken, externalCalendarId, cursor);
  },

  async assertEventWrite(userID, accountId, externalCalendarId, operation) {
    const accessToken = await getAccessToken(userID, accountId);
    await assertOAuthEventWriteGrant(userID, "google", accountId);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const response = await fetch(
      `${GCAL}/users/me/calendarList/${encodeURIComponent(externalCalendarId)}`,
      { headers },
    );
    assertEventWriteResponse(response);
    const calendar = await response.json();
    assertEventWriteEvidence(
      typeof calendar.accessRole === "string"
        ? ["owner", "writer"].includes(calendar.accessRole)
        : undefined,
      "event-write",
    );
    // A calendar grant does not make an invited copy an organizer's meeting.
    // DELETE can cancel an organizer copy, but only removes an attendee copy.
    if (operation.action !== "create" && operation.external) {
      requireEventEtag(operation.external.etag);
      if (operation.action === "update") toGoogleEventPatch(operation.event, operation.patch);
      const response = await fetch(
        `${GCAL}/calendars/${encodeURIComponent(externalCalendarId)}/events/${encodeURIComponent(operation.external.externalEventId)}`,
        { headers },
      );
      if (operation.action === "delete" && [404, 410].includes(response.status)) return;
      assertEventWriteResponse(response);
      const current = await response.json();
      assertAcceptedEventEtag(operation.external.etag, current.etag);
      // Google documents self=false as the default on an organizer object.
      // An absent organizer object is not evidence of that default.
      const self = typeof current.organizer?.self === "boolean"
        ? current.organizer.self
        : typeof current.organizer?.email === "string" && current.organizer.email
          ? false : undefined;
      assertEventWriteEvidence(operation.action === "delete" && self === false ? true : self, "organizer");
    }
  },

  async pushCreate(userID, accountId, externalCalendarId, event: Event) {
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(
      `${GCAL}/calendars/${encodeURIComponent(externalCalendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toGoogleEvent(event)),
        redirect: "error",
      },
    );
    assertProviderEventMutationResponse(res);
    const data = await res.json().catch(() => null);
    if (typeof data?.id !== "string" || !data.id) {
      throw new ProviderEventWriteError("provider-write-failed", "unconfirmed", res.status);
    }
    return { externalEventId: data.id, etag: strongEventEtag(data.etag) };
  },

  async pushUpdate(
    userID,
    accountId,
    externalCalendarId,
    externalEventId,
    event: Event,
    ref,
    patch,
  ) {
    const etag = requireEventEtag(ref?.etag);
    const payload = toGoogleEventPatch(event, patch);
    if (Object.keys(payload).length === 0) return; // Known local-only/no-op diff, no write.
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(
      `${GCAL}/calendars/${encodeURIComponent(externalCalendarId)}/events/${encodeURIComponent(externalEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "If-Match": etag,
        },
        body: JSON.stringify(payload),
        redirect: "error", // Never turn a conditional mutation into a redirected GET.
      },
    );
    assertProviderEventMutationResponse(res);
    // A missing/malformed success body cannot authorize another write. Never
    // adopt a later GET's version without accepting its content through sync.
    const data = await res.json().catch(() => null);
    return { etag: strongEventEtag(data?.etag) };
  },

  async pushDelete(userID, accountId, externalCalendarId, externalEventId, ref) {
    const etag = requireEventEtag(ref?.etag);
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(
      `${GCAL}/calendars/${encodeURIComponent(externalCalendarId)}/events/${encodeURIComponent(externalEventId)}`,
      { method: "DELETE", redirect: "error", headers: { Authorization: `Bearer ${accessToken}`, "If-Match": etag } },
    );
    // 404/410 = already gone = success (idempotent)
    if (res.status !== 404 && res.status !== 410) {
      assertProviderEventMutationResponse(res);
    }
  },

  async pushTaskCreate(userID, accountId, externalCalendarId, task) {
    const taskListId = googleTaskListId(externalCalendarId);
    if (!taskListId) throw new Error("Google task write requires a task list");
    return createGoogleTask(
      await getAccessToken(userID, accountId, true),
      taskListId,
      task,
    );
  },

  async pushTaskUpdate(
    userID,
    accountId,
    externalCalendarId,
    externalTaskId,
    task,
    ref,
  ) {
    const taskListId = googleTaskListId(externalCalendarId);
    if (!taskListId) throw new Error("Google task write requires a task list");
    return updateGoogleTask(
      await getAccessToken(userID, accountId, true),
      taskListId,
      externalTaskId,
      task,
      ref?.etag,
    );
  },

  async pushTaskDelete(
    userID,
    accountId,
    externalCalendarId,
    externalTaskId,
    ref,
  ) {
    const taskListId = googleTaskListId(externalCalendarId);
    if (!taskListId) throw new Error("Google task write requires a task list");
    await deleteGoogleTask(
      await getAccessToken(userID, accountId, true),
      taskListId,
      externalTaskId,
      ref?.etag,
    );
  },

  async createCalendar(userID, accountId, { name, color }) {
    const accessToken = await getAccessToken(userID, accountId);
    await assertOAuthEventWriteGrant(userID, "google", accountId);
    const res = await fetch(`${GCAL}/calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ summary: name }),
    });
    if (!res.ok) throw await googleError(res);
    const data = await res.json();
    await patchCalendarColor(accessToken!, data.id, color);
    return { externalId: data.id };
  },

  async updateCalendar(userID, accountId, externalCalendarId, { name, color }) {
    const accessToken = await getAccessToken(userID, accountId);
    const taskListId = googleTaskListId(externalCalendarId);
    if (taskListId && !(await hasOAuthTaskScope(userID, "google", accountId)))
      throw new TaskScopeMissingError();
    if (taskListId) {
      const res = await fetch(
        `${GTASKS}/users/@me/lists/${encodeURIComponent(taskListId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: name }),
        },
      );
      if (!res.ok) throw await googleError(res);
      return;
    }
    const res = await fetch(
      `${GCAL}/calendars/${encodeURIComponent(externalCalendarId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ summary: name }),
      },
    );
    if (!res.ok) throw await googleError(res);
    await patchCalendarColor(accessToken!, externalCalendarId, color);
  },

  async deleteCalendar(userID, accountId, externalCalendarId) {
    const accessToken = await getAccessToken(userID, accountId);
    const taskListId = googleTaskListId(externalCalendarId);
    if (taskListId && !(await hasOAuthTaskScope(userID, "google", accountId)))
      throw new TaskScopeMissingError();
    const res = await fetch(
      taskListId
        ? `${GTASKS}/users/@me/lists/${encodeURIComponent(taskListId)}`
        : `${GCAL}/calendars/${encodeURIComponent(externalCalendarId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // 404/410 = already gone = success; primary calendars come back as 400 and bubble up.
    if (!res.ok && res.status !== 404 && res.status !== 410)
      throw await googleError(res);
  },
};
