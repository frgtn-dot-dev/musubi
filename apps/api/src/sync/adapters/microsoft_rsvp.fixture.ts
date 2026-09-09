import assert from "node:assert/strict";
import { createServer } from "node:http";
export function graphRsvpNative() {
  return { id: "meeting", iCalUId: "meeting-uid", "@odata.etag": 'W/"v1"', changeKey: "v1", type: "singleInstance", isCancelled: false, isOrganizer: false, isDraft: false, recurrence: null,
    subject: "Project meeting", body: { contentType: "text", content: "Keep details" }, location: { displayName: "Room" },
    start: { dateTime: "2026-03-28T08:00:00", timeZone: "UTC" }, end: { dateTime: "2026-03-28T09:00:00", timeZone: "UTC" },
    originalStartTimeZone: "Europe/Prague", originalEndTimeZone: "Europe/Prague", isAllDay: false,
    organizer: { emailAddress: { address: "organizer@example.test", name: "Organizer" } },
    attendees: [{ emailAddress: { address: "self@example.test", name: "Self" }, type: "required", status: { response: "notResponded", time: "2026-03-27T08:00:00Z" } }, { emailAddress: { address: "guest@example.test" }, type: "optional", status: { response: "accepted" } }],
    responseStatus: { response: "notResponded", time: "2026-03-27T08:00:00Z" }, isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", onlineMeeting: null, onlineMeetingUrl: null,
    customPreserved: { value: "untouched" },
  };
}
export async function graphRsvpFixture() {
  const state = { native: graphRsvpNative(), mode: "ok", posts: 0, reads: 0, marked: false, hook: undefined as (() => Promise<void>) | undefined };
  const server = createServer((req, res) => { void (async () => {
    assert.equal(req.headers.authorization, "Bearer fixture");
    const url = new URL(req.url!, "http://fixture"), reply = (value: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.method === "GET") {
      state.reads++;
      if (url.pathname === "/v1.0/me") return reply({ id: "account", mail: "self@example.test", userPrincipalName: "self@example.test" });
      if (url.pathname === "/v1.0/me/calendar") return reply({ id: "calendar", isDefaultCalendar: true, canEdit: state.mode !== "denied", owner: { address: state.mode === "foreign" ? "foreign@example.test" : "self@example.test" } });
      assert.equal(url.pathname, "/v1.0/me/calendars/calendar/events/meeting");
      await state.hook?.();
      return state.mode === "missing" || state.mode === "decline-absent" && state.posts > 0 ? reply({}, 404) : reply(state.native);
    }
    assert.equal(req.method, "POST"); assert.equal(state.marked, true, "private marker must exist before network action");
    state.posts++;
    let body = ""; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { sendResponse: true }); assert.equal(req.headers["if-match"], undefined);
    const action = url.pathname.split("/").slice(-1)[0];
    assert.ok(["accept", "tentativelyAccept", "decline"].includes(action!));
    if (state.mode !== "not-observed") {
      const response = action === "accept" ? "accepted" : action === "tentativelyAccept" ? "tentativelyAccepted" : "declined";
      state.native.responseStatus.response = response; state.native.attendees[0]!.status.response = response;
      state.native["@odata.etag"] = 'W/"v2"'; state.native.changeKey = "v2";
    }
    if (state.mode === "lost") return res.destroy();
    if (state.mode === "changed") state.native.customPreserved.value = "concurrent change";
    return reply(null, 202);
  })().catch(error => { res.statusCode = 500; res.end(String(error)); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  return { state, originalFetch, close: async () => { globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
