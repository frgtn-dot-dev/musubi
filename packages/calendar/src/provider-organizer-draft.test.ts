import { eventDeliveryExplanation } from "./event-delivery";
import type { EventDeliveryTarget } from "@musubi/types";
import assert from "node:assert/strict";
import { organizerDraft, organizerRequest } from "./provider-organizer-draft";
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
