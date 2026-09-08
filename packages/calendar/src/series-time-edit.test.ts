import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventSchema, eventUpdateOperation } from "@musubi/types";
import { expandRecurringEvents } from "./recurrence";
import { resolveEventTimeEdit } from "./time-edit";
import { editEventTimeDraft, knownEventTimeDraft } from "./time-draft";
import { seriesEditWrites, withSeriesEditIntent } from "./recurrence-edit";

if (!process.env.MUSUBI_SERIES_TIME_CHILD) {
  for (const TZ of ["UTC", "Europe/Prague", "America/New_York"]) {
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", import.meta.filename],
      {
        env: { ...process.env, TZ, MUSUBI_SERIES_TIME_CHILD: "1" },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, child.stdout + child.stderr);
  }
} else {
  assert.equal(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    process.env.TZ,
  );
  for (const kind of ["zoned", "floating", "all-day"] as const) {
    const master = EventSchema.parse({
      id: "00000000-0000-4000-8000-000000000154",
      revision: 7,
      title: "Series",
      color: "red",
      isCanceled: false,
      creatorID: "owner",
      organizer: "owner",
      calendars: ["home"],
      recurrence: "FREQ=DAILY;COUNT=5",
      ...resolveEventTimeEdit(
        kind === "all-day"
          ? { kind, startDate: "2026-03-28", endDate: "2026-03-28" }
          : {
              kind,
              ...(kind === "zoned" ? { timeZone: "Europe/Prague" } : {}),
              startLocal: "2026-03-28T09:30:17.123",
              endLocal: "2026-03-28T10:30:19.456",
            },
      ),
    });
    const occurrence = expandRecurringEvents(
      [master],
      new Date("2026-03-29T00:00Z"),
      new Date("2026-03-30T00:00Z"),
      { consumerTimeZone: "America/New_York" },
    ).find((item) => knownEventTimeDraft(item)!.date === "2026-03-29")!;
    const draft = knownEventTimeDraft(occurrence)!;
    assert.equal(draft.date, "2026-03-29");
    const edited = editEventTimeDraft(
      occurrence,
      { ...occurrence, title: "Together" },
      { ...draft, date: "2026-03-30", endDate: "2026-03-30" },
    );
    for (const scope of ["occurrence", "following"] as const)
      assert.throws(
        () => seriesEditWrites({ master, occurrence, edited, scope }),
        /Only the whole series/,
      );
    assert.throws(
      () =>
        seriesEditWrites({
          master: { ...master, revision: 8 },
          occurrence,
          edited,
          scope: "series",
        }),
      /series changed/,
    );
    const writes = withSeriesEditIntent(
      seriesEditWrites({ master, occurrence, edited, scope: "series" }),
    );
    assert.equal(writes.creates.length, 0);
    assert.equal(writes.updates.length, 1);
    assert.equal("scopeEdit" in writes.updates[0]!, false);
    const operation = eventUpdateOperation(writes.updates[0]!);
    assert.equal(operation.method, "PUT");
    assert.equal(operation.path, `/events/${master.id}/time`);
    assert.equal(
      writes.updates[0]!.start.toISOString(),
      kind === "zoned"
        ? "2026-03-29T07:30:17.123Z"
        : kind === "floating"
          ? "2026-03-29T09:30:17.123Z"
          : "2026-03-29T00:00:00.000Z",
    );
    assert.equal(writes.updates[0]!.recurrence, master.recurrence);
    assert.deepEqual(operation.body, {
      expectedRevision: 7,
      patch: { title: "Together" },
      time:
        kind === "all-day"
          ? { kind, startDate: "2026-03-29", endDate: "2026-03-29" }
          : {
              kind,
              ...(kind === "zoned" ? { timeZone: "Europe/Prague" } : {}),
              startLocal: "2026-03-29T09:30:17.123",
              endLocal: "2026-03-29T10:30:19.456",
            },
    });
    assert.throws(
      () =>
        editEventTimeDraft(master, master, {
          ...knownEventTimeDraft(master)!,
          date: "2026-03-29",
          timeKind: kind === "all-day" ? "floating" : "all-day",
          isAllDay: kind !== "all-day",
        }),
      /Only the whole series/,
    );
    const dated = {
      ...master,
      recurrence: master.recurrence + "\nEXDATE:20260329T073017Z",
    };
    assert.throws(
      () =>
        editEventTimeDraft(dated, dated, {
          ...knownEventTimeDraft(dated)!,
          date: "2026-03-29",
        }),
      /Only the whole series/,
    );
    for (const recurrence of [
      "RDATE;TZID=Europe/Prague:20260401T093000",
      "RDATE;VALUE=DATE:20260401",
    ]) {
      const datedOnly = { ...master, recurrence };
      assert.throws(
        () =>
          editEventTimeDraft(datedOnly, datedOnly, {
            ...knownEventTimeDraft(datedOnly)!,
            date: "2026-03-29",
          }),
        /Only the whole series/,
      );
    }
    assert.equal(master.revision, 7);
  }
}
console.log("Whole-series civil shifts across three host zones: OK");
