import type { Event, Task, TaskStatus } from "@musubi/types";

// A calendar event reduced to what Musubi stores, provider-agnostic.
// Adapters translate their own format (Google JSON / Graph JSON / iCal) <-> this.
export type NormalizedEvent = {
  externalId: string;
  status: "active" | "cancelled"; // cancelled => delete locally
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  description: string | null;
  location: string | null;
  organizer: string | null;
  recurrence: string | null; // RRULE text, or null
  url: string | null;
  etag?: string | null; // used by CalDAV; null for OAuth providers
  icalUid?: string | null; // preserve the remote UID across CalDAV writes
};

export type NormalizedTask = {
  externalId: string;
  deleted?: boolean;
  status: TaskStatus;
  title: string;
  description: string | null;
  start: Date | null;
  due: Date | null;
  isAllDay: boolean;
  completedAt: Date | null;
  percentComplete: number;
  priority: number;
  recurrence: string | null;
  relatedTo: string | null;
  sequence: number;
  url: string | null;
  etag?: string | null;
  icalUid?: string | null;
};

export type NormalizedChange =
  | { kind: "event"; data: NormalizedEvent }
  | { kind: "task"; data: NormalizedTask };

export type ExternalEventRef = {
  externalEventId: string;
  etag?: string | null;
  icalUid?: string | null;
};

export type ExternalTaskRef = {
  externalTaskId: string;
  etag?: string | null;
  icalUid?: string | null;
};

export type EventWriteOperation = {
  action: "create" | "update" | "delete";
  event: Event;
  previous?: Event;
  external?: ExternalEventRef;
};

export type ExternalCalendarInfo = {
  externalId: string;
  name: string;
  color: string;
  supportsEvents?: boolean;
  supportsTasks?: boolean;
  // Provider says the user can't write (holidays, subscribed calendars, …) →
  // mirror becomes read-only even for its owner.
  readOnly?: boolean;
};

export type CalendarDiscoveryResult = {
  calendars: ExternalCalendarInfo[];
  // False means optional task-list discovery was omitted or failed. Its absent
  // mirrors are not evidence of deletion and must not be fetched or swept.
  taskListsComplete: boolean;
};

export type FetchChangesResult = {
  changes: NormalizedChange[];
  nextCursor: string | null;
  reset?: boolean; // true => reconcile the complete collection snapshot (e.g. Google 410)
};

// Everything provider-specific lives behind this. The generic core (sync engine)
// never talks to Google/Graph/CalDAV directly — only through an adapter.
export type CalendarAdapter = {
  provider: string;

  // Connected accounts for this provider (id = Better Auth account.accountId for
  // OAuth / caldav_accounts.id for CalDAV; label = human name e.g. email/username).
  // Empty = provider not connected.
  listAccounts(
    userID: string,
    accountId?: string,
  ): Promise<{ id: string; label: string }[]>;

  // Which calendars can this account sync?
  listCalendars(
    userID: string,
    accountId: string,
  ): Promise<CalendarDiscoveryResult>;

  // Pull changes since `cursor` (null = full sync). Adapter paginates internally
  // and returns the complete change set + the new cursor to persist.
  fetchChanges(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    cursor: string | null,
  ): Promise<FetchChangesResult>;

  // Read current provider evidence before any local mutation or provider write.
  // This is a preflight, not a reservation or a distributed transaction.
  assertEventWrite?(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    operation: EventWriteOperation,
  ): Promise<void>;

  // Push a Musubi event out. Adapter maps Event -> its own format.
  pushCreate(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    event: Event,
  ): Promise<ExternalEventRef>;
  pushUpdate(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    externalEventId: string,
    event: Event,
    ref?: ExternalEventRef,
  ): Promise<{ etag?: string | null; icalUid?: string | null } | void>;
  pushDelete(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    externalEventId: string,
    ref?: ExternalEventRef,
  ): Promise<void>;

  pushTaskCreate?(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    task: Task,
  ): Promise<ExternalTaskRef>;
  pushTaskUpdate?(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    externalTaskId: string,
    task: Task,
    ref?: ExternalTaskRef,
  ): Promise<{ etag?: string | null; icalUid?: string | null } | void>;
  pushTaskDelete?(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    externalTaskId: string,
    ref?: ExternalTaskRef,
  ): Promise<void>;

  // Calendar-level writes — create/rename/recolor/delete the calendar itself
  // on the provider. Callers must abort the local change when these throw.
  createCalendar(
    userID: string,
    accountId: string,
    data: { name: string; color: string },
  ): Promise<{ externalId: string }>;
  updateCalendar(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    data: { name: string; color: string },
  ): Promise<void>;
  deleteCalendar(
    userID: string,
    accountId: string,
    externalCalendarId: string,
  ): Promise<void>;
};
