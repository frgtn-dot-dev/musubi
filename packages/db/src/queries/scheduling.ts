import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import {
  db,
  schedulingParticipants,
  schedulingPolls,
  schedulingSlots,
  schedulingVotes,
} from "..";

export type SchedulingPollRow = typeof schedulingPolls.$inferSelect;

export async function createPoll(
  poll: typeof schedulingPolls.$inferInsert,
  slots: Array<{ end: Date; start: Date }>,
): Promise<SchedulingPollRow> {
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(schedulingPolls).values(poll).returning();
    // A poll with no slots is a question with no answers — the handler refuses
    // it, and this keeps the two writes from ever disagreeing about that.
    await tx.insert(schedulingSlots).values(
      slots.map((slot) => ({ ...slot, pollID: created!.id })),
    );
    return created!;
  });
}

export async function listPolls(ownerID: string, ownerEmail?: string) {
  return db
    .select()
    .from(schedulingPolls)
    .where(
      ownerEmail
        ? or(
            eq(schedulingPolls.ownerID, ownerID),
            eq(schedulingPolls.ownerEmail, ownerEmail),
          )
        : eq(schedulingPolls.ownerID, ownerID),
    )
    .orderBy(desc(schedulingPolls.createdAt));
}

export function listActivePollsForCalendar(
  ownerID: string,
  verifiedEmail?: string,
) {
  const participantAccess = verifiedEmail
    ? exists(
        db
          .select({ id: schedulingParticipants.id })
          .from(schedulingParticipants)
          .where(
            and(
              eq(schedulingParticipants.pollID, schedulingPolls.id),
              eq(schedulingParticipants.email, verifiedEmail),
            ),
          ),
      )
    : undefined;
  const access = verifiedEmail
    ? or(
        eq(schedulingPolls.ownerID, ownerID),
        eq(schedulingPolls.ownerEmail, verifiedEmail),
        participantAccess,
      )
    : eq(schedulingPolls.ownerID, ownerID);

  return db
    .select()
    .from(schedulingPolls)
    .where(
      and(
        access,
        or(
          isNotNull(schedulingPolls.chosenSlotID),
          and(
            isNull(schedulingPolls.closedAt),
            or(
              isNull(schedulingPolls.deadline),
              gte(schedulingPolls.deadline, new Date()),
            ),
          ),
        ),
      ),
    )
    .orderBy(desc(schedulingPolls.createdAt));
}

export function listPollCalendarSlots(pollIDs: string[]) {
  if (pollIDs.length === 0) return [];
  return db
    .select()
    .from(schedulingSlots)
    .where(inArray(schedulingSlots.pollID, pollIDs))
    .orderBy(asc(schedulingSlots.start));
}

export function listPollCalendarVotes(pollIDs: string[]) {
  if (pollIDs.length === 0) return [];
  return db
    .select({
      participantID: schedulingParticipants.id,
      pollID: schedulingParticipants.pollID,
      slotID: schedulingVotes.slotID,
      value: schedulingVotes.value,
    })
    .from(schedulingVotes)
    .innerJoin(
      schedulingParticipants,
      eq(schedulingParticipants.id, schedulingVotes.participantID),
    )
    .where(inArray(schedulingParticipants.pollID, pollIDs));
}

export async function claimPollOwnership(pollID: string, ownerID: string) {
  await db
    .update(schedulingPolls)
    .set({ ownerID })
    .where(eq(schedulingPolls.id, pollID));
}

export async function getPollByToken(token: string) {
  const [row] = await db
    .select()
    .from(schedulingPolls)
    .where(eq(schedulingPolls.token, token));
  return row;
}

export async function getPollById(id: string) {
  const [row] = await db
    .select()
    .from(schedulingPolls)
    .where(eq(schedulingPolls.id, id));
  return row;
}

export async function listPollSlots(pollID: string) {
  return db
    .select()
    .from(schedulingSlots)
    .where(eq(schedulingSlots.pollID, pollID))
    .orderBy(asc(schedulingSlots.start));
}

/** Every participant and any answers they have given. */
export async function listPollVotes(pollID: string) {
  return db
    .select({
      email: schedulingParticipants.email,
      name: schedulingParticipants.name,
      participantID: schedulingParticipants.id,
      slotID: schedulingVotes.slotID,
      value: schedulingVotes.value,
    })
    .from(schedulingParticipants)
    .leftJoin(
      schedulingVotes,
      eq(schedulingParticipants.id, schedulingVotes.participantID),
    )
    .where(eq(schedulingParticipants.pollID, pollID));
}

/** Add a signed-in visitor to the grid without touching any saved answers. */
export async function ensurePollParticipant(input: {
  email: string;
  name?: string;
  pollID: string;
  userID: string;
}) {
  await db
    .insert(schedulingParticipants)
    .values({ ...input, name: input.name || "Guest" })
    .onConflictDoUpdate({
      set: { ...(input.name ? { name: input.name } : {}), userID: input.userID },
      target: [schedulingParticipants.pollID, schedulingParticipants.email],
    });
}

export class PollIdentityExistsError extends Error {}

/** Replace one person's answers in one write, so a vote is never half-saved. */
export async function setPollVotes(input: {
  allowExisting: boolean;
  email: string;
  name: string;
  pollID: string;
  userID?: string;
  votes: Array<{ slotID: string; value: string }>;
}) {
  const slots = await listPollSlots(input.pollID);
  const owned = new Set(slots.map((slot) => slot.id));
  const accepted = input.votes.filter((vote) => owned.has(vote.slotID));

  return db.transaction(async (tx) => {
    let [participant] = await tx
      .select()
      .from(schedulingParticipants)
      .where(
        and(
          eq(schedulingParticipants.pollID, input.pollID),
          eq(schedulingParticipants.email, input.email),
        ),
      );

    if (participant && !input.allowExisting) {
      throw new PollIdentityExistsError();
    }
    if (!participant) {
      [participant] = await tx
        .insert(schedulingParticipants)
        .values({
          email: input.email,
          name: input.name,
          pollID: input.pollID,
          userID: input.userID,
        })
        .onConflictDoNothing()
        .returning();
      if (!participant) throw new PollIdentityExistsError();
    } else {
      await tx
        .update(schedulingParticipants)
        .set({ name: input.name, userID: input.userID ?? participant.userID })
        .where(eq(schedulingParticipants.id, participant.id));
    }

    if (slots.length > 0) {
      await tx
        .delete(schedulingVotes)
        .where(
          and(
            eq(schedulingVotes.participantID, participant.id),
            inArray(
              schedulingVotes.slotID,
              slots.map((slot) => slot.id),
            ),
          ),
        );
    }
    if (accepted.length > 0) {
      await tx.insert(schedulingVotes).values(
        accepted.map((vote) => ({
          ...vote,
          participantID: participant.id,
        })),
      );
    }
    return participant.id;
  });
}

/**
 * Stop taking answers.
 *
 * With a slot the poll was decided and an event exists; without one it was closed
 * for some other reason — the meeting was arranged elsewhere, or nobody could
 * make any of it. Both leave the poll readable, so the people who answered can
 * still see what came of it.
 */
export async function closePoll(input: {
  chosenSlotID?: string;
  eventID?: string;
  pollID: string;
}) {
  await db
    .update(schedulingPolls)
    .set({
      chosenSlotID: input.chosenSlotID ?? null,
      closedAt: new Date(),
      eventID: input.eventID ?? null,
    })
    .where(eq(schedulingPolls.id, input.pollID));
}

/** Slots and votes go with it: both cascade from the poll's own row. */
export async function deletePoll(pollID: string) {
  await db.delete(schedulingPolls).where(eq(schedulingPolls.id, pollID));
}
