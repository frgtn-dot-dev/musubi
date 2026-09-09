import assert from "node:assert/strict";
import ICAL from "ical.js";
import { EventSchema, EventWriteError } from "@musubi/types";
import { expandRecurringEvents } from "@musubi/calendar";
import { validateCalendarImportDates } from "./caldav_recurrence_dates";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
  const { toVevent, veventToFields, patchEventIcal } = await import("./caldav");
  const { handlerImportCalendar } = await import("../../handlers/calendars");
  const master = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000401", creatorID: "owner", organizer: "", revision: 1, title: "Dated series", color: "red", calendars: [], isCanceled: false, isAllDay: true, timeModel: { kind: "all-day" }, start: new Date("2026-03-28T00:00:00Z"), end: new Date("2026-03-28T00:00:00Z"), recurrence: "RRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:20260328,20260330\nRDATE;VALUE=DATE:20260402,20260404" });
  const visible = (event: typeof master) => expandRecurringEvents([event], new Date("2026-03-27T00:00:00Z"), new Date("2026-04-06T00:00:00Z"), { consumerTimeZone: "UTC" }).map(value => value.start.toISOString().slice(0, 10));
  const exportFile = (event: typeof master) => { const calendar = new ICAL.Component("vcalendar"); calendar.updatePropertyWithValue("version", "2.0"); calendar.addSubcomponent(toVevent(event)); return calendar.toString(); };
  const exported = exportFile(master);
  assert.match(exported, /EXDATE;VALUE=DATE:20260328,20260330/); assert.match(exported, /RDATE;VALUE=DATE:20260402,20260404/);
  validateCalendarImportDates(exported);
  const component = new ICAL.Component(ICAL.parse(exported)).getFirstSubcomponent("vevent")!;
  const imported = EventSchema.parse({ ...master, ...veventToFields(component), organizer: "" });
  assert.equal(component.getFirstPropertyValue("uid"), master.id);
  assert.deepEqual(imported.start, master.start); assert.deepEqual(imported.end, master.end);
  assert.ok(imported.recurrence!.startsWith("RRULE:FREQ=DAILY;COUNT=4"));
  assert.deepEqual(visible(imported), ["2026-03-29", "2026-03-31", "2026-04-02", "2026-04-04"]);
  assert.deepEqual(visible(imported), visible(master));
  // The public importer currently creates legacy time rows; do not mask that
  // path by borrowing the known model from the exported master.
  const publicImported = EventSchema.parse({ ...imported, timeModel: undefined });
  assert.deepEqual(visible(publicImported), visible(master));
  const second = EventSchema.parse({ ...imported, ...veventToFields(new ICAL.Component(ICAL.parse(exportFile(imported))).getFirstSubcomponent("vevent")!), organizer: "" });
  assert.deepEqual(visible(second), visible(master));
  validateCalendarImportDates(exported.replace("20260328,20260330", "20260328,\r\n 20260330"));
  for (const value of ["202603300", "2026033", "20260230", "20260229", "20261301", "", "20260330T000000Z"]) {
    assert.throws(() => toVevent({ ...master, recurrence: `RRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:${value}` }));
    assert.throws(() => validateCalendarImportDates(exported.replace("EXDATE;VALUE=DATE:20260328,20260330", `EXDATE;VALUE=DATE:${value}`)));
  }
  // Quoted parameter punctuation is not a separate VALUE parameter. These
  // DATE-TIME properties remain outside this narrow DATE validator.
  for (const parameter of ['X-NOTE="ignore;VALUE=DATE:here"', 'X-NOTE="colon:and;semicolon";VALUE=DATE-TIME']) {
    const control = exported.replace("EXDATE;VALUE=DATE:20260328,20260330", `EXDATE;${parameter}:20260330T000000Z`);
    validateCalendarImportDates(control);
    const parsed = new ICAL.Component(ICAL.parse(control)).getFirstSubcomponent("vevent")!;
    const excluded = parsed.getFirstPropertyValue("exdate") as ICAL.Time;
    assert.equal(excluded.isDate, false);
    assert.equal(excluded.toICALString(), "20260330T000000Z");
    const fields = veventToFields(parsed)!;
    assert.ok(fields.recurrence!.includes("EXDATE:20260330T000000Z"));
    const roundTrip = toVevent(EventSchema.parse({ ...master, ...fields, organizer: "" }));
    assert.equal((roundTrip.getFirstPropertyValue("exdate") as ICAL.Time).toICALString(), "20260330");
  }
  // The narrow contract refuses quoted DATE too, before ICAL can truncate it.
  for (const header of ['VALUE="DATE"', 'X-NOTE="colon:and;semicolon";VALUE="DATE"', 'VALUE="DATE";X-NOTE="colon:and;semicolon"']) {
    assert.throws(() => validateCalendarImportDates(exported.replace("EXDATE;VALUE=DATE:20260328,20260330", `EXDATE;${header}:202603300`)));
  }
  const malformedHeaders = [
    `RDATE;MEMBER="a^',^'b^',^'c^',^'d^',^':202603300":20260402`, // exact decoded boundary bypass
    ...["^'", "^n", "^^", "\\n", "\\,", "\\;"].map(encoded => `RDATE;X-NOTE="a${encoded}:202603300":20260402`),
    'RDATE;MEMBER="a,b:202603300":20260402',
    'RDATE;MEMBER="a";MEMBER="b:202603300":20260402',

    'EXDATE;X-NOTE=x,";VALUE=DATE:202603300":20260331T000000Z', // exact ICAL differential
    'EXDATE;X-NOTE=x,";VALUE=DATE:fake";VALUE=DATE-TIME:20260330T000000Z',
    'EXDATE;X-NOTE="safe",";VALUE=DATE:202603300":20260331T000000Z',
    'EXDATE;X-NOTE=x,y;VALUE=DATE-TIME:20260330T000000Z',
    'EXDATE;X-NOTE=x";VALUE=DATE:202603300"', // exact review bypass
    'EXDATE;X-NOTE=x";VALUE=DATE:202603300',
    'EXDATE;X-NOTE="x;VALUE=DATE:202603300', // unclosed quoted value
    'EXDATE;X-NOTE="x"tail;VALUE=DATE:202603300',
    'EXDATE;X-NOTE="x"";VALUE=DATE:202603300',
    'EXDATE;X-NOTE=a,"x"tail;VALUE=DATE:202603300',
    'EXDATE;X-NOTE="x" ;VALUE=DATE:202603300',
    'EXDATE;X-NOTE="colon:and;semicolon",x";VALUE=DATE:202603300"',
  ];
  for (const line of malformedHeaders) assert.throws(() => validateCalendarImportDates(exported.replace("EXDATE;VALUE=DATE:20260328,20260330", line)));
  assert.throws(() => validateCalendarImportDates(exported.replace("EXDATE;VALUE=DATE:20260328,20260330", 'EXDATE;X-NOTE=x,"colon:and;semicolon";VALUE=DATE:202603300')));
  // Invoke the public handler: each refusal happens before destination writes,
  // and needs no database or provider connection.
  for (const file of [
    ...malformedHeaders.map(line => exported.replace("EXDATE;VALUE=DATE:20260328,20260330", line)),
    exported.replace("20260328,20260330", "20260328,20260230"),
    exported.replace("EXDATE;VALUE=DATE:20260328,20260330", 'EXDATE;VALUE="DATE":202603300'),
    exported.replace("EXDATE;VALUE=DATE:20260328,20260330", 'EXDATE;X-NOTE="colon:and;semicolon";VALUE="DATE":202603300'),
    exported.replace("RRULE:FREQ=DAILY;COUNT=4\r\n", ""),
    exported.replace("DTSTART;VALUE=DATE:20260328", "DTSTART:20260328T000000Z"),
  ]) await assert.rejects(() => handlerImportCalendar({ body: file, query: {}, user: { id: "owner" }, get: () => undefined } as never, {} as never), (error: unknown) => (error as { kind?: string }).kind === "BadRequest");
  assert.throws(() => toVevent({ ...master, isAllDay: false }));
  for (const line of ["RDATE;TZID=Europe/Prague:20260402T090000", "RDATE;VALUE=PERIOD:20260402T090000Z/PT1H", "EXDATE;VALUE=DATE;TZID=UTC:20260330", "EXDATE:20260230T000000Z"]) assert.throws(() => toVevent({ ...master, recurrence: "RRULE:FREQ=DAILY;COUNT=4\n" + line }));
  // This is the exact legacy update preflight path used by assertEventWrite.
  // Typed refusal survives engine preflight's catch (plain errors become unknown
  // permission); the preserving writer must not return a native PUT payload.
  const unsupported = (error: unknown) => error instanceof EventWriteError && error.capability === "recurrence" && error.reason === "unsupported";
  for (const line of ['EXDATE;VALUE=DATE:20260230', 'RDATE;VALUE=PERIOD:20260402T090000Z/PT1H', 'EXDATE:20260230T000000Z']) {
    const invalidMaster = { ...master, timeModel: undefined, recurrence: "RRULE:FREQ=DAILY;COUNT=4\n" + line };
    assert.throws(() => toVevent(invalidMaster), unsupported);
    assert.throws(() => patchEventIcal(exported, invalidMaster, master.id, { title: "Changed title" }), unsupported);
  }
  // Existing bare DATE-TIME export behavior remains UTC, including all-day conversion.
  const timed = toVevent({ ...master, isAllDay: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4\nEXDATE:20260330T090000Z\nRDATE:20260402T090000" }).toString();
  assert.match(timed, /EXDATE:20260330T090000Z/); assert.match(timed, /RDATE:20260402T090000Z/);
  assert.match(toVevent({ ...master, recurrence: "RRULE:FREQ=DAILY;COUNT=4\nEXDATE:20260330T000000Z" }).toString(), /EXDATE;VALUE=DATE:20260330/);
  console.log("Calendar DATE export/import serializer: finite COUNT, excluded DTSTART, added dates, exact visible membership, malformed refusal and DATE-TIME compatibility: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
