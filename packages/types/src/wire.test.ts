import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareWireContract, type WireBreak } from "./wire_contract";
import { wireSnapshot, type WireSnapshot } from "./wire";
import { PRODUCT_VERSION } from "./version";

const promised = JSON.parse(
  readFileSync(new URL("../contracts/wire.json", import.meta.url), "utf8"),
) as WireSnapshot;

// ---------------------------------------------------------------------------
// The check itself: does today's code still honour what was promised?
// ---------------------------------------------------------------------------

const breaks = compareWireContract(promised, wireSnapshot());

assert.deepEqual(
  breaks,
  [],
  breaks.length === 0
    ? ""
    : [
        "",
        `The wire contract promised at ${promised.version} is broken:`,
        "",
        ...breaks.map(
          (item) => `  ${item.document}.${item.path} — ${item.reason}`,
        ),
        "",
        "A phone build cannot be patched the way the server can — there is no",
        "OTA channel, so every install out there keeps the shape it was built",
        "against until its owner updates from the store.",
        "",
        "If this is deliberate: raise MIN_CLIENT_VERSION in",
        "packages/types/src/version.ts to the release that fixes it, then run",
        "`pnpm wire:snapshot`. See docs/releasing.md.",
        "",
      ].join("\n"),
);

// The snapshot trails the product: it moves only on a deliberate re-baseline.
// Compared numerically, because "0.1.10" sorts before "0.1.9" as a string.
const rank = (version: string) => version.split(".").map(Number);
const [a = 0, b = 0, c = 0] = rank(promised.version);
const [x = 0, y = 0, z = 0] = rank(PRODUCT_VERSION);
assert.ok(
  !(a > x || (a === x && (b > y || (b === y && c > z)))),
  `the promised contract claims ${promised.version}, ahead of the product at ${PRODUCT_VERSION}`,
);

// ---------------------------------------------------------------------------
// And the comparison itself, because a checker that cannot fail is decoration.
// ---------------------------------------------------------------------------

const reasons = (found: WireBreak[]) => found.map((item) => item.reason);

const readDoc = (schema: unknown): WireSnapshot => ({
  documents: { Doc: { direction: "read", schema } },
  version: "0.0.0",
});
const writeDoc = (schema: unknown): WireSnapshot => ({
  documents: { Doc: { direction: "write", schema } },
  version: "0.0.0",
});

const object = (
  properties: Record<string, unknown>,
  required: string[],
  extra: Record<string, unknown> = {},
) => ({ properties, required, type: "object", ...extra });

// Additive changes are the point of the exercise and must stay silent.
assert.deepEqual(
  compareWireContract(
    readDoc(object({ a: { type: "string" } }, ["a"])),
    readDoc(
      object({ a: { type: "string" }, b: { type: "number" } }, ["a", "b"]),
    ),
  ),
  [],
  "a response may gain a field",
);
assert.deepEqual(
  compareWireContract(
    writeDoc(object({ a: { type: "string" } }, [])),
    writeDoc(object({ a: { type: "string" }, b: { type: "number" } }, [])),
  ),
  [],
  "a request may gain an optional field",
);

assert.deepEqual(
  reasons(
    compareWireContract(
      readDoc(object({ a: { type: "string" } }, ["a"])),
      readDoc(object({}, [])),
    ),
  ),
  ["field removed", "field is no longer always sent"],
  "a removed response field is caught",
);

assert.deepEqual(
  reasons(
    compareWireContract(
      readDoc(object({ a: { type: "string" } }, ["a"])),
      readDoc(object({ a: { type: "string" } }, [])),
    ),
  ),
  ["field is no longer always sent"],
  "a response field that stops always being sent is caught",
);

assert.deepEqual(
  reasons(
    compareWireContract(
      writeDoc(object({ a: { type: "string" } }, [])),
      writeDoc(object({ a: { type: "string" }, b: { type: "number" } }, ["b"])),
    ),
  ),
  ["field is now required, so an older client's request is refused"],
  "a new required request field is caught",
);

// The exact regression this repository has already shipped once: a patch
// schema turning strict, so one unknown field rejects the whole request.
assert.deepEqual(
  reasons(
    compareWireContract(
      writeDoc(object({ a: { type: "string" } }, [])),
      writeDoc(object({ a: { type: "string" } }, [], {
        additionalProperties: false,
      })),
    ),
  ),
  [
    "additionalProperties false is new, which only narrows what is accepted",
  ],
  "a schema turning strict is caught",
);

assert.deepEqual(
  reasons(
    compareWireContract(
      readDoc(object({ a: { enum: ["x", "y"], type: "string" } }, ["a"])),
      readDoc(object({ a: { enum: ["x", "y", "z"], type: "string" } }, ["a"])),
    ),
  ),
  ['changed from ["x","y"] to ["x","y","z"]'],
  "a widened enum is caught — an older client rejects the value it has never heard of",
);

assert.deepEqual(
  reasons(
    compareWireContract(
      writeDoc(object({ a: { type: "string" } }, [])),
      writeDoc(object({ a: { maxLength: 80, type: "string" } }, [])),
    ),
  ),
  ["maxLength 80 is new, which only narrows what is accepted"],
  "a newly tightened bound is caught",
);

assert.deepEqual(
  reasons(
    compareWireContract(readDoc(object({}, [])), {
      documents: {},
      version: "0.0.0",
    }),
  ),
  ["no longer in the wire contract"],
  "a document dropped from the registry is caught",
);

console.log("wire contract ok");
