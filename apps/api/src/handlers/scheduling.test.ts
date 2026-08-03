import assert from "node:assert/strict";
import { bestSlots, pollProjection } from "./scheduling";

const POLL = {
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
    { name: "Zoe", slotID: "slot-tue", userID: "u1", value: "yes" },
    { name: "Adam", slotID: "slot-tue", userID: "u2", value: "if-needed" },
    { name: "", slotID: "slot-tue", userID: "u3", value: "no" },
    { name: "Zoe", slotID: "slot-wed", userID: "u1", value: "yes" },
    { name: "Adam", slotID: "slot-wed", userID: "u2", value: "yes" },
  ];
  const projection = pollProjection(POLL, SLOTS, votes);

  assert.deepEqual(Object.keys(projection).sort(), [
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
    !JSON.stringify(projection).includes("u1"),
    "a projection must not carry account ids to strangers holding the link",
  );

  // Nobody signed in: no row is theirs, and no answers are theirs.
  assert.equal(projection.mineID, null);
  assert.deepEqual(projection.mine, {});

  // Signed in: their own row is named, so the grid can show it once and let them
  // edit it rather than printing them twice.
  const asAdam = pollProjection(POLL, SLOTS, votes, "u2");
  assert.equal(asAdam.mineID, "2");
  assert.deepEqual(asAdam.mine, { "slot-tue": "if-needed", "slot-wed": "yes" });

  // Somebody who has not answered yet is nobody's row.
  assert.equal(pollProjection(POLL, SLOTS, votes, "u9").mineID, null);

  // Two people with one name stay two rows — a poll of Jans is still a poll of
  // people, and merging them would lose an answer.
  const jans = pollProjection(POLL, SLOTS, [
    { name: "Jan", slotID: "slot-tue", userID: "a", value: "yes" },
    { name: "Jan", slotID: "slot-tue", userID: "b", value: "no" },
  ]);
  assert.equal(jans.people.length, 2);
  assert.deepEqual(
    jans.people.map((person) => person.answers["slot-tue"]),
    ["yes", "no"],
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
