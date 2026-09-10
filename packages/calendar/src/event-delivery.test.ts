import assert from "node:assert/strict";
import type { EventDeliveryTarget } from "@musubi/types";
import { eventDeliveryActions, eventDeliveryExplanation, eventDeliveryLabel, eventDeliveryRetryLabel } from "./event-delivery";

const receipt: EventDeliveryTarget = {
  targetId: "00000000-0000-4000-8000-000000000001",
  calendarId: "00000000-0000-4000-8000-000000000002",
  calendarName: "Outlook",
  provider: "microsoft",
  connected: true,
  owned: true,
  operationId: "00000000-0000-4000-8000-000000000003",
  action: "update",
  status: "conflict",
  revision: 2,
  latestRevision: 2,
  updatedAt: new Date(0),
  retryAt: null,
  issue: "conflict",
  graphRsvpPhase: "queued",
};

assert.equal(eventDeliveryLabel(receipt), "Outlook response not sent");
assert.match(eventDeliveryExplanation(receipt), /stopped before sending because the current Outlook state could not be confirmed/);
assert.match(eventDeliveryExplanation(receipt), /respond there/);
assert.deepEqual(eventDeliveryActions(receipt), { retry: false, review: false });
for (const status of ["blocked", "cancelled", "not-written"] as const) {
  const stopped = { ...receipt, status };
  assert.equal(eventDeliveryLabel(stopped), "Outlook response not sent");
  assert.doesNotMatch(eventDeliveryExplanation(stopped), /will be asked/);
}
for (const status of ["pending", "attempting", "retry"] as const) {
  assert.equal(eventDeliveryLabel({ ...receipt, status }), "Response request saved");
  assert.match(eventDeliveryExplanation({ ...receipt, status }), /will be asked/);
}
for (const graphRsvpPhase of ["dispatched", "accepted", "absent"] as const) {
  const uncertain = { ...receipt, graphRsvpPhase };
  assert.notEqual(eventDeliveryLabel(uncertain), "Outlook response not sent");
  assert.match(eventDeliveryExplanation(uncertain), /will not be resent/);
  assert.equal(eventDeliveryActions(uncertain).retry, true);
  assert.equal(eventDeliveryRetryLabel(uncertain), "Check response");
}
console.log("Graph RSVP receipts distinguish stopped unsent requests from uncertain dispatched actions: OK");
