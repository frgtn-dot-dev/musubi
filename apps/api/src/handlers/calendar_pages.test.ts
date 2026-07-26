import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PageConfigV1Schema,
  ReorderPagesRequestSchema,
  SavePageRequestSchema,
  defaultPageConfig,
} from "@musubi/types";

const calendarId = randomUUID();

// A well-formed week config round-trips and fills view defaults.
{
  const parsed = PageConfigV1Schema.parse({
    schemaVersion: 1,
    view: { id: "week", configVersion: 1 },
    calendarVisibility: { mode: "include", calendarIds: [calendarId] },
    filters: [],
  });
  assert.equal(parsed.view.id, "week");
  assert.equal(
    parsed.view.id === "week" && parsed.view.weekend,
    true,
    "week view must default weekend on",
  );
}

// Strict configs reject unknown top-level keys so a stray field can't be
// silently persisted.
assert.equal(
  PageConfigV1Schema.safeParse({
    schemaVersion: 1,
    view: { id: "month", configVersion: 1 },
    calendarVisibility: { mode: "all", hiddenCalendarIds: [] },
    filters: [],
    surprise: true,
  }).success,
  false,
  "unknown page config keys must be rejected",
);

// visibility is a discriminated union: `include` may not carry hidden ids.
assert.equal(
  PageConfigV1Schema.safeParse({
    schemaVersion: 1,
    view: { id: "month", configVersion: 1 },
    calendarVisibility: { mode: "include", hiddenCalendarIds: [] },
    filters: [],
  }).success,
  false,
  "include visibility must use calendarIds, not hiddenCalendarIds",
);

// Save requests demand a positive baseRevision for compare-and-swap.
assert.equal(
  SavePageRequestSchema.safeParse({
    baseRevision: 0,
    name: "Work",
    config: defaultPageConfig("month"),
  }).success,
  false,
  "baseRevision must be a positive integer",
);

// A blank name is rejected after trimming.
assert.equal(
  SavePageRequestSchema.safeParse({
    baseRevision: 1,
    name: "   ",
    config: defaultPageConfig("month"),
  }).success,
  false,
  "page name must not be blank",
);

// Reorder needs at least one id and non-uuid entries are rejected.
assert.equal(
  ReorderPagesRequestSchema.safeParse({ pageIds: [] }).success,
  false,
  "reorder must list at least one page",
);
assert.equal(
  ReorderPagesRequestSchema.safeParse({ pageIds: ["not-a-uuid"] }).success,
  false,
  "reorder ids must be uuids",
);

// The default Page maps the settings agenda id and shows all calendars.
{
  const config = defaultPageConfig("agenda");
  assert.equal(config.view.id, "agenda");
  assert.equal(config.calendarVisibility.mode, "all");
}

console.log("calendar pages contract self-check: OK");
