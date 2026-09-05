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
