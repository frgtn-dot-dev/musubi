import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { account, db, user } from "@musubi/db";
import { decryptToken, encryptToken } from "../tokenCrypto";
import { ProviderAuthError } from "./errors";
import { getOAuthAccessToken } from "./oauth";

async function main() {
  if (process.env.ENVIRONMENT !== "test") {
    throw new Error("Refusing to run provider DB integration test unless ENVIRONMENT=test");
  }

  const suffix = randomUUID();
  const userID = `provider-oauth-${suffix}`;
  const rotatingID = `rotating-${suffix}`;
  const revokedID = `revoked-${suffix}`;
  const transientID = `transient-${suffix}`;
  const siblingID = `sibling-${suffix}`;
  const transientAttempts = { count: 0 };
  const receivedRefreshTokens: string[] = [];
  let tokenEndpoint = "";
  let userCreated = false;

  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const refreshToken = new URLSearchParams(body).get("refresh_token") ?? "";
      receivedRefreshTokens.push(refreshToken);
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (refreshToken === "rotating-refresh") {
        return json(200, {
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 1_800,
        });
      }
      if (refreshToken === "revoked-refresh") {
        return json(400, {
          error: "invalid_grant",
          error_subtype: "invalid_rapt",
        });
      }
      if (refreshToken === "transient-refresh") {
        transientAttempts.count++;
        if (transientAttempts.count === 1) {
          return json(503, { error: "temporarily_unavailable" });
        }
        return json(200, {
          access_token: "recovered-access",
          expires_in: 3_600,
        });
      }
      return json(500, { error: "unexpected_test_refresh_token" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake token endpoint did not bind.");
  tokenEndpoint = `http://127.0.0.1:${address.port}/token`;

  try {
    await db.insert(user).values({
      id: userID,
      name: "Provider OAuth test",
      email: `${userID}@example.test`,
    });
    userCreated = true;

    const encrypted = await Promise.all([
      encryptToken("rotating-refresh"),
      encryptToken("revoked-refresh"),
      encryptToken("transient-refresh"),
      encryptToken("sibling-refresh"),
    ]);
    await db.insert(account).values([
      {
        id: `row-${rotatingID}`,
        accountId: rotatingID,
        providerId: "google",
        userId: userID,
        refreshToken: encrypted[0],
        accessToken: await encryptToken("expired-access"),
        accessTokenExpiresAt: new Date(Date.now() - 60_000),
      },
      {
        id: `row-${revokedID}`,
        accountId: revokedID,
        providerId: "google",
        userId: userID,
        refreshToken: encrypted[1],
      },
      {
        id: `row-${transientID}`,
        accountId: transientID,
        providerId: "google",
        userId: userID,
        refreshToken: encrypted[2],
      },
      {
        id: `row-${siblingID}`,
        accountId: siblingID,
        providerId: "google",
        userId: userID,
        refreshToken: encrypted[3],
      },
    ]);

    const config = {
      tokenEndpoint,
      clientId: "test-client",
      clientSecret: "test-secret",
      subtypeKey: "error_subtype",
    };

    assert.equal(
      await getOAuthAccessToken("google", userID, rotatingID, config),
      "rotated-access",
    );
    const [rotated] = await db.select().from(account)
      .where(eq(account.id, `row-${rotatingID}`));
    assert.notEqual(rotated.accessToken, "rotated-access");
    assert.notEqual(rotated.refreshToken, "rotated-refresh");
    assert.equal(await decryptToken(rotated.accessToken), "rotated-access");
    assert.equal(await decryptToken(rotated.refreshToken), "rotated-refresh");
    assert.ok(rotated.accessTokenExpiresAt! > new Date());

    await assert.rejects(
      getOAuthAccessToken("google", userID, revokedID, config),
      (error: unknown) =>
        error instanceof ProviderAuthError
        && error.code === "invalid_grant"
        && error.subtype === "invalid_rapt"
        && error.reconnectRequired,
    );
    const [revoked, sibling] = await Promise.all([
      db.select().from(account).where(eq(account.id, `row-${revokedID}`))
        .then((rows) => rows[0]),
      db.select().from(account).where(eq(account.id, `row-${siblingID}`))
        .then((rows) => rows[0]),
    ]);
    assert.equal(revoked.syncStatus, "reconnect_required");
    assert.equal(revoked.refreshToken, null);
    assert.equal(revoked.syncErrorCode, "invalid_grant");
    assert.equal(revoked.syncErrorSubtype, "invalid_rapt");
    assert.equal(await decryptToken(sibling.refreshToken), "sibling-refresh");
    assert.equal(sibling.syncStatus, "active");

    await assert.rejects(
      getOAuthAccessToken("google", userID, transientID, config),
      (error: unknown) =>
        error instanceof ProviderAuthError
        && error.code === "temporarily_unavailable"
        && !error.reconnectRequired,
    );
    const [afterTransientFailure] = await db.select().from(account)
      .where(eq(account.id, `row-${transientID}`));
    assert.equal(afterTransientFailure.syncStatus, "active");
    assert.equal(
      await decryptToken(afterTransientFailure.refreshToken),
      "transient-refresh",
    );

    assert.equal(
      await getOAuthAccessToken("google", userID, transientID, config),
      "recovered-access",
    );
    assert.equal(transientAttempts.count, 2);
    assert.deepEqual(receivedRefreshTokens, [
      "rotating-refresh",
      "revoked-refresh",
      "transient-refresh",
      "transient-refresh",
    ]);
  } finally {
    if (userCreated) await db.delete(user).where(eq(user.id, userID));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }

  console.log("provider OAuth lifecycle integration self-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
