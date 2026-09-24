import assert from "node:assert/strict";
import { createServer } from "node:http";
import { graphRsvpNative } from "./microsoft_rsvp.fixture";

export function graphRsvpSeriesNative() {
  const base = { ...graphRsvpNative(), isOnlineMeeting: false, showAs: "tentative" };
  const master: any = {
    ...structuredClone(base),
    id: "series",
    iCalUId: "series-uid",
    type: "seriesMaster",
    originalStart: null,
    recurrence: {
      pattern: { type: "daily", interval: 1 },
      range: { type: "numbered", startDate: "2026-03-28", numberOfOccurrences: 4, recurrenceTimeZone: "Europe/Prague" },
    },
    exceptionOccurrences: [],
    cancelledOccurrences: ["cancelled-slot-30"],
  };
  const instances: any[] = [28, 29, 31].map((day) => ({
    ...structuredClone(base),
    id: `slot-${day}`,
    iCalUId: `slot-${day}-uid`,
    type: "occurrence",
    seriesMasterId: "series",
    originalStart: `2026-03-${day}T0${day === 28 ? 8 : 7}:00:00.000Z`,
    start: { dateTime: `2026-03-${day}T0${day === 28 ? 8 : 7}:00:00`, timeZone: "UTC" },
    end: { dateTime: `2026-03-${day}T0${day === 28 ? 9 : 8}:00:00`, timeZone: "UTC" },
  }));
  instances[1].type = "exception";
  instances[1].subject = "Moved exception";
  instances[1].start.dateTime = "2027-01-01T11:00:00";
  instances[1].end.dateTime = "2027-01-01T12:00:00";
  instances[1].responseStatus.response = "accepted";
  instances[1].showAs = "busy";
  master.exceptionOccurrences = [structuredClone(instances[1])];
  return { master, instances };
}

export async function graphRsvpSeriesFixture() {
  const state = {
    ...graphRsvpSeriesNative(),
    mode: "ok",
    posts: 0,
    reads: 0,
    marked: false,
    hook: undefined as (() => Promise<void>) | undefined,
  };
  const server = createServer((req, res) => {
    void (async () => {
      assert.equal(req.headers.authorization, "Bearer fixture");
      const url = new URL(req.url!, "http://fixture");
      const reply = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.method === "GET") {
        state.reads++;
        if (url.pathname === "/v1.0/me")
          return reply({ id: "graph-object-id", mail: "self@example.test", userPrincipalName: "self@example.test" });
        if (url.pathname === "/v1.0/me/calendar")
          return reply({
            id: "calendar",
            isDefaultCalendar: true,
            canEdit: true,
            owner: { address: "self@example.test" },
          });
        await state.hook?.();
        if (state.mode === "missing" || (state.mode === "decline-absent" && state.posts))
          return reply({ error: { code: "ErrorItemNotFound" } }, 404);
        if (url.pathname.endsWith("/series/instances")) {
          const items = state.instances.filter((item) => item.type !== "exception");
          return reply({
            value: url.searchParams.has("$skiptoken") ? items.slice(1) : items.slice(0, 1),
            ...(url.searchParams.has("$skiptoken")
              ? {}
              : {
                  "@odata.nextLink":
                    state.mode === "foreign-page"
                      ? "https://attacker.invalid/steal"
                      : "https://graph.microsoft.com/v1.0/me/calendars/calendar/events/series/instances?$skiptoken=next",
                }),
          });
        }
        if (url.pathname.endsWith("/series")) {
          state.master.exceptionOccurrences = state.instances
            .filter((item) => item.type === "exception")
            .map((item) => structuredClone(item));
          if (url.searchParams.has("$expand")) return reply(state.master);
          const plain = structuredClone(state.master);
          delete plain.exceptionOccurrences;
          delete plain.cancelledOccurrences;
          delete plain.originalStart;
          return reply(plain);
        }
        const target = state.instances.find((item) => url.pathname.endsWith("/" + item.id));
        assert.ok(target);
        assert.equal(url.searchParams.get("$select"), "*,originalStart");
        return reply(target);
      }
      assert.equal(req.method, "POST");
      assert.equal(state.marked, true);
      assert.match(url.pathname, /\/series\/(accept|tentativelyAccept|decline)$/);
      let text = "";
      for await (const chunk of req) text += chunk;
      assert.deepEqual(JSON.parse(text), { sendResponse: true });
      assert.equal(req.headers["if-match"], undefined);
      state.posts++;
      const response = url.pathname.endsWith("/accept")
        ? "accepted"
        : url.pathname.endsWith("/tentativelyAccept")
          ? "tentativelyAccepted"
          : "declined";
      if (state.mode !== "not-observed")
        for (const item of [state.master, ...state.instances]) {
          item["@odata.etag"] = 'W/"v' + state.posts + '-after"';
          item.changeKey = "after" + state.posts;
          if (item.type !== "exception") {
            item.responseStatus.response = response;
            if (response === "accepted") item.showAs = "busy";
            if (response === "tentativelyAccepted") item.showAs = "tentative";
          }
          item.responseStatus.time = "2026-03-27T08:02:00Z";
        }
      if (state.mode === "exception-change") state.instances[1].body.content = "Concurrent organizer change";
      if (state.mode === "override-change") state.instances[1].responseStatus.response = "declined";
      if (state.mode === "lost") return res.destroy();
      return reply(null, 202);
    })().catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://graph.microsoft.com");
    return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  return {
    state,
    originalFetch,
    close: async () => {
      globalThis.fetch = originalFetch;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
