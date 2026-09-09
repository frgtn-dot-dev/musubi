import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  account,
  caldavAccounts,
  user,
  events,
  calendarMembers,
  calendarEvents,
  externalEvents,
  externalCalendars,
  eventOutbox,
  createCalendar,
  createEvent,
  replaceMemberToken,
  claimEventOutbox,
  type EventOutboxRow,
} from "@musubi/db";
import {
  CLIENT_VERSION_HEADER,
  PRODUCT_VERSION,
  EventSchema,
  EventDeliverySchema,
  EventDeliveryInboxSchema,
} from "@musubi/types";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import {
  handlerGetEventDelivery,
  handlerGetEventDeliveryInbox,
  handlerRetryEventDelivery,
} from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const people = await Promise.all(
    ["owner", "other", "viewer", "stranger"].map(async (name) => {
      const id = `delivery-${name}-${randomUUID()}`;
      const token = issueMemberToken();
      await db
        .insert(user)
        .values({ id, name, email: `${id}@example.test`, isExternal: true });
      await replaceMemberToken(id, token.tokenHash);
      return { id, token: token.raw };
    }),
  );
  const [owner, other, viewer, stranger] = people;
  function serve() {
    const app = express();
    app.use(express.json());
    app.get(
      "/api/v1/event-deliveries",
      requireAuth,
      handlerGetEventDeliveryInbox,
    );
    app.get(
      "/api/v1/events/:eventId/delivery",
      requireAuth,
      handlerGetEventDelivery,
      handlerGetEventDeliveryInbox,
    );
    app.post(
      "/api/v1/events/:eventId/delivery/:operationId/retry",
      requireAuth,
      handlerRetryEventDelivery,
    );
    app.use(middlewareErrorHandler);
    return app.listen(0, "127.0.0.1");
  }
  let server = serve();
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const read = async (
    person: typeof owner,
    eventID: string,
    authenticated = true,
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/events/${eventID}/delivery`,
      {
        headers: {
          ...(authenticated ? { authorization: `Bearer ${person.token}` } : {}),
          [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
        },
      },
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: await response.json(),
    };
  };
  const inbox = async (
    person: typeof owner,
    query = "",
    authenticated = true,
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/event-deliveries${query}`,
      {
        headers: {
          ...(authenticated ? { authorization: `Bearer ${person.token}` } : {}),
          [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
        },
      },
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: await response.json(),
    };
  };
  try {
    const retry = async (
      person: typeof owner,
      eventID: string,
      operationID: string,
      body: unknown = {},
    ) => {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/events/${eventID}/delivery/${operationID}/retry`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${person.token}`,
            [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      return { status: response.status, body: await response.json() };
    };
    const destination = async (
      person: typeof owner,
      name: string,
      provider: string,
    ) => {
      const calendar = await createCalendar({
        creatorID: person.id,
        name,
        color: "#112233",
      });
      const [link] = await db
        .insert(externalCalendars)
        .values({
          calendarID: calendar.id,
          userID: person.id,
          provider,
          accountID: randomUUID(),
          externalCalendarID: `private-calendar-${randomUUID()}`,
        })
        .returning();
      // Receipt title projection requires a real current connected account,
      // including legacy links whose access discovery has not run yet.
      if (provider === "caldav") {
        await db.insert(caldavAccounts).values({ id: link.accountID, userID: person.id, serverUrl: "https://fixture.invalid", username: person.id, encryptedPassword: "unused-fixture" });
      } else {
        await db.insert(account).values({ id: randomUUID(), accountId: link.accountID, providerId: provider, userId: person.id });
      }
      return { calendar, link };
    };
    const google = await destination(owner, "Google", "google");
    const hidden = await destination(
      other,
      "Private calendar name",
      "microsoft",
    );
    const shared = await destination(other, "Shared", "caldav");
    const unknown = await destination(
      owner,
      "Imported without receipt",
      "google",
    );
    await db.insert(calendarMembers).values(
      [owner, viewer].map((person) => ({
        userID: person.id,
        calendarID: shared.calendar.id,
        role: "viewer",
      })),
    );
    const value = EventSchema.parse({
      id: randomUUID(),
      creatorID: owner.id,
      organizer: owner.id,
      title: "Private payload must stay in DB",
      color: "#112233",
      start: "2026-09-07T10:00:00Z",
      end: "2026-09-07T11:00:00Z",
      calendars: [
        google.calendar.id,
        hidden.calendar.id,
        shared.calendar.id,
        unknown.calendar.id,
      ],
      originCalendarID: google.calendar.id,
      isAllDay: false,
      isCanceled: false,
    });
    await createEvent(value, value.calendars);
    await db.update(events).set({ revision: 2 }).where(eq(events.id, value.id));
    const receipt = async (
      target: typeof google,
      status: EventOutboxRow["status"],
      revision = 1,
      predecessorID: string | null = null,
    ) => {
      const [row] = await db
        .insert(eventOutbox)
        .values({
          id: randomUUID(),
          actorID: owner.id,
          mutationID: randomUUID(),
          position: 0,
          eventID: value.id,
          revision,
          predecessorID,
          calendarID: target.calendar.id,
          externalCalendarLinkID: target.link.id,
          userID: target.link.userID,
          provider: target.link.provider,
          accountID: target.link.accountID,
          externalCalendarID: target.link.externalCalendarID,
          externalEventID: "private-resource",
          expectedEtag: '"private-etag"',
          action: "update",
          status,
          payload: { event: value },
          errorCode: "provider-private-error-data",
          remoteSnapshot: {
            externalEventId: "private-resource",
            etag: '"private-etag"',
            deleted: false,
            observedAt: new Date().toISOString(),
            values: { title: "Private remote content" },
          },
        })
        .returning();
      return row;
    };
    const delivered = await receipt(google, "completed", 2);
    await receipt(hidden, "conflict");
    const blocker = await receipt(shared, "blocked");
    await receipt(shared, "pending", 2, blocker.id);

    assert.equal((await inbox(owner, "", false)).status, 401);
    for (const query of [
      "?cursor=invalid",
      "?cursor[]=bad",
      "?cursor=a&cursor=b",
    ]) {
      assert.equal((await inbox(owner, query)).status, 400);
    }
    assert.deepEqual(
      (await inbox(owner)).body,
      { items: [], nextCursor: null },
      "other members' unfinished receipts cannot enter the owner's inbox",
    );
    assert.deepEqual((await inbox(viewer)).body.items, []);
    const otherInbox = await inbox(other);
    assert.equal(otherInbox.cache, "private, no-store");
    assert.deepEqual(
      EventDeliveryInboxSchema.parse(otherInbox.body).items,
      [{ eventId: value.id, savedTitle: value.title }],
      "multiple targets deduplicate the event",
    );
    for (const forbidden of [
      "private-account",
      "private-resource",
      "private-etag",
      "Private remote",
      "private-error",
    ]) {
      assert.equal(JSON.stringify(otherInbox.body).includes(forbidden), false);
    }
    // CalDAV projects current readable content, without rewriting accepted intent.
    await db
      .update(events)
      .set({ title: "New private content" })
      .where(eq(events.id, value.id));
    assert.deepEqual((await inbox(other)).body.items, [
      { eventId: value.id, savedTitle: "New private content" },
    ]);
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.id, blocker.id)))[0]!.payload.event.title, value.title);

    // The recipient's connected account and old native mapping survive unlink.
    // Neither authorizes future changes to an event now private to its creator.
    const [retainedMapping] = await db.insert(externalEvents).values({
      provider: "caldav", eventID: value.id, calendarID: shared.calendar.id,
      externalCalendarID: shared.link.externalCalendarID,
      externalEventID: "retained-shared-resource", etag: '"retained"',
    }).returning();
    const [retainedReceipt] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, blocker.id));
    await db.delete(calendarEvents).where(and(
      eq(calendarEvents.eventID, value.id),
      inArray(calendarEvents.calendarID, [shared.calendar.id, hidden.calendar.id]),
    ));
    await db.update(events).set({ title: "Creator-only title after unlink" }).where(eq(events.id, value.id));
    const [privateEvent] = await db.select().from(events).where(eq(events.id, value.id));
    assert.equal(privateEvent!.providerReadRetiredRevision, null, "No provider read retirement is involved");
    assert.equal((await db.select().from(caldavAccounts).where(eq(caldavAccounts.id, shared.link.accountID))).length, 1);
    assert.deepEqual((await inbox(other)).body.items, [
      { eventId: value.id, savedTitle: "Calendar event" },
    ], "An unlinked recipient cannot discover subsequent private title changes");
    assert.deepEqual((await db.select().from(externalEvents).where(eq(externalEvents.id, retainedMapping!.id)))[0], retainedMapping);
    assert.deepEqual((await db.select().from(eventOutbox).where(eq(eventOutbox.id, blocker.id)))[0], retainedReceipt);
    await db.insert(calendarEvents).values([
      { eventID: value.id, calendarID: shared.calendar.id },
      { eventID: value.id, calendarID: hidden.calendar.id },
    ]);
    assert.deepEqual((await inbox(other)).body.items, [
      { eventId: value.id, savedTitle: "Creator-only title after unlink" },
    ], "Restoring actual destination visibility permits current content again");


    assert.equal((await read(owner, value.id, false)).status, 401);
    assert.equal((await read(owner, "invalid")).status, 400);
    assert.equal((await read(stranger, value.id)).status, 404);
    assert.equal((await read(owner, randomUUID())).status, 404);
    const response = await read(owner, value.id.toUpperCase());
    assert.equal(response.status, 200);
    assert.equal(response.cache, "private, no-store");
    const status = EventDeliverySchema.parse(response.body);
    assert.equal(status.eventId, value.id);
    assert.equal(status.localRevision, 2);
    assert.equal(status.targets.length, 3);
    assert.equal(
      status.targets.find((row) => row.targetId === google.link.id)?.status,
      "completed",
    );
    const pending = status.targets.find(
      (row) => row.targetId === shared.link.id,
    )!;
    assert.equal(
      pending.operationId,
      blocker.id,
      "queued successor must not hide its blocker",
    );
    assert.equal(pending.status, "blocked");
    assert.equal(pending.revision, 1);
    assert.equal(pending.latestRevision, 2);
    assert.equal(pending.owned, false);
    const untracked = status.targets.find(
      (row) => row.targetId === unknown.link.id,
    )!;
    assert.equal(
      untracked.status,
      "unknown",
      "mapping/import without a receipt is not outbound confirmation",
    );
    assert.equal(untracked.operationId, null);
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "private-account",
      "private-calendar",
      "private-resource",
      "private-etag",
      "Private remote",
      "Private payload",
      "private-error",
      "Private calendar name",
      hidden.calendar.id,
      hidden.link.id,
    ]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `private metadata leaked: ${forbidden}`,
      );
    }
    assert.equal((await read(viewer, value.id)).body.targets.length, 1);
    await db
      .delete(calendarMembers)
      .where(
        and(
          eq(calendarMembers.userID, viewer.id),
          eq(calendarMembers.calendarID, shared.calendar.id),
        ),
      );
    assert.equal(
      (await read(viewer, value.id)).status,
      404,
      "membership revocation applies on the next read",
    );

    // A fresh API instance reconstructs receipt state from the same database.
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    server = serve();
    await new Promise<void>((resolve) => server.once("listening", resolve));
    assert.deepEqual((await read(owner, value.id)).body, response.body);

    // Replacing a connection cannot lend its private history to current viewers.
    await db
      .delete(externalCalendars)
      .where(eq(externalCalendars.id, shared.link.id));
    const [replacement] = await db
      .insert(externalCalendars)
      .values({
        ...shared.link,
        id: randomUUID(),
        accountID: "replacement-account",
      })
      .returning();
    const replaced = EventDeliverySchema.parse(
      (await read(owner, value.id)).body,
    );
    assert.equal(
      replaced.targets.some((row) => row.targetId === shared.link.id),
      false,
    );
    assert.equal(
      replaced.targets.find((row) => row.targetId === replacement.id)?.status,
      "unknown",
    );
    const ownHistory = EventDeliverySchema.parse(
      (await read(other, value.id)).body,
    );
    assert.equal(
      ownHistory.targets.find((row) => row.targetId === shared.link.id)
        ?.connected,
      false,
    );

    // A capability loss may cancel a job without replacing the connection. A
    // later edit still depends on it; only completed/not-needed unblock claims.
    const cancelled = await receipt(unknown, "cancelled");
    const waiting = await receipt(unknown, "pending", 2, cancelled.id);
    assert.equal(await claimEventOutbox(waiting.id), undefined);
    const blockedByCancellation = EventDeliverySchema.parse(
      (await read(owner, value.id)).body,
    ).targets.find((row) => row.targetId === unknown.link.id)!;
    assert.equal(blockedByCancellation.status, "cancelled");
    assert.equal(blockedByCancellation.operationId, cancelled.id);
    assert.equal(blockedByCancellation.latestRevision, 2);
    await db
      .delete(eventOutbox)
      .where(inArray(eventOutbox.id, [waiting.id, cancelled.id]));

    // Authenticated retry admits only the exact owned operation. A future
    // Retry-After keeps this HTTP fixture away from any live provider transport.
    const retryJob = await receipt(google, "blocked", 3, delivered.id);
    const future = new Date(Date.now() + 3_600_000);
    await db
      .update(eventOutbox)
      .set({ remoteSnapshot: null, nextAttemptAt: future })
      .where(eq(eventOutbox.id, retryJob.id));
    const storedRetry = async () =>
      (
        await db
          .select()
          .from(eventOutbox)
          .where(eq(eventOutbox.id, retryJob.id))
      )[0];
    const beforeRetry = await storedRetry();
    await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, google.calendar.id), eq(calendarMembers.userID, owner.id)));
    const beforeReadOnlyRetry = await storedRetry();
    const readOnlyRetry = await retry(owner, value.id, retryJob.id);
    assert.equal(readOnlyRetry.status, 409, "The connected account's current viewer role cannot readmit an old write");
    assert.equal(readOnlyRetry.body.code, "delivery-destination-unavailable");
    assert.deepEqual(await storedRetry(), beforeReadOnlyRetry);
    assert.equal((await read(owner, value.id)).status, 200, "Loss of write access does not hide the delivery receipt");
    await db.update(calendarMembers).set({ role: "owner" }).where(and(eq(calendarMembers.calendarID, google.calendar.id), eq(calendarMembers.userID, owner.id)));

    for (const [code, issue] of [
      ["provider-reconnect-required", "reconnect-required"],
      ["provider-write-denied", "write-denied"],
      ["provider-write-unsupported", "write-unsupported"],
      ["provider-permission-unknown", "permission-unknown"],
    ]) {
      await db
        .update(eventOutbox)
        .set({ errorCode: code })
        .where(eq(eventOutbox.id, retryJob.id));
      const receiptStatus = EventDeliverySchema.parse(
        (await read(owner, value.id)).body,
      );
      assert.equal(
        receiptStatus.targets.find((row) => row.operationId === retryJob.id)
          ?.issue,
        issue,
      );
    }
    assert.equal((await retry(other, value.id, retryJob.id)).status, 404);
    assert.equal((await retry(owner, randomUUID(), retryJob.id)).status, 404);
    assert.equal(
      (await retry(owner, value.id, retryJob.id, { expectedEtag: '"new"' }))
        .status,
      400,
    );
    const accepted = await retry(
      owner,
      value.id.toUpperCase(),
      retryJob.id.toUpperCase(),
    );
    assert.equal(accepted.status, 202);
    EventDeliverySchema.parse(accepted.body);
    const afterRetry = await storedRetry();
    assert.equal(afterRetry.status, "retry");
    assert.equal(afterRetry.nextAttemptAt.getTime(), future.getTime());
    assert.equal(afterRetry.attempts, 0);
    assert.equal(afterRetry.expectedEtag, beforeRetry.expectedEtag);
    assert.deepEqual(afterRetry.payload, beforeRetry.payload);
    const repeats = await Promise.all(
      Array.from({ length: 5 }, () => retry(owner, value.id, retryJob.id)),
    );
    assert.ok(repeats.every((response) => response.status === 202));
    assert.equal((await storedRetry()).attempts, 0);
    assert.equal(
      (await storedRetry()).nextAttemptAt.getTime(),
      future.getTime(),
    );

    await db
      .update(eventOutbox)
      .set({ status: "unconfirmed", uncertain: false })
      .where(eq(eventOutbox.id, retryJob.id));
    assert.equal((await retry(owner, value.id, retryJob.id)).status, 202);
    assert.equal(
      (await storedRetry()).uncertain,
      true,
      "legacy unconfirmed state cannot become a blind replay",
    );
    assert.equal((await storedRetry()).status, "unconfirmed");
    const leaseToken = randomUUID();
    await db
      .update(eventOutbox)
      .set({ status: "attempting", leaseToken, leaseUntil: future })
      .where(eq(eventOutbox.id, retryJob.id));
    assert.equal((await retry(owner, value.id, retryJob.id)).status, 202);
    assert.equal((await storedRetry()).leaseToken, leaseToken);
    assert.equal((await storedRetry()).leaseUntil?.getTime(), future.getTime());

    await db
      .update(eventOutbox)
      .set({ status: "conflict", remoteSnapshot: retryJob.remoteSnapshot })
      .where(eq(eventOutbox.id, retryJob.id));
    assert.equal(
      (await retry(owner, value.id, retryJob.id)).body.code,
      "delivery-conflict-unresolved",
    );
    assert.equal((await storedRetry()).status, "conflict");
    assert.deepEqual(
      (await storedRetry()).remoteSnapshot,
      retryJob.remoteSnapshot,
    );
    await db
      .update(eventOutbox)
      .set({ status: "cancelled", remoteSnapshot: null })
      .where(eq(eventOutbox.id, retryJob.id));
    assert.equal(
      (await retry(owner, value.id, retryJob.id)).body.code,
      "delivery-destination-unavailable",
    );
    await db
      .update(eventOutbox)
      .set({ status: "blocked", predecessorID: blocker.id })
      .where(eq(eventOutbox.id, retryJob.id));
    assert.equal(
      (await retry(owner, value.id, retryJob.id)).body.code,
      "delivery-predecessor-unresolved",
    );
    await db
      .update(eventOutbox)
      .set({ predecessorID: delivered.id })
      .where(eq(eventOutbox.id, retryJob.id));
    for (const unavailable of [
      { disabled: true },
      { supportsEvents: false },
      { accountID: "changed-account" },
    ]) {
      await db
        .update(externalCalendars)
        .set(unavailable)
        .where(eq(externalCalendars.id, google.link.id));
      assert.equal(
        (await retry(owner, value.id, retryJob.id)).body.code,
        "delivery-destination-unavailable",
      );
      await db
        .update(externalCalendars)
        .set({
          disabled: false,
          supportsEvents: true,
          accountID: google.link.accountID,
        })
        .where(eq(externalCalendars.id, google.link.id));
    }
    await db
      .delete(calendarMembers)
      .where(
        and(
          eq(calendarMembers.userID, owner.id),
          eq(calendarMembers.calendarID, google.calendar.id),
        ),
      );
    assert.equal(
      (await retry(owner, value.id, retryJob.id)).body.code,
      "delivery-destination-unavailable",
    );
    await db.insert(calendarMembers).values({
      userID: owner.id,
      calendarID: google.calendar.id,
      role: "owner",
    });
    await db
      .update(eventOutbox)
      .set({ status: "completed" })
      .where(eq(eventOutbox.id, retryJob.id));
    assert.equal(
      (await retry(owner, value.id, retryJob.id)).status,
      202,
      "a duplicate click after completion is harmless",
    );
    assert.equal((await storedRetry()).status, "completed");
    assert.equal(
      (
        await db
          .select()
          .from(eventOutbox)
          .where(eq(eventOutbox.id, blocker.id))
      )[0].status,
      "blocked",
      "retry does not change a sibling account",
    );
    await db.delete(eventOutbox).where(eq(eventOutbox.id, retryJob.id));

    // Exercise the HTTP handler's actual post-commit dispatcher/claim, without
    // any registered provider or credentials capable of leaving the fixture.
    const wakeupTarget = await destination(
      owner,
      "Immediate retry",
      "fixture-unregistered",
    );
    const wakeupJob = await receipt(wakeupTarget, "blocked", 2);
    await db
      .update(eventOutbox)
      .set({ remoteSnapshot: null, nextAttemptAt: new Date(0) })
      .where(eq(eventOutbox.id, wakeupJob.id));
    assert.equal((await retry(owner, value.id, wakeupJob.id)).status, 202);
    let claimed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [observed] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.id, wakeupJob.id));
      if (observed.attempts === 1 && observed.status === "blocked") {
        assert.equal(observed.errorCode, "provider-write-unsupported");
        claimed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      claimed,
      true,
      "HTTP retry must wake the real durable dispatcher after commit",
    );
    await db.delete(eventOutbox).where(eq(eventOutbox.id, wakeupJob.id));

    // Removing the local event does not erase the owner's undelivered deletion.
    const deleteReceipt = await receipt(google, "unconfirmed", 3, delivered.id);
    await db
      .update(eventOutbox)
      .set({ action: "delete", uncertain: true })
      .where(eq(eventOutbox.id, deleteReceipt.id));
    await db.delete(events).where(eq(events.id, value.id));
    const retained = EventDeliverySchema.parse(
      (await read(owner, value.id)).body,
    );
    assert.equal(retained.localRevision, null);
    assert.equal(retained.targets.length, 1);
    assert.equal(retained.targets[0].status, "unconfirmed");
    assert.equal(retained.targets[0].action, "delete");
    assert.equal((await read(stranger, value.id)).status, 404);
    const retainedInbox = await inbox(owner);
    assert.deepEqual(retainedInbox.body.items, [
      { eventId: value.id, savedTitle: value.title },
    ]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = serve();
    await new Promise<void>((resolve) => server.once("listening", resolve));
    assert.deepEqual(
      (await inbox(owner)).body,
      retainedInbox.body,
      "a restarted client can discover the deleted event without knowing its ID",
    );

    // Stable, bounded UUID pagination through multiple retained deletion intents.
    const ids = Array.from({ length: 28 }, () => randomUUID()).sort();
    await db.insert(eventOutbox).values(
      ids.map((id) => ({
        ...deleteReceipt,
        id: randomUUID(),
        eventID: id,
        mutationID: randomUUID(),
        predecessorID: null,
        action: "delete" as const,
        status: "unconfirmed" as const,
        payload: { event: { ...value, id, title: `Saved ${id}` } },
      })),
    );
    const firstPage = EventDeliveryInboxSchema.parse((await inbox(owner)).body);
    assert.equal(firstPage.items.length, 25);
    assert.ok(firstPage.nextCursor);
    await db
      .update(eventOutbox)
      .set({ updatedAt: new Date(), status: "retry" })
      .where(eq(eventOutbox.userID, owner.id));
    const secondPage = EventDeliveryInboxSchema.parse(
      (await inbox(owner, `?cursor=${firstPage.nextCursor.toUpperCase()}`))
        .body,
    );
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(
      [...firstPage.items, ...secondPage.items].map((item) => item.eventId),
      [...ids, value.id].sort(),
      "retry updates neither skip nor duplicate items",
    );
    await db
      .update(eventOutbox)
      .set({ status: "completed" })
      .where(eq(eventOutbox.userID, owner.id));
    assert.deepEqual((await inbox(owner)).body.items, []);
    await db
      .update(eventOutbox)
      .set({ status: "cancelled" })
      .where(eq(eventOutbox.id, deleteReceipt.id));
    assert.equal(
      (await inbox(owner)).body.items.length,
      1,
      "final cancelled operation stays discoverable",
    );
    await db.insert(eventOutbox).values({
      ...deleteReceipt,
      id: randomUUID(),
      mutationID: randomUUID(),
      revision: 4,
      status: "completed",
      predecessorID: null,
    });
    assert.deepEqual(
      (await inbox(owner)).body.items,
      [],
      "completed resolution archives its cancellation",
    );

    console.log(
      "event delivery status/retry: scoped receipts, authorization, preserved leases/uncertainty/Retry-After, reload and retained deletes passed",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(user).where(
      inArray(
        user.id,
        people.map((person) => person.id),
      ),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
