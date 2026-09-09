import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "@musubi/config";
import { MicrosoftOrganizerRequestSchema, ProviderOrganizerRequestSchema, type ProviderOrganizerIntent } from "@musubi/types";
import { fetchMicrosoftChanges } from "./microsoft";
import { microsoftOrganizerBody, microsoftOrganizerEvidence, microsoftOrganizerTransport } from "./microsoft_organizer";
async function main() {
  const request = MicrosoftOrganizerRequestSchema.parse({ provider: "microsoft", action: "create", notificationPolicy: "server-invite", operationID: randomUUID(), eventID: randomUUID(), calendarID: randomUUID(), color: "#777777", content: { title: "Team meeting", description: "Notes", location: "Room" }, guests: [{ email: "guest@example.test", optional: false }], time: { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-15T09:00:00", endLocal: "2026-09-15T10:00:00" } });
  const desired = microsoftOrganizerBody(request, "self@example.test");
  const native = () => ({ ...structuredClone(desired), id: "native", iCalUId: "uid", "@odata.etag": 'W/"version"', type: "singleInstance", originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", isCancelled: false, isDraft: false, isOrganizer: true, recurrence: null, organizer: { emailAddress: { address: "self@example.test" } }, onlineMeeting: null, onlineMeetingUrl: null, hasAttachments: false });
  assert.equal(microsoftOrganizerEvidence(native(), request, "self@example.test").native.id, "native");
  assert.throws(() => ProviderOrganizerRequestSchema.parse({ ...request, action: "delete" }));
  assert.throws(() => ProviderOrganizerRequestSchema.parse({ ...request, sendUpdates: "all" }));
  for (const change of [{ attendees: [] }, { "attendees@odata.count": 2 }, { originalStartTimeZone: "Europe/Prague" }, { isOrganizer: false }, { transactionId: randomUUID() }, { recurrence: {} }, { hasAttachments: true }, { "attendees@odata.nextLink": "https://graph.microsoft.com/next" }]) assert.throws(() => microsoftOrganizerEvidence({ ...native(), ...change }, request, "self@example.test"));
  for (const response of ["accepted", "tentativelyAccepted", "declined", "notResponded", "none"]) {
    const answered = native();
    const raw = { ...answered, attendees: answered.attendees.map(guest => ({ ...guest, status: { response, time: "2026-09-15T08:00:00Z" } })) };
    assert.equal(microsoftOrganizerEvidence(raw, request, "self@example.test").native.id, "native");
    assert.throws(() => microsoftOrganizerEvidence({ ...raw, subject: "Changed" }, request, "self@example.test"));
  }
  const allDay = MicrosoftOrganizerRequestSchema.parse({ ...request, time: { kind: "all-day", startDate: "2026-09-15", endDate: "2026-09-16" } });
  assert.equal(microsoftOrganizerBody(allDay, "self@example.test").end.dateTime, "2026-09-17T00:00:00.000");
  const oldFetch = globalThis.fetch, oldFlag = config.api.providerOrganizerEditsEnabled;
  config.api.providerOrganizerEditsEnabled = true;
  let posts = 0, stored = false, mode = "ok", marked = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1.0/me") return response({ id: mode === "wrong-account" ? "other" : "graph-object-id", mail: "self@example.test", userPrincipalName: "self@example.test" });
    if (url.pathname === "/v1.0/me/calendar") return response({ id: "calendar", isDefaultCalendar: mode !== "secondary", canEdit: mode !== "denied", owner: { address: mode === "foreign" ? "other@example.test" : "self@example.test" } });
    assert.equal(url.pathname, "/v1.0/me/calendars/calendar/events");
    if (init?.method === "POST") { assert.ok(marked); posts++; assert.deepEqual(JSON.parse(String(init.body)), desired); stored = true; if (mode === "lost") throw new Error("lost response"); return response({ id: "native" }, 201); }
    return response({ value: stored ? [native(), ...(mode === "duplicate" ? [native()] : [])] : [], ...(mode === "foreign-page" ? { "@odata.nextLink": "https://other.example.test/events" } : {}) });
  };
  const connect = () => microsoftOrganizerTransport(async () => "fixture")("user", "account", "calendar");
  const intent = (): ProviderOrganizerIntent => ({ request, desired, baseline: null, mappingID: null, graphIdentity: { oauthAccountID: "account", graphUserID: "graph-object-id", calendarID: "calendar", selfAddress: "self@example.test" }, sourceEvent: {} as ProviderOrganizerIntent["sourceEvent"] });
  try {
    for (const bad of ["secondary", "denied", "foreign"]) { mode = bad; await assert.rejects(connect()); assert.equal(posts, 0); }
    mode = "wrong-account";
    await assert.rejects((await connect()).deliver(intent(), async () => { throw Error("must not send"); }, async () => {}));
    assert.equal(posts, 0);
    mode = "lost";
    const transport = await connect(), saved = intent();
    const mark = async () => { marked = true; saved.dispatch = { kind: "microsoft-organizer-dispatch", version: 1, startedAt: new Date().toISOString() }; };
    assert.equal((await transport.deliver(saved, mark, async () => {})).kind, "observed"); assert.equal(posts, 1);
    assert.equal((await transport.deliver(saved, async () => { throw new Error("must not redispatch"); }, async () => {})).kind, "observed"); assert.equal(posts, 1);
    mode = "wrong-account";
    await assert.rejects((await connect()).deliver(saved, async () => { throw Error("must not redispatch"); }, async () => {}));
    assert.equal(posts, 1);
    mode = "lost";
    stored = false;
    assert.equal((await transport.deliver(saved, async () => { throw new Error("must not recreate"); }, async () => {})).kind, "unconfirmed"); assert.equal(posts, 1);
    stored = true; mode = "duplicate"; await assert.rejects(transport.deliver(saved, mark, async () => {})); assert.equal(posts, 1);
    mode = "foreign-page"; await assert.rejects(transport.deliver(saved, mark, async () => {})); assert.equal(posts, 1);
    const pulled = await fetchMicrosoftChanges("fixture", "calendar", null, { timeModels: false, organizerEventIDs: ["native"], now: Date.parse("2026-09-01T00:00:00Z"), fetchImpl: async () => new Response(JSON.stringify({ value: [{ ...native(), start: { dateTime: "2026-09-15T11:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-15T12:00:00.0000000", timeZone: "UTC" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/calendar/calendarView/delta?token=next" }), { status: 200, headers: { "content-type": "application/json" } }) });
    const changed = pulled.changes[0]; assert.equal(changed?.kind, "event");
    if (changed?.kind === "event") { assert.equal(changed.data.start.toISOString(), "2026-09-15T11:00:00.000Z"); assert.equal(changed.data.timeModel?.kind, "zoned"); }
    console.log("Graph organizer create: exact ownership/native proof, immutable policy, lost-response read-only recovery and no repeat POST: OK");
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
