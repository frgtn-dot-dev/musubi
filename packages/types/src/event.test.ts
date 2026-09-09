import assert from "node:assert/strict";
import {
  EventSchema,
  EventPatchSchema,
  EventPatchRequestSchema,
  EventCreateRequestSchema,
  EventDeleteRequestSchema,
  EventLinkRequestSchema,
  EventForkRequestSchema,
  EventUnlinkRequestSchema,
  eventCreateRequest,
  eventCreateOperation,
  eventPatchRequest,
  editedEvent,
} from "./event";

const event = EventSchema.parse({
  id: "e96f7826-360d-4f25-ae0a-1d57c732792f",
  revision: 7,
  creatorID: "owner",
  organizer: "owner",
  title: "Night",
  color: "red",
  start: "2026-09-01T23:00:00Z",
  end: "2026-09-03T02:00:00Z",
  calendars: ["e96f7826-360d-4f25-ae0a-1d57c732793f"],
  isAllDay: false,
  isCanceled: false,
  hasAttendees: true,
  description: "Keep",
  location: "Room",
});
assert.equal(EventSchema.parse(event).revision, 7);
assert.deepEqual(
  EventPatchSchema.parse({}),
  {},
  "read defaults must not invent PATCH fields",
);
assert.deepEqual(EventPatchSchema.parse({ description: null }), {
  description: null,
});
for (const field of ["start", "end", "hasAttendees", "title", "calendars"])
  assert.equal(EventPatchSchema.safeParse({ [field]: null }).success, false);
for (const expectedRevision of [undefined, null, 0, -1, 1.5, "7"]) {
  assert.equal(
    EventPatchRequestSchema.safeParse({
      id: event.id,
      expectedRevision,
      patch: {},
    }).success,
    false,
  );
  assert.equal(
    EventDeleteRequestSchema.safeParse({ id: event.id, expectedRevision })
      .success,
    false,
  );
  assert.equal(
    EventLinkRequestSchema.safeParse({
      calendarID: event.calendars[0],
      expectedRevision,
    }).success,
    false,
  );
  assert.equal(
    EventForkRequestSchema.safeParse({
      calendarID: event.calendars[0],
      expectedRevision,
    }).success,
    false,
  );
  assert.equal(
    EventUnlinkRequestSchema.safeParse({
      id: event.id,
      unlinkCalendarID: event.calendars[0],
      expectedRevision,
    }).success,
    false,
  );
}
const title = editedEvent(event, { ...event, title: "Title only" });
assert.deepEqual(eventPatchRequest(title), {
  id: event.id,
  expectedRevision: 7,
  patch: { title: "Title only" },
});
assert.equal(EventSchema.parse(title).revision, 7);
assert.equal("contentPatch" in EventSchema.parse(title), false);
assert.equal("revision" in eventCreateRequest(title), false);
assert.equal("contentPatch" in eventCreateRequest(title), false);
assert.equal(
  EventCreateRequestSchema.safeParse({
    ...eventCreateRequest(event),
    revision: 7,
  }).success,
  false,
);
assert.throws(
  () => eventPatchRequest({ ...title, revision: undefined }),
  /revision is unavailable/,
);
assert.equal(
  EventPatchRequestSchema.safeParse({
    ...eventPatchRequest(title),
    scopeEditValidated: true,
  }).success,
  false,
);
assert.equal(
  EventPatchRequestSchema.safeParse(event).success,
  false,
  "no legacy full Event request bypass",
);
console.log(
  "Event request contracts: positive frozen revision, omission/null, distinct create/PATCH/delete/link/unlink/fork and no metadata leakage OK",
);

const known = EventSchema.parse({ ...event, timeModel: {
  kind: "zoned", timeZone: "UTC", startLocal: "2026-09-01T23:00:00", endLocal: "2026-09-03T02:00:00",
}, seriesID: "00000000-0000-4000-8000-000000000001", originalStart: { kind: "instant", value: "2026-09-01T23:00:00Z" } });
assert.equal(known.timeModel?.kind, "zoned");
assert.equal(known.originalStart?.value, "2026-09-01T23:00:00.000Z");
for (const field of ["timeModel", "seriesID", "originalStart"] as const) {
  assert.equal(EventPatchSchema.safeParse({ [field]: known[field] }).success, false);
  assert.equal(EventCreateRequestSchema.safeParse({ ...eventCreateRequest(event), [field]: known[field] }).success, false);
}
assert.throws(() => eventCreateRequest(known), /time-model-aware copy/);
assert.deepEqual(eventCreateRequest({ ...event, timeModel: null, seriesID: null, originalStart: null }), eventCreateRequest(event));
assert.deepEqual(eventPatchRequest(editedEvent(known, { ...known, title: "New title" })).patch, { title: "New title" });

const retired = EventSchema.parse({ ...event, providerReadRetiredRevision: 3 });
assert.equal(retired.providerReadRetiredRevision, 3);
assert.equal(EventSchema.parse(event).providerReadRetiredRevision, undefined);
for (const value of [null, 0, 3]) {
  assert.equal(EventPatchSchema.safeParse({ providerReadRetiredRevision: value }).success, false);
  assert.equal(EventCreateRequestSchema.safeParse({ ...eventCreateRequest(event), providerReadRetiredRevision: value }).success, false);
}
assert.equal("providerReadRetiredRevision" in eventCreateRequest(retired), false);

for (const providerReadRetiredRevision of [undefined, null, 3]) {
  assert.equal("providerReadRetiredRevision" in eventCreateRequest({ ...event, providerReadRetiredRevision }), false);
  const draft = { ...event, providerReadRetiredRevision, timeEdit: { kind: "all-day" as const, startDate: "2026-09-01", endDate: "2026-09-02" } };
  assert.equal("providerReadRetiredRevision" in (eventCreateOperation(draft).body as { event: object }).event, false);
}

assert.equal(JSON.stringify(EventSchema.parse({ ...event, providerReadRetiredRevision: null })), JSON.stringify(EventSchema.parse(event)), "Absent pre-migration event metadata and nullable DB metadata have the same serialized snapshot");
