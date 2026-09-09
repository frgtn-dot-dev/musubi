import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderEventDetails } from "./ProviderEventDetails";
import { providerEventDetails } from "@musubi/calendar";
import { EventSchema, type ProviderEventState } from "@musubi/types";
const fetchState = vi.hoisted(() => vi.fn());
vi.mock("~/api/resources", () => ({ getProviderEventState: fetchState }));
const state: ProviderEventState = { provider: "microsoft", organizer: { name: "Host", address: "host@example.test", self: false }, isOrganizer: false, attendees: [], attendeesComplete: false, ownResponse: "notResponded", reminders: { provider: "microsoft", isOn: true, minutesBeforeStart: 0 }, availability: "workingElsewhere", privacy: "confidential", status: null, eventType: "singleInstance", conferenceURLs: [] };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("shows native values and distinguishes independent reminders", async () => {
  fetchState.mockResolvedValue({ state });
  render(<ProviderEventDetails eventId="event" userId="owner" />);
  expect(await screen.findByText("Outlook details")).toBeTruthy();
  expect(screen.getByText("workingElsewhere")).toBeTruthy();
  expect(screen.getByText("0 minutes before start")).toBeTruthy();
  expect(screen.getByText(/Both apps may notify/)).toBeTruthy();
});
it("never displays a previous account's late result", async () => {
  let resolve!: (value: { state: ProviderEventState }) => void;
  fetchState.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce({ state: null });
  const view = render(<ProviderEventDetails eventId="event" userId="old" connectionId="one" />);
  view.rerender(<ProviderEventDetails eventId="event" userId="new" connectionId="two" />);
  await act(async () => { resolve({ state }); });
  expect(screen.queryByText(/host@example/)).toBeNull();
  expect(screen.queryByText("Outlook details")).toBeNull();
  expect(fetchState.mock.calls[1]?.[2]).toBe("two");
});
it("reports unavailable data without presenting RSVP controls", async () => {
  fetchState.mockRejectedValue(new Error("offline"));
  render(<ProviderEventDetails eventId="event" userId="owner" />);
  expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("preserves unknown alarm semantics and negative offsets as raw CalDAV values", () => {
  const details = providerEventDetails({ ...state, provider: "caldav", reminders: { provider: "caldav", alarms: [{ action: "X-CUSTOM", trigger: "PT15M", related: "END", repeat: "3", duration: "PT2M" }] } });
  expect(details.rows.find(row => row.label === "Provider alarms")?.value).toBe("X-CUSTOM · PT15M · END · repeat 3 · PT2M");
});

it("offers the editor only from the server contract and clears it on account change", async () => {
  const google = { ...state, provider: "google", reminders: { provider: "google", useDefault: true, overrides: [] } };
  fetchState.mockResolvedValueOnce({ state: google, version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 } }).mockResolvedValueOnce({ state: google, version: "b".repeat(64), reminderEdit: { provider: "google", expectedRevision: 8 } }).mockResolvedValueOnce({ state: null });
  const view = render(<ProviderEventDetails eventId="event" userId="owner" connectionId="one" />);
  const edit = await screen.findByRole("button", { name: "Edit Google reminders" });
  await act(async () => edit.click());
  expect(await screen.findByRole("dialog", { name: "Google reminders" })).toBeTruthy();
  view.rerender(<ProviderEventDetails eventId="event" userId="other" connectionId="two" />);
  expect(screen.queryByRole("dialog", { name: "Google reminders" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit Google reminders" })).toBeNull();
});

it("refreshes RSVP capability before handoff and refuses a revoked capability", async () => {
  const google = { ...state, provider: "google", reminders: { provider: "google", useDefault: true, overrides: [] } };
  const initial = { state: google, version: "a".repeat(64), rsvpEdit: { provider: "google", expectedRevision: 7 } };
  const fresh = { ...initial, version: "b".repeat(64), rsvpEdit: { provider: "google", expectedRevision: 8 } };
  fetchState.mockResolvedValueOnce(initial).mockResolvedValueOnce(fresh).mockResolvedValueOnce({ state: google, version: "c".repeat(64) });
  const onRespond = vi.fn();
  render(<ProviderEventDetails eventId="event" userId="owner" connectionId="remote" onRespond={onRespond} />);
  const respond = await screen.findByRole("button", { name: "Respond in Google" });
  await act(async () => respond.click());
  expect(onRespond).toHaveBeenCalledWith(fresh);
  await act(async () => screen.getByRole("button", { name: "Respond in Google" }).click());
  expect(await screen.findByText(/unavailable in the refreshed state/)).toBeTruthy();
  expect(onRespond).toHaveBeenCalledTimes(1);
});

it("opens a clearly scoped instance response and discards it when scope changes", async () => {
  const google = { ...state, provider: "google", reminders: { provider: "google", useDefault: true, overrides: [] } };
  fetchState.mockResolvedValue({ state: google, version: "a".repeat(64), rsvpEdit: { provider: "google", expectedRevision: 7 } });
  const view = render(<ProviderEventDetails eventId="child" userId="owner" occurrence />);
  const respond = await screen.findByRole("button", { name: "Respond to this occurrence" });
  await act(async () => respond.click());
  expect(await screen.findByRole("dialog", { name: "Respond to this occurrence" })).toBeTruthy();
  expect(screen.getByText(/This Google response applies only to this occurrence/)).toBeTruthy();
  view.rerender(<ProviderEventDetails eventId="child" userId="owner" series />);
  expect(screen.queryByRole("dialog", { name: "Respond to this occurrence" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Respond to this occurrence" })).toBeNull();
});

it("opens reminders for the bound occurrence and clears the editor on scope change", async () => {
  const google = { ...state, provider: "google", reminders: { provider: "google", useDefault: true, overrides: [] } };
  fetchState.mockResolvedValue({ state: google, version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 } });
  const view = render(<ProviderEventDetails eventId="child" userId="owner" occurrence />);
  const action = await screen.findByRole("button", { name: "Edit reminders for this occurrence" });
  await act(async () => action.click());
  expect(await screen.findByRole("dialog", { name: "Google reminders for this occurrence" })).toBeTruthy();
  expect(screen.getByText("These Google reminders apply only to this occurrence. Personal notifications from Google Calendar. Musubi reminders are separate; both apps may notify you.")).toBeTruthy();
  expect(fetchState.mock.calls[1][0]).toBe("child");
  view.rerender(<ProviderEventDetails eventId="child" userId="owner" series />);
  expect(screen.queryByRole("dialog", { name: "Google reminders for this occurrence" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit reminders for this occurrence" })).toBeNull();
});

it("retires private details and an open editor when the event revision changes", async () => {
  const google = { ...state, provider: "google", reminders: { provider: "google", useDefault: true, overrides: [] } };
  fetchState.mockResolvedValueOnce({ state: google, version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 } }).mockResolvedValueOnce({ state: google, version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 } });
  let complete!: (value: { state: null }) => void;
  fetchState.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<ProviderEventDetails eventId="event" userId="owner" revision={7} />);
  const action = await screen.findByRole("button", { name: "Edit Google reminders" });
  await act(async () => action.click());
  expect(await screen.findByRole("dialog", { name: "Google reminders" })).toBeTruthy();
  view.rerender(<ProviderEventDetails eventId="event" userId="owner" revision={8} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/host@example/)).toBeNull();
  expect(screen.queryByText("Google details")).toBeNull();
  await act(async () => complete({ state: null }));
  expect(screen.queryByText("Provider details")).toBeNull();
});

it("opens only explicit series alarm settings from a stored master and refuses a stale refresh", async () => {
  const master = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000301", revision: 7, isCanceled: false, title: "Series", creatorID: "owner", organizer: "", color: "red", calendars: [], start: new Date("2026-03-28T00:00:00Z"), end: new Date("2026-03-28T00:00:00Z"), isAllDay: true, timeModel: { kind: "all-day" }, recurrence: "RRULE:FREQ=DAILY;COUNT=4" });
  const observation = { state: { ...state, provider: "caldav", reminders: { provider: "caldav", alarms: [] } }, version: "a".repeat(64), reminderEdit: { provider: "caldav", scope: "series", expectedRevision: 7, minutesBeforeStart: 15 } };
  fetchState.mockResolvedValue(observation);
  const view = render(<ProviderEventDetails eventId={master.id} userId="owner" series />);
  await screen.findByText("CalDAV details");
  expect(screen.queryByRole("button", { name: "Edit CalDAV event alarms" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Series alarm settings" })).toBeNull();
  view.rerender(<ProviderEventDetails eventId={master.id} userId="owner" series seriesMaster={master} />);
  const action = await screen.findByRole("button", { name: "Series alarm settings" });
  await act(async () => action.click());
  expect(await screen.findByRole("dialog", { name: "CalDAV series alarm" })).toBeTruthy();
  expect(screen.getByText(/applies to every occurrence in this series/)).toBeTruthy();
  await act(async () => screen.getByRole("button", { name: "Close CalDAV series alarm" }).click());
  fetchState.mockResolvedValue({ ...observation, reminderEdit: { ...observation.reminderEdit, expectedRevision: 8 } });
  await act(async () => action.click());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await screen.findByText(/Could not refresh provider details/)).toBeTruthy();
});
