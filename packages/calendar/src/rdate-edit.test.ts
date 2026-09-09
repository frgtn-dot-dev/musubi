import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { allDayAdditionalDate, setAllDayAdditionalDate, caldavRdateEdit } from "./rdate-edit";
import { expandRecurringEvents } from "./recurrence";
const master = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000901", creatorID: "owner", organizer: "", revision: 1, title: "Extra date", calendars: [], color: "red", isCanceled: false, isAllDay: true, timeModel: { kind: "all-day" }, start: new Date("2026-03-28T00:00:00Z"), end: new Date("2026-03-28T00:00:00Z"), recurrence: "RRULE:FREQ=DAILY;COUNT=2" });
const added = setAllDayAdditionalDate(master, "2026-04-02");
assert.deepEqual(caldavRdateEdit(master, added), { before: undefined, after: "2026-04-02" });
assert.deepEqual(expandRecurringEvents([{ ...master, recurrence: added }], master.start, new Date("2026-04-04T00:00:00Z")).map(event => event.start.toISOString().slice(0,10)), ["2026-03-28", "2026-03-29", "2026-04-02"]);
assert.equal(setAllDayAdditionalDate({ ...master, recurrence: added }, null), master.recurrence);
assert.deepEqual(caldavRdateEdit({ ...master, recurrence: added }, master.recurrence!), { before: "2026-04-02", after: undefined });
for (const date of ["2026-03-28", "2026-03-29", "2026-03-27", "2026-02-30", "2026-04-020", "2028-03-27"]) assert.throws(() => setAllDayAdditionalDate(master, date));
for (const recurrence of [added + "\nRDATE;VALUE=DATE:20260402", added.replace("20260402", "20260402,20260403"), added.replace("VALUE=DATE", "VALUE=\"DATE\""), added.replace("20260402", "20260230"), "RRULE:FREQ=DAILY", "RRULE:FREQ=DAILY;UNTIL=20260331", added + "\nEXDATE;VALUE=DATE:20260329"]) assert.throws(() => allDayAdditionalDate({ ...master, recurrence }));
assert.throws(() => caldavRdateEdit(master, added.replace("COUNT=2", "COUNT=3")));
assert.throws(() => caldavRdateEdit({ ...master, recurrence: added }, added.replace("20260402", "20260403")));
assert.throws(() => setAllDayAdditionalDate({ ...master, recurrence: "RRULE:FREQ=DAILY;COUNT=366" }, "2027-04-02"));
console.log("Single all-day RDATE: fixed COUNT anchor, exact add/remove and bounded DATE membership: OK");

assert.throws(() => setAllDayAdditionalDate({ ...master, recurrence: "RRULE:FREQ=DAILY;COUNT=1", end: new Date("2026-04-28T00:00:00Z") }, "2028-03-20"));
