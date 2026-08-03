import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  schedulingPolls,
  schedulingSlots,
  schedulingVotes,
  user,
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

export async function listPolls(ownerID: string) {
  return db
    .select()
    .from(schedulingPolls)
    .where(eq(schedulingPolls.ownerID, ownerID))
    .orderBy(desc(schedulingPolls.createdAt));
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

/**
 * Every answer on a poll, with the name behind it.
 *
 * Names are the point here — a poll is people agreeing with each other, not an
 * anonymous tally, and the PRD's participant flow shows who is available.
 */
export async function listPollVotes(pollID: string) {
  return db
    .select({
      name: user.name,
      slotID: schedulingVotes.slotID,
      userID: schedulingVotes.userID,
      value: schedulingVotes.value,
    })
    .from(schedulingVotes)
    .innerJoin(
      schedulingSlots,
      eq(schedulingSlots.id, schedulingVotes.slotID),
    )
    .innerJoin(user, eq(user.id, schedulingVotes.userID))
    .where(eq(schedulingSlots.pollID, pollID));
}

/** Replace one person's answers in one write, so a vote is never half-saved. */
export async function setPollVotes(
  pollID: string,
  userID: string,
  votes: Array<{ slotID: string; value: string }>,
) {
  const slots = await listPollSlots(pollID);
  const owned = new Set(slots.map((slot) => slot.id));
  // Slots are named by the client, so they are checked against the poll before
  // anything is written — a vote must not be able to reach another poll's slot.
  const accepted = votes.filter((vote) => owned.has(vote.slotID));

  await db.transaction(async (tx) => {
    if (slots.length > 0) {
      await tx
        .delete(schedulingVotes)
        .where(
          and(
            eq(schedulingVotes.userID, userID),
            inArray(
              schedulingVotes.slotID,
              slots.map((slot) => slot.id),
            ),
          ),
        );
    }
    if (accepted.length > 0) {
      await tx
        .insert(schedulingVotes)
        .values(accepted.map((vote) => ({ ...vote, userID })));
    }
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
