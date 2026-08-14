import assert from "node:assert";
import {
	buildRRule,
	describeAdvanced,
	isEditableRRule,
	joinRecurrence,
	parseAdvanced,
	parseRRule,
	splitRecurrence,
	type AdvancedRRuleConfig,
} from "./rrule-editor";

const wed = new Date(2026, 6, 8);
const defaults = parseAdvanced(null, wed.getDay());

assert.equal(buildRRule("none", wed, defaults), null);
assert.equal(buildRRule("daily", wed, defaults), "FREQ=DAILY");
assert.equal(buildRRule("weekly", wed, defaults), "FREQ=WEEKLY;BYDAY=WE");
assert.equal(
	buildRRule("weekdays", wed, defaults),
	"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
);
assert.equal(buildRRule("monthly", wed, defaults), "FREQ=MONTHLY");
assert.equal(buildRRule("yearly", wed, defaults), "FREQ=YEARLY");

const custom: AdvancedRRuleConfig = {
	count: 5,
	days: new Set([3, 1]),
	endType: "count",
	freq: "WEEKLY",
	interval: 2,
};
assert.equal(
	buildRRule("custom", wed, custom),
	"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5",
);
assert.equal(describeAdvanced(custom), "Every 2 weeks on Mon, Wed, 5 times");

assert.equal(parseRRule("FREQ=WEEKLY;BYDAY=WE"), "weekly");
assert.equal(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"), "custom");
const parsed = parseAdvanced("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5");
assert.equal(parsed.freq, "WEEKLY");
assert.equal(parsed.interval, 2);
assert.deepEqual([...parsed.days].sort(), [1, 3]);
assert.equal(parsed.endType, "count");
assert.equal(parsed.count, 5);

const stored =
	"RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO\nEXDATE:20260720T090000Z\nRDATE:20260721T090000Z";
const split = splitRecurrence(stored);
assert.equal(split.rrule, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
assert.deepEqual(split.extras, [
	"EXDATE:20260720T090000Z",
	"RDATE:20260721T090000Z",
]);
assert.equal(joinRecurrence(split.rrule, split.extras), stored);
assert.equal(joinRecurrence(null, split.extras), null);

assert.equal(
	isEditableRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5"),
	true,
);
assert.equal(isEditableRRule("FREQ=WEEKLY;BYDAY=1MO"), false);
assert.equal(isEditableRRule("FREQ=MONTHLY;BYMONTHDAY=15"), false);
assert.equal(isEditableRRule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1"), false);
assert.equal(isEditableRRule("FREQ=WEEKLY;WKST=MO"), false);
assert.equal(isEditableRRule("FREQ=WEEKLY;INTERVAL=0"), false);
assert.equal(isEditableRRule("FREQ=WEEKLY;INTERVAL=100"), false);
assert.equal(isEditableRRule("FREQ=WEEKLY;COUNT=0"), false);
assert.equal(isEditableRRule("FREQ=WEEKLY;COUNT=1000"), false);

const bounded = parseAdvanced("FREQ=WEEKLY;INTERVAL=999;BYDAY=XX;COUNT=0", 4);
assert.equal(bounded.interval, 99);
assert.equal(bounded.count, 1);
assert.deepEqual([...bounded.days], [4]);
assert.equal(
	buildRRule("custom", wed, { ...bounded, days: new Set() }),
	"FREQ=WEEKLY;INTERVAL=99;BYDAY=WE;COUNT=1",
);

const until = parseAdvanced(
	"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261231T225959Z",
);
assert.equal(until.until, "20261231T225959Z");
assert.equal(
	buildRRule("custom", wed, { ...until, interval: 3 }),
	"FREQ=WEEKLY;INTERVAL=3;BYDAY=WE;UNTIL=20261231T225959Z",
);
assert.equal(
	buildRRule("custom", wed, { ...until, until: undefined }),
	"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
);
assert.equal(
	buildRRule("custom", wed, { ...until, endType: "count", count: 8 }),
	"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=8",
);
assert.equal(describeAdvanced(until), "Every 2 weeks on Wed, until 2026-12-31");

console.log("rrule editor: ok");
