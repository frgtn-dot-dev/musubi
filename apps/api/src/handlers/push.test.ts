import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createPushHandlers } from "./push";

// A push endpoint is a URL this server will later make requests to, and it
// arrives from a browser. That makes the schema a trust boundary, not a
// formality: an unbounded or non-https string here is somebody else's outage
// with our server's name on it.

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { auth: "auth-secret", p256dh: "public-key" };

function recorder() {
  let statusCode = 0;
  let ended = false;
  const response = {
    end() {
      ended = true;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;
  return { ended: () => ended, response, statusCode: () => statusCode };
}

const request = (body: unknown) =>
  ({ body, user: { id: "user-1" } }) as unknown as Request;

async function run() {
  {
    const saved: unknown[] = [];
    const handlers = createPushHandlers({
      save: async (input) => void saved.push(input),
    });

    const { ended, response, statusCode } = recorder();
    await handlers.subscribe(
      request({ endpoint: ENDPOINT, keys: KEYS }),
      response,
    );

    assert.equal(statusCode(), 204);
    assert.ok(ended());
    assert.deepEqual(saved[0], {
      auth: KEYS.auth,
      endpoint: ENDPOINT,
      p256dh: KEYS.p256dh,
      userID: "user-1",
    });
  }

  {
    const handlers = createPushHandlers({ save: async () => undefined });
    const rejected = [
      { body: {}, why: "nothing at all" },
      { body: { endpoint: ENDPOINT }, why: "no keys" },
      { body: { endpoint: ENDPOINT, keys: { auth: "a" } }, why: "half the keys" },
      { body: { endpoint: "not a url", keys: KEYS }, why: "not a URL" },
      {
        body: { endpoint: "http://fcm.example/x", keys: KEYS },
        why: "plain http, which no push service uses",
      },
      {
        body: { endpoint: `https://x.example/${"a".repeat(2100)}`, keys: KEYS },
        why: "longer than the column",
      },
      {
        body: { endpoint: ENDPOINT, keys: KEYS, userID: "somebody-else" },
        why: "a userID of its own choosing",
      },
    ];

    for (const { body, why } of rejected) {
      await assert.rejects(
        handlers.subscribe(request(body), recorder().response),
        /Body must be/,
        `accepted ${why}`,
      );
    }
  }

  {
    // Unsubscribing is scoped to the caller — the query carries their id, so
    // holding somebody else's endpoint is not enough to silence their laptop.
    const removed: unknown[][] = [];
    const handlers = createPushHandlers({
      remove: async (...args) => void removed.push(args),
    });

    await handlers.unsubscribe(
      request({ endpoint: ENDPOINT }),
      recorder().response,
    );
    assert.deepEqual(removed[0], ["user-1", ENDPOINT]);

    await assert.rejects(
      handlers.unsubscribe(request({}), recorder().response),
      /Body must be/,
    );
  }

  console.log("handlers/push.test.ts ok");
}

void run();
