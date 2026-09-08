import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderEventDetails } from "./ProviderEventDetails";
import { providerEventDetails } from "@musubi/calendar";
import type { ProviderEventState } from "@musubi/types";
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
