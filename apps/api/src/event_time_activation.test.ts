import assert from "node:assert/strict";
import { assertEventTimeActivation } from "./event_time_activation";

const release = { product: "0.1.8", client: "0.1.8", peer: "0.1.8" };
const incompatible = [
  { product: "0.1.8", client: "0.1.7", peer: "0.1.8" },
  { product: "0.1.8", client: "0.1.8", peer: "0.1.7" },
  { product: "0.1.7", client: "0.1.8", peer: "0.1.8" },
  { product: "0.1.8", client: "0.1.9", peer: "0.1.8" },
  { product: "0.1.8", client: "0.1.8", peer: "0.1.9" },
];
for (const key of ["product", "client", "peer"] as const) {
  for (const value of ["invalid", "", "0.1.8-beta.1", "0.1", "9007199254740992.1.8"]) {
    incompatible.push({ ...release, [key]: value });
  }
}

// Exercise each independently enabled gate: organizer-only activation must not
// bypass the compatibility boundary when explicit-time editing is disabled.
for (const enabledKey of ["eventTimeEditsEnabled", "providerOrganizerEditsEnabled", "caldavOrganizerEditsEnabled"] as const) {
  const flags = { eventTimeEditsEnabled: false, providerOrganizerEditsEnabled: false, caldavOrganizerEditsEnabled: false };
  for (const versions of incompatible) assert.doesNotThrow(() => assertEventTimeActivation("prod", flags, versions));
  flags[enabledKey] = true;
  assert.doesNotThrow(() => assertEventTimeActivation("prod", flags, release));
  assert.doesNotThrow(() => assertEventTimeActivation("prod", flags));
  for (const versions of incompatible) {
    assert.throws(() => assertEventTimeActivation("prod", flags, versions), /coordinated release/);
    assert.doesNotThrow(() => assertEventTimeActivation("dev", flags, versions));
    assert.doesNotThrow(() => assertEventTimeActivation("test", flags, versions));
  }
}
assert.doesNotThrow(() => assertEventTimeActivation("prod", true, release));
assert.doesNotThrow(() => assertEventTimeActivation("prod", true, { product: "0.1.9", client: "0.1.8", peer: "0.1.8" }));
assert.doesNotThrow(() => assertEventTimeActivation("prod", true, { product: "0.1.9", client: "0.1.9", peer: "0.1.9" }));
assert.throws(() => assertEventTimeActivation("prod", true, incompatible[0]), /coordinated release/);
assert.doesNotThrow(() => assertEventTimeActivation("prod", false, incompatible[0]));
console.log("Explicit time production activation compatibility gate: OK");
