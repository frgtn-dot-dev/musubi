import assert from "node:assert/strict";
import { fetchGoogleChanges } from "./google";

const shell = {
  id: "synthetic-private", etag: '"unchanged"', status: "confirmed", visibility: "private",
  start: { dateTime: "2026-09-23T10:00:00+02:00", timeZone: "Europe/Prague" },
  end: { dateTime: "2026-09-23T11:00:00+02:00", timeZone: "Europe/Prague" },
};

async function main() {
  for (const timeModels of [false, true]) {
    for (const role of ["reader", "writerWithoutPrivateAccess", "owner", "writer", "future-role", undefined]) {
      const items = [
        shell,
        { ...shell, id: "public", visibility: "public" },
        { ...shell, id: "default", visibility: "default" },
        { ...shell, id: "supplied", summary: "Native title" },
        { ...shell, id: "empty", summary: "" },
        { ...shell, id: "attendee", organizer: { email: "synthetic@example.test" } },
        { ...shell, id: "cancelled", status: "cancelled" },
      ];
      const result = await fetchGoogleChanges("synthetic", "source", null, {
        timeModels,
        fetchImpl: async () => Response.json({ accessRole: role, items, nextSyncToken: "next" }),
      });
      const normalized = result.changes.map(change => {
        assert.equal(change.kind, "event");
        if (change.kind !== "event") throw new Error("Expected event");
        return change.data;
      });
      assert.deepEqual(normalized.map(event => event.title), [
        role === "reader" || role === "writerWithoutPrivateAccess" ? "Busy" : "(untitled)",
        "(untitled)", "(untitled)", "Native title", "", "(untitled)", "",
      ], `${role}, timeModels=${timeModels}`);
      assert.equal(normalized[0].etag, shell.etag);
      assert.equal(normalized[0].description, null);
      assert.equal(normalized[0].location, null);
      assert.equal(normalized[0].start.toISOString(), "2026-09-23T08:00:00.000Z");
    }
  }
  // Role evidence belongs to each page, never to the last page of a listing.
  let page = 0;
  const paged = await fetchGoogleChanges("synthetic", "source", null, { fetchImpl: async () => Response.json(
    page++ === 0 ? { accessRole: "reader", items: [shell], nextPageToken: "page2" }
      : { accessRole: "owner", items: [{ ...shell, id: "owner-untitled" }], nextSyncToken: "next" },
  ) });
  assert.deepEqual(paged.changes.map(change => {
    assert.equal(change.kind, "event");
    if (change.kind !== "event") throw new Error("Expected event");
    return change.data.title;
  }), ["Busy", "(untitled)"]);
  console.log("Google private list shells use Busy only with fresh restricted role evidence; ordinary untitled reads preserved: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
