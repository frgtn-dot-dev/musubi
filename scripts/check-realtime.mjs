#!/usr/bin/env node
// Fails if the live-update stream has a name mismatch between the two ends.
//
// `/api/stream` carries frames of the shape `{ type, payload }`, and `type` is
// a bare string on both sides — nothing in the type system connects the server
// that writes `"event_updated"` to the `case "event_updated":` that acts on it.
// A rename compiles, passes every test, deploys, and then the phone in someone's
// pocket goes quiet: the socket is open, the frames arrive, none of them match
// a case, and the calendar simply stops updating until the app is restarted.
//
// Two directions, and the second is the one that matters most:
//
//   emitted but unhandled — a new event nobody acts on. Cheap mistake, silent.
//   handled but unemitted — a shipped build listening for a name the server no
//                           longer sends. That build cannot be patched.
//
// Usage:
//   node scripts/check-realtime.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const API_DIR = resolve(root, "apps/api/src");
const WEB_STREAM = resolve(root, "apps/web/src/api/realtime.ts");
const PHONE_STREAM = resolve(root, "apps/client/hooks/useEventsStream.ts");

/** The functions that put a frame on the wire. */
const EMITTERS = ["notifyCalendarMembers", "notifyPages", "notify", "emit"];

/**
 * Frames the phone is allowed not to handle.
 *
 * Pages are a web-only surface — the phone has no equivalent screen, so a page
 * frame is not something it is missing. Everything else it ignores is a bug.
 */
const PHONE_MAY_IGNORE = new Set([
  "page_created",
  "page_removed",
  "page_updated",
]);

/** An event type: snake_case, which no payload key in these calls is. */
const EVENT_TYPE = /^[a-z]+(?:_[a-z]+)+$/;

const problems = [];
const fail = (message) => problems.push(message);

// --- What the server sends --------------------------------------------------

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.includes(".test."))
      yield full;
  }
}

/** The argument text of a call, from its opening paren to the matching close. */
function callArguments(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return "";
}

function emittedTypes() {
  const types = new Set();
  const pattern = new RegExp(`\\b(?:${EMITTERS.join("|")})\\s*\\(`, "g");

  for (const file of sourceFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      const args = callArguments(source, match.index + match[0].length - 1);
      // Every snake_case literal in the call, not just the first: one call site
      // picks between `event_removed` and `event_updated` with a ternary.
      for (const [, literal] of args.matchAll(/"([^"]*)"/g)) {
        if (EVENT_TYPE.test(literal)) types.add(literal);
      }
    }
  }
  return types;
}

// --- What each client listens for -------------------------------------------

function handledTypes(file) {
  const source = readFileSync(file, "utf8");
  const types = new Set();
  for (const [, literal] of source.matchAll(/\bcase\s+"([^"]+)"\s*:/g)) {
    if (EVENT_TYPE.test(literal)) types.add(literal);
  }
  return types;
}

// --- Run --------------------------------------------------------------------

const emitted = emittedTypes();
const web = handledTypes(WEB_STREAM);
const phone = handledTypes(PHONE_STREAM);

// A parser that quietly finds nothing would pass forever.
if (emitted.size < 10) {
  fail(
    `only ${emitted.size} emitted frame types were found in apps/api/src — ` +
      "the emit call shape changed and this check is no longer reading it",
  );
}
if (web.size < 10 || phone.size < 8) {
  fail(
    `only ${web.size} web and ${phone.size} phone handlers were found — ` +
      "the switch shape changed and this check is no longer reading it",
  );
}

const sorted = (set) => [...set].sort();

for (const type of sorted(emitted)) {
  if (!web.has(type)) {
    fail(
      `the server sends "${type}" and apps/web/src/api/realtime.ts ignores it`,
    );
  }
  if (!phone.has(type) && !PHONE_MAY_IGNORE.has(type)) {
    fail(
      `the server sends "${type}" and apps/client/hooks/useEventsStream.ts ` +
        "ignores it — add a case, or add the type to PHONE_MAY_IGNORE here " +
        "with the reason it does not concern the phone",
    );
  }
}

for (const [name, handled] of [
  ["apps/web/src/api/realtime.ts", web],
  ["apps/client/hooks/useEventsStream.ts", phone],
]) {
  for (const type of sorted(handled)) {
    if (emitted.has(type)) continue;
    fail(`${name} listens for "${type}", which nothing in apps/api/src sends`);
  }
}

for (const type of sorted(PHONE_MAY_IGNORE)) {
  if (emitted.has(type)) continue;
  fail(
    `PHONE_MAY_IGNORE names "${type}", which the server no longer sends — ` +
      "drop it so the exemption list stays honest",
  );
}

if (problems.length > 0) {
  console.error("Realtime frame contract broken:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    [
      "",
      "A frame type is a string on both ends, so a rename is invisible to the",
      "compiler and silent at runtime — the socket stays open and the client",
      "simply stops reacting.",
      "",
      "Renaming one means every phone build already installed listens for the",
      "old name forever. Send both names for a release instead, and drop the",
      "old one after MIN_CLIENT_VERSION passes it. See docs/releasing.md.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Realtime frame contract verified: ${emitted.size} frame types, ` +
    `${web.size} handled by the web, ${phone.size} by the phone.`,
);
