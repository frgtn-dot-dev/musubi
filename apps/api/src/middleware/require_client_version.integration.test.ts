import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, replaceMemberToken, user } from "@musubi/db";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "./require_auth";
import { middlewareErrorHandler } from "./error_handler";
import { handlerGetEvents, handlerCreateEvent } from "../handlers/events";
import { handlerServer } from "../handlers/server";
import { handlerStream } from "../handlers/stream";
import { handlerFederationAccept, handlerFederationRotateToken } from "../handlers/federation";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const id = `version-${randomUUID()}`;
  const token = issueMemberToken();
  await db.insert(user).values({ id, name: id, email: `${id}@example.test`, isExternal: true });
  await replaceMemberToken(id, token.tokenHash);
  const app = express();
  app.use(express.json());
  app.get("/api/v1/server", handlerServer);
  app.get("/api/v1/events", requireAuth, handlerGetEvents);
  app.post("/api/v1/events", requireAuth, handlerCreateEvent);
  app.get("/api/stream", requireAuth, handlerStream);
  app.post("/api/v1/federation/accept", handlerFederationAccept);
  app.post("/api/v1/federation/token/rotate", requireAuth, handlerFederationRotateToken);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, version?: string, method = "GET") => fetch(origin + path, {
    method, headers: { authorization: `Bearer ${token.raw}`, ...(version === undefined ? {} : { [CLIENT_VERSION_HEADER]: version }) },
  });
  try {
    for (const version of [undefined, "", "0.1.7", "0.1.8garbage", "9", "1.2.3.4", "Infinity.1.2"]) {
      for (const [path, method] of [["/api/v1/events", "GET"], ["/api/v1/events", "POST"], ["/api/stream", "GET"]]) {
        const response = await request(path!, version, method);
        assert.equal(response.status, 426, `${method} ${path} refuses ${version}`);
        assert.equal((await response.json()).error, "ClientUpgradeRequired");
      }
    }
    assert.equal((await request("/api/v1/events?clientVersion=0.1.8")).status, 426, "query spelling is stream-only");
    assert.equal((await request("/api/v1/events", PRODUCT_VERSION)).status, 200);
    assert.equal((await request("/api/v1/events", PRODUCT_VERSION, "POST")).status, 400, "compatible version does not authorize malformed writes");
    assert.equal((await fetch(origin + "/api/v1/events", { headers: { [CLIENT_VERSION_HEADER]: PRODUCT_VERSION } })).status, 401, "version is not authentication");
    assert.equal((await fetch(origin + "/api/v1/server")).status, 200, "discovery remains available for upgrade");
    for (const path of ["/api/stream", "/api/stream?clientVersion=0.1.8"]) {
      const controller = new AbortController();
      const response = await fetch(origin + path, { signal: controller.signal, headers: {
        authorization: `Bearer ${token.raw}`, ...(path.includes("?") ? {} : { [CLIENT_VERSION_HEADER]: PRODUCT_VERSION }),
      } });
      assert.equal(response.status, 200);
      controller.abort();
    }
    const oldPeer = await request("/api/v1/federation/accept", "0.1.7", "POST");
    assert.equal(oldPeer.status, 426, "old peer handshake is refused before creating a shadow user");
    assert.equal((await request("/api/v1/federation/accept", PRODUCT_VERSION, "POST")).status, 400, "compatible handshake still validates invite");
    assert.equal((await request("/api/v1/federation/token/rotate", undefined, "POST")).status, 200, "machine credential lifecycle is the narrow authenticated exemption");
    assert.equal((await fetch(origin + "/api/v1/federation/token/rotate", { method: "POST" })).status, 401);
    console.log("client/peer version real auth/read/write/stream/handshake gate: OK");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(user).where(eq(user.id, id));
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
