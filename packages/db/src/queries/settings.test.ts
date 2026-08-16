import assert from "node:assert/strict";
import {
  DEFAULT_REMINDER_RULE,
  SILENT_REMINDER_RULE,
  type ReminderRule,
} from "@musubi/types";
import { alignReminderDefaults } from "./settings";

// One setting, two vocabularies: `notificationsOnByDefault` is what older mobile
// builds speak, `defaultReminder` is what everything since speaks. These
// assertions are the contract that keeps a phone from turning reminders off
// while the server keeps sending them.

const HOURLY: ReminderRule = { minutesBefore: 60, allDay: null };

{
  // The rule is the richer statement, so it decides and the boolean follows.
  const withRule = alignReminderDefaults({ defaultReminder: HOURLY });
  assert.equal(withRule.notificationsOnByDefault, true);

  const silenced = alignReminderDefaults({ defaultReminder: SILENT_REMINDER_RULE });
  assert.equal(
    silenced.notificationsOnByDefault,
    false,
    "a rule that never fires must not read as notifications on",
  );
}

{
  // An old client switching them off has to actually silence the rule.
  const off = alignReminderDefaults({ notificationsOnByDefault: false });
  assert.deepEqual(off.defaultReminder, SILENT_REMINDER_RULE);
}

{
  // Switching back on from silence restores something that fires…
  const on = alignReminderDefaults(
    { notificationsOnByDefault: true },
    { defaultReminder: SILENT_REMINDER_RULE },
  );
  assert.deepEqual(on.defaultReminder, DEFAULT_REMINDER_RULE);

  // …but must not overwrite a choice the old client cannot see.
  const kept = alignReminderDefaults(
    { notificationsOnByDefault: true },
    { defaultReminder: HOURLY },
  );
  assert.equal(kept.defaultReminder, undefined, "an hour before stays an hour before");
}

{
  // A patch about something else must not drag reminders into the update.
  const unrelated = alignReminderDefaults({ theme: "dark" });
  assert.deepEqual(unrelated, { theme: "dark" });
}

console.log("queries/settings.test.ts ok");
