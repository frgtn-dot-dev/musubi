import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderReminderEditor } from "./ProviderReminderEditor";
import type { ProviderEventStateResponse } from "@musubi/types";
const save = vi.hoisted(() => vi.fn());
vi.mock("~/api/resources", () => ({ editProviderReminders: save }));
const observation: ProviderEventStateResponse = {
  version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 },
  state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] },
};
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("keeps invalid and failed drafts and retries the frozen personal request", async () => {
  save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  render(<ProviderReminderEditor eventId="event" observation={observation} connectionId="remote" returnFocus={document.body} onClose={vi.fn()} />);
  const minutes = screen.getByRole("textbox", { name: "Reminder 1 minutes before start" });
  fireEvent.change(minutes, { target: { value: "-5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Google reminders" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/whole minutes/);
  expect(save).not.toHaveBeenCalled(); expect((minutes as HTMLInputElement).value).toBe("-5");
  fireEvent.change(minutes, { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Google reminders" }));
  expect((await screen.findByRole("alert")).textContent).toContain("offline");
  expect((minutes as HTMLInputElement).value).toBe("15");
  fireEvent.click(screen.getByRole("button", { name: "Save Google reminders" }));
  await screen.findByText(/Google confirmation is still pending/);
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(save.mock.calls[0]).toMatchObject(["event", { expectedRevision: 7, expectedStateVersion: "a".repeat(64), reminders: { useDefault: false, overrides: [{ method: "email", minutes: 15 }] } }, "remote"]);
});
it("limits native reminder slots and never submits on cancel", async () => {
  const close = vi.fn();
  render(<ProviderReminderEditor eventId="event" observation={observation} returnFocus={document.body} onClose={close} />);
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));
  expect((screen.getByRole("button", { name: "Add reminder" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(save).not.toHaveBeenCalled();
});

it("isolates portal pointer and keyboard events from the calendar", () => {
  const parent = vi.fn();
  render(<div onClick={parent} onKeyDown={parent} onPointerDown={parent}><ProviderReminderEditor eventId="event" observation={observation} returnFocus={document.body} onClose={vi.fn()} /></div>);
  const button = screen.getByRole("button", { name: "Add reminder" });
  fireEvent.keyDown(button, { key: "Enter" });
  fireEvent.click(button, { detail: 0 });
  fireEvent.pointerDown(button);
  expect(parent).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Reminder 2 minutes before start" })).toBeTruthy();
});
