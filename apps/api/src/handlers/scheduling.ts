import { randomBytes } from "node:crypto";
import {
  closePoll,
  createEvent,
  createPoll,
  getPollById,
  getPollByToken,
  listPollSlots,
  listPollVotes,
  listPolls,
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
    polls.map((poll) => ({ ...poll, url: pollUrl(poll.token) })),
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

  res.status(200).json({
    ...pollProjection(poll, slots, votes),
    mine: req.user
      ? Object.fromEntries(
          votes
            .filter((vote) => vote.userID === req.user!.id)
            .map((vote) => [vote.slotID, vote.value]),
        )
      : {},
  });
}

export type PollRow = {
  chosenSlotID: null | string;
  closedAt: Date | null;
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
) {
  const people = new Set(votes.map((vote) => vote.userID));

  return {
    chosenSlotID: poll.chosenSlotID,
    closed: Boolean(poll.closedAt),
    description: poll.description,
    durationMinutes: poll.durationMinutes,
    respondents: people.size,
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

  res.status(200).json({
    ...pollProjection(poll, slots, saved),
    mine: Object.fromEntries(
      saved
        .filter((vote) => vote.userID === req.user!.id)
        .map((vote) => [vote.slotID, vote.value]),
    ),
  });
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
