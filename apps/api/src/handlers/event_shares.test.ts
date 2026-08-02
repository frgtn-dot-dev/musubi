import assert from "node:assert/strict";
import {
  publicEventProjection,
  type SharedEventRow,
} from "./event_shares";

const BASE: SharedEventRow = {
  description: "Come see the presses.",
  end: new Date("2026-08-20T18:00:00.000Z"),
  indexable: false,
  isAllDay: false,
  isCanceled: false,
  location: "Brno",
  organizerName: "Sharer",
  recurrence: null,
  start: new Date("2026-08-20T15:00:00.000Z"),
  title: "Studio open day",
  url: null,
};

// ── What a stranger can see ──────────────────────────────────────────────────
// The whole point of a published page is that it is readable without a session,
// so the key set IS the security boundary. Pinned exactly: a column added to the
// query behind this must not arrive on the public page because someone spread a
// row into the response.
{
  const projection = publicEventProjection(BASE);

  assert.deepEqual(Object.keys(projection).sort(), [
    "description",
    "end",
    "indexable",
    "isAllDay",
    "isCanceled",
    "location",
    "organizer",
    "recurrence",
    "start",
    "title",
    "url",
  ]);

  // Named individually, because these are the ones that would hurt: who else is
  // coming, which calendar it lives in, and any id that could be used to ask the
  // API for more.
  for (const forbidden of [
    "attendees",
    "calendarId",
    "calendars",
    "creatorID",
    "eventId",
    "id",
    "organizerEmail",
    "token",
    "userId",
  ]) {
    assert.equal(
      forbidden in projection,
      false,
      `${forbidden} must never reach a public event page`,
    );
  }

  // The organizer is a display name, never an address.
  assert.equal(projection.organizer, "Sharer");
  assert.equal(JSON.stringify(projection).includes("@"), false);
}

// ── A recurring event ships its rule, not an expansion ──────────────────────
// Recurrence is wall-clock: expanding it here would answer in the server's
// timezone, and a UTC container would tell a reader in Prague the wrong hour
// after a daylight-saving change. The page expands it in the reader's own zone,
// which is the same frame every other Musubi surface uses.
{
  const weekly: SharedEventRow = {
    ...BASE,
    end: new Date("2026-01-06T18:00:00.000Z"),
    recurrence: "FREQ=WEEKLY",
    start: new Date("2026-01-06T15:00:00.000Z"),
  };
  const projection = publicEventProjection(weekly);

  assert.equal(projection.recurrence, "FREQ=WEEKLY");
  assert.equal(projection.start, "2026-01-06T15:00:00.000Z");
  assert.equal(projection.end, "2026-01-06T18:00:00.000Z");
}

// A one-off says so with a null, so the page never has to guess.
assert.equal(publicEventProjection(BASE).recurrence, null);

// ── A cancelled event still has a page ───────────────────────────────────────
// Someone holding the link needs to learn it is off; a 404 would read as a
// broken link and send them asking.
{
  const projection = publicEventProjection({ ...BASE, isCanceled: true });
  assert.equal(projection.isCanceled, true);
  assert.equal(projection.title, "Studio open day");
}

console.log("event share projection self-check: OK");
