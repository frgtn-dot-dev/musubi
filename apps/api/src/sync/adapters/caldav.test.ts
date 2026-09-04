import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

async function main() {
  const {
    icalToNormalized,
    icalToNormalizedTask,
    toCaldavCalendarObject,
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
    recurrence: null,
    url: null,
  };
  assert.throws(
    () => toCaldavCalendarObject("https://dav.example/cal/imported.ics", event),
    /no ETag/,
  );

  const calendarObject = toCaldavCalendarObject(
    "https://dav.example/cal/imported.ics",
    event,
    {
      externalEventId: "https://dav.example/cal/imported.ics",
      etag: '"remote-v1"',
      icalUid: imported!.icalUid,
    },
  );
  assert.equal(calendarObject.etag, '"remote-v1"');
  assert.match(calendarObject.data, /UID:remote-uid@example\.com/);

  const task = {
    id: "local-task",
    creatorID: "user-id",
    calendarID: "calendar-id",
    ...importedTask,
  };
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
