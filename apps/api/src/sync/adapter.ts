import type { GoogleOccurrenceIntent } from "@musubi/db";
import type { GoogleOccurrenceEvidence, GoogleSeriesEvidence } from "./adapters/google_occurrence";
import type { CaldavSeriesIntent, CaldavSeriesEvidence, CaldavSeriesWrite, CaldavSeriesResolutionEvidence } from "./adapters/caldav_series";
import type { GoogleReminderWrite, ProviderEventState, Event, Task, TaskStatus, EventTimeModel, OccurrenceStart } from "@musubi/types";
import type { EventContentPatch } from "@musubi/db";

// A calendar event reduced to what Musubi stores, provider-agnostic.
// Adapters translate their own format (Google JSON / Graph JSON / iCal) <-> this.
export type NormalizedEvent = {
  providerState?: ProviderEventState;
  creationOperationID?: string;
  providerOccurrence?: { externalSeriesID: string; originalStart: OccurrenceStart };
  timeModel?: EventTimeModel;
  externalSeriesID?: string | null;
  originalStart?: OccurrenceStart | null;
  isCanceled?: boolean;
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
  etag?: string | null; // exact provider validator when exposed; never synthesize from changeKey
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
  | { kind: "event-resource"; externalId: string; events: NormalizedEvent[] }
  | { kind: "task"; data: NormalizedTask };

export type ExternalEventRef = {
  externalEventId: string;
  etag?: string | null;
  icalUid?: string | null;
};

/** Identity of one persisted create intent, never a new ID on retry. */
export type EventCreateIdentity = { operationID: string; signal?: AbortSignal };
export type CreatedEventEvidence = {
  ref: ExternalEventRef;
  event: NormalizedEvent;
};

export type ExternalTaskRef = {
  externalTaskId: string;
  etag?: string | null;
  icalUid?: string | null;
};

export type EventWriteOperation = {
  signal?: AbortSignal;
  action: "create" | "update" | "delete";
  event: Event;
  previous?: Event;
  // Server-computed actual content diff; never a client full snapshot. Missing
  // is not an empty diff. CAS callers supply the committed transaction's patch.
  patch?: EventContentPatch;
  external?: ExternalEventRef;
  // Server-only: the handler validated the complete request intent and its ACLs.
  scopeEditValidated?: boolean;
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
  readCaldavSeries?(user: string, account: string, calendar: string, intent: CaldavSeriesIntent, signal?: AbortSignal): Promise<CaldavSeriesEvidence>;
  readCaldavSeriesResolution?(user: string, account: string, calendar: string, intent: CaldavSeriesIntent, before: string, signal?: AbortSignal): Promise<CaldavSeriesResolutionEvidence>;
  writeCaldavSeries?(user: string, account: string, calendar: string, intent: CaldavSeriesWrite, signal?: AbortSignal): Promise<CaldavSeriesEvidence>;
  readSeries?(user: string, account: string, calendar: string, intent: Pick<GoogleOccurrenceIntent, "master" | "masterExternalID" | "masterEtag">, signal?: AbortSignal): Promise<GoogleSeriesEvidence>;
  readOccurrence?(user: string, account: string, calendar: string, intent: GoogleOccurrenceIntent, ref?: ExternalEventRef, signal?: AbortSignal): Promise<GoogleOccurrenceEvidence>;
  writeOccurrence?(user: string, account: string, calendar: string, intent: GoogleOccurrenceIntent, event: Event, ref: ExternalEventRef, signal?: AbortSignal): Promise<GoogleOccurrenceEvidence>;
  readReminderState?(userID: string, accountID: string, calendarID: string, ref: ExternalEventRef, signal?: AbortSignal): Promise<{ ref: ExternalEventRef; state: ProviderEventState; event: NormalizedEvent } | null>;
  writeReminders?(userID: string, accountID: string, calendarID: string, ref: ExternalEventRef, reminders: GoogleReminderWrite, signal?: AbortSignal): Promise<{ ref: ExternalEventRef; state: ProviderEventState; event: NormalizedEvent }>;
  projectEvent?(event: Event): Pick<NormalizedEvent, "title" | "start" | "end" | "isAllDay" | "description" | "location" | "recurrence">;

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
    identity?: EventCreateIdentity,
  ): Promise<ExternalEventRef>;
  // Read-only recovery. null means no matching live object was observed, not
  // permission to repeat a POST (Graph does not promise an infinite dedup window).
  findCreatedEvent?(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    identity: EventCreateIdentity,
  ): Promise<CreatedEventEvidence | null>;
  // Read current content without accepting its validator as a write baseline.
  readEvent?(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    ref: ExternalEventRef,
    signal?: AbortSignal,
  ): Promise<CreatedEventEvidence | null>;
  pushUpdate(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    externalEventId: string,
    event: Event,
    ref?: ExternalEventRef,
    patch?: EventContentPatch,
    signal?: AbortSignal,
  ): Promise<{ etag?: string | null; icalUid?: string | null } | void>;
  pushDelete(
    userID: string,
    accountId: string,
    externalCalendarId: string,
    externalEventId: string,
    ref?: ExternalEventRef,
    signal?: AbortSignal,
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
