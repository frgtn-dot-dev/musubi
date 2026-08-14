import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, musubiAccounts, upsertMusubiAccount, user } from "@musubi/db";
import type { Request, Response } from "express";
import { encryptSecret } from "./sync/crypto";
import { handlerFederationProxy } from "./handlers/federation_proxy";

// End-to-end check of the federation gateway (ADR-005) against a stand-in
// "server B": the member token must be attached upstream, the home session must
// not leak, and the upstream status/body must be relayed.

type Recorded = {
  auth?: string;
  body: string;
  cookie?: string;
  method?: string;
  url?: string;
};

function fakeResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let payload: unknown;
  const response = {
    json(body: unknown) {
      payload = body;
      return response;
    },
    send(body: unknown) {
      payload = body;
      return response;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;

  return { response, result: () => ({ headers, payload, statusCode }) };
}

function proxyRequest(input: {
  body?: unknown;
  connectionId: string;
  method?: string;
  rest: string[];
  url: string;
  userId: string;
}): Request {
  return {
    body: input.body,
    get: (name: string) =>
      name.toLowerCase() === "accept" ? "application/json" : undefined,
    headers: { cookie: "musubi_session=home-secret" },
    method: input.method ?? "GET",
    originalUrl: input.url,
    params: { connectionId: input.connectionId, rest: input.rest },
    requestId: "gateway-test",
    user: { id: input.userId },
  } as unknown as Request;
}

async function main() {
  if (process.env.ENVIRONMENT !== "test") {
    throw new Error(
      "Refusing to run federation gateway integration test unless ENVIRONMENT=test",
    );
  }

  const userID = `gw-user-${randomUUID()}`;
  const memberToken = `mt1_test_${randomUUID()}`;
  let recorded: Recorded = { body: "" };

  const remote = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      recorded = {
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString(),
        cookie: req.headers.cookie,
        method: req.method,
        url: req.url,
      };
      if (req.url?.startsWith("/api/v1/boom")) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const port = (remote.address() as { port: number }).port;
  const server = `http://127.0.0.1:${port}`;

  await db.insert(user).values({
    email: `${userID}@example.test`,
    emailVerified: true,
    id: userID,
    name: "Gateway Test",
  });

  try {
    await upsertMusubiAccount(userID, server, "fed_remote", encryptSecret(memberToken));
    const [account] = await db
      .select()
      .from(musubiAccounts)
      .where(eq(musubiAccounts.userID, userID));
    assert.ok(account, "connection row must exist");

    // GET relays path + query, attaches the member token, drops the home cookie.
    {
      const { response, result } = fakeResponse();
      await handlerFederationProxy(
        proxyRequest({
          connectionId: account.id,
          rest: ["api", "v1", "events"],
          url: `/api/v1/federation/s/${account.id}/api/v1/events?since=2026-07-01`,
          userId: userID,
        }),
        response,
      );

      assert.equal(recorded.method, "GET");
      assert.equal(recorded.url, "/api/v1/events?since=2026-07-01");
      assert.equal(recorded.auth, `Bearer ${memberToken}`);
      assert.equal(recorded.cookie, undefined, "home cookie must not be forwarded");
      assert.equal(result().statusCode, 200);
      assert.equal(result().payload, JSON.stringify({ ok: true }));
    }

    // Writes forward the JSON body.
    {
      const { response, result } = fakeResponse();
      await handlerFederationProxy(
        proxyRequest({
          body: { attending: true },
          connectionId: account.id,
          method: "PUT",
          rest: ["api", "v1", "events", "e1", "attendance"],
          url: `/api/v1/federation/s/${account.id}/api/v1/events/e1/attendance`,
          userId: userID,
        }),
        response,
      );

      assert.equal(recorded.method, "PUT");
      assert.equal(recorded.url, "/api/v1/events/e1/attendance");
      assert.equal(recorded.body, JSON.stringify({ attending: true }));
      assert.equal(result().statusCode, 200);
    }

    // Upstream rejections keep their status (no laundering into 200/500).
    {
      const { response, result } = fakeResponse();
      await handlerFederationProxy(
        proxyRequest({
          connectionId: account.id,
          rest: ["api", "v1", "boom"],
          url: `/api/v1/federation/s/${account.id}/api/v1/boom`,
          userId: userID,
        }),
        response,
      );
      assert.equal(result().statusCode, 403);
    }

    // Another user's connection id is invisible.
    await assert.rejects(
      () =>
        handlerFederationProxy(
          proxyRequest({
            connectionId: account.id,
            rest: ["api", "v1", "events"],
            url: `/api/v1/federation/s/${account.id}/api/v1/events`,
            userId: `someone-else-${randomUUID()}`,
          }),
          fakeResponse().response,
        ),
      /not found/i,
    );

    // A dead origin becomes 502, not an unhandled error.
    {
      await new Promise<void>((resolve) => remote.close(() => resolve()));
      const { response, result } = fakeResponse();
      await handlerFederationProxy(
        proxyRequest({
          connectionId: account.id,
          rest: ["api", "v1", "events"],
          url: `/api/v1/federation/s/${account.id}/api/v1/events`,
          userId: userID,
        }),
        response,
      );
      assert.equal(result().statusCode, 502);
    }

    console.log("federation gateway DB integration self-check: OK");
  } finally {
    await db.delete(musubiAccounts).where(eq(musubiAccounts.userID, userID));
    await db.delete(user).where(eq(user.id, userID));
    remote.close();
  }
}

void main();
