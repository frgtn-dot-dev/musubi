import assert from "node:assert/strict";
import { describeChange } from "./event_notifications";
import { planDeliveries, toEventChange, wants } from "./notification_dispatch";

// Two decisions decide whether this feature is useful or a reason to filter
// Musubi into a folder: what counts as news, and who hears about it.

const base = {
  end: new Date("2026-08-20T10:00:00Z"),
  id: "event-1",
  isAllDay: false,
  isCanceled: false,
  start: new Date("2026-08-20T09:00:00Z"),
  title: "Standup",
};

// ── What counts as news ──────────────────────────────────────────────────────

{
  // Editing the words is not news. This is the assertion that keeps a shared
  // calendar from mailing thirty people because somebody fixed a typo.
  assert.equal(
    describeChange(base, { ...base, title: "Standup (daily)" }),
    null,
  );
}

{
  const moved = describeChange(base, {
    ...base,
    end: new Date("2026-08-20T12:00:00Z"),
    start: new Date("2026-08-20T11:00:00Z"),
  });
  assert.equal(moved?.kind, "moved");
  assert.equal(
    moved?.wasStart,
    base.start.toISOString(),
    "a move says where from",
  );
}

{
  // The end moving alone is still a move — an hour becoming three changes
  // whether you can make it.
  const longer = describeChange(base, {
    ...base,
    end: new Date("2026-08-20T12:00:00Z"),
  });
  assert.equal(longer?.kind, "moved");
}

{
  const cancelled = describeChange(base, { ...base, isCanceled: true });
  assert.equal(cancelled?.kind, "cancelled");

  // Already cancelled and then edited: nothing further to announce.
  assert.equal(
    describeChange(
      { ...base, isCanceled: true },
      { ...base, isCanceled: true, title: "x" },
    ),
    null,
  );

  // Un-cancelling is silent by design — "it is back on" after "it is off"
  // reads as noise unless somebody asked for it.
  assert.equal(describeChange({ ...base, isCanceled: true }, base), null);
}

// ── Who hears about it ───────────────────────────────────────────────────────

{
  assert.equal(
    wants(null, "event_changed"),
    true,
    "no settings row means defaults",
  );
  assert.equal(
    wants({ eventChanged: false, pollDecided: true }, "event_changed"),
    false,
  );
  // A kind this build does not know is a newer server's row. Staying quiet is
  // the failure nobody notices; sending is the one that annoys somebody.
  assert.equal(wants(null, "something_later"), false);
}

{
  const row = (over: Record<string, unknown> = {}) => ({
    dueAt: new Date("2026-08-20T08:00:00Z"),
    email: "filip@example.com",
    id: "row-1",
    kind: "event_changed",
    name: "Filip",
    notificationEmails: null,
    payload: {
      isAllDay: false,
      kind: "moved",
      start: base.start.toISOString(),
      title: "Standup",
    },
    subjectID: "event-1",
    timezone: "Europe/Prague",
    userID: "user-1",
    ...over,
  });

  // Two changes for one person are one email, not two.
  const { deliveries } = planDeliveries([
    row(),
    row({ id: "row-2", subjectID: "event-2" }),
  ]);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]!.changes.length, 2);
  assert.deepEqual(deliveries[0]!.ids, ["row-1", "row-2"]);
}

{
  // Somebody who switched it off still has their rows cleared, or the drain
  // re-reads them on every pass until the end of time.
  const { deliveries, discard } = planDeliveries([
    {
      dueAt: new Date(),
      email: "no@example.com",
      id: "row-9",
      kind: "event_changed",
      name: "Nope",
      notificationEmails: { eventChanged: false, pollDecided: true },
      payload: {
        isAllDay: false,
        kind: "moved",
        start: base.start.toISOString(),
        title: "x",
      },
      subjectID: "event-1",
      timezone: "UTC",
      userID: "user-2",
    },
  ]);
  assert.deepEqual(deliveries, []);
  assert.deepEqual(discard, ["row-9"]);
}

// ── On whose clock ───────────────────────────────────────────────────────────

{
  const payload = {
    isAllDay: false,
    kind: "moved" as const,
    start: "2026-08-20T09:00:00Z",
    title: "Standup",
    wasStart: "2026-08-20T07:00:00Z",
  };
  assert.match(toEventChange(payload, "Europe/Prague").when!, /11:00/);
  assert.match(toEventChange(payload, "America/New_York").when!, /05:00/);
}

{
  // An all-day event is a timezone-invariant DATE at UTC midnight. Rendering it
  // on the reader's clock would move a birthday to the day before.
  const birthday = {
    isAllDay: true,
    kind: "moved" as const,
    start: "2026-08-20T00:00:00Z",
    title: "Birthday",
  };
  for (const zone of ["Pacific/Auckland", "America/Los_Angeles"]) {
    assert.match(toEventChange(birthday, zone).when!, /20 August 2026/);
  }
}

console.log("event_notifications.test.ts ok");
