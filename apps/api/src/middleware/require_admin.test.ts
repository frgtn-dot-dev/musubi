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

// Federovaný shadow účet nese e-mail, který je nezaručené tvrzení dodané
// volajícím při přijetí pozvánky (viz federation.ts) — i kdyby se shodoval se
// seznamem adminů, nesmí projít. Bez tohohle by kdokoli s odkazem na pozvánku
// mohl namintovat účet s e-mailem z ADMIN_EMAILS a stát se adminem.
function callsNextExternal(email: string, adminList: string[]) {
  let called = false;
  createRequireAdmin(adminList)(
    { user: { email, isExternal: true } } as unknown as Request,
    response,
    () => {
      called = true;
    },
  );
  return called;
}

assert.throws(
  () => callsNextExternal("owner@example.com", admins),
  (error: unknown) => error instanceof Error && error.message === "Admin only",
);

console.log("require_admin tests passed");
