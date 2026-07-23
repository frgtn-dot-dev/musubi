import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

function activeGoogleEvent(id: string) {
  return {
    id,
    status: "confirmed",
    summary: id,
    start: { dateTime: "2026-07-23T09:00:00.000Z" },
    end: { dateTime: "2026-07-23T10:00:00.000Z" },
  };
}

function graphEvent(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    subject: id,
    isAllDay: false,
    start: { dateTime: "2026-07-23T09:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-07-23T10:00:00.0000000", timeZone: "UTC" },
    ...extra,
  };
}

async function main() {
  const requests: { url: URL; authorization?: string; prefer?: string }[] = [];
  let googleRetryAttempts = 0;
  let graphMasterRequests = 0;
  let origin = "";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    requests.push({
      url,
      authorization: req.headers.authorization,
      prefer: typeof req.headers.prefer === "string" ? req.headers.prefer : undefined,
    });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.includes("/google/calendars/retry/")) {
      googleRetryAttempts++;
      if (googleRetryAttempts === 1) return json(503, { error: "temporary" });
      return json(200, { items: [], nextSyncToken: "retry-fresh" });
    }
    if (url.pathname.includes("/google/calendars/calendar-1/")) {
      const syncToken = url.searchParams.get("syncToken");
      const pageToken = url.searchParams.get("pageToken");
      if (syncToken === "stale" && !pageToken) {
        return json(200, {
          items: [activeGoogleEvent("discard-before-410")],
          nextPageToken: "stale-page-2",
        });
      }
      if (syncToken === "stale" && pageToken === "stale-page-2") {
        return json(410, { error: "sync token expired" });
      }
      if (!syncToken && !pageToken) {
        return json(200, {
          items: [activeGoogleEvent("fresh-event")],
          nextPageToken: "full-page-2",
        });
      }
      if (!syncToken && pageToken === "full-page-2") {
        return json(200, {
          items: [{ id: "deleted-event", status: "cancelled" }],
          nextSyncToken: "fresh-cursor",
        });
      }
    }

    if (url.pathname === "/graph-expired") {
      return json(200, {
        value: [{
          id: "discard-before-410",
          type: "occurrence",
          seriesMasterId: "master-1",
          start: { dateTime: "2026-07-20T09:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-07-20T10:00:00.0000000", timeZone: "UTC" },
        }],
        "@odata.nextLink": `${origin}/graph-expired-page-2`,
      });
    }
    if (url.pathname === "/graph-expired-page-2") {
      return json(410, { error: { message: "delta expired" } });
    }
    if (url.pathname.includes("/graph/me/calendars/calendar-graph/calendarView/delta")) {
      return json(200, {
        value: [
          graphEvent("master-definition", { type: "seriesMaster" }),
          {
            id: "occurrence-1",
            type: "occurrence",
            seriesMasterId: "master-1",
            start: { dateTime: "2026-07-24T09:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-07-24T10:00:00.0000000", timeZone: "UTC" },
          },
        ],
        "@odata.nextLink": `${origin}/graph-page-2`,
      });
    }
    if (url.pathname === "/graph/me/events/master-1") {
      graphMasterRequests++;
      return json(200, graphEvent("master-1", {
        subject: graphMasterRequests === 1 ? "Stale title" : "Inherited title",
      }));
    }
    if (url.pathname === "/graph-page-2") {
      return json(200, {
        value: [{
          id: "occurrence-2",
          type: "occurrence",
          seriesMasterId: "master-1",
          start: { dateTime: "2026-07-25T09:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-07-25T10:00:00.0000000", timeZone: "UTC" },
        }],
        "@odata.deltaLink": `${origin}/graph-delta-fresh`,
      });
    }

    return json(500, { error: `Unhandled fake-provider request: ${url}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake provider did not bind a TCP port.");
  origin = `http://127.0.0.1:${address.port}`;

  try {
    const { fetchGoogleChanges } = await import("./google");
    const google = await fetchGoogleChanges(
      "google-access",
      "calendar-1",
      "stale",
      { baseUrl: `${origin}/google` },
    );
    assert.equal(google.reset, true);
    assert.equal(google.nextCursor, "fresh-cursor");
    assert.deepEqual(
      google.changes.map(({ externalId, status }) => ({ externalId, status })),
      [
        { externalId: "fresh-event", status: "active" },
        { externalId: "deleted-event", status: "cancelled" },
      ],
    );
    assert.equal(
      google.changes.some((event) => event.externalId === "discard-before-410"),
      false,
    );

    await assert.rejects(
      fetchGoogleChanges("google-access", "retry", null, {
        baseUrl: `${origin}/google`,
      }),
      /Google 503/,
    );
    const retried = await fetchGoogleChanges("google-access", "retry", null, {
      baseUrl: `${origin}/google`,
    });
    assert.equal(retried.nextCursor, "retry-fresh");
    assert.equal(googleRetryAttempts, 2);

    const { fetchMicrosoftChanges, parseCursor } = await import("./microsoft");
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    const microsoft = await fetchMicrosoftChanges(
      "graph-access",
      "calendar-graph",
      JSON.stringify({
        link: `${origin}/graph-expired`,
        windowEnd: now + 365 * 86_400_000,
      }),
      {
        graphBase: `${origin}/graph`,
        now,
      },
    );
    assert.equal(microsoft.reset, true);
    assert.deepEqual(
      microsoft.changes.map(({ externalId, title }) => ({ externalId, title })),
      [
        { externalId: "occurrence-1", title: "Inherited title" },
        { externalId: "occurrence-2", title: "Inherited title" },
      ],
    );
    assert.equal(
      microsoft.changes.some((event) => event.externalId === "discard-before-410"),
      false,
    );
    // Once during the discarded incremental page, once after reset; occurrence
    // 2 then reuses the fresh full-sync cache.
    assert.equal(graphMasterRequests, 2);
    assert.equal(
      parseCursor(microsoft.nextCursor)?.link,
      `${origin}/graph-delta-fresh`,
    );

    assert.ok(requests.every((request) =>
      request.authorization === (
        request.url.pathname.startsWith("/google")
          ? "Bearer google-access"
          : "Bearer graph-access"
      ),
    ));
    const graphRequests = requests.filter((request) =>
      request.url.pathname.startsWith("/graph"),
    );
    assert.ok(graphRequests.every((request) =>
      request.prefer?.includes('outlook.timezone="UTC"'),
    ));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }

  console.log("provider HTTP boundary self-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
