import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  calendarEvents,
  calendarMembers,
  eventReminders,
  eventUsers,
  pages,
  schedulingParticipants,
  schedulingPolls,
  schedulingVotes,
  user,
  userSettings,
} from "./schema";

assert.equal(
  user.isAnonymous.default,
  false,
  "users must be ordinary accounts unless explicitly created anonymously",
);

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
assert.equal(
  schedulingPolls.approximateStartTime.notNull,
  false,
  "a poll's approximate start must stay optional",
);
assert.equal(schedulingPolls.ownerEmail.notNull, true);
assert.equal(schedulingPolls.ownerName.notNull, true);
assert.equal(schedulingPolls.ownerID.notNull, false);
assert.ok(
  getTableConfig(schedulingParticipants).uniqueConstraints.some(
    (constraint) =>
      constraint.name === "scheduling_participants_poll_email_unique",
  ),
  "one email must identify at most one participant in a poll",
);
assert.ok(
  getTableConfig(schedulingVotes).uniqueConstraints.some(
    (constraint) =>
      constraint.name === "scheduling_votes_slot_participant_unique",
  ),
  "a participant must have at most one answer per slot",
);
assert.equal(
  eventUsers.status.notNull,
  true,
  "an attendee row must always say which answer it is",
);
assert.equal(
  eventUsers.status.default,
  "going",
  "membership rows that predate answers mean 'going'",
);

const pagesPositionIndex = getTableConfig(pages).indexes.find(
  (index) => index.config.name === "pages_user_position_idx",
);
assert.ok(
  pagesPositionIndex,
  "pages must be orderable per user by position",
);

console.log("database schema invariant self-check: OK");

// ── Reminders ────────────────────────────────────────────────────────────────

assert.equal(
  userSettings.timezone.default,
  "UTC",
  "an account with no reported zone must still resolve all-day reminders",
);
assert.equal(
  userSettings.defaultReminder.notNull,
  true,
  "the bottom of the inheritance chain has nothing to fall back to",
);

assert.equal(
  calendarMembers.reminder.notNull,
  false,
  "a null calendar rule is how a membership says 'inherit'",
);

assert.ok(
  getTableConfig(eventReminders).uniqueConstraints.some((constraint) =>
    ["event_id", "user_id"].every((column) =>
      constraint.columns.some((c) => c.name === column),
    ),
  ),
  "one override per person per event, so a repeated PUT updates rather than piles up",
);
