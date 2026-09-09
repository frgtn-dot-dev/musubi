import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { graphAdoptionFixture } from "./microsoft_create_adoption.fixture";
import { findGraphCreatedSeries, findGraphCreatedSeriesAdoption } from "./microsoft_series_create";
import { readGraphSeriesFamily } from "./microsoft_series_family";
async function main() {
  const saved = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000101", revision: 1, creatorID: "owner", organizer: "", calendars: [], title: "Saved title", color: "red", isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" }) });
  const fixture = await graphAdoptionFixture({ ...saved, title: "Provider title", recurrence: "RRULE:FREQ=DAILY;COUNT=3" });
  const identity = { operationID: fixture.state.operationID };
  try {
    await assert.rejects(() => findGraphCreatedSeries("fixture", "calendar", saved, identity));
    const candidate = await findGraphCreatedSeriesAdoption("fixture", "calendar", saved, identity); assert.ok(candidate);
    assert.equal(candidate.candidate.title, "Provider title"); assert.match(candidate.candidate.recurrence!, /COUNT=3/);
    const family = await readGraphSeriesFamily("fixture", "calendar", candidate.candidate, candidate.evidence.ref);
    assert.equal(family.instances.length, 3); assert.equal(saved.title, "Saved title"); assert.equal(saved.recurrence, "RRULE:FREQ=DAILY;COUNT=4");
    for (const mode of ["duplicate", "meeting", "no-end", "exception"]) { fixture.state.mode = mode; await assert.rejects(() => findGraphCreatedSeriesAdoption("fixture", "calendar", saved, identity), mode); }
    fixture.state.mode = "ok";
    const mutable = structuredClone(saved), mutableIdentity = { ...identity };
    const pending = findGraphCreatedSeriesAdoption("fixture", "calendar", mutable, mutableIdentity);
    mutable.title = "Concurrent draft"; mutable.recurrence = "RRULE:FREQ=DAILY"; mutableIdentity.operationID = saved.id;
    assert.deepEqual(await pending, candidate);
    fixture.state.mode = "absent"; assert.equal(await findGraphCreatedSeriesAdoption("fixture", "calendar", saved, identity), null);
    fixture.state.mode = "partial"; await assert.rejects(() => readGraphSeriesFamily("fixture", "calendar", candidate.candidate, candidate.evidence.ref));
    assert.equal(fixture.state.writes, 0);
    console.log("Graph explicit adoption candidate: unique changed finite master, strict original ACK, full family, no write, absent/duplicate/meeting/noEnd/partial refusal: OK");
  } finally { await fixture.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
