import { outlookSeriesOrganizerObservation } from "./provider-organizer-draft";
import { eventDeliveryExplanation } from "./event-delivery";
import type { EventDeliveryTarget } from "@musubi/types";
import assert from "node:assert/strict";
import { canManageProviderOrganizer, organizerDraft, organizerRequest } from "./provider-organizer-draft";
import { ProviderOrganizerRequestSchema, EventSchema } from "@musubi/types";
const identity = {
  operationID: "00000000-0000-4000-8000-000000000001",
  eventID: "00000000-0000-4000-8000-000000000002",
  calendarID: "00000000-0000-4000-8000-000000000003",
  color: "red",
};
const draft = {
  ...organizerDraft(),
  title: "Meeting",
  guests: "Guest@example.test",
  start: "2026-10-25T09:00:00",
  end: "2026-10-25T10:00:00",
  timeZone: "Europe/Prague",
};
const create = organizerRequest("create", draft, [], identity);
assert.equal(create.action, "create");
assert.deepEqual(create.action === "create" && create.guests, [
  { email: "guest@example.test", optional: false },
]);
for (const value of [
  { ...create, sendUpdates: "none" },
  { ...create, sendUpdates: "externalOnly" },
  { ...create, recurrence: "RRULE:FREQ=DAILY" },
  {
    ...create,
    guests: [
      { email: "guest@example.test", optional: false },
      { email: "Guest@example.test", optional: true },
    ],
  },
])
  assert.equal(ProviderOrganizerRequestSchema.safeParse(value).success, false);
const observation = {
  state: null,
  version: "a".repeat(64),
  organizerEdit: {
    provider: "google" as const,
    calendarID: identity.calendarID,
    expectedRevision: 2,
  },
};
const update = organizerRequest(
  "update",
  { ...draft, description: "" },
  ["description"],
  identity,
  observation,
);
assert.ok(update.action === "update");
assert.deepEqual(update.patch, { description: null });
assert.equal(update.sendUpdates, "all");
assert.throws(() =>
  organizerRequest("update", draft, [], identity, observation),
);
const legacy = EventSchema.parse({
  id: identity.eventID,
  revision: 2,
  title: "Legacy",
  start: new Date(),
  end: new Date(),
  creatorID: "owner",
  organizer: "owner",
  color: "red",
  calendars: [identity.calendarID],
  isCanceled: false,
  isAllDay: false,
});
assert.equal(organizerDraft(legacy).start, "");
assert.equal(organizerDraft(legacy).timeZone, "");
console.log(
  "Organizer draft: explicit policy, field deltas, guest bounds and unknown time: OK",
);

for (const organizerPhase of ["dispatched", "absent", "observed"] as const) {
  const text = eventDeliveryExplanation({
    organizerPhase,
  } as EventDeliveryTarget);
  assert.match(text, /may have been sent/);
  assert.doesNotMatch(text, /Google was asked/);
}
assert.match(
  eventDeliveryExplanation({
    organizerPhase: "accepted",
  } as EventDeliveryTarget),
  /Google accepted/,
);

const boundObservation = { ...observation, organizerEdit: { ...observation.organizerEdit, scope: "occurrence" as const, instanceVersion: "b".repeat(64) } };
const child = { ...legacy, revision: 2, originCalendarID: identity.calendarID, seriesID: "00000000-0000-4000-8000-000000000004", originalStart: { kind: "instant" as const, value: "2026-10-23T08:00:00.000Z" } };
assert.equal(canManageProviderOrganizer(child, boundObservation), true);
for (const invalid of [{ ...child, revision: 3 }, { ...child, recurrence: "RRULE:FREQ=DAILY;COUNT=4" }, { ...child, originalStart: null }, { ...child, seriesID: null }, { ...child, isCanceled: true }]) assert.equal(canManageProviderOrganizer(invalid, boundObservation), false);
assert.equal(canManageProviderOrganizer(child, observation), false);
const boundUpdate = organizerRequest("update", { ...draft, title: "This occurrence" }, ["title", "start"], identity, boundObservation);
assert.equal(boundUpdate.action, "update");
assert.deepEqual(boundUpdate.action === "update" && boundUpdate.patch, { title: "This occurrence" });
assert.ok(boundUpdate.action !== "create");
assert.equal(boundUpdate.scope, "occurrence");
assert.equal(boundUpdate.expectedInstanceVersion, "b".repeat(64));
for (const bad of [{ ...boundUpdate, expectedInstanceVersion: undefined }, { ...boundUpdate, scope: undefined }, { ...boundUpdate, patch: { time: { kind: "all-day", startDate: "2026-10-25", endDate: "2026-10-25" } } }]) assert.equal(ProviderOrganizerRequestSchema.safeParse(bad).success, false);
console.log("Bound organizer draft and stored occurrence admission: OK");
const outlook = organizerRequest("create", { ...draft, timeZone: "UTC" }, [], { ...identity, provider: "microsoft" });
assert.equal(outlook.provider, "microsoft");
assert.equal("notificationPolicy" in outlook && outlook.notificationPolicy, "server-invite");
assert.equal(organizerDraft(undefined, "microsoft").timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
for (const action of ["update", "delete"] as const) assert.throws(() => organizerRequest(action, draft, ["title"], { ...identity, provider: "microsoft" }));
assert.match(eventDeliveryExplanation({ provider: "microsoft", organizerPhase: "accepted" } as EventDeliveryTarget), /Outlook accepted/);

const localOutlook = organizerRequest("create", { ...draft, timeZone: "Europe/Prague", start: "2026-09-13T09:00:00", end: "2026-09-13T10:00:00" }, [], { ...identity, provider: "microsoft" });
assert.equal(localOutlook.action, "create");
if (localOutlook.action === "create") assert.deepEqual(localOutlook.time, { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-13T07:00:00.000", endLocal: "2026-09-13T08:00:00.000" });

const caldavAlias = organizerRequest("create", { ...draft, organizerAddress: "mailto:alias@example.test", timeZone: "UTC" }, [], { ...identity, provider: "caldav" });
assert.equal(caldavAlias.provider === "caldav" && caldavAlias.action === "create" && caldavAlias.organizerAddress, "mailto:alias@example.test");
assert.equal("organizerAddress" in organizerRequest("create", { ...draft, organizerAddress: "mailto:alias@example.test" }, [], identity), false);
assert.equal("organizerAddress" in organizerRequest("update", { ...draft, organizerAddress: "mailto:alias@example.test", title: "Renamed" }, ["title"], identity, observation), false);

const outlookObservation = { ...observation, organizerEdit: { ...observation.organizerEdit, provider: "microsoft" as const, actions: ["update", "delete"] as ("update" | "delete")[] } };
const outlookContent = organizerRequest("update", { ...draft, location: "" }, ["title", "location"], identity, outlookObservation);
assert.equal(outlookContent.provider, "microsoft");
assert.deepEqual(outlookContent.action === "update" && outlookContent.patch, { title: "Meeting", location: null });
assert.throws(() => organizerRequest("update", draft, ["start"], identity, outlookObservation), /Time editing is not available/);
for (const change of [{ guests: [] }, { time: { kind: "all-day", startDate: "2026-09-22", endDate: "2026-09-23" } }]) assert.equal(ProviderOrganizerRequestSchema.safeParse({ ...outlookContent, patch: change }).success, false);

const outlookOccurrence = { ...outlookObservation, organizerEdit: { ...outlookObservation.organizerEdit, scope: "occurrence" as const, seriesVersion: "c".repeat(64), actions: ["update" as const] } };
assert.equal(canManageProviderOrganizer(child, outlookOccurrence), true);
assert.equal(canManageProviderOrganizer({ ...child, seriesID: null, originalStart: null }, outlookOccurrence), true);
assert.equal(canManageProviderOrganizer({ ...child, recurrence: "RRULE:FREQ=DAILY;COUNT=3" }, outlookOccurrence), false);
assert.equal(canManageProviderOrganizer(child, { organizerEdit: { ...outlookOccurrence.organizerEdit, seriesVersion: undefined } }), false);
const occurrenceUpdate = organizerRequest("update", { ...draft, title: "Only one occurrence" }, ["title"], identity, outlookOccurrence);
assert.equal(occurrenceUpdate.provider === "microsoft" && occurrenceUpdate.action === "update" && occurrenceUpdate.expectedSeriesVersion, "c".repeat(64));
for (const change of [{ scope: undefined }, { expectedSeriesVersion: undefined }, { expectedInstanceVersion: "b".repeat(64) }]) assert.equal(ProviderOrganizerRequestSchema.safeParse({ ...occurrenceUpdate, ...change }).success, false);

const seriesSource = { ...outlookOccurrence, state: { ...observation.state!, provider: "microsoft" as const }, outlookSeriesContent: { calendarID: child.originCalendarID!, expectedRevision: child.revision!, seriesVersion: "d".repeat(64), content: { title: "Series title", description: "Series notes", location: "Series room" } } };
const scopedSeries = outlookSeriesOrganizerObservation(child, seriesSource)!;
assert.equal(scopedSeries.organizerEdit?.scope, "series");
assert.equal(organizerDraft(child, "microsoft", scopedSeries).title, "Series title");
assert.equal(outlookSeriesOrganizerObservation({ ...child, revision: child.revision! + 1 }, seriesSource), undefined);
assert.equal(outlookSeriesOrganizerObservation(child, { ...seriesSource, version: undefined }), undefined);
const seriesUpdate = organizerRequest("update", { ...draft, title: "New series" }, ["title"], identity, scopedSeries);
assert.equal(seriesUpdate.action === "update" && seriesUpdate.provider === "microsoft" && seriesUpdate.scope, "series");
assert.equal(seriesUpdate.action === "update" && seriesUpdate.provider === "microsoft" && seriesUpdate.expectedSeriesVersion, "d".repeat(64));

const outlookTime = { ...outlookOccurrence, organizerEdit: { ...outlookOccurrence.organizerEdit, timeEdit: true as const } };
const timedDraft = organizerDraft(child, "microsoft", outlookTime);
assert.equal(timedDraft.timeZone, "UTC");
assert.equal(timedDraft.start, child.start.toISOString().slice(0, -1));
const timeUpdate = organizerRequest("update", { ...timedDraft, start: "2026-10-23T10:00:00", end: "2026-10-23T11:00:00" }, ["start", "end"], identity, outlookTime);
assert.deepEqual(timeUpdate.action === "update" && timeUpdate.patch, { time: { kind: "zoned", timeZone: "UTC", startLocal: "2026-10-23T10:00:00.000", endLocal: "2026-10-23T11:00:00.000" } });
for (const change of [ { scope: undefined }, { expectedSeriesVersion: undefined }, { patch: { time: { kind: "zoned", timeZone: "America/New_York", startLocal: "2026-10-23T10:00:00", endLocal: "2026-10-23T11:00:00" } } }]) assert.equal(ProviderOrganizerRequestSchema.safeParse({ ...timeUpdate, ...change }).success, false);

const pragueTime = { ...outlookTime, organizerEdit: { ...outlookTime.organizerEdit, timeZone: "Europe/Prague" as const } };
for (const [instant, local] of [["2026-10-23T10:00:00Z", "2026-10-23T12:00:00.000"], ["2026-10-25T11:00:00Z", "2026-10-25T12:00:00.000"]]) {
  const view = organizerDraft({ ...child, start: new Date(instant!), end: new Date(Date.parse(instant!) + 3600000), timeModel: { kind: "legacy-unknown" } }, "microsoft", pragueTime);
  assert.equal(view.start, local); assert.equal(view.timeZone, "Europe/Prague");
  const request = organizerRequest("update", { ...view, start: "2026-10-25T14:00", end: "2026-10-25T15:00" }, ["start", "end"], identity, pragueTime);
  assert.deepEqual(request.action === "update" && request.patch, { time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T14:00:00.000", endLocal: "2026-10-25T15:00:00.000" } });
  for (const start of ["2026-10-25T02:30:00", "2026-03-29T02:30:00"]) assert.throws(() => organizerRequest("update", { ...view, start }, ["start"], identity, pragueTime), /unambiguous/);
  assert.throws(() => organizerRequest("update", { ...view, timeZone: "UTC" }, ["timeZone"], identity, pragueTime), /verified series time zone/);
}

const allDayObservation = { ...outlookTime, organizerEdit: { ...outlookTime.organizerEdit, timeKind: "all-day" as const } };
const allDayDraft = organizerDraft({ ...child, isAllDay: true, start: new Date("2026-10-24T00:00:00Z"), end: new Date("2026-10-25T00:00:00Z"), timeModel: { kind: "all-day" } }, "microsoft", allDayObservation);
assert.equal(allDayDraft.start, "2026-10-24"); assert.equal(allDayDraft.end, "2026-10-25"); assert.equal(allDayDraft.timeZone, "");
const allDayUpdate = organizerRequest("update", { ...allDayDraft, end: "2026-10-24" }, ["end"], identity, allDayObservation);
assert.deepEqual(allDayUpdate.action === "update" && allDayUpdate.patch, { time: { kind: "all-day", startDate: "2026-10-24", endDate: "2026-10-24" } });
assert.throws(() => organizerRequest("update", { ...allDayDraft, allDay: false, timeZone: "UTC" }, ["allDay"], identity, allDayObservation), /all-day or timed/);
assert.throws(() => organizerRequest("update", allDayDraft, ["start"], identity, outlookTime), /all-day or timed/);
assert.equal(ProviderOrganizerRequestSchema.safeParse({ ...allDayUpdate, scope: "series" }).success, false);
console.log("Outlook all-day occurrence: inclusive dates and mode preservation: OK");

const seriesTimeModel = { kind: "zoned" as const, timeZone: "UTC" as const, startLocal: "2026-10-20T09:00:00", endLocal: "2026-10-20T10:00:00" };
const seriesTimeObservation = outlookSeriesOrganizerObservation(child, { ...seriesSource, outlookSeriesContent: { ...seriesSource.outlookSeriesContent, time: seriesTimeModel } })!;
assert.equal(seriesTimeObservation.organizerEdit?.timeEdit, true);
const seriesDraft = organizerDraft(child, "microsoft", seriesTimeObservation);
assert.equal(seriesDraft.start, seriesTimeModel.startLocal, "Series draft uses the first slot, not the selected occurrence");
assert.equal(seriesDraft.end, seriesTimeModel.endLocal);
const seriesTimeUpdate = organizerRequest("update", { ...seriesDraft, end: "2026-10-20T11:30:00" }, ["end"], identity, seriesTimeObservation);
assert.deepEqual(seriesTimeUpdate.action === "update" && seriesTimeUpdate.patch, { time: { kind: "zoned", timeZone: "UTC", startLocal: "2026-10-20T09:00:00.000", endLocal: "2026-10-20T11:30:00.000" } });
assert.equal(seriesTimeUpdate.action === "update" && seriesTimeUpdate.provider === "microsoft" && seriesTimeUpdate.scope, "series");
assert.equal(ProviderOrganizerRequestSchema.safeParse({ ...seriesTimeUpdate, patch: { time: { ...seriesTimeModel, timeZone: "Europe/Prague" } } }).success, false);
console.log("Outlook series time: first occurrence anchor and explicit scope: OK");
