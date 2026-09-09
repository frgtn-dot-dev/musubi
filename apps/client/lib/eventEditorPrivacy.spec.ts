import { expect, it } from "vitest";
import { EventSchema } from "@musubi/types";
import { privateEditorRefresh, refreshedPrivateField } from "./eventEditorPrivacy";
import { liveEventDetail } from "./liveEvent";
const event = EventSchema.parse({ id: "event", isAllDay: false, isCanceled: false, revision: 3, creatorID: "owner", organizer: "Private organizer", title: "Private", description: "Note", location: "Room", url: "https://private.example", color: "red", start: "2026-09-10T09:00:00Z", end: "2026-09-10T10:00:00Z", calendars: ["source"], originCalendarID: "source", recurrence: "FREQ=DAILY", timeModel: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } });
const calendars = [{ id: "source", provider: "google", role: "viewer" }] as any;
const redacted = { ...event, revision: 4, title: "Busy", description: null, location: null, url: null, organizer: "" };
it("refreshes one-off and generated known-occurrence privacy without rebasing temporal authority", () => {
  for (const snapshot of [{ ...event, recurrence: null }, { ...event, start: new Date("2026-09-11T09:00:00Z"), end: new Date("2026-09-11T10:00:00Z"), timeModel: { ...event.timeModel!, startLocal: "2026-09-11T11:00:00.000", endLocal: "2026-09-11T12:00:00.000" } } as typeof event]) {
    const refreshed = privateEditorRefresh(snapshot, redacted, calendars)!;
    expect(refreshed).toMatchObject({ title: "Busy", description: null, location: null, url: null, organizer: "", revision: 3 });
    expect(refreshed.start).toBe(snapshot.start); expect(refreshed.timeModel).toBe(snapshot.timeModel);
  }
  const detail = liveEventDetail([redacted], event)!;
  expect(detail.title).toBe("Busy"); expect(detail.revision).toBe(3);
  expect(liveEventDetail([], event)).toBe(event); // initial/offline absence is not deletion
  expect(liveEventDetail([], event, new Set([event.id]))).toBeNull();
});
it("requires canonical privacy evidence and retains each explicit field delta", () => {
  expect(privateEditorRefresh(event, { ...event, title: "Busy" }, calendars)).toBeUndefined();
  expect(privateEditorRefresh(event, { ...event, revision: 4, title: "Renamed" }, [{ id: "source", role: "owner", provider: "google" }] as any)).toBeUndefined();
  expect(privateEditorRefresh(event, redacted, [{ id: "source", role: "viewer", provider: "microsoft" }] as any)).toBeUndefined();
  expect(privateEditorRefresh(event, undefined, [])).toBeUndefined();
  expect(privateEditorRefresh(event, undefined, [], true)).toMatchObject({ title: "Busy", revision: 3 });
  expect(refreshedPrivateField("Note", "Note", null)).toBe("");
  expect(refreshedPrivateField("My note", "Note", null)).toBe("My note");
  expect(refreshedPrivateField("", "Note", "Fresh note")).toBe("");
});


it("a previously refreshed snapshot follows newer full reads without rebasing its write revision", () => {
  const owner = [{ id: "source", provider: "google", role: "owner" }] as any;
  const hidden = privateEditorRefresh(event, redacted, calendars)!;
  expect(hidden.revision).toBe(3);
  // Role-only restoration and unchanged revision cannot reveal an older copy.
  expect(privateEditorRefresh(hidden, { ...event, revision: 4 }, owner)).toBeUndefined();
  const restored = privateEditorRefresh(hidden, { ...event, revision: 5, title: "Fresh full read" }, owner)!;
  expect(restored).toMatchObject({ title: "Fresh full read", description: "Note", revision: 3 });
  expect(restored.start).toBe(event.start); expect(restored.timeModel).toBe(event.timeModel);
  expect(privateEditorRefresh(restored, { ...redacted, revision: 4 }, calendars)).toBeUndefined();
  expect(privateEditorRefresh(event, { ...event, revision: 5 }, owner)).toBeUndefined(); // an ordinary draft still stays frozen
});
