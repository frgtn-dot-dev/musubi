import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createRequireAdmin, isAdminEmailIn } from "./require_admin";

// --- isAdminEmailIn ---
const admins = ["owner@example.com"];
assert.equal(isAdminEmailIn(admins, "owner@example.com"), true);
// Psaní velkých písmen ani mezery kolem nesmí rozhodovat.
assert.equal(isAdminEmailIn(admins, "Owner@Example.com"), true);
assert.equal(isAdminEmailIn(admins, " owner@example.com "), true);
assert.equal(isAdminEmailIn(admins, "someone@example.com"), false);
assert.equal(isAdminEmailIn(admins, undefined), false);
assert.equal(isAdminEmailIn(admins, null), false);
assert.equal(isAdminEmailIn(admins, ""), false);
// Server bez adminů neuzná nikoho — prázdný seznam nesmí znamenat "všichni".
assert.equal(isAdminEmailIn([], "owner@example.com"), false);

// --- middleware ---
const response = {} as Response;

function callsNext(email: string | undefined, adminList: string[]) {
  let called = false;
  createRequireAdmin(adminList)(
    { user: email ? { email } : undefined } as Request,
    response,
    () => {
      called = true;
    },
  );
  return called;
}

assert.equal(callsNext("owner@example.com", admins), true);

assert.throws(
  () => callsNext("someone@example.com", admins),
  (error: unknown) => error instanceof Error && error.message === "Admin only",
);

// Nepřihlášený se sem nemá jak dostat (requireAdmin běží za requireAuth),
// ale kdyby se pořadí někdy prohodilo, odmítnout je bezpečnější než spadnout.
assert.throws(
  () => callsNext(undefined, admins),
  (error: unknown) => error instanceof Error && error.message === "Admin only",
);

console.log("require_admin tests passed");
