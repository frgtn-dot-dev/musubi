import assert from "node:assert/strict";
import { fetchGoogleChanges } from "./google";
const flight = { id: "flight", etag: '\"v1\"', status: "confirmed", summary: "Flight", start: { dateTime: "2026-09-10T10:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-09-11T06:00:00+02:00", timeZone: "Europe/Prague" } };
async function main() {
  for (const rsvpEvidence of [false, true]) {
    const fetched = await fetchGoogleChanges("synthetic", "source", "old", { rsvpEvidence, fetchImpl: async () => Response.json({ items: [flight], nextSyncToken: "next" }) });
    assert.equal(fetched.nextCursor, "next"); assert.equal(fetched.changes.length, 1);
    const change = fetched.changes[0]; assert.equal(change.kind, "event");
    if (change.kind !== "event") throw new Error("Expected event");
    assert.equal(change.data.title, "Flight"); assert.equal(change.data.start.toISOString(), "2026-09-10T14:00:00.000Z");
    assert.equal(change.data.timeModel, undefined); assert.equal(change.data.reminderTimeEvidence, undefined);
  }
  const known = { ...flight, start: { dateTime: "2026-09-10T11:00:00+02:00", timeZone: "Europe/Prague" } };
  const fetched = await fetchGoogleChanges("synthetic", "source", "old", { rsvpEvidence: true, fetchImpl: async () => Response.json({ items: [known], nextSyncToken: "next" }) });
  const change = fetched.changes[0]; assert.equal(change.kind, "event");
  if (change.kind !== "event") throw new Error("Expected event");
  assert.equal(change.data.timeModel, undefined); assert.equal(change.data.reminderTimeEvidence?.kind, "zoned");
  console.log("RSVP-only Google import preserves unsupported multi-zone reads and withholds write-time evidence: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
