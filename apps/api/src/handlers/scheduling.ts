import { randomBytes } from "node:crypto";
import {
  closePoll,
  createEvent,
  createPoll,
  deletePoll,
  getPollById,
  getPollByToken,
  listPollSlots,
  listPollVotes,
  listPolls,
  nameAnonymousUser,
  setPollVotes,
} from "@musubi/db";
import { BadRequestError, ForbiddenError, NotFoundError } from "@musubi/types";
import { config } from "@musubi/config";
import { Request, Response } from "express";
import { assertCan } from "../permissions";

const VOTE_VALUES = new Set(["if-needed", "no", "yes"]);
/**
 * Enough to ask about a month of days at a couple of times each — the organizer
 * picks days and times separately, so the count multiplies rather than adds.
 * Beyond this a poll stops being a question and becomes a survey.
 */
const MAX_SLOTS = 60;
const MAX_TITLE = 120;

function pollToken() {
  return randomBytes(16).toString("hex");
}

function pollUrl(token: string) {
  return `${config.api.url}/s/${token}`;
}

export async function handlerCreatePoll(req: Request, res: Response) {
  const title = String(req.body?.title ?? "").trim().slice(0, MAX_TITLE);
  const durationMinutes = Number(req.body?.durationMinutes);
  const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];

  if (!title) throw new BadRequestError("A poll needs a title...");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5) {
    throw new BadRequestError("durationMinutes must be at least 5...");
  }
  if (slots.length === 0) {
    throw new BadRequestError("A poll needs at least one time to choose from...");
  }
  if (slots.length > MAX_SLOTS) {
    throw new BadRequestError(`A poll can offer at most ${MAX_SLOTS} times...`);
  }

  const parsed = slots.map((slot: { start?: string }) => {
    const start = new Date(String(slot?.start));
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestError("Every slot needs a valid start...");
    }
    // The end comes from the poll's duration, never from the client: one poll
    // asks about one length of meeting, and letting slots disagree about that
    // would make the overlap meaningless.
    return { end: new Date(start.getTime() + durationMinutes * 60_000), start };
  });

  // A poll made from the public page belongs to an account created seconds ago,
  // which has no name on it. Only fills an empty one — creating a poll never
  // renames an existing account.
  const organizer = String(req.body?.name ?? "").trim();
  if (organizer) await nameAnonymousUser(req.user!.id, organizer);

  const poll = await createPoll(
    {
      deadline: req.body?.deadline ? new Date(String(req.body.deadline)) : null,
      description: String(req.body?.description ?? "").trim() || null,
      durationMinutes,
      ownerID: req.user!.id,
      title,
      token: pollToken(),
    },
    parsed,
  );

  res.status(201).json({ ...poll, url: pollUrl(poll.token) });
}

export async function handlerListPolls(req: Request, res: Response) {
  const polls = await listPolls(req.user!.id);

  res.status(200).json(
    polls.map((poll) => ({
      ...poll,
      // Whether it still takes answers, worked out here rather than in the
      // browser: the deadline is a wall-clock comparison and the server's clock
      // is the one that refuses a vote, so it is the one that gets to say.
      closed: pollIsClosed(poll),
      url: pollUrl(poll.token),
    })),
  );
}

/** Shut to answers, for either reason. */
function pollIsClosed(poll: { closedAt: Date | null; deadline: Date | null }) {
  return (
    Boolean(poll.closedAt) ||
    Boolean(poll.deadline && poll.deadline.getTime() < Date.now())
  );
}

/**
 * The poll as a participant sees it: what is being asked, and how everyone has
 * answered so far.
 *
 * Open by token, like an invite or a published event — the link is the
 * invitation. Voting needs a session; reading does not, so somebody can see what
 * they are being asked before they identify themselves.
 */
export async function handlerGetPoll(req: Request, res: Response) {
  const poll = await getPollByToken(String(req.params.token));
  if (!poll) throw new NotFoundError("This poll is not available...");

  const [slots, votes] = await Promise.all([
    listPollSlots(poll.id),
    listPollVotes(poll.id),
  ]);

  res.status(200).json(pollProjection(poll, slots, votes, req.user?.id));
}

export type PollRow = {
  chosenSlotID: null | string;
  closedAt: Date | null;
  deadline: Date | null;
  description: null | string;
  durationMinutes: number;
  title: string;
};

export type SlotRow = { end: Date; id: string; start: Date };
export type VoteRow = { name: string; slotID: string; userID: string; value: string };

/**
 * What every participant of a poll is allowed to see.
 *
 * Names and answers, because a poll is people coordinating with each other and
 * "who else can make Tuesday" is the question. Nothing about anyone's calendar:
 * availability is worked out in the participant's own browser and only their
 * answers are ever sent (PRD §19.1 — "before sending, they see what they share").
 */
export function pollProjection(
  poll: PollRow,
  slots: SlotRow[],
  votes: VoteRow[],
  /** Who is asking, when anybody is: their own row is the one they can edit. */
  viewerID?: string,
) {
  // One row per person who has answered, because the grid participants read is
  // people down and times across. Identified by a number local to this poll and
  // not by the user id: two people called Jan must stay two rows, and a stranger
  // holding the link has no business learning account ids. Sorted by user id so
  // the numbering is the same on every request — a row that renumbered between
  // polls would move under the reader's cursor.
  const userIDs = [...new Set(votes.map((vote) => vote.userID))].sort();
  const people = userIDs.map((userID, index) => {
    const theirs = votes.filter((vote) => vote.userID === userID);

    return {
      answers: Object.fromEntries(
        theirs.map((vote) => [vote.slotID, vote.value]),
      ),
      id: String(index + 1),
      name: theirs[0]?.name.trim() || "Guest",
    };
  });

  const viewerIndex = viewerID ? userIDs.indexOf(viewerID) : -1;

  return {
    chosenSlotID: poll.chosenSlotID,
    /**
     * Shut to new answers, for either reason. A passed deadline counts, worked out
     * on read: nothing has to run on a schedule for a poll to stop taking answers,
     * and `handlerVotePoll` refuses on the same comparison.
     */
    closed: pollIsClosed(poll),
    /** When it shuts on its own, so a participant can see the clock too. */
    deadline: poll.deadline,
    description: poll.description,
    durationMinutes: poll.durationMinutes,
    /** The reader's own answers. Empty when nobody is signed in. */
    mine: viewerIndex >= 0 ? people[viewerIndex]!.answers : {},
    /** Which row is theirs, so the grid does not show them twice. */
    mineID: viewerIndex >= 0 ? people[viewerIndex]!.id : null,
    people,
    respondents: userIDs.length,
    slots: slots.map((slot) => {
      const forSlot = votes.filter((vote) => vote.slotID === slot.id);
      const named = (value: string) =>
        forSlot
          .filter((vote) => vote.value === value)
          .map((vote) => vote.name.trim() || "Guest")
          .sort((left, right) => left.localeCompare(right));

      return {
        end: slot.end.toISOString(),
        id: slot.id,
        ifNeeded: named("if-needed"),
        no: named("no"),
        start: slot.start.toISOString(),
        yes: named("yes"),
      };
    }),
    title: poll.title,
  };
}

/**
 * Which slot suits the most people.
 *
 * A plain "yes" outranks an "if needed" rather than being averaged with it: the
 * poll exists to find a time nobody has to be talked into, and a slot where two
 * people said yes beats one where four said "if you must". "If needed" still
 * counts — as a tiebreak, which is exactly its meaning.
 */
export function bestSlots<T extends { ifNeeded: unknown[]; yes: unknown[] }>(
  slots: T[],
): T[] {
  const best = slots.reduce(
    (top, slot) =>
      slot.yes.length > top.yes ||
      (slot.yes.length === top.yes && slot.ifNeeded.length > top.ifNeeded)
        ? { ifNeeded: slot.ifNeeded.length, yes: slot.yes.length }
        : top,
    { ifNeeded: -1, yes: -1 },
  );

  if (best.yes <= 0 && best.ifNeeded <= 0) return [];

  return slots.filter(
    (slot) =>
      slot.yes.length === best.yes && slot.ifNeeded.length === best.ifNeeded,
  );
}

export async function handlerVotePoll(req: Request, res: Response) {
  const poll = await getPollByToken(String(req.params.token));
  if (!poll) throw new NotFoundError("This poll is not available...");
  if (poll.closedAt) {
    throw new BadRequestError("This poll is already decided...");
  }
  if (poll.deadline && poll.deadline.getTime() < Date.now()) {
    throw new BadRequestError("This poll has closed for answers...");
  }

  const votes = Array.isArray(req.body?.votes) ? req.body.votes : [];
  for (const vote of votes) {
    if (!VOTE_VALUES.has(String(vote?.value))) {
      throw new BadRequestError("A vote is yes, if-needed or no...");
    }
  }

  // Sending only slots that are not on this poll would otherwise clear the
  // person's answers: the write replaces their whole set, so nothing valid in
  // means nothing left behind. Withdrawing is still possible — with an
  // explicitly empty list, which says so.
  if (votes.length > 0) {
    const slots = new Set((await listPollSlots(poll.id)).map((slot) => slot.id));
    if (!votes.some((vote: { slotID?: string }) => slots.has(String(vote?.slotID)))) {
      throw new BadRequestError("None of those times are on this poll...");
    }
  }

  // Somebody who arrived by link has an account with no name on it, and a grid
  // row reading "Guest" is useless to everyone else. Only fills an empty name —
  // a poll never renames an existing account.
  const name = String(req.body?.name ?? "").trim();
  if (name) await nameAnonymousUser(req.user!.id, name);

  await setPollVotes(
    poll.id,
    req.user!.id,
    votes.map((vote: { slotID: string; value: string }) => ({
      slotID: String(vote.slotID),
      value: String(vote.value),
    })),
  );

  const [slots, saved] = await Promise.all([
    listPollSlots(poll.id),
    listPollVotes(poll.id),
  ]);

  res.status(200).json(pollProjection(poll, slots, saved, req.user!.id));
}

/**
 * The organizer picks a time, and the poll becomes an event.
 *
 * The event is created here rather than by the client so the poll and the event
 * cannot disagree about what was decided, and so everyone who answered can be
 * told by looking at the poll again.
 */
export async function handlerDecidePoll(req: Request, res: Response) {
  const poll = await getPollById(String(req.params.pollId));
  if (!poll) throw new NotFoundError("Poll not found...");
  if (poll.ownerID !== req.user!.id) {
    throw new ForbiddenError("Only the organizer can decide a poll...");
  }
  if (poll.closedAt) throw new BadRequestError("This poll is already decided...");

  const slotID = String(req.body?.slotId ?? "");
  const calendarID = String(req.body?.calendarId ?? "");
  const slot = (await listPollSlots(poll.id)).find((item) => item.id === slotID);
  if (!slot) throw new BadRequestError("That time is not on this poll...");

  await assertCan(req.user!.id, calendarID, "editEvents");

  const event = await createEvent(
    {
      color: "#c8553d",
      creatorID: req.user!.id,
      end: slot.end,
      id: crypto.randomUUID(),
      isAllDay: false,
      isCanceled: false,
      organizer: req.user!.id,
      originCalendarID: calendarID,
      start: slot.start,
      title: poll.title,
      ...(poll.description ? { description: poll.description } : {}),
    },
    [calendarID],
  );

  await closePoll({ chosenSlotID: slot.id, eventID: event.id, pollID: poll.id });

  res.status(200).json({ eventId: event.id, slotId: slot.id });
}

/**
 * Stop taking answers without picking anything.
 *
 * Deciding was the only way to close a poll, so an organizer who sorted the
 * meeting out another way had to either invent an event or leave the link open
 * for good. The poll stays readable — the people who answered keep their answers.
 */
export async function handlerClosePoll(req: Request, res: Response) {
  const poll = await getPollById(String(req.params.pollId));
  if (!poll) throw new NotFoundError("Poll not found...");
  if (poll.ownerID !== req.user!.id) {
    throw new ForbiddenError("Only the organizer can close a poll...");
  }
  if (poll.closedAt) throw new BadRequestError("This poll is already closed...");

  await closePoll({ pollID: poll.id });

  res.status(200).json({ closed: true });
}

/**
 * Remove a poll and everything answered on it.
 *
 * Not reversible, and not the same as closing: the link stops resolving and the
 * answers are gone. Any event a decision created stays where it is — it is in
 * people's calendars by then, and deleting a poll is not a way to cancel a
 * meeting.
 */
export async function handlerDeletePoll(req: Request, res: Response) {
  const poll = await getPollById(String(req.params.pollId));
  if (!poll) throw new NotFoundError("Poll not found...");
  if (poll.ownerID !== req.user!.id) {
    throw new ForbiddenError("Only the organizer can delete a poll...");
  }

  await deletePoll(poll.id);

  res.status(204).end();
}
