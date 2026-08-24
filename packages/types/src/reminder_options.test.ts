import assert from "node:assert/strict";
import type { ReminderRule } from "./reminder";
import {
  allDayValue,
  CUSTOM,
  optionsFor,
  presetOptions,
  presetRule,
  presetValue,
  timedValue,
  withAllDay,
  withTimed,
} from "./reminder_options";

// The vocabulary every client speaks. A phone that offers a set the web does
// not is how one device ends up unable to display what the other one saved, so
// these live here rather than beside either UI.

const rule = (over: Partial<ReminderRule> = {}): ReminderRule => ({
  allDay: { atMinute: 18 * 60, daysBefore: 1 },
  minutesBefore: 10,
  ...over,
});

// Reads a rule the control has a button for.
assert.equal(timedValue(rule()), "10");
assert.equal(allDayValue(rule()), "evening");
assert.equal(allDayValue(rule({ allDay: { atMinute: 540, daysBefore: 0 } })), "morning");

// Says off rather than picking something.
assert.equal(timedValue(rule({ minutesBefore: null })), "off");
assert.equal(allDayValue(rule({ allDay: null })), "off");

{
  // A rule saved by an older client must SHOW, not be silently rewritten to
  // the nearest thing this control can express.
  const legacyRule = rule({ minutesBefore: 15 });
  assert.equal(timedValue(legacyRule), CUSTOM);
  assert.deepEqual(optionsFor(legacyRule, "timed").at(-1), {
    label: "15 min",
    value: CUSTOM,
  });
  assert.deepEqual(withTimed(legacyRule, CUSTOM), legacyRule);
}

// One branch changes without disturbing the other.
assert.deepEqual(withTimed(rule(), "60"), rule({ minutesBefore: 60 }));
assert.deepEqual(withAllDay(rule(), "off"), rule({ allDay: null }));
assert.deepEqual(withTimed(rule(), "off").allDay, rule().allDay);

{
  // Calendar presets are whole rules, so "Evening before" can answer for a
  // birthdays calendar — which an offset never can.
  const evening = presetRule("Evening before");
  assert.deepEqual(evening, { allDay: { atMinute: 1080, daysBefore: 1 }, minutesBefore: null });
  assert.equal(presetValue(evening!), "Evening before");
  assert.equal(presetValue({ allDay: null, minutesBefore: null }), "Off");

  // Mutating a returned preset must not poison the next caller.
  evening!.minutesBefore = 99;
  assert.equal(presetRule("Evening before")!.minutesBefore, null);
}

{
  // A rule matching no preset still appears, rather than the row lying about
  // what is stored.
  const odd: ReminderRule = { allDay: null, minutesBefore: 7 };
  assert.equal(presetValue(odd), CUSTOM);
  assert.deepEqual(presetOptions(odd).at(-1), { label: "7 min", value: CUSTOM });
  // A calendar with no rule of its own gets the plain list.
  assert.equal(presetOptions(undefined).length, 4);
}

console.log("reminder_options.test.ts ok");
