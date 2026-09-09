import assert from "node:assert/strict";
import { createServer } from "node:http";
export const caldavRsvpFixtureData = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Musubi//RSVP Fixture//EN", "BEGIN:VEVENT", "UID:rsvp-fixture", "DTSTART:20260328T090000Z", "DTEND:20260328T100000Z", "DTSTAMP:20260301T090000Z", "SEQUENCE:2", "SUMMARY:Private meeting", "DESCRIPTION:Private notes", "ORGANIZER;CN=Organizer:mailto:organizer@example.test", "ATTENDEE;CN=Self;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:self@example.test", "ATTENDEE;CN=Other;PARTSTAT=ACCEPTED:mailto:other@example.test", "X-PRIVATE;X-KEEP=yes:Folded", " extension", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Private alarm", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
export const caldavRsvpDstDurationData = caldavRsvpFixtureData
  .replace("BEGIN:VEVENT", ["BEGIN:VTIMEZONE", "TZID:Europe/Prague", "BEGIN:STANDARD", "DTSTART:19701025T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "BEGIN:DAYLIGHT", "DTSTART:19700329T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "END:VTIMEZONE", "BEGIN:VEVENT"].join("\r\n"))
  .replace("DTSTART:20260328T090000Z", "DTSTART;TZID=Europe/Prague:20260328T090000")
  .replace("DTEND:20260328T100000Z", "DURATION:PT24H");
export async function createCaldavRsvpFixture() {
  const state = { data: caldavRsvpFixtureData, etag: '"before"', scheduleTag: '"schedule-before"', mode: "ok", puts: 0, reads: 0, requests: [] as string[], onRead: undefined as (() => Promise<void>) | undefined, onPut: undefined as (() => Promise<void>) | undefined };
  const server = createServer(async (req, res) => {
    state.requests.push(`${req.method} ${req.url}`);
    assert.ok(req.headers.authorization?.startsWith("Basic "));
    if (state.mode === "redirect") { res.writeHead(302, { location: "http://foreign.invalid/leak" }); return res.end(); }
    const transient = /^(OPTIONS|PROPFIND)-(408|429|503)$/.exec(state.mode);
    if (transient && req.method === transient[1]) { res.writeHead(Number(transient[2]), { "retry-after": "17" }); return res.end(); }
    if (req.method === "OPTIONS") { res.writeHead(200, { DAV: state.mode === "no-auto" ? "1, calendar-access" : "1, calendar-access, calendar-auto-schedule" }); return res.end(); }
    if (req.method === "PROPFIND") {
      assert.equal(req.headers.depth, "0");
      let props: string;
      if (req.url === "/collection/") props = `<d:current-user-principal><d:href>${state.mode === "cross-origin" ? "http://foreign.invalid/principal/" : "/principal/"}</d:href></d:current-user-principal><d:owner><d:href>${state.mode === "wrong-owner" ? "/other/" : "/principal/"}</d:href></d:owner>`;
      else if (req.url === "/principal/") props = `<c:calendar-user-address-set><d:href>mailto:self@example.test</d:href>${state.mode === "two-self" ? "<d:href>mailto:other@example.test</d:href>" : ""}</c:calendar-user-address-set><c:schedule-outbox-URL><d:href>/outbox/</d:href></c:schedule-outbox-URL>`;
      else if (req.url === "/outbox/") props = `<d:resourcetype><d:collection/>${state.mode === "no-outbox" ? "" : "<c:schedule-outbox/>"}</d:resourcetype><d:current-user-privilege-set><d:privilege><c:${state.mode === "no-reply" ? "schedule-send-invite" : "schedule-send-reply"}/></d:privilege></d:current-user-privilege-set>`;
      else { assert.equal(req.url, "/collection/invite.ics"); props = `<d:current-user-privilege-set><d:privilege><d:${state.mode === "no-write" ? "read" : "write-content"}/></d:privilege></d:current-user-privilege-set>`; }
      const response = `<d:response><d:href>${state.mode === "wrong-href" ? "/elsewhere" : req.url}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 ${state.mode === "failed-propstat" ? "403 Forbidden" : state.mode === "partial-propstat" ? "206 Partial Content" : "200 OK"}</d:status></d:propstat></d:response>`;
      res.writeHead(207, { "content-type": "application/xml" }); return res.end(`<d:multistatus xmlns:d="DAV:" xmlns:c="${state.mode === "wrong-namespace" ? "urn:evil" : "urn:ietf:params:xml:ns:caldav"}">${response}${state.mode === "duplicate-response" ? response : ""}</d:multistatus>`);
    }
    assert.equal(req.url, "/collection/invite.ics");
    if (req.method === "GET") {
      state.reads++; await state.onRead?.();
      res.writeHead(200, { "content-type": "text/calendar", etag: state.mode === "weak-etag" ? 'W/"weak"' : state.etag, ...(state.mode === "no-schedule-tag" ? {} : { "schedule-tag": state.scheduleTag }) }); return res.end(state.data);
    }
    assert.equal(req.method, "PUT"); assert.equal(req.headers["if-schedule-tag-match"], undefined); assert.equal(req.headers["schedule-reply"], undefined);
    state.puts++;
    if (req.headers["if-match"] !== state.etag || state.mode === "race") { res.writeHead(412); return res.end(); }
    let data = ""; for await (const chunk of req) data += chunk;
    state.data = data; state.etag = '"after"'; state.scheduleTag = '"schedule-after"';
    if (state.mode === "metadata") state.data = state.data.replace("DTSTAMP:20260301T090000Z", "DTSTAMP:20260302T090000Z").replace("ORGANIZER;CN=Organizer:", 'ORGANIZER;CN=Organizer;SCHEDULE-STATUS="2.0":');
    if (state.mode === "changed-after") state.data = state.data.replace("Private notes", "Concurrent private notes");
    await state.onPut?.();
    if (state.mode === "lost") { req.socket.destroy(); return; }
    res.writeHead(204); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address(); assert.ok(addr && typeof addr !== "string");
  const origin = `http://127.0.0.1:${addr.port}`;
  return { state, origin, collection: origin + "/collection/", resource: origin + "/collection/invite.ics", close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
