import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

async function main() {
  const {
    icalToNormalized,
    icalToNormalizedTask,
    patchEventIcal,
    patchTaskIcal,
    toCaldavTaskObject,
    toVtodo,
    vtodoToFields,
  } = await import("./caldav");
  const { createCalendarObject, deleteCalendarObject, updateCalendarObject } =
    await import("tsdav");

  const data = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:remote-uid@example.com",
    "DTSTART:20260101T100000Z",
    "DTEND:20260101T110000Z",
    "SUMMARY:Imported",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const imported = icalToNormalized({
    url: "https://dav.example/cal/imported.ics",
    etag: '"remote-v1"',
    data,
  });
  assert.equal(imported?.icalUid, "remote-uid@example.com");
  assert.equal(
    icalToNormalized({
      url: "https://dav.example/cal/cancelled.ics",
      data: data.replace(
        "SUMMARY:Imported",
        "STATUS:CANCELLED\r\nSUMMARY:Imported",
      ),
    })?.status,
    "cancelled",
  );

  const compatibilityData = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Prague",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:series@example.com",
    "DTSTART;TZID=Europe/Prague:20260101T100000",
    "DTEND;TZID=Europe/Prague:20260101T110000",
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:Series",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "DESCRIPTION:Keep me",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:series@example.com",
    "RECURRENCE-ID;TZID=Europe/Prague:20260108T100000",
    "DTSTART;TZID=Europe/Prague:20260108T120000",
    "DTEND;TZID=Europe/Prague:20260108T130000",
    "SUMMARY:Moved occurrence",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:series@example.com",
    "RECURRENCE-ID;TZID=Europe/Prague:20260115T100000",
    "DTSTART;TZID=Europe/Prague:20260115T130000",
    "DTEND;TZID=Europe/Prague:20260115T140000",
    "SUMMARY:Second moved occurrence",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const compatibleEvent = icalToNormalized({
    url: "https://dav.example/cal/series.ics",
    data: compatibilityData,
  });
  assert.equal(
    compatibleEvent?.start.toISOString(),
    "2026-01-01T09:00:00.000Z",
  );
  assert.match(compatibleEvent?.recurrence ?? "", /EXDATE:20260108T090000Z/);
  assert.match(compatibleEvent?.recurrence ?? "", /RDATE:20260108T110000Z/);

  const taskData = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTODO",
    "UID:remote-task@example.com",
    "DTSTART;VALUE=DATE:20260201",
    "DUE;VALUE=DATE:20260203",
    "COMPLETED:20260202T120000Z",
    "SUMMARY:Ship task sync",
    "DESCRIPTION:Keep the UID and ETag",
    "STATUS:COMPLETED",
    "PERCENT-COMPLETE:100",
    "PRIORITY:3",
    "SEQUENCE:4",
    "RRULE:FREQ=WEEKLY",
    "EXDATE;VALUE=DATE:20260208",
    "RELATED-TO:parent-task@example.com",
    "URL:https://example.com/tasks/1",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT30M",
    "DESCRIPTION:Keep task alarm",
    "END:VALARM",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");
  const importedTask = icalToNormalizedTask({
    url: "https://dav.example/cal/task.ics",
    etag: '"task-v1"',
    data: taskData,
  });
  assert.ok(importedTask);
  assert.equal(importedTask.icalUid, "remote-task@example.com");
  assert.equal(importedTask.status, "completed");
  assert.equal(importedTask.isAllDay, true);
  assert.equal(importedTask.due?.toISOString(), "2026-02-03T00:00:00.000Z");
  assert.equal(
    importedTask.completedAt?.toISOString(),
    "2026-02-02T12:00:00.000Z",
  );
  assert.equal(importedTask.percentComplete, 100);
  assert.equal(importedTask.priority, 3);
  assert.equal(importedTask.sequence, 4);
  assert.match(importedTask.recurrence ?? "", /RRULE:FREQ=WEEKLY/);
  assert.match(importedTask.recurrence ?? "", /EXDATE:20260208T000000Z/);

  const serializedTask = toVtodo(
    { id: "local-task", ...importedTask },
    importedTask.icalUid ?? undefined,
  );
  assert.equal(
    serializedTask.getFirstPropertyValue("uid"),
    "remote-task@example.com",
  );
  assert.equal(serializedTask.getFirstPropertyValue("status"), "COMPLETED");
  assert.deepEqual(vtodoToFields(serializedTask), {
    title: importedTask.title,
    description: importedTask.description,
    status: importedTask.status,
    start: importedTask.start,
    due: importedTask.due,
    isAllDay: importedTask.isAllDay,
    completedAt: importedTask.completedAt,
    percentComplete: importedTask.percentComplete,
    priority: importedTask.priority,
    recurrence: importedTask.recurrence,
    relatedTo: importedTask.relatedTo,
    sequence: importedTask.sequence,
    url: importedTask.url,
  });

  const undatedTask = icalToNormalizedTask({
    url: "https://dav.example/cal/undated.ics",
    data: [
      "BEGIN:VCALENDAR",
      "BEGIN:VTODO",
      "UID:undated@example.com",
      "SUMMARY:No deadline",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n"),
  });
  assert.equal(undatedTask?.start, null);
  assert.equal(undatedTask?.due, null);
  assert.equal(undatedTask?.status, "needs-action");

  const event = {
    id: "local-id",
    creatorID: "user-id",
    organizer: "user@example.com",
    title: "Edited",
    color: "#123456",
    start: new Date("2026-01-01T10:00:00Z"),
    end: new Date("2026-01-01T11:00:00Z"),
    calendars: ["calendar-id"],
    originCalendarID: "calendar-id",
    isCanceled: false,
    isAllDay: false,
    hasAttendees: false,
    description: null,
    location: null,
    recurrence: compatibleEvent!.recurrence,
    url: null,
  };
  const patchedEventData = patchEventIcal(
    compatibilityData,
    event,
    "series@example.com",
    { title: event.title, start: event.start, end: event.end },
  );
  assert.match(patchedEventData, /BEGIN:VTIMEZONE/);
  assert.match(patchedEventData, /BEGIN:VALARM/);
  assert.match(patchedEventData, /DTSTART;TZID=Europe\/Prague:20260101T110000/);
  assert.equal(
    patchedEventData.match(/RECURRENCE-ID;TZID=Europe\/Prague/g)?.length,
    2,
  );
  assert.doesNotMatch(patchedEventData, /^RDATE:/m);

  const calendarObject = {
    url: "https://dav.example/cal/imported.ics",
    data: patchEventIcal(data, event, imported!.icalUid!, { title: event.title }),
    etag: '"remote-v1"',
  };
  assert.equal(calendarObject.etag, '"remote-v1"');
  assert.match(calendarObject.data, /UID:remote-uid@example\.com/);

  const task = {
    id: "local-task",
    creatorID: "user-id",
    calendarID: "calendar-id",
    ...importedTask,
  };
  const patchedTaskData = patchTaskIcal(
    taskData,
    task,
    "remote-task@example.com",
  );
  assert.match(patchedTaskData, /BEGIN:VALARM/);
  assert.throws(
    () => toCaldavTaskObject("https://dav.example/cal/task.ics", task),
    /no ETag/,
  );
  const taskCalendarObject = toCaldavTaskObject(
    "https://dav.example/cal/task.ics",
    task,
    {
      externalTaskId: "https://dav.example/cal/task.ics",
      etag: '"task-v1"',
      icalUid: importedTask.icalUid,
    },
  );
  assert.match(taskCalendarObject.data, /UID:remote-task@example\.com/);

  const requests: Array<{ method: string; headers: Headers }> = [];
  const fetchMock: typeof fetch = async (_input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    });
    return new Response(null, {
      status: 204,
      headers: { etag: '"remote-v2"' },
    });
  };

  await updateCalendarObject({ calendarObject, fetch: fetchMock });
  await deleteCalendarObject({ calendarObject, fetch: fetchMock });
  await createCalendarObject({
    calendar: { url: "https://dav.example/cal/" },
    filename: "new.ics",
    iCalString: calendarObject.data,
    fetch: fetchMock,
  });
  await updateCalendarObject({
    calendarObject: taskCalendarObject,
    fetch: fetchMock,
  });
  await deleteCalendarObject({
    calendarObject: taskCalendarObject,
    fetch: fetchMock,
  });

  assert.deepEqual(
    requests.map(({ method, headers }) => [
      method,
      headers.get("if-match"),
      headers.get("if-none-match"),
    ]),
    [
      ["PUT", '"remote-v1"', null],
      ["DELETE", '"remote-v1"', null],
      ["PUT", null, "*"],
      ["PUT", '"task-v1"', null],
      ["DELETE", '"task-v1"', null],
    ],
  );

  console.log("caldav adapter tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
