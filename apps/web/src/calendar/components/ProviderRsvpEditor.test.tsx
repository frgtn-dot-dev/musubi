import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderRsvpEditor } from "./ProviderRsvpEditor";
import type { ProviderEventStateResponse } from "@musubi/types";
const save = vi.hoisted(() => vi.fn());
vi.mock("~/api/resources", () => ({ editProviderRsvp: save }));
const observation: ProviderEventStateResponse = {
  version: "a".repeat(64), rsvpEdit: { provider: "google", expectedRevision: 7 },
  state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] },
};
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("requires an explicit choice and preserves the frozen response when retrying offline", async () => {
  save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  render(<ProviderRsvpEditor eventId="event" observation={observation} connectionId="remote" returnFocus={document.body} onClose={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Send response" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("combobox", { name: "Your Google response" }));
  fireEvent.click(await screen.findByRole("option", { name: "Tentative" }));
  fireEvent.click(screen.getByRole("button", { name: "Send response" }));
  expect((await screen.findByRole("alert")).textContent).toContain("offline");
  fireEvent.click(screen.getByRole("button", { name: "Send response" }));
  await screen.findByText(/Google confirmation is still pending/);
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(save.mock.calls[0]).toMatchObject(["event", { expectedRevision: 7, expectedStateVersion: "a".repeat(64), response: "tentative", sendUpdates: "all" }, "remote"]);
});
it("does not send on cancel or bubble portal interactions to the calendar", async () => {
  const close = vi.fn(), parent = vi.fn();
  render(<div onClick={parent} onKeyDown={parent} onPointerDown={parent}><ProviderRsvpEditor eventId="event" observation={observation} returnFocus={document.body} onClose={close} /></div>);
  const cancel = screen.getByRole("button", { name: "Cancel" });
  fireEvent.pointerDown(cancel); fireEvent.keyDown(cancel, { key: "Enter" }); fireEvent.click(cancel);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(parent).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
