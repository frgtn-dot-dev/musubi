import assert from "node:assert/strict";
import type { Request } from "express";
import { BadRequestError } from "@musubi/types";
import { parseEventReadQuery } from "./events";

const query = (value: Record<string, string>) => value as Request["query"];

assert.deepEqual(
  parseEventReadQuery(query({ since: "2026-07-01T00:00:00.000Z" })),
  { since: new Date("2026-07-01T00:00:00.000Z") },
);
assert.deepEqual(
  parseEventReadQuery(query({
    start: "2026-07-01T00:00:00.000Z",
    end: "2026-08-01T00:00:00.000Z",
  })),
  {
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
    since: undefined,
  },
);
assert.throws(
  () => parseEventReadQuery(query({
    since: "2026-07-15T00:00:00.000Z",
    start: "2026-07-01T00:00:00.000Z",
    end: "2026-08-01T00:00:00.000Z",
  })),
  (error: unknown) =>
    error instanceof BadRequestError &&
    error.message === "since cannot be combined with start and end.",
);
assert.throws(
  () => parseEventReadQuery(query({
    start: "2026-01-01T00:00:00.000Z",
    end: "2030-01-01T00:00:00.000Z",
  })),
  (error: unknown) =>
    error instanceof BadRequestError &&
    error.message === "Requested event range is too large.",
);

console.log("event read query self-check: OK");
