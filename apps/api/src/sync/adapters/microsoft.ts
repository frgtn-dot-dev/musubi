import { config, logger } from "@musubi/config";
import { getOAuthAccountIDs, hasOAuthTaskScope } from "@musubi/db";
import {
  DEFAULT_CALENDAR_COLOR,
  type Event,
  nearestMicrosoftCalendarColor,
  type Task,
  type TaskStatus,
} from "@musubi/types";
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

const GRAPH = "https://graph.microsoft.com/v1.0";
const TASK_LIST_PREFIX = "musubi-microsoft-task-list:";

export function microsoftTaskListExternalId(taskListId: string) {
  return `${TASK_LIST_PREFIX}${taskListId}`;
}

function microsoftTaskListId(externalCalendarId: string) {
  return externalCalendarId.startsWith(TASK_LIST_PREFIX)
    ? externalCalendarId.slice(TASK_LIST_PREFIX.length)
    : null;
}

// ── Sync window tuning ───────────────────────────────────────────────────────
// Graph's v1.0 event delta only works on a calendarView — a FIXED date range
// baked into the delta token at the initial sync. Events outside the window
// are invisible to the mirror; when the future edge gets close, we force a
// full re-sync with a fresh window (reset: true → the engine wipes + refetches
// and its sweep tombstones events that slid out of the window).
// ponytail: rolling ~2.5y view, not full history like Google. Upgrade path:
// beta /events/delta (unbounded) once it hits v1.0.
const WINDOW_PAST_DAYS = 180;
const WINDOW_FUTURE_DAYS = 730;
const WINDOW_RENEW_MARGIN_DAYS = 90; // re-window when less future than this remains
const PAGE_SIZE = 100;

const DAY_MS = 86_400_000;

// Every request asks for UTC times and plain-text bodies up front — saves
// timezone/HTML conversion on our side.
const PREFER = `outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=${PAGE_SIZE}`;

async function getAccessToken(
  userID: string,
  accountId: string,
  requireTasks = false,
) {
  const tenant = config.social.microsoftTenantID;
  const accessToken = await getOAuthAccessToken(
    "microsoft",
    userID,
    accountId,
    {
      tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      clientId: config.social.microsoftClientID,
      clientSecret: config.social.microsoftClientSecret,
      // Omit scope on refresh: Microsoft retains the original grant, including
      // Tasks when granted, without escalating calendar-only consent.
      subtypeKey: "suberror",
    },
  );
  // Refresh may return a narrower grant. Check after minting, before any Tasks
  // endpoint, including task writes that bypass discovery.
  if (
    requireTasks &&
    !(await hasOAuthTaskScope(userID, "microsoft", accountId))
  )
    throw new TaskScopeMissingError();
  return accessToken;
}

// Error with Graph's own message when available ("Cannot delete default
// calendar", …) — status text alone is useless to the user.
async function graphError(res: Response): Promise<Error> {
  let detail = res.statusText;
  try {
    detail = (await res.json())?.error?.message ?? detail;
  } catch {
    /* keep statusText */
  }
  return new Error(`Outlook ${res.status}: ${detail}`);
}

// Graph dateTime comes as "2026-07-18T20:30:00.0000000" (no zone designator,
// zone is UTC via the Prefer header). Trim the 7-digit fraction and pin Z.
export function parseGraphDate(dateTime: string): Date {
  const normalized = dateTime.replace(/(\.\d{3})\d*/, "$1");
  return new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`,
  );
}

// Graph event JSON -> NormalizedEvent. Recurring series arrive pre-expanded by
// calendarView (occurrences + exceptions as individual events), so recurrence
// is always null here — no RRULE conversion on pull.
export function toNormalized(item: any): NormalizedEvent {
  if (item["@removed"]) {
    return {
      externalId: item.id,
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

  const isAllDay = !!item.isAllDay;
  const start = parseGraphDate(item.start.dateTime);
  const end = isAllDay
    ? new Date(parseGraphDate(item.end.dateTime).getTime() - DAY_MS) // Graph all-day end is exclusive
    : parseGraphDate(item.end.dateTime);

  return {
    externalId: item.id,
    status: "active",
    title: item.subject ?? "(untitled)",
    start,
    end,
    isAllDay,
    description: item.body?.content?.trim() || null,
    location: item.location?.displayName?.trim() || null,
    organizer: item.organizer?.emailAddress?.address ?? null,
    recurrence: null,
    // NOT webLink — that's just "open in Outlook" noise on every event.
    url: item.onlineMeeting?.joinUrl ?? item.onlineMeetingUrl ?? null,
  };
}

// Musubi Event -> Graph event JSON
export function toGraphEvent(event: Event) {
  // Pull never produces recurrence for this provider (see toNormalized), so
  // this only triggers for Musubi-native recurring events pushed into an
  // Outlook mirror. Graph models recurrence as structured patterns + per-
  // occurrence exceptions — no iCal RRULE/EXDATE round-trip exists.
  // ponytail: reject instead of silently dropping the recurrence; upgrade
  // path is an RRULE→patternedRecurrence converter + master-echo dedup.
  if (event.recurrence) {
    throw new Error(
      "Outlook calendars don't support recurring events created in Musubi yet.",
    );
  }
  return {
    subject: event.title,
    body: { contentType: "text", content: event.description ?? "" },
    location: { displayName: event.location ?? "" },
    isAllDay: event.isAllDay,
    // All-day needs midnight-to-midnight and an exclusive end (+1 day).
    start: {
      dateTime: event.isAllDay
        ? event.start.toISOString().slice(0, 10) + "T00:00:00"
        : event.start.toISOString(),
      timeZone: "UTC",
    },
    end: {
      dateTime: event.isAllDay
        ? new Date(event.end.getTime() + DAY_MS).toISOString().slice(0, 10) +
          "T00:00:00"
        : event.end.toISOString(),
      timeZone: "UTC",
    },
  };
}

function graphTaskDate(value: any) {
  return typeof value?.dateTime === "string"
    ? parseGraphDate(value.dateTime)
    : null;
}

function graphTaskStatus(status: string | undefined): TaskStatus {
  if (status === "completed") return "completed";
  if (status === "inProgress") return "in-process";
  return "needs-action";
}

export function toNormalizedMicrosoftTask(item: any): NormalizedTask {
  const status = graphTaskStatus(item.status);
  return {
    completedAt: graphTaskDate(item.completedDateTime),
    deleted: Boolean(item["@removed"]),
    description: item.body?.content?.trim() || null,
    due: graphTaskDate(item.dueDateTime),
    etag: item["@odata.etag"] ?? null,
    externalId: item.id,
    icalUid: null,
    isAllDay: false,
    percentComplete: status === "completed" ? 100 : 0,
    priority:
      item.importance === "high" ? 1 : item.importance === "low" ? 9 : 0,
    recurrence: null,
    relatedTo: null,
    sequence: 0,
    start: graphTaskDate(item.startDateTime),
    status,
    title: item.title ?? "(untitled)",
    url:
      item.linkedResources?.find((resource: any) => resource?.webUrl)?.webUrl ??
      null,
  };
}

function toGraphTaskDate(date: Date | null | undefined) {
  return date
    ? { dateTime: date.toISOString().replace(/Z$/, ""), timeZone: "UTC" }
    : null;
}

function toGraphTask(task: Task) {
  return {
    body: { content: task.description ?? "", contentType: "text" },
    dueDateTime: toGraphTaskDate(task.due),
    importance:
      task.priority === 0
        ? "normal"
        : task.priority < 5
          ? "high"
          : task.priority > 5
            ? "low"
            : "normal",
    startDateTime: toGraphTaskDate(task.start),
    status:
      task.status === "completed"
        ? "completed"
        : task.status === "in-process"
          ? "inProgress"
          : "notStarted",
    title: task.title,
  };
}

type MicrosoftTaskRequestOptions = {
  fetchImpl?: typeof fetch;
  graphBase?: string;
};

function microsoftTaskPath(taskListId: string, taskId?: string) {
  const list = encodeURIComponent(taskListId);
  return `/me/todo/lists/${list}/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;
}

export async function fetchMicrosoftTaskChanges(
  accessToken: string,
  taskListId: string,
  cursor: string | null,
  options: MicrosoftTaskRequestOptions = {},
): Promise<FetchChangesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphBase = options.graphBase ?? GRAPH;
  const initialUrl = `${graphBase}${microsoftTaskPath(taskListId)}/delta?$top=${PAGE_SIZE}`;
  const changes: NormalizedChange[] = [];
  let reset = !cursor;
  let url = cursor ?? initialUrl;
  let deltaLink: string | null = null;

  while (!deltaLink) {
    const res = await graphGet(accessToken, url, fetchImpl);
    if (res.status === 410 && url !== initialUrl) {
      changes.length = 0;
      reset = true;
      url = initialUrl;
      continue;
    }
    if (!res.ok) throw await graphError(res);
    const data = await res.json();
    for (const item of data.value ?? []) {
      changes.push({ kind: "task", data: toNormalizedMicrosoftTask(item) });
    }
    if (data["@odata.nextLink"]) url = data["@odata.nextLink"];
    else deltaLink = data["@odata.deltaLink"] ?? url;
  }

  return { changes, nextCursor: deltaLink, reset };
}

export async function createMicrosoftTask(
  accessToken: string,
  taskListId: string,
  task: Task,
  options: MicrosoftTaskRequestOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphBase = options.graphBase ?? GRAPH;
  const res = await fetchImpl(`${graphBase}${microsoftTaskPath(taskListId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toGraphTask(task)),
  });
  if (!res.ok) throw await graphError(res);
  const created = await res.json();
  return {
    etag: created["@odata.etag"] ?? null,
    externalTaskId: created.id,
    icalUid: null,
  };
}

export async function updateMicrosoftTask(
  accessToken: string,
  taskListId: string,
  externalTaskId: string,
  task: Task,
  etag: string | null | undefined,
  options: MicrosoftTaskRequestOptions = {},
) {
  if (!etag) throw new Error("Microsoft task update requires an ETag");
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphBase = options.graphBase ?? GRAPH;
  const res = await fetchImpl(
    `${graphBase}${microsoftTaskPath(taskListId, externalTaskId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      body: JSON.stringify(toGraphTask(task)),
    },
  );
  if (!res.ok) throw await graphError(res);
  const updated = await res.json();
  return { etag: updated["@odata.etag"] ?? null, icalUid: null };
}

export async function deleteMicrosoftTask(
  accessToken: string,
  taskListId: string,
  externalTaskId: string,
  etag: string | null | undefined,
  options: MicrosoftTaskRequestOptions = {},
) {
  if (!etag) throw new Error("Microsoft task delete requires an ETag");
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphBase = options.graphBase ?? GRAPH;
  const res = await fetchImpl(
    `${graphBase}${microsoftTaskPath(taskListId, externalTaskId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "If-Match": etag,
      },
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw await graphError(res);
  }
}

export function toExternalMicrosoftTaskList(list: any): ExternalCalendarInfo {
  return {
    color: DEFAULT_CALENDAR_COLOR,
    externalId: microsoftTaskListExternalId(list.id),
    name: list.displayName ?? "Tasks",
    readOnly: list.isOwner !== true,
    supportsEvents: false,
    supportsTasks: true,
  };
}

async function listMicrosoftTaskLists(accessToken: string) {
  const lists: any[] = [];
  let url: string | null = `${GRAPH}/me/todo/lists?$top=${PAGE_SIZE}`;
  while (url) {
    const res = await graphGet(accessToken, url);
    if (!res.ok) throw await graphError(res);
    const data = await res.json();
    lists.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return lists;
}

// The cursor stores the deltaLink AND the window's future edge so we know when
// to re-window. Old plain-URL cursors (or garbage) parse as "no cursor".
export function parseCursor(
  cursor: string | null,
): { link: string; windowEnd: number } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor);
    if (
      typeof parsed?.link === "string" &&
      typeof parsed?.windowEnd === "number"
    )
      return parsed;
  } catch {
    /* treat as no cursor */
  }
  return null;
}

async function graphGet(
  accessToken: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: PREFER },
  });
}

// calendarView/delta returns recurring-series OCCURRENCES as lightweight stubs:
// only id/start/end/seriesMasterId — no subject, isAllDay, body, etc. Those live
// on the series master, which is usually outside the sync window (its start is
// the first-ever instance), so it isn't in the delta stream. Fetch it by id and
// cache per sync run so a holiday calendar costs one extra GET per series.
async function fetchSeriesMaster(
  accessToken: string,
  externalCalendarId: string,
  id: string,
  cache: Map<string, any>,
  fetchImpl: typeof fetch = fetch,
  graphBase = GRAPH,
): Promise<any> {
  if (cache.has(id)) return cache.get(id);
  const res = await graphGet(
    accessToken,
    `${graphBase}${microsoftEventPath(externalCalendarId, id)}`,
    fetchImpl,
  );
  // Even 404/410 on an active occurrence's dependency is ambiguous. Only
  // explicit delta @removed entries authorize removal; never advance past an
  // incomplete hydration or cache an error as a successful empty master.
  if (!res.ok) throw await graphError(res);
  const master = await res.json();
  if (!master || master.id !== id || master["@removed"]) {
    throw new Error("Outlook returned an invalid series master");
  }
  cache.set(id, master);
  return master;
}

export async function fetchMicrosoftChanges(
  accessToken: string,
  externalCalendarId: string,
  cursor: string | null,
  options: {
    fetchImpl?: typeof fetch;
    graphBase?: string;
    now?: number;
  } = {},
): Promise<FetchChangesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphBase = options.graphBase ?? GRAPH;
  const now = options.now ?? Date.now();
  const changes: NormalizedChange[] = [];

  let parsed = parseCursor(cursor);
  // Window edge approaching → start over with a fresh window.
  if (parsed && parsed.windowEnd - now < WINDOW_RENEW_MARGIN_DAYS * DAY_MS)
    parsed = null;

  let reset = !parsed && !!cursor; // had a cursor but can't continue from it → wipe
  let windowEnd = parsed?.windowEnd ?? now + WINDOW_FUTURE_DAYS * DAY_MS;
  let url =
    parsed?.link ??
    initialDeltaUrl(externalCalendarId, windowEnd, now, graphBase);
  let deltaLink: string | null = null;
  const seriesMasters = new Map<string, any>();

  while (!deltaLink) {
    const res = await graphGet(accessToken, url, fetchImpl);

    // Delta token expired → discard partial incremental pages and restart as a
    // full set. The engine sweeps mappings missing from the completed result.
    if (res.status === 410) {
      reset = true;
      changes.length = 0;
      seriesMasters.clear();
      windowEnd = now + WINDOW_FUTURE_DAYS * DAY_MS;
      url = initialDeltaUrl(externalCalendarId, windowEnd, now, graphBase);
      continue;
    }
    if (!res.ok) throw await graphError(res);

    const data = await res.json();
    for (let item of data.value ?? []) {
      if (item.type === "seriesMaster") continue; // definition only; occurrences carry the instances
      // Occurrences/exceptions inherit subject, isAllDay, body, … from their
      // master; backfill them (the occurrence's own start/end/id win on spread).
      if (item.seriesMasterId && !item["@removed"]) {
        const master = await fetchSeriesMaster(
          accessToken,
          externalCalendarId,
          item.seriesMasterId,
          seriesMasters,
          fetchImpl,
          graphBase,
        );
        item = { ...master, ...item };
      }
      changes.push({ kind: "event", data: toNormalized(item) });
    }

    if (data["@odata.nextLink"]) {
      url = data["@odata.nextLink"];
    } else {
      deltaLink = data["@odata.deltaLink"] ?? url;
    }
  }

  return {
    changes,
    nextCursor: JSON.stringify({ link: deltaLink, windowEnd }),
    reset,
  };
}

type GraphCalendar = {
  id: string;
  name: string;
  hexColor?: string | null;
  canEdit?: boolean;
};

export function microsoftEventPath(
  externalCalendarId: string,
  externalEventId: string,
) {
  return `/me/calendars/${encodeURIComponent(externalCalendarId)}/events/${encodeURIComponent(externalEventId)}`;
}

export function toExternalCalendar(c: GraphCalendar): ExternalCalendarInfo {
  return {
    externalId: c.id,
    name: c.name,
    // Graph must explicitly grant writes. Missing permission data is not a safe
    // reason to expose actions that can only fail later.
    readOnly: c.canEdit !== true,
    // hexColor is "" when the calendar uses the "auto" preset
    color: c.hexColor || "#0078D4",
    supportsEvents: true,
    supportsTasks: false,
  };
}

export const microsoftAdapter: CalendarAdapter = {
  provider: "microsoft",

  async listAccounts(
    userID: string,
    accountId?: string,
  ): Promise<{ id: string; label: string }[]> {
    const ids = await getOAuthAccountIDs(userID, "microsoft", accountId);
    return Promise.all(
      ids.map(async (id) => {
        let label = id;
        try {
          const accessToken = await getAccessToken(userID, id);
          const res = await fetch(`${GRAPH}/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (res.ok) {
            const d = await res.json();
            label = d.mail ?? d.userPrincipalName ?? id;
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
    let url: string | null =
      `${GRAPH}/me/calendars?$select=id,name,hexColor,canEdit&$top=${PAGE_SIZE}`;
    while (url) {
      const res = await graphGet(accessToken, url);
      if (!res.ok) throw await graphError(res);
      const data = await res.json();
      for (const c of data.value ?? []) calendars.push(toExternalCalendar(c));
      url = data["@odata.nextLink"] ?? null;
    }
    if (!(await hasOAuthTaskScope(userID, "microsoft", accountId))) {
      return { calendars, taskListsComplete: false };
    }
    try {
      const taskLists = await listMicrosoftTaskLists(accessToken);
      return {
        calendars: [
          ...calendars,
          ...taskLists.map(toExternalMicrosoftTaskList),
        ],
        taskListsComplete: true,
      };
    } catch (error) {
      if (!isOptionalTaskError(error)) throw error;
      logger.warn("sync.tasks.discovery_unavailable", {
        provider: "microsoft",
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
    const taskListId = microsoftTaskListId(externalCalendarId);
    if (
      taskListId &&
      !(await hasOAuthTaskScope(userID, "microsoft", accountId))
    )
      throw new TaskScopeMissingError();
    return taskListId
      ? fetchMicrosoftTaskChanges(accessToken, taskListId, cursor)
      : fetchMicrosoftChanges(accessToken, externalCalendarId, cursor);
  },

  async pushCreate(userID, accountId, externalCalendarId, event: Event) {
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(
      `${GRAPH}/me/calendars/${encodeURIComponent(externalCalendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toGraphEvent(event)),
      },
    );
    if (!res.ok) throw await graphError(res);
    const data = await res.json();
    return { externalEventId: data.id };
  },

  async pushUpdate(
    userID,
    accountId,
    externalCalendarId,
    externalEventId,
    event: Event,
  ) {
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(
      `${GRAPH}${microsoftEventPath(externalCalendarId, externalEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toGraphEvent(event)),
      },
    );
    if (!res.ok) throw await graphError(res);
  },

  async pushDelete(userID, accountId, externalCalendarId, externalEventId) {
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(
      `${GRAPH}${microsoftEventPath(externalCalendarId, externalEventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    // 404/410 = already gone = success (idempotent)
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw await graphError(res);
    }
  },

  async pushTaskCreate(userID, accountId, externalCalendarId, task) {
    const taskListId = microsoftTaskListId(externalCalendarId);
    if (!taskListId)
      throw new Error("Microsoft task write requires a task list");
    return createMicrosoftTask(
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
    const taskListId = microsoftTaskListId(externalCalendarId);
    if (!taskListId)
      throw new Error("Microsoft task write requires a task list");
    return updateMicrosoftTask(
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
    const taskListId = microsoftTaskListId(externalCalendarId);
    if (!taskListId)
      throw new Error("Microsoft task write requires a task list");
    await deleteMicrosoftTask(
      await getAccessToken(userID, accountId, true),
      taskListId,
      externalTaskId,
      ref?.etag,
    );
  },

  async createCalendar(userID, accountId, { name, color }) {
    // Graph only accepts preset color names (hexColor is read-only) — map to
    // the nearest preset. The client offers exactly these presets for Outlook
    // calendars, so this is normally an exact match.
    const accessToken = await getAccessToken(userID, accountId);
    const res = await fetch(`${GRAPH}/me/calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        color: nearestMicrosoftCalendarColor(color).name,
      }),
    });
    if (!res.ok) throw await graphError(res);
    const data = await res.json();
    return { externalId: data.id };
  },

  async updateCalendar(userID, accountId, externalCalendarId, { name, color }) {
    const accessToken = await getAccessToken(userID, accountId);
    const taskListId = microsoftTaskListId(externalCalendarId);
    if (
      taskListId &&
      !(await hasOAuthTaskScope(userID, "microsoft", accountId))
    )
      throw new TaskScopeMissingError();
    if (taskListId) {
      const res = await fetch(
        `${GRAPH}/me/todo/lists/${encodeURIComponent(taskListId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ displayName: name }),
        },
      );
      if (!res.ok) throw await graphError(res);
      return;
    }
    const res = await fetch(
      `${GRAPH}/me/calendars/${encodeURIComponent(externalCalendarId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          color: nearestMicrosoftCalendarColor(color).name,
        }),
      },
    );
    if (!res.ok) throw await graphError(res);
  },

  async deleteCalendar(userID, accountId, externalCalendarId) {
    const accessToken = await getAccessToken(userID, accountId);
    const taskListId = microsoftTaskListId(externalCalendarId);
    if (
      taskListId &&
      !(await hasOAuthTaskScope(userID, "microsoft", accountId))
    )
      throw new TaskScopeMissingError();
    const res = await fetch(
      taskListId
        ? `${GRAPH}/me/todo/lists/${encodeURIComponent(taskListId)}`
        : `${GRAPH}/me/calendars/${encodeURIComponent(externalCalendarId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // 404/410 = already gone = success; the default calendar comes back as an
    // error and bubbles up.
    if (!res.ok && res.status !== 404 && res.status !== 410)
      throw await graphError(res);
  },
};

function initialDeltaUrl(
  externalCalendarId: string,
  windowEnd: number,
  now = Date.now(),
  graphBase = GRAPH,
): string {
  const start = new Date(now - WINDOW_PAST_DAYS * DAY_MS).toISOString();
  const end = new Date(windowEnd).toISOString();
  return `${graphBase}/me/calendars/${encodeURIComponent(externalCalendarId)}/calendarView/delta?startDateTime=${start}&endDateTime=${end}`;
}
