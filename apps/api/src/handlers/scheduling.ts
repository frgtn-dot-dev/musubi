import { randomBytes } from "node:crypto";
import {
  claimPollOwnership,
  closePoll,
  createEvent,
  createPoll,
  deletePoll,
  getPollById,
  getPollByToken,
  listPollSlots,
  listPollVotes,
  listPolls,
  PollIdentityExistsError,
  setPollVotes,
  type SchedulingPollRow,
} from "@musubi/db";
import { BadRequestError, ForbiddenError, NotFoundError } from "@musubi/types";
import { config } from "@musubi/config";
import type { Request, Response } from "express";
import { assertCan } from "../permissions";

const VOTE_VALUES = new Set(["if-needed", "no", "yes"]);
/**
 * Enough to ask about a month of days at a couple of times each — the organizer
 * picks days and times separately, so the count multiplies rather than adds.
 * Beyond this a poll stops being a question and becomes a survey.
 */
const MAX_SLOTS = 60;
const MAX_TITLE = 120;
const ALL_DAY_DURATION_MINUTES = 24 * 60;

function pollToken() {
  return randomBytes(16).toString("hex");
}

function pollUrl(token: string) {
  return `${config.api.url}/s/${token}`;
}

function emailIdentity(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestError("Enter a valid email address...");
  }
  return email;
}

function identityName(value: unknown) {
  const name = String(value ?? "").trim().slice(0, 120);
  if (!name) throw new BadRequestError("Enter your name...");
  return name;
}

function pollSummary(poll: SchedulingPollRow) {
  return {
    approximateStartTime: poll.approximateStartTime,
    chosenSlotID: poll.chosenSlotID,
    closed: pollIsClosed(poll),
    closedAt: poll.closedAt,
    createdAt: poll.createdAt,
    deadline: poll.deadline,
    durationMinutes: poll.durationMinutes,
    id: poll.id,
    title: poll.title,
    token: poll.token,
    url: pollUrl(poll.token),
  };
}

async function assertPollOwner(poll: SchedulingPollRow, req: Request) {
  if (poll.ownerID === req.user!.id) return;
  if (
    req.user!.emailVerified &&
    poll.ownerEmail === String(req.user!.email).trim().toLowerCase()
  ) {
    await claimPollOwnership(poll.id, req.user!.id);
    return;
  }
  throw new ForbiddenError("Only the organizer can change this poll...");
}

export function parseApproximateStartTime(value: unknown) {
  const time = String(value ?? "").trim();
  if (!time) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new BadRequestError("approximateStartTime must be HH:mm...");
  }
  return time;
}

export async function handlerCreatePoll(req: Request, res: Response) {
  const title = String(req.body?.title ?? "").trim().slice(0, MAX_TITLE);
  const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
  const approximateStartTime = parseApproximateStartTime(req.body?.approximateStartTime);
  const ownerEmail = emailIdentity(req.body?.email ?? req.user?.email);
  const ownerName = identityName(req.body?.name ?? req.user?.name);

  if (!title) throw new BadRequestError("A poll needs a title...");
  if (slots.length === 0) {
    throw new BadRequestError("A poll needs at least one day to choose from...");
  }
  if (slots.length > MAX_SLOTS) {
    throw new BadRequestError(`A poll can offer at most ${MAX_SLOTS} days...`);
  }

  const parsed = slots.map((slot: { start?: string }) => {
    const start = new Date(String(slot?.start));
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestError("Every slot needs a valid start...");
    }
    return {
      end: new Date(start.getTime() + ALL_DAY_DURATION_MINUTES * 60_000),
      start,
    };
  });

  const poll = await createPoll(
    {
      approximateStartTime,
      deadline: req.body?.deadline ? new Date(String(req.body.deadline)) : null,
      description: String(req.body?.description ?? "").trim() || null,
      // Kept in storage and projections for older clients; new polls become
      // all-day events and no longer ask the organizer for a duration.
      durationMinutes: ALL_DAY_DURATION_MINUTES,
      ownerEmail,
      ownerID: req.user?.id,
      ownerName,
      title,
      token: pollToken(),
    },
    parsed,
  );

  res.status(201).json(pollSummary(poll));
}

export async function handlerListPolls(req: Request, res: Response) {
  const polls = await listPolls(
    req.user!.id,
    req.user!.emailVerified
      ? String(req.user!.email).trim().toLowerCase()
      : undefined,
  );

  res.status(200).json(polls.map(pollSummary));
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
 * invitation. A first vote needs a private email identity but no session; only
 * replacing that identity's answers requires an authenticated matching inbox.
 */
export async function handlerGetPoll(req: Request, res: Response) {
  const poll = await getPollByToken(String(req.params.token));
  if (!poll) throw new NotFoundError("This poll is not available...");

  const [slots, votes] = await Promise.all([
    listPollSlots(poll.id),
    listPollVotes(poll.id),
  ]);

  res.status(200).json(
    pollProjection(
      poll,
      slots,
      votes,
      req.user ? String(req.user.email).trim().toLowerCase() : undefined,
    ),
  );
}

export type PollRow = {
  approximateStartTime?: null | string;
  chosenSlotID: null | string;
  closedAt: Date | null;
  deadline: Date | null;
  description: null | string;
  durationMinutes: number;
  title: string;
};

export type SlotRow = { end: Date; id: string; start: Date };
export type VoteRow = {
  email: string;
  name: string;
  participantID: string;
  slotID: string;
  value: string;
};

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
  /** The authenticated email asking, when anybody is: their row is editable. */
  viewerEmail?: string,
) {
  // Poll-local ids keep emails private while names and answers remain visible.
  const participantIDs = [
    ...new Set(votes.map((vote) => vote.participantID)),
  ].sort();
  const people = participantIDs.map((participantID, index) => {
    const theirs = votes.filter(
      (vote) => vote.participantID === participantID,
    );

    return {
      answers: Object.fromEntries(
        theirs.map((vote) => [vote.slotID, vote.value]),
      ),
      id: String(index + 1),
      name: theirs[0]?.name.trim() || "Guest",
    };
  });

  const viewerParticipantID = viewerEmail
    ? votes.find((vote) => vote.email === viewerEmail)?.participantID
    : undefined;
  const viewerIndex = viewerParticipantID
    ? participantIDs.indexOf(viewerParticipantID)
    : -1;

  return {
    approximateStartTime: poll.approximateStartTime ?? null,
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
    respondents: participantIDs.length,
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

  const email = emailIdentity(req.body?.email ?? req.user?.email);
  const name = identityName(req.body?.name ?? req.user?.name);
  const authenticatedEmail = req.user
    ? String(req.user.email).trim().toLowerCase()
    : undefined;

  try {
    await setPollVotes({
      allowExisting: authenticatedEmail === email,
      email,
      name,
      pollID: poll.id,
      userID: authenticatedEmail === email ? req.user?.id : undefined,
      votes: votes.map((vote: { slotID: string; value: string }) => ({
        slotID: String(vote.slotID),
        value: String(vote.value),
      })),
    });
  } catch (error) {
    if (error instanceof PollIdentityExistsError) {
      throw new ForbiddenError(
        "Sign in with the code sent to this email before changing its answers...",
      );
    }
    throw error;
  }

  const [slots, saved] = await Promise.all([
    listPollSlots(poll.id),
    listPollVotes(poll.id),
  ]);

  res.status(200).json(pollProjection(poll, slots, saved, email));
}

/**
 * The organizer picks a time, and the poll becomes an event.
 *
 * The event is created here rather than by the client so the poll and the event
 * cannot disagree about what was decided, and so everyone who answered can be
 * told by looking at the poll again.
 */
export function pollSlotEventTiming(slotStart: Date) {
  const date = new Date(Date.UTC(
    slotStart.getUTCFullYear(),
    slotStart.getUTCMonth(),
    slotStart.getUTCDate(),
  ));
  return { end: date, isAllDay: true, start: date };
}

export async function handlerDecidePoll(req: Request, res: Response) {
  const poll = await getPollById(String(req.params.pollId));
  if (!poll) throw new NotFoundError("Poll not found...");
  await assertPollOwner(poll, req);
  if (poll.closedAt) throw new BadRequestError("This poll is already decided...");

  const slotID = String(req.body?.slotId ?? "");
  const calendarID = String(req.body?.calendarId ?? "");
  const slot = (await listPollSlots(poll.id)).find((item) => item.id === slotID);
  if (!slot) throw new BadRequestError("That time is not on this poll...");

  await assertCan(req.user!.id, calendarID, "editEvents");
  const eventTiming = pollSlotEventTiming(slot.start);

  const event = await createEvent(
    {
      color: "#c8553d",
      creatorID: req.user!.id,
      ...eventTiming,
      id: crypto.randomUUID(),
      isCanceled: false,
      organizer: req.user!.id,
      originCalendarID: calendarID,
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
  await assertPollOwner(poll, req);
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
  await assertPollOwner(poll, req);

  await deletePoll(poll.id);

  res.status(204).end();
}
