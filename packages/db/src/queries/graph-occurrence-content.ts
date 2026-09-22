import { graphSeriesTimeChange, graphSeriesTimeObserved } from "./graph-series-time";
import { resolveEventTimeEdit, instantToCivil, unambiguousCivilToInstant } from "@musubi/calendar";
import { and, eq, sql } from "drizzle-orm";
import { BadRequestError, EventSchema, MicrosoftRecurringContentRequestSchema, type MicrosoftRecurringContentRequest, type Event } from "@musubi/types";
import { db } from "..";
import { events, externalEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { readOrganizerSourceInTransaction } from "./provider-organizer";
import { appendEventOutbox, type EventOutboxRow } from "./event-outbox";
import { lockGraphMeetingContext, graphMeetingContextInTransaction, assertGraphMeetingRequest, graphMeetingVersion, type GraphMeetingContext } from "./graph-meeting-cancel";
import { sameCaldavScopeContext as same } from "./caldav-series-scope";
import type { GraphFamilyObservation } from "./graph-family";

function refuse(): never { throw new BadRequestError("The Outlook series changed. Sync and reopen it before editing."); }
export type GraphOccurrenceContent = {
  version: 1; context: GraphMeetingContext; request: MicrosoftRecurringContentRequest;
  baseline: GraphFamilyObservation; targetID: string; template: Event; native: Record<string, unknown>;
  identity: { oauthAccountID: string; graphUserID: string; calendarID: string; selfAddress: string };
  // The durable graphOccurrenceContent key predates series editing. Sharing
  // this journal preserves its existing import fences and no-resend recovery.
  nativeExceptions?: Record<string, unknown>[];
  dispatch?: { startedAt: string; acceptedAt?: string };
};

/** Render/edit in the proven series zone, never an inferred exception zone.
 * Keep the allowlist bounded to native-tested zone contracts. */
export function graphOccurrenceTimeSupported(saved: Pick<GraphOccurrenceContent, "baseline" | "targetID" | "template" | "native">) {
  const target = saved.baseline.instances.find(n => n.externalID === saved.targetID);
  if (saved.template.timeModel?.kind === "all-day")
    return saved.template.isAllDay && saved.native.isAllDay === true &&
      saved.native.originalStartTimeZone === "UTC" && saved.native.originalEndTimeZone === "UTC" &&
      !!target && target.values.isAllDay && target.originalStart.kind === "date";
  return saved.template.timeModel?.kind === "zoned" && ["UTC", "Europe/Prague"].includes(saved.template.timeModel.timeZone) &&
    saved.native.originalStartTimeZone === saved.template.timeModel.timeZone && saved.native.originalEndTimeZone === saved.template.timeModel.timeZone &&
    !!target && !target.values.isAllDay && target.originalStart.kind === "instant";
}
export function graphOccurrenceTimeChange(saved: Pick<GraphOccurrenceContent, "baseline" | "targetID" | "template" | "native" | "request">) {
  const input = saved.request.patch.time;
  if (!input || saved.request.scope === "series") return undefined;
  if (saved.request.scope !== "occurrence" || !graphOccurrenceTimeSupported(saved) || input.kind !== saved.template.timeModel?.kind) refuse();
  if (input.kind === "zoned") {
    if (saved.template.timeModel?.kind !== "zoned" || input.timeZone !== saved.template.timeModel.timeZone) refuse();
    try {
      unambiguousCivilToInstant(input.startLocal, input.timeZone);
      unambiguousCivilToInstant(input.endLocal, input.timeZone);
    } catch { throw new BadRequestError("Choose an unambiguous time outside the daylight-saving clock change."); }
  } else if (input.kind !== "all-day") refuse();
  const desired = resolveEventTimeEdit(input);
  const target = saved.baseline.instances.find(n => n.externalID === saved.targetID)!;
  const slots = [...saved.baseline.instances.map(n => ({ ...n.values, originalStart: n.originalStart })), ...saved.baseline.cancelled]
    .sort((a, b) => a.originalStart.value.localeCompare(b.originalStart.value));
  const index = slots.findIndex(n => same(n.originalStart, target.originalStart));
  if (index < 0 || desired.end < desired.start || (!desired.isAllDay && desired.end <= desired.start) ||
      (desired.isAllDay && !/^\d{4}-/.test(new Date(desired.end.getTime() + 86_400_000).toISOString())) ||
      [desired.start, desired.end].some(value => Math.abs(value.getTime() - new Date(target.originalStart.value).getTime()) > 730 * 86_400_000)) refuse();
  // Musubi's all-day end is inclusive; Graph's next midnight is exclusive.
  // Compare occupied dates so ending the day before a neighbour is allowed.
  const day = (value: Date | string) => (input.kind === "all-day" ? new Date(value).toISOString() : instantToCivil(new Date(value), input.timeZone)).slice(0, 10);
  const previous = slots[index - 1], next = slots[index + 1];
  // Include cancelled slots and both original and moved neighbours. Outlook
  // forbids crossing their days, not just overlapping their time intervals.
  if ((previous && (day(desired.start) <= day(previous.originalStart.value) || day(desired.start) <= day(previous.end))) ||
      (next && (day(desired.end) >= day(next.originalStart.value) || day(desired.end) >= day(next.start))))
    throw new BadRequestError("Keep this occurrence between the days of its previous and next occurrences.");
  return desired;
}

/** The whole bounded family must survive, including moved and cancelled slots.
 * Ignore change tokens, but never ignore guests, unrequested time or other content. */
export function graphOccurrenceContentObserved(saved: Pick<GraphOccurrenceContent, "baseline" | "targetID" | "request" | "template" | "native" | "nativeExceptions">, after: GraphFamilyObservation | null) {
  if (saved.request.scope === "series") return graphSeriesContentObserved(saved, after);
  if (!after) return false;
  const before = saved.baseline.instances.find(n => n.externalID === saved.targetID);
  const target = after.instances.find(n => n.externalID === saved.targetID);
  if (!before || !target || !target.etag || after.instances.length !== saved.baseline.instances.length || after.instances.filter(n => n.externalID === saved.targetID).length !== 1) return false;
  const content = ({ etag: _etag, ...value }: GraphFamilyObservation["master"]) => value;
  const patch = saved.request.patch;
  const desiredTime = graphOccurrenceTimeChange(saved);
  const values = { ...before.values, ...(desiredTime ?? {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
    ...(patch.location !== undefined ? { location: patch.location?.trim() || null } : {}),
  };
  // The reader deliberately marks exception time as legacy-unknown instead of
  // inferring its authoring zone from the master's rule. Native UTC instants and
  // original slot must still match. Content-only edits preserve stored time; an
  // explicit time edit commits the verified series-zone intent instead.
  if ((desiredTime || before.providerState.eventType === "occurrence") && target.providerState.eventType === "exception" && target.values.timeModel.kind === "legacy-unknown") values.timeModel = target.values.timeModel;
  const eventType = before.providerState.eventType === "occurrence" && target.providerState.eventType === "exception" ? "exception" : before.providerState.eventType;
  // A real time change is a full meeting update: Outlook may reset only the
  // edited occurrence's RSVP responses. Full native verification also checks
  // each attendee's identity, role, extra fields and response timestamp.
  const timeChanged = desiredTime && (desiredTime.start.getTime() !== new Date(before.values.start).getTime() || desiredTime.end.getTime() !== new Date(before.values.end).getTime());
  const attendees = before.providerState.attendees.map((guest, index) => {
    const response = target.providerState.attendees[index]?.response;
    return timeChanged && (response === "none" || response === "notResponded") ? { ...guest, response } : guest;
  });
  return same(content(after.master), content(saved.baseline.master)) &&
    same(after.instances.filter(n => n.externalID !== saved.targetID).map(content), saved.baseline.instances.filter(n => n.externalID !== saved.targetID).map(content)) &&
    same(after.cancelled, saved.baseline.cancelled) &&
    same(content(target), content({ ...before, values, providerState: { ...before.providerState, eventType, attendees } }));
}
/** Outlook retains per-field exception overrides. When an exception equals the
 * old master, its override bit is not exposed: either inheritance or retention
 * is valid. Different overrides and every unrelated field must survive exactly. */
export function graphSeriesContentObserved(saved: Pick<GraphOccurrenceContent, "baseline" | "targetID" | "request" | "native" | "nativeExceptions" | "template">, after: GraphFamilyObservation | null) {
  if (saved.request.patch.time) return graphSeriesTimeObserved(saved, after);
  if (!after || saved.targetID !== saved.baseline.master.externalID || !same(after.cancelled, saved.baseline.cancelled) || after.instances.length !== saved.baseline.instances.length) return false;
  const compare = (before: GraphFamilyObservation["master"], next: GraphFamilyObservation["master"]) => {
    if (!next.etag) return false;
    const values = { ...before.values };
    for (const key of ["title", "description", "location"] as const) {
      const patch = saved.request.patch[key];
      if (patch === undefined) continue;
      const desired = key === "title" ? patch! : patch?.trim() || null;
      const exception = before.providerState.eventType === "exception";
      if (!exception) Object.assign(values, { [key]: desired });
      else if (before.values[key] === saved.baseline.master.values[key] && next.values[key] === desired) Object.assign(values, { [key]: desired });
    }
    return same({ ...before, values, etag: null }, { ...next, etag: null });
  };
  return compare(saved.baseline.master, after.master) && saved.baseline.instances.every(before => {
    const matches = after.instances.filter(n => n.externalID === before.externalID);
    return matches.length === 1 && compare(before, matches[0]!);
  });
}
export function graphContentVersion(saved: Pick<GraphOccurrenceContent, "context" | "baseline" | "identity" | "native" | "nativeExceptions">) {
  return graphMeetingVersion({ context: saved.context, baseline: saved.baseline, identity: saved.identity, native: saved.native,
    ...(saved.nativeExceptions ? { nativeExceptions: saved.nativeExceptions } : {}) });
}
function assertBoundContent(saved: GraphOccurrenceContent) {
  MicrosoftRecurringContentRequestSchema.parse(saved.request);
  assertGraphMeetingRequest(saved.context, saved.request);
  graphOccurrenceTimeChange(saved);
  graphSeriesTimeChange(saved);
  const mapping = saved.context.mappings.find(m => m.eventID === saved.request.eventID)!;
  const series = saved.request.scope === "series";
  const target = series ? saved.baseline.master : saved.baseline.instances.find(n => n.externalID === saved.targetID);
  if (saved.version !== 1 || (series ? saved.targetID !== saved.context.masterID || !Array.isArray(saved.nativeExceptions) : mapping.externalSeriesID !== saved.context.masterID || mapping.externalEventID !== saved.targetID || target?.etag !== mapping.etag || target?.icalUid !== mapping.icalUid) ||
    !target?.etag || saved.native.id !== saved.targetID || saved.native.etag !== target.etag || saved.native.iCalUId !== target.icalUid ||
    saved.identity.oauthAccountID !== saved.context.link.accountID || saved.identity.calendarID !== saved.context.link.externalCalendarID ||
    saved.request.expectedSeriesVersion !== graphContentVersion(saved)) refuse();
}
const receipt = (row: EventOutboxRow, replayed: boolean) => ({ operationID: row.id, eventID: row.eventID, replayed, status: row.status, localCommitted: true as const, notificationDelivery: "unknown" as const });
export async function findGraphOccurrenceContent(actorID: string, request: MicrosoftRecurringContentRequest) {
  return db.transaction(async tx => {
    await lockGraphMeetingContext(tx, { actorID, ...request });
    const link = await readOrganizerSourceInTransaction(tx, actorID, request.calendarID, "microsoft");
    const [row] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, request.operationID));
    if (!row) return undefined;
    if (row.actorID !== actorID || row.externalCalendarLinkID !== link.id || !same(row.payload.graphOccurrenceContent?.request, request)) refuse();
    return receipt(row, true);
  });
}
export async function saveGraphOccurrenceContent(saved: GraphOccurrenceContent) {
  saved = structuredClone(saved);
  assertBoundContent(saved);
  return db.transaction(async tx => {
    await lockGraphMeetingContext(tx, saved.context.address);
    const link = await readOrganizerSourceInTransaction(tx, saved.context.address.actorID, saved.context.address.calendarID, "microsoft");
    const [previous] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, saved.request.operationID));
    if (previous) {
      if (previous.actorID !== saved.context.address.actorID || previous.externalCalendarLinkID !== link.id || !same(previous.payload.graphOccurrenceContent?.request, saved.request)) refuse();
      return receipt(previous, true);
    }
    const current = await graphMeetingContextInTransaction(tx, saved.context.address);
    if (!same(current, saved.context)) refuse();
    assertGraphMeetingRequest(current, saved.request);
    const event = EventSchema.parse({ ...current.family.find(e => e.id === saved.request.eventID), calendars: [current.address.calendarID] });
    await appendEventOutbox(tx, event, [{ id: saved.request.operationID, actorID: current.address.actorID, mutationID: saved.request.operationID, position: 0,
      eventID: event.id, calendarID: current.address.calendarID, externalCalendarLinkID: current.link.id, provider: "microsoft", userID: current.address.actorID,
      accountID: current.link.accountID, externalCalendarID: current.link.externalCalendarID, externalEventID: saved.targetID,
      expectedEtag: String(saved.native.etag), icalUid: String(saved.native.iCalUId), action: "update", payload: { event, graphOccurrenceContent: saved } }]);
    const [row] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, saved.request.operationID));
    return receipt(row!, false);
  });
}
async function withLease<T>(row: EventOutboxRow, action: (tx: DbTransaction, saved: GraphOccurrenceContent, current: EventOutboxRow) => Promise<T>) {
  return db.transaction(async tx => {
    const initial = row.payload.graphOccurrenceContent;
    if (!initial || initial.version !== 1 || row.provider !== "microsoft" || row.action !== "update" || row.actorID !== initial.context.address.actorID || row.userID !== row.actorID) refuse();
    assertBoundContent(initial);
    await lockGraphMeetingContext(tx, initial.context.address);
    const context = await graphMeetingContextInTransaction(tx, initial.context.address, row.id);
    if (!same(context, initial.context)) refuse();
    const [current] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, row.id), eq(eventOutbox.status, "attempting"), eq(eventOutbox.leaseToken, row.leaseToken!), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
    const saved = current?.payload.graphOccurrenceContent;
    if (!saved || !same({ ...saved, dispatch: undefined }, { ...initial, dispatch: undefined }) || current.externalCalendarLinkID !== context.link.id || current.accountID !== context.link.accountID || current.externalCalendarID !== context.link.externalCalendarID || current.calendarID !== context.address.calendarID || current.eventID !== context.address.eventID || current.id !== saved.request.operationID || current.externalEventID !== saved.targetID || current.expectedEtag !== saved.native.etag || current.icalUid !== saved.native.iCalUId || current.revision !== context.family.find(e => e.id === current.eventID)?.revision) refuse();
    return action(tx, saved, current);
  });
}
export const confirmGraphOccurrenceContent = (row: EventOutboxRow) => withLease(row, async () => undefined);
export const markGraphOccurrenceContent = (row: EventOutboxRow, accepted = false) => withLease(row, async (tx, saved, current) => {
  if (accepted ? !saved.dispatch : !!saved.dispatch) refuse();
  const dispatch = accepted ? { ...saved.dispatch!, acceptedAt: new Date().toISOString() } : { startedAt: new Date().toISOString() };
  await tx.update(eventOutbox).set({ payload: { ...current.payload, graphOccurrenceContent: { ...saved, dispatch } }, uncertain: true }).where(eq(eventOutbox.id, row.id));
});
export const completeGraphOccurrenceContent = (row: EventOutboxRow, observation: GraphFamilyObservation) => withLease(row, async (tx, saved) => {
  if ((!saved.dispatch?.acceptedAt && (saved.dispatch || !same(saved.baseline, observation))) || !graphOccurrenceContentObserved(saved, observation)) refuse();
  const now = new Date();
  const time = graphOccurrenceTimeChange(saved);
  const seriesTime = graphSeriesTimeChange(saved);
  const native = [observation.master, ...observation.instances].find(n => n.externalID === saved.targetID)!;
  for (const previous of saved.context.family) {
    if (previous.deletedAt || previous.isCanceled || (saved.request.scope !== "series" && previous.id !== row.eventID)) continue;
    const mapping = saved.context.mappings.find(m => m.eventID === previous.id);
    const actual = [observation.master, ...observation.instances].find(n => n.externalID === mapping?.externalEventID);
    if (!actual) refuse();
    const seriesMaster = seriesTime && actual.externalID === observation.master.externalID;
    const actualTime = seriesTime ? { start: actual.values.start, end: actual.values.end, isAllDay: actual.values.isAllDay, timeModel: actual.values.timeModel, ...(seriesMaster ? { recurrence: actual.values.recurrence } : {}), ...(previous.seriesID && "originalStart" in actual ? { originalStart: actual.originalStart } : {}) } : time;
    const content = { title: actual.values.title, description: actual.values.description, location: actual.values.location, ...(actualTime ?? {}) };
    if (!same(content, { title: previous.title, description: previous.description, location: previous.location, ...(actualTime ? { start: previous.start, end: previous.end, isAllDay: previous.isAllDay, timeModel: previous.timeModel, ...(seriesMaster ? { recurrence: previous.recurrence } : {}), ...(seriesTime && previous.seriesID ? { originalStart: previous.originalStart } : {}) } : {}) }))
      await tx.update(events).set({ ...content, revision: sql`${events.revision} + 1`, updatedAt: now }).where(eq(events.id, previous.id));
  }
  for (const mapping of saved.context.mappings) {
    const current = [observation.master, ...observation.instances].find(n => n.externalID === mapping.externalEventID);
    if (current) await tx.update(externalEvents).set({ ...(seriesTime && "originalStart" in current ? { originalStart: current.originalStart } : {}), etag: current.etag, providerState: current.providerState, providerStateObservedAt: now }).where(eq(externalEvents.id, mapping.id));
  }
  await tx.update(eventOutbox).set({ status: "completed", errorCode: null, resultRef: { externalEventId: native.externalID, icalUid: native.icalUid, etag: native.etag }, uncertain: false, leaseToken: null, leaseUntil: null, remoteSnapshot: null, updatedAt: now }).where(eq(eventOutbox.id, row.id));
});

/** No optimistic event mutation needs rolling back. Only definite no-write
 * outcomes release the calendar fence; uncertain dispatches retain it. */
export async function stopGraphOccurrenceContent(row: EventOutboxRow, rejected = false) {
  const stopped = await db.update(eventOutbox).set({ status: "cancelled", errorCode: rejected ? "outlook-update-rejected" : "organizer-not-dispatched", uncertain: false, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(
    eq(eventOutbox.id, row.id), eq(eventOutbox.status, "attempting"), eq(eventOutbox.leaseToken, row.leaseToken!), eq(eventOutbox.provider, "microsoft"), eq(eventOutbox.action, "update"),
    sql`${eventOutbox.leaseUntil} > clock_timestamp() and ${eventOutbox.payload}->'graphOccurrenceContent' is not null`,
    rejected ? sql`${eventOutbox.payload}->'graphOccurrenceContent'->'dispatch'->>'startedAt' is not null and ${eventOutbox.payload}->'graphOccurrenceContent'->'dispatch'->>'acceptedAt' is null`
      : sql`${eventOutbox.payload}->'graphOccurrenceContent'->'dispatch' is null`,
  )).returning({ id: eventOutbox.id });
  return stopped.length === 1;
}
