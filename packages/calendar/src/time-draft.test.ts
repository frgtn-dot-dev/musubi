import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  EventSchema,
  eventUpdateOperation,
  eventPatchRequest,
} from "@musubi/types";
import {
  knownEventTimeDraft,
  legacyEventTimeDraft,
  chooseEventTimeKind,
  editEventTimeDraft,
} from "./time-draft";
import { resolveEventTimeEdit } from "./time-edit";

if (!process.env.MUSUBI_DRAFT_TZ_CHILD) {
  for (const TZ of ["UTC", "Europe/Prague", "America/New_York"]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", import.meta.filename],
      {
        env: { ...process.env, TZ, MUSUBI_DRAFT_TZ_CHILD: "1" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
} else {
  assert.equal(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    process.env.TZ,
  );
  const allDay = EventSchema.parse({
    ...resolveEventTimeEdit({
      kind: "all-day",
      startDate: "2026-03-28",
      endDate: "2026-03-29",
    }),
    id: "00000000-0000-4000-8000-000000000152",
    revision: 1,
    title: "Dates",
    color: "red",
    creatorID: "owner",
    organizer: "owner",
    calendars: ["home"],
    isCanceled: false,
  });
  const dateWrite = editEventTimeDraft(allDay, allDay, {
    ...knownEventTimeDraft(allDay)!,
    endDate: "2026-03-30",
  });
  assert.equal(dateWrite.end.toISOString(), "2026-03-30T00:00:00.000Z");
  assert.deepEqual(eventUpdateOperation(dateWrite).body, {
    expectedRevision: 1,
    time: { kind: "all-day", startDate: "2026-03-28", endDate: "2026-03-30" },
    patch: {},
  });
  const legacy = EventSchema.parse({
    ...allDay,
    isAllDay: false,
    start: "2026-03-29T08:30:17.123Z",
    end: "2026-03-29T09:30:19.456Z",
    timeModel: null,
  });
  const visible = legacyEventTimeDraft(legacy);
  assert.equal(visible.timeKind, "legacy-unknown");
  assert.equal(visible.timeZone, undefined);
  const choosing = chooseEventTimeKind(visible, "zoned");
  assert.throws(
    () => editEventTimeDraft(legacy, legacy, choosing),
    /explicit event time zone/,
  );
  const adopted = editEventTimeDraft(
    legacy,
    { ...legacy, title: "Explicit choice" },
    { ...choosing, timeZone: " Europe/Prague " },
  );
  const adoption = eventUpdateOperation(adopted).body;
  assert.equal(
    "time" in adoption &&
      adoption.time.kind === "zoned" &&
      adoption.time.timeZone,
    "Europe/Prague",
  );
  assert.equal(
    "time" in adoption &&
      adoption.time.kind === "zoned" &&
      adoption.time.startLocal,
    `${visible.date}T${visible.startTime}:17.123`,
  );
  assert.equal(adopted.revision, legacy.revision);
  assert.equal(
    eventUpdateOperation(
      editEventTimeDraft(legacy, { ...legacy, title: "Legacy title" }, visible),
    ).method,
    "PATCH",
  );
  const dates = editEventTimeDraft(
    legacy,
    legacy,
    chooseEventTimeKind(visible, "all-day"),
  );
  assert.equal(dates.start.toISOString(), `${visible.date}T00:00:00.000Z`);
  assert.deepEqual(dates.timeModel, { kind: "all-day" });
  const floating = editEventTimeDraft(allDay, allDay, {
    ...chooseEventTimeKind(knownEventTimeDraft(allDay)!, "floating"),
    startTime: "09:00",
    endTime: "10:00",
  });
  assert.equal(floating.timeModel?.kind, "floating");
  assert.equal(floating.start.toISOString(), "2026-03-28T09:00:00.000Z");
  assert.throws(
    () =>
      editEventTimeDraft(allDay, allDay, {
        ...knownEventTimeDraft(allDay)!,
        timeKind: "legacy-unknown",
      }),
    /cannot be removed/,
  );
  for (const kind of ["zoned", "floating"] as const) {
    const time = {
      kind,
      ...(kind === "zoned" ? { timeZone: "Europe/Prague" } : {}),
      startLocal: "2026-03-29T02:30:17.123",
      endLocal: "2026-03-29T04:30:19.456",
    };
    const event = EventSchema.parse({
      ...resolveEventTimeEdit(time),
      id: "00000000-0000-4000-8000-000000000151",
      revision: 3,
      title: "Before",
      color: "red",
      creatorID: "owner",
      organizer: "owner",
      calendars: ["home"],
      isCanceled: false,
    });
    const draft = knownEventTimeDraft(event)!;
    assert.equal(draft.startTime, "02:30");
    if (kind === "zoned") {
      const recurring = { ...event, recurrence: "FREQ=DAILY" };
      assert.equal(
        eventUpdateOperation(
          editEventTimeDraft(
            recurring,
            { ...recurring, title: "Padded same zone" },
            { ...draft, timeZone: " Europe/Prague " },
          ),
        ).method,
        "PATCH",
      );
    }
    assert.deepEqual(
      eventUpdateOperation(
        editEventTimeDraft(event, { ...event, title: "Title only" }, draft),
      ).body,
      { id: event.id, expectedRevision: 3, patch: { title: "Title only" } },
    );
    const saved = editEventTimeDraft(
      event,
      { ...event, title: "Together" },
      { ...draft, date: "2026-03-30", endDate: "2026-03-30" },
    );
    const operation = eventUpdateOperation(saved);
    assert.equal(operation.method, "PUT");
    assert.equal(operation.path, `/events/${event.id}/time`);
    assert.deepEqual(operation.body, {
      expectedRevision: 3,
      time: {
        ...time,
        startLocal: "2026-03-30T02:30:17.123",
        endLocal: "2026-03-30T04:30:19.456",
      },
      patch: { title: "Together" },
    });
    assert.throws(() => eventPatchRequest(saved), /atomic time edit/);
    assert.throws(
      () =>
        eventUpdateOperation({
          ...saved,
          contentPatch: { ...saved.contentPatch, calendars: ["elsewhere"] },
        }),
      /separately/,
    );
    assert.throws(
      () => editEventTimeDraft(event, event, { ...draft, date: "invalid" }),
      /valid time zone/,
    );

  }
}
console.log("Civil editor drafts and atomic transport across host zones: OK");
