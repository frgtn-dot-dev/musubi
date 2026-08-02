import assert from "node:assert/strict";
import { withVerifiedLanding } from "./verified_landing";

// Better Auth builds the link itself, so this is string surgery on somebody
// else's URL — the case worth pinning is that it only touches the default.
const base = "https://musubi.example.com/api/auth/verify-email?token=abc123";

// No callback chosen: send the browser to the page this API serves, or an
// API-only server ends a successful verification on a 404.
assert.equal(
  withVerifiedLanding(`${base}&callbackURL=%2F`),
  `${base}&callbackURL=%2Femail-verified`,
);

// A caller that asked for somewhere specific — the web client sending people
// back to the page they signed up on — keeps it.
assert.equal(
  withVerifiedLanding(`${base}&callbackURL=%2Flogin%3Fverified%3D1`),
  `${base}&callbackURL=%2Flogin%3Fverified%3D1`,
);

// An unescaped slash and an empty value are the same "nowhere in particular".
assert.equal(
  withVerifiedLanding(`${base}&callbackURL=/`),
  `${base}&callbackURL=%2Femail-verified`,
);
assert.equal(
  withVerifiedLanding(`${base}&callbackURL=`),
  `${base}&callbackURL=%2Femail-verified`,
);

console.log("auth verification landing self-check: OK");
