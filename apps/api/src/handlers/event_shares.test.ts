import assert from "node:assert/strict";
import {
  publicEventProjection,
  requireVerifiedRsvpUser,
  rsvpSummaryOf,
  type SharedEventRow,
} from "./event_shares";

assert.throws(
  () => requireVerifiedRsvpUser({ emailVerified: false }),
  (error: any) => error?.kind === "Forbidden",
);
assert.doesNotThrow(() => requireVerifiedRsvpUser({ emailVerified: true }));

const BASE: SharedEventRow = {
  creatorID: "organizer-1",
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
    "content",
    "coverUrl",
    "description",
    "end",
    "indexable",
    "isAllDay",
    "isCanceled",
    "location",
    "mapImageUrl",
    "organizer",
    "recurrence",
    "start",
    "theme",
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

  // The look is part of the page, and it always parses to a complete, valid
  // theme — an older row with no theme at all still renders as the default
  // rather than as nothing.
  assert.deepEqual(projection.theme, {
    cover: "none",
    font: "serif",
    layout: "classic",
    palette: "sand",
  });

  // The organizer is a display name and public avatar URL, never an address.
  assert.equal(projection.organizer.name, "Sharer");
  assert.match(projection.organizer.avatarUrl, /\/users\/organizer-1\/avatar$/);
  assert.equal(projection.coverUrl, null);
  assert.equal(JSON.stringify(projection).includes("@"), false);
}

{
  const projection = publicEventProjection(
    {
      ...BASE,
      content: {
        agenda: [
          {
            description: "Welcome",
            id: "doors",
            time: "18:00",
            title: "Doors",
          },
        ],
        cover: { focalX: 25, focalY: 70, source: "upload" },
        tags: ["Community"],
      },
    },
    "public-token",
  );
  assert.deepEqual(projection.content.tags, ["Community"]);
  assert.match(projection.coverUrl!, /\/public\/events\/public-token\/cover$/);
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

// ── The summary a page reports ───────────────────────────────────────────────
// One list, one count: attendance from the app and answers from the page are the
// same rows, so a published event cannot report two different numbers.
const ANSWERS = [
  { name: "Zoe", status: "going", userID: "u-1" },
  { name: "Bea", status: "maybe", userID: "u-2" },
  { name: "Cyril", status: "declined", userID: "u-3" },
  { name: "Adam", status: "going", userID: "u-4" },
];

{
  const summary = rsvpSummaryOf({
    answers: ANSWERS,
    userID: "u-2",
    visibility: "names",
  });

  assert.deepEqual(summary.counts, { declined: 1, going: 2, maybe: 1 });
  assert.equal(summary.mine, "maybe");
  // Alphabetical, and only the yeses: a maybe and a no are answers people give
  // in confidence.
  assert.deepEqual(summary.names, ["Adam", "Zoe"]);
  assert.deepEqual(
    summary.attendees.map(({ name }) => name),
    ["Adam", "Zoe"],
  );
  assert.match(summary.attendees[0]!.avatarUrl, /\/users\/u-4\/avatar$/);
}

// Counts without names is the default, and a reader who never answered has no
// answer of their own rather than a made-up one.
{
  const summary = rsvpSummaryOf({
    answers: ANSWERS,
    userID: "nobody",
    visibility: "counts",
  });

  assert.equal(summary.mine, null);
  assert.deepEqual(summary.names, []);
  assert.deepEqual(summary.attendees, []);
  assert.deepEqual(summary.counts, { declined: 1, going: 2, maybe: 1 });
}

// Rows from before a name was required must still read as a person.
{
  const summary = rsvpSummaryOf({
    answers: [{ name: "  ", status: "going", userID: "u-5" }],
    userID: "u-5",
    visibility: "names",
  });

  assert.deepEqual(summary.names, ["Guest"]);
}

// Nobody yet is an empty list, not a missing one — the page renders either.
{
  const empty = rsvpSummaryOf({
    answers: [],
    userID: "u-1",
    visibility: "names",
  });
  assert.deepEqual(empty.counts, { declined: 0, going: 0, maybe: 0 });
  assert.deepEqual(empty.names, []);
  assert.deepEqual(empty.attendees, []);
  assert.equal(empty.mine, null);
}

console.log("event share projection self-check: OK");
