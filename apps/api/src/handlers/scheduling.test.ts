import assert from "node:assert/strict";
import {
  bestSlots,
  parseApproximateStartTime,
  pollCalendarProjection,
  pollProjection,
  pollSlotEventTiming,
} from "./scheduling";

assert.equal(parseApproximateStartTime(undefined), null);
assert.equal(parseApproximateStartTime(" 18:30 "), "18:30");
assert.throws(() => parseApproximateStartTime("25:00"));

const POLL = {
  approximateStartTime: "18:30",
  chosenSlotID: null,
  closedAt: null,
  deadline: null,
  description: "Which afternoon suits everyone?",
  durationMinutes: 60,
  title: "Studio planning",
};

const SLOTS = [
  {
    end: new Date("2026-08-18T14:00:00.000Z"),
    id: "slot-tue",
    start: new Date("2026-08-18T13:00:00.000Z"),
  },
  {
    end: new Date("2026-08-19T14:00:00.000Z"),
    id: "slot-wed",
    start: new Date("2026-08-19T13:00:00.000Z"),
  },
];

// A decided slot becomes one inclusive all-day date; its meeting time and old
// duration never leak into the event.
assert.deepEqual(
  pollSlotEventTiming(new Date("2026-08-18T13:00:00.000Z")),
  {
    end: new Date("2026-08-18T00:00:00.000Z"),
    isAllDay: true,
    start: new Date("2026-08-18T00:00:00.000Z"),
  },
);

// ── A deadline shuts the poll without anything having to run ────────────────
{
  const past = { ...POLL, deadline: new Date(Date.now() - 60_000) };
  const future = { ...POLL, deadline: new Date(Date.now() + 60_000) };
  assert.equal(pollProjection(past, SLOTS, []).closed, true);
  assert.equal(pollProjection(future, SLOTS, []).closed, false);
  // Closed by hand still reads as closed, deadline or none.
  assert.equal(
    pollProjection({ ...POLL, closedAt: new Date() }, SLOTS, []).closed,
    true,
  );
}

// ── What a participant sees ──────────────────────────────────────────────────
// Names and answers, because a poll is people coordinating with each other.
// Nothing about anybody's calendar: availability is worked out in the
// participant's own browser and only the answers are ever sent.
{
  const votes = [
    { email: "zoe@example.com", name: "Zoe", participantID: "p1", slotID: "slot-tue", value: "yes" },
    { email: "adam@example.com", name: "Adam", participantID: "p2", slotID: "slot-tue", value: "if-needed" },
    { email: "guest@example.com", name: "", participantID: "p3", slotID: "slot-tue", value: "no" },
    { email: "zoe@example.com", name: "Zoe", participantID: "p1", slotID: "slot-wed", value: "yes" },
    { email: "adam@example.com", name: "Adam", participantID: "p2", slotID: "slot-wed", value: "yes" },
  ];
  const projection = pollProjection(POLL, SLOTS, votes);

  assert.deepEqual(Object.keys(projection).sort(), [
    "approximateStartTime",
    "chosenSlotID",
    "closed",
    "deadline",
    "description",
    "durationMinutes",
    "mine",
    "mineID",
    "people",
    "respondents",
    "slots",
    "title",
  ]);

  assert.equal(projection.approximateStartTime, "18:30");

  const [tuesday, wednesday] = projection.slots;
  assert.deepEqual(tuesday!.yes, ["Zoe"]);
  assert.deepEqual(tuesday!.ifNeeded, ["Adam"]);
  // A nameless account still appears rather than vanishing from the tally.
  assert.deepEqual(tuesday!.no, ["Guest"]);
  assert.deepEqual(wednesday!.yes, ["Adam", "Zoe"]);
  // Three people answered, five votes — a respondent is a person, not a click.
  assert.equal(projection.respondents, 3);

  // One row per person, for the grid: names and answers, never a user id, and
  // never a calendar.
  assert.deepEqual(projection.people, [
    { answers: { "slot-tue": "yes", "slot-wed": "yes" }, id: "1", name: "Zoe" },
    {
      answers: { "slot-tue": "if-needed", "slot-wed": "yes" },
      id: "2",
      name: "Adam",
    },
    { answers: { "slot-tue": "no" }, id: "3", name: "Guest" },
  ]);
  assert.ok(
    !JSON.stringify(projection).includes("zoe@example.com"),
    "a projection must not carry emails to strangers holding the link",
  );

  // Nobody signed in: no row is theirs, and no answers are theirs.
  assert.equal(projection.mineID, null);
  assert.deepEqual(projection.mine, {});

  // Signed in: their own row is named, so the grid can show it once and let them
  // edit it rather than printing them twice.
  const asAdam = pollProjection(POLL, SLOTS, votes, "adam@example.com");
  assert.equal(asAdam.mineID, "2");
  assert.deepEqual(asAdam.mine, { "slot-tue": "if-needed", "slot-wed": "yes" });

  // Somebody who has not answered yet is nobody's row.
  assert.equal(pollProjection(POLL, SLOTS, votes, "new@example.com").mineID, null);

  // Two people with one name stay two rows — a poll of Jans is still a poll of
  // people, and merging them would lose an answer.
  const jans = pollProjection(POLL, SLOTS, [
    { email: "a@example.com", name: "Jan", participantID: "a", slotID: "slot-tue", value: "yes" },
    { email: "b@example.com", name: "Jan", participantID: "b", slotID: "slot-tue", value: "no" },
  ]);
  assert.equal(jans.people.length, 2);
  assert.deepEqual(
    jans.people.map((person) => person.answers["slot-tue"]),
    ["yes", "no"],
  );
}

// ── Calendar projection ──────────────────────────────────────────────────────
{
  const createdAt = new Date("2026-08-01T09:00:00.000Z");
  const poll = {
    ...POLL,
    createdAt,
    eventID: null,
    id: "poll-1",
    ownerEmail: "owner@example.com",
    ownerID: "owner-1",
    ownerName: "Owner",
    token: "poll-token",
    updatedAt: createdAt,
  } as Parameters<typeof pollCalendarProjection>[0][number];
  const slots = SLOTS.map((slot) => ({ ...slot, pollID: poll.id }));
  const votes = [
    { participantID: "p1", pollID: poll.id, slotID: "slot-tue", value: "yes" },
    { participantID: "p2", pollID: poll.id, slotID: "slot-tue", value: "no" },
    { participantID: "p1", pollID: poll.id, slotID: "slot-wed", value: "yes" },
    { participantID: "p2", pollID: poll.id, slotID: "slot-wed", value: "if-needed" },
  ];

  const [projection] = pollCalendarProjection([poll], slots, votes, {
    email: "guest@example.com",
    id: "guest-1",
  });
  assert.equal(projection!.role, "participant");
  assert.equal(projection!.respondents, 2);
  assert.deepEqual(projection!.days[0], {
    end: SLOTS[0]!.end,
    id: "slot-tue",
    ifNeeded: 0,
    no: 1,
    start: SLOTS[0]!.start,
    yes: 1,
  });
  assert.ok(!JSON.stringify(projection).includes("participantID"));
  assert.equal(
    pollCalendarProjection([poll], slots, votes, {
      email: "owner@example.com",
      id: "some-session",
    })[0]!.role,
    "organizer",
  );
}

// ── Which slot wins ──────────────────────────────────────────────────────────
// A plain yes outranks an "if needed" instead of being averaged with it: the
// poll looks for a time nobody has to be talked into.
{
  const [winner] = bestSlots([
    { id: "a", ifNeeded: ["p", "q", "r", "s"], yes: ["x"] },
    { id: "b", ifNeeded: [], yes: ["x", "y"] },
  ]);
  assert.equal(winner!.id, "b");
}

// "If needed" is the tiebreak, which is exactly what it means.
{
  const [winner] = bestSlots([
    { id: "a", ifNeeded: [], yes: ["x", "y"] },
    { id: "b", ifNeeded: ["z"], yes: ["x", "y"] },
  ]);
  assert.equal(winner!.id, "b");
}

// A genuine tie returns both rather than picking for the organizer — the
// decision is theirs, and a silent choice would hide that two times are equal.
{
  const tied = bestSlots([
    { id: "a", ifNeeded: [], yes: ["x"] },
    { id: "b", ifNeeded: [], yes: ["y"] },
  ]);
  assert.deepEqual(tied.map((slot) => slot.id), ["a", "b"]);
}

// Nobody has answered yet: no slot leads, and the UI must not crown one.
assert.deepEqual(
  bestSlots([{ id: "a", ifNeeded: [], yes: [] }]),
  [],
);

console.log("scheduling poll self-check: OK");
