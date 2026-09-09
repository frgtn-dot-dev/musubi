import assert from "node:assert/strict";
import { providerReminderDraft, providerReminderRequest, providerReminderReceiptMessage } from "./provider-reminder-draft";
import type { ProviderEventStateResponse } from "@musubi/types";
const observation: ProviderEventStateResponse = {
  version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 },
  state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: false, overrides: [{ method: "email", minutes: 0 }, { method: "popup", minutes: 40320 }] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] },
};
const id = "00000000-0000-4000-8000-000000000014";
const draft = providerReminderDraft(observation);
assert.deepEqual(draft, { mode: "custom", overrides: [{ method: "email", minutes: "0" }, { method: "popup", minutes: "40320" }] });
assert.deepEqual(providerReminderRequest(observation, draft, id), { provider: "google", operationID: id, expectedRevision: 7, expectedStateVersion: "a".repeat(64), reminders: { useDefault: false, overrides: [{ method: "email", minutes: 0 }, { method: "popup", minutes: 40320 }] } });
for (const minutes of ["", "-1", "1.5", "1e2", "40321", "NaN", " 15 "]) assert.throws(() => providerReminderRequest(observation, { mode: "custom", overrides: [{ method: "popup", minutes }] }, id));
assert.throws(() => providerReminderRequest(observation, { mode: "custom", overrides: [] }, id));
assert.throws(() => providerReminderRequest(observation, { mode: "custom", overrides: Array.from({ length: 6 }, () => ({ method: "popup", minutes: "15" })) }, id));
assert.deepEqual((providerReminderRequest(observation, { ...draft, mode: "defaults" }, id) as import("@musubi/types").ProviderReminderEdit).reminders, { useDefault: true });
assert.deepEqual((providerReminderRequest(observation, { ...draft, mode: "off" }, id) as import("@musubi/types").ProviderReminderEdit).reminders, { useDefault: false, overrides: [] });
assert.throws(() => providerReminderDraft({ ...observation, reminderEdit: undefined }));
assert.throws(() => providerReminderDraft({ ...observation, state: { ...observation.state!, reminders: { provider: "google", useDefault: false, overrides: [{ method: "X-UNKNOWN", minutes: 5 }] } } }));
assert.equal(observation.reminderEdit?.expectedRevision, 7);
console.log("Provider reminder draft: exact native settings, frozen CAS, bounds and unknown refusal: OK");

const caldav: ProviderEventStateResponse = { ...observation, reminderEdit: { provider: "caldav", expectedRevision: 7, minutesBeforeStart: 15 } };
assert.equal(providerReminderReceiptMessage("not-needed", "caldav"), "No further alarm write is pending. Open Delivery details to check the saved request; this does not confirm the CalDAV alarm.");
assert.equal(providerReminderReceiptMessage("completed", "caldav"), "CalDAV event alarm change confirmed.");
assert.equal(providerReminderReceiptMessage("not-needed", "google"), "Google reminder change confirmed.");
assert.deepEqual(providerReminderDraft(caldav), { mode: "custom", overrides: [{ method: "popup", minutes: "15" }] });
assert.deepEqual(providerReminderRequest(caldav, { mode: "off", overrides: [] }, id), { provider: "caldav", operationID: id, expectedRevision: 7, expectedStateVersion: "a".repeat(64), alarms: { minutesBeforeStart: null } });
for (const invalid of [{ mode: "defaults" as const, overrides: [] }, { mode: "custom" as const, overrides: [{ method: "email" as const, minutes: "15" }] }, { mode: "custom" as const, overrides: [{ method: "popup" as const, minutes: "15" }, { method: "popup" as const, minutes: "30" }] }]) assert.throws(() => providerReminderRequest(caldav, invalid, id));

const series: ProviderEventStateResponse = { ...caldav, reminderEdit: { provider: "caldav", scope: "series", expectedRevision: 7, minutesBeforeStart: 15 } };
assert.deepEqual(providerReminderRequest(series, { mode: "off", overrides: [] }, id), { provider: "caldav", scope: "series", operationID: id, expectedRevision: 7, expectedStateVersion: "a".repeat(64), alarms: { minutesBeforeStart: null } });
