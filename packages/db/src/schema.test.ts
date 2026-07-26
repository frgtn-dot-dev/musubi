import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import { calendarEvents, pages, userSettings } from "./schema";

assert.equal(
  userSettings.id.primary,
  true,
  "user_settings.id must enforce one settings row per user",
);
assert.equal(
  userSettings.revision.default,
  1,
  "user_settings.revision must start at one",
);

const calendarEventUnique = getTableConfig(calendarEvents).uniqueConstraints.find(
  (constraint) => constraint.name === "calendar_events_event_id_calendar_id_unique",
);
assert.ok(
  calendarEventUnique,
  "calendar_events must reject duplicate event/calendar links",
);
assert.deepEqual(
  calendarEventUnique.columns.map((column) => column.name),
  ["event_id", "calendar_id"],
);

assert.equal(
  pages.revision.default,
  1,
  "pages.revision must start at one for compare-and-swap saves",
);
assert.equal(
  pages.config.notNull,
  true,
  "pages.config must always hold a versioned document",
);
const pagesPositionIndex = getTableConfig(pages).indexes.find(
  (index) => index.config.name === "pages_user_position_idx",
);
assert.ok(
  pagesPositionIndex,
  "pages must be orderable per user by position",
);

console.log("database schema invariant self-check: OK");
