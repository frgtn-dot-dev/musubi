import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
	calendars,
	closePoll,
	createPoll,
	db,
	decidePoll,
	events,
	schedulingPolls,
	user,
} from "@musubi/db";

async function main() {
	if (process.env.ENVIRONMENT !== "test") {
		throw new Error(
			"Refusing to run scheduling DB integration test unless ENVIRONMENT=test",
		);
	}

	const userID = `poll-race-${randomUUID()}`;
	const calendarID = randomUUID();
	const pollID = randomUUID();
	const slotID = randomUUID();
	const eventIDs = [randomUUID(), randomUUID()];
	await db.insert(user).values({
		id: userID,
		name: "Poll Race Test",
		email: `${userID}@example.test`,
		emailVerified: true,
	});
	await db.insert(calendars).values({
		id: calendarID,
		creatorID: userID,
		name: "Race",
		color: "#000000",
	});
	await createPoll(
		{
			id: pollID,
			calendarID,
			durationMinutes: 1440,
			ownerEmail: `${userID}@example.test`,
			ownerID: userID,
			ownerName: "Poll Race Test",
			title: "One winner",
			token: randomUUID(),
		},
		[
			{
				start: new Date("2030-01-01T12:00:00Z"),
				end: new Date("2030-01-02T12:00:00Z"),
			},
		],
	);
	const [slot] = await db.query.schedulingSlots.findMany({
		where: (table, { eq }) => eq(table.pollID, pollID),
	});

	try {
		const decide = (id: string) =>
			decidePoll({
				calendars: [calendarID],
				event: {
					id,
					color: "#000000",
					creatorID: userID,
					end: new Date("2030-01-02T00:00:00Z"),
					isCanceled: false,
					organizer: userID,
					start: new Date("2030-01-01T00:00:00Z"),
					title: "One winner",
				},
				pollID,
				slotID: slot!.id,
			});
		const results = await Promise.all(eventIDs.map(decide));
		assert.deepEqual(results.map((result) => result.status).sort(), [
			"already_closed",
			"decided",
		]);
		assert.equal(await closePoll(pollID), false);
		assert.equal(
			(await db.select().from(events).where(inArray(events.id, eventIDs)))
				.length,
			1,
		);
		const [poll] = await db
			.select()
			.from(schedulingPolls)
			.where(inArray(schedulingPolls.id, [pollID]));
		assert.ok(poll?.eventID);
		assert.equal(poll?.chosenSlotID, slot?.id);
	} finally {
		await db.delete(user).where(inArray(user.id, [userID]));
	}

	console.log("scheduling decision concurrency self-check: OK");
}

void main();
