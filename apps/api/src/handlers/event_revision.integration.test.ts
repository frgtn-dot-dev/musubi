import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import {
  createCalendar,
  db,
  getEvent,
  getEventCalendars,
  replaceMemberToken,
  user,
  removeCalendar,
  linkEventToCalendars,
} from "@musubi/db";
import {
  CLIENT_VERSION_HEADER,
  PRODUCT_VERSION,
  EventSchema,
} from "@musubi/types";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import {
  handlerCreateEvent,
  handlerGetEvents,
  handlerUpdateEvent,
  handlerRemoveEvent,
  handlerLinkEvent,
  handlerForkEvent,
} from "./events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const id = `event-cas-${randomUUID()}`;
  const token = issueMemberToken();
  await db
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test`, isExternal: true });
  await replaceMemberToken(id, token.tokenHash);
  const home = await createCalendar({
    creatorID: id,
    name: "Home",
    color: "#112233",
  });
  const copy = await createCalendar({
    creatorID: id,
    name: "Copy",
    color: "#112233",
  });
  const forkHome = await createCalendar({
    creatorID: id,
    name: "Fork",
    color: "#112233",
  });
  const app = express();
  app.use(express.json());
  app.get("/events", requireAuth, handlerGetEvents);
  app.post("/events", requireAuth, handlerCreateEvent);
  app.patch("/events", requireAuth, handlerUpdateEvent);
  app.put("/events", requireAuth, handlerUpdateEvent);
  app.delete("/events", requireAuth, handlerRemoveEvent);
  app.post("/events/:eventId/link", requireAuth, handlerLinkEvent);
  app.post("/events/:eventId/fork", requireAuth, handlerForkEvent);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = async (
    method: string,
    body?: unknown,
    path = "/events",
    version = PRODUCT_VERSION,
  ) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        authorization: `Bearer ${token.raw}`,
        [CLIENT_VERSION_HEADER]: version,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const input = {
      id: randomUUID(),
      creatorID: id,
      organizer: id,
      title: "Original",
      color: "#112233",
      calendars: [home.id],
      originCalendarID: home.id,
      start: "2026-09-01T23:00:00Z",
      end: "2026-09-03T02:00:00Z",
      isAllDay: false,
      isCanceled: false,
      description: "Preserve",
      location: "Room",
      hasAttendees: true,
    };
    const created = await send("POST", input);
    assert.equal(created.status, 201);
    assert.equal(created.body.revision, 1);
    const eventID = created.body.id;
    assert.equal(
      EventSchema.parse((await send("GET")).body.events[0]).revision,
      1,
      "read validator preserves authoritative revision",
    );
    for (const expectedRevision of [undefined, null, 0, -1, 1.5, "1"]) {
      assert.equal(
        (
          await send("PATCH", {
            id: eventID,
            expectedRevision,
            patch: { title: "Invalid" },
          })
        ).status,
        400,
      );
      assert.equal(
        (await send("DELETE", { id: eventID, expectedRevision })).status,
        400,
      );
      assert.equal(
        (
          await send(
            "POST",
            { calendarID: copy.id, expectedRevision },
            `/events/${eventID}/link`,
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (await send("PUT", { ...created.body, title: "Legacy bypass" })).status,
      400,
    );
    assert.equal(
      (
        await send("PATCH", {
          id: eventID,
          expectedRevision: 1,
          patch: { scopeEditValidated: true },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send(
          "PATCH",
          { id: eventID, expectedRevision: 1, patch: { title: "Old" } },
          "/events",
          "0.1.7",
        )
      ).status,
      426,
    );
    const first = await send("PATCH", {
      id: eventID,
      expectedRevision: 1,
      patch: { start: "2026-09-02T00:00:00Z" },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.revision, 2);
    assert.equal(
      first.body.hasAttendees,
      true,
      "omitted read-default field preserved",
    );
    const stale = await send("PATCH", {
      id: eventID,
      expectedRevision: 1,
      patch: { title: "Second real draft" },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.localCommitted, false);
    assert.equal(stale.body.currentRevision, 2);
    assert.equal((await getEvent(eventID)).title, "Original");
    assert.equal(
      (await getEvent(eventID)).start.toISOString(),
      first.body.start,
    );
    const before = await getEvent(eventID);
    const noop = await send("PATCH", {
      id: eventID,
      expectedRevision: 2,
      patch: { title: "Original" },
    });
    assert.equal(noop.body.revision, 2);
    assert.equal(
      (await getEvent(eventID)).updatedAt.getTime(),
      before.updatedAt.getTime(),
    );
    const cleared = await send("PATCH", {
      id: eventID,
      expectedRevision: 2,
      patch: { description: null },
    });
    assert.equal(cleared.body.description, null);
    assert.equal(cleared.body.location, "Room");
    const racers = await Promise.all([
      send("PATCH", {
        id: eventID,
        expectedRevision: 3,
        patch: { title: "Race A", calendars: [home.id, copy.id] },
      }),
      send("PATCH", {
        id: eventID,
        expectedRevision: 3,
        patch: { title: "Race B", calendars: [home.id, copy.id] },
      }),
    ]);
    assert.deepEqual(racers.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await getEvent(eventID)).revision, 4);
    assert.deepEqual(
      (await getEventCalendars(eventID)).sort(),
      [home.id, copy.id].sort(),
    );
    assert.equal(
      (
        await send(
          "POST",
          { calendarID: forkHome.id, expectedRevision: 3 },
          `/events/${eventID}/fork`,
        )
      ).status,
      409,
    );
    const fork = await send(
      "POST",
      { calendarID: forkHome.id, expectedRevision: 4 },
      `/events/${eventID}/fork`,
    );
    assert.equal(fork.status, 201);
    assert.equal(fork.body.revision, 1);
    assert.notEqual(fork.body.id, eventID);
    assert.equal((await getEvent(eventID)).revision, 4);
    await linkEventToCalendars(eventID, [copy.id]);
    assert.equal(
      (await getEvent(eventID)).revision,
      4,
      "administrative no-op links do not bump",
    );
    await removeCalendar(copy.id);
    assert.equal(
      (await getEvent(eventID)).revision,
      5,
      "FK link cascade changes surviving identity revision",
    );
    const deleted = await send("DELETE", { id: eventID, expectedRevision: 5 });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.revision, 6);
    assert.equal(deleted.body.removed, true);
    assert.equal(
      (await send("PATCH", { id: eventID, expectedRevision: 6, patch: {} }))
        .status,
      409,
    );
    console.log(
      "authenticated Event PATCH/CAS: read, null, no-op, race, links, fork, cascade, tombstone, old-client and legacy refusal OK",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(user).where(eq(user.id, id));
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
