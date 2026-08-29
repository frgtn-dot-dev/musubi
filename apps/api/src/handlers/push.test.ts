import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createPushHandlers, fingerprintEndpoint } from "./push";

// A push endpoint is a URL this server will later make requests to, and it
// arrives from a browser. That makes the schema a trust boundary, not a
// formality: an unbounded or non-https string here is somebody else's outage
// with our server's name on it.

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { auth: "auth-secret", p256dh: "public-key" };

function recorder() {
  let statusCode = 0;
  let ended = false;
  let body: unknown;
  const response = {
    end() {
      ended = true;
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;
  return {
    body: () => body,
    ended: () => ended,
    response,
    statusCode: () => statusCode,
  };
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

  {
    // Listing exists to answer "does the server still know about this browser?"
    // — the question that had no way to be asked, and the reason a subscription
    // dropped on a 410 could go unnoticed forever.
    const seen = new Date("2026-08-20T10:00:00.000Z");
    const asked: string[] = [];
    const handlers = createPushHandlers({
      list: async (userID) => {
        asked.push(userID);
        return [
          { endpoint: ENDPOINT, lastSeenAt: seen },
          { endpoint: `${ENDPOINT}-other`, lastSeenAt: seen },
        ];
      },
    });

    const listed = recorder();
    await handlers.listSubscriptions(request(undefined), listed.response);

    assert.deepEqual(asked, ["user-1"], "scoped to the caller");
    assert.equal(listed.statusCode(), 200);
    assert.deepEqual(listed.body(), {
      subscriptions: [
        {
          fingerprint: fingerprintEndpoint(ENDPOINT),
          lastSeenAt: seen.toISOString(),
        },
        {
          fingerprint: fingerprintEndpoint(`${ENDPOINT}-other`),
          lastSeenAt: seen.toISOString(),
        },
      ],
    });

    // The whole point of the digest. An endpoint is a capability URL — anyone
    // holding it can make that device buzz — so a read that returned them would
    // turn diagnostics into a way to collect them.
    const serialised = JSON.stringify(listed.body());
    assert.ok(
      !serialised.includes(ENDPOINT),
      "the endpoint itself must never leave the server",
    );
    assert.ok(
      !serialised.includes("fcm.googleapis.com"),
      "not even the push service host",
    );

    // A browser can still find itself: it hashes the endpoint it already holds.
    assert.equal(
      fingerprintEndpoint(ENDPOINT),
      fingerprintEndpoint(ENDPOINT),
      "the digest is stable",
    );
    assert.notEqual(
      fingerprintEndpoint(ENDPOINT),
      fingerprintEndpoint(`${ENDPOINT}-other`),
      "and it distinguishes two endpoints",
    );
  }

  console.log("handlers/push.test.ts ok");
}

void run();
