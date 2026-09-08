import assert from "node:assert/strict";
import { assertEventTimeActivation } from "./event_time_activation";

assert.doesNotThrow(() => assertEventTimeActivation("prod", false));
assert.doesNotThrow(() => assertEventTimeActivation("test", true));
assert.doesNotThrow(() => assertEventTimeActivation("dev", true));
const old = { product: "0.1.8", client: "0.1.8", peer: "0.1.8" };
assert.throws(() => assertEventTimeActivation("prod", true, old), /coordinated release/);
for (const versions of [
  { product: "0.1.9", client: "0.1.8", peer: "0.1.9" },
  { product: "0.1.9", client: "0.1.9", peer: "0.1.8" },
  { product: "0.1.8", client: "0.1.9", peer: "0.1.9" },
  { product: "0.1.9", client: "invalid", peer: "0.1.9" },
]) assert.throws(() => assertEventTimeActivation("prod", true, versions));
assert.doesNotThrow(() => assertEventTimeActivation("prod", true, { product: "0.1.9", client: "0.1.9", peer: "0.1.9" }));
console.log("Explicit time production activation compatibility gate: OK");
