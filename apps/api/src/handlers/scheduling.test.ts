import assert from "node:assert/strict";
import { bestSlots, pollProjection } from "./scheduling";

const POLL = {
  chosenSlotID: null,
  closedAt: null,
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

// ── What a participant sees ──────────────────────────────────────────────────
// Names and answers, because a poll is people coordinating with each other.
// Nothing about anybody's calendar: availability is worked out in the
// participant's own browser and only the answers are ever sent.
{
  const projection = pollProjection(POLL, SLOTS, [
    { name: "Zoe", slotID: "slot-tue", userID: "u1", value: "yes" },
    { name: "Adam", slotID: "slot-tue", userID: "u2", value: "if-needed" },
    { name: "", slotID: "slot-tue", userID: "u3", value: "no" },
    { name: "Zoe", slotID: "slot-wed", userID: "u1", value: "yes" },
    { name: "Adam", slotID: "slot-wed", userID: "u2", value: "yes" },
  ]);

  assert.deepEqual(Object.keys(projection).sort(), [
    "chosenSlotID",
    "closed",
    "description",
    "durationMinutes",
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
