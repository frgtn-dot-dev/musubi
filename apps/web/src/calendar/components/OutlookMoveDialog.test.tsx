import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OutlookMoveOptions, OutlookMoveResult } from "@musubi/types";
import { OutlookMoveDialog } from "./OutlookMoveDialog";
const api = vi.hoisted(() => ({ latest: vi.fn(), options: vi.fn(), preview: vi.fn(), start: vi.fn(), read: vi.fn() }));
vi.mock("~/api/outlook-moves", () => ({ getLatestOutlookMove: api.latest, getOutlookMoveOptions: api.options, previewOutlookMove: api.preview, startOutlookMove: api.start, getOutlookMove: api.read }));
const eventID = "00000000-0000-4000-8000-000000000001";
const calendarID = "00000000-0000-4000-8000-000000000002";
const choices: OutlookMoveOptions = { eventID, calendarID, version: "a".repeat(64), title: "Team planning", meeting: true, timeZone: "UTC", preserved: { edited: 1, cancelled: 1, unavailable: 0 }, occurrences: [{ eventID, start: "2026-10-01T09:00:00.000Z", end: "2026-10-01T10:00:00.000Z" }] };
const preview: OutlookMoveResult = { operationID: "00000000-0000-4000-8000-000000000003", eventID, title: choices.title, meeting: true, timeZone: "UTC", status: "preview", offsetMinutes: 30, expiresAt: "2026-09-23T12:00:00Z", items: [{ ...choices.occurrences[0]!, newStart: "2026-10-01T09:30:00.000Z", newEnd: "2026-10-01T10:30:00.000Z", status: "pending" }] };
beforeEach(() => { api.latest.mockResolvedValue(null); api.options.mockResolvedValue(choices); api.preview.mockResolvedValue(preview); api.start.mockResolvedValue({ ...preview, status: "running" }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const mount = () => render(<OutlookMoveDialog eventID={eventID} onClose={vi.fn()} />);
async function select() { fireEvent.click(await screen.findByRole("checkbox", { name: /Oct 1, 2026/ })); }
it("requires selection and a preview before any write, with exact times and meeting consequences", async () => {
  mount(); await select();
  expect(api.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Preview 1 occurrence" }));
  expect(await screen.findByText("09:00–10:00 → 09:30–10:30 UTC")).toBeTruthy();
  expect(screen.getByText(/Guests may need to respond again/)).toBeTruthy();
  expect(api.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Move 1 occurrence & notify guests" }));
  expect(await screen.findByText(/changes will continue/)).toBeTruthy();
  expect(api.start).toHaveBeenCalledExactlyOnceWith(preview.operationID);
});
it("reuses the same frozen preview identity after a lost response", async () => {
  api.preview.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue(preview);
  mount(); await select(); fireEvent.click(screen.getByRole("button", { name: "Preview 1 occurrence" }));
  await screen.findByText("Lost response");
  expect((screen.getByRole("spinbutton", { name: "Minutes" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Preview 1 occurrence" }));
  await screen.findByText("09:00–10:00 → 09:30–10:30 UTC");
  expect(api.preview.mock.calls[1]![0]).toEqual(api.preview.mock.calls[0]![0]);
});
it("reopens a saved partial result without re-sending any move", async () => {
  api.latest.mockResolvedValue({ ...preview, status: "stopped", items: [{ ...preview.items[0], status: "unconfirmed" }] });
  mount();
  expect(await screen.findByText("Unconfirmed")).toBeTruthy();
  expect(screen.getByText(/may already have moved/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New preview" })).toBeNull();
  expect(api.start).not.toHaveBeenCalled(); expect(api.preview).not.toHaveBeenCalled(); expect(api.options).not.toHaveBeenCalled();
});
it("does not describe partial completion as success and separates skipped occurrences", async () => {
  api.latest.mockResolvedValue({ ...preview, status: "stopped", items: [
    { ...preview.items[0], status: "completed" },
    { ...preview.items[0], eventID: calendarID, start: "2026-10-04T09:00:00.000Z", status: "failed" },
    { ...preview.items[0], eventID: preview.operationID, start: "2026-10-07T09:00:00.000Z", status: "not-started" },
  ] });
  mount(); await screen.findByText("Moved");
  expect(screen.getByText("Not moved")).toBeTruthy(); expect(screen.getByText("Not started")).toBeTruthy();
  expect(screen.queryByText(/All .* moved/)).toBeNull();
});
it("refreshes a stopped result without sending another POST", async () => {
  api.latest.mockResolvedValue({ ...preview, status: "stopped", items: [{ ...preview.items[0], status: "unconfirmed" }] });
  api.read.mockResolvedValue({ ...preview, status: "completed", items: [{ ...preview.items[0], status: "completed" }] });
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Refresh result" }));
  await screen.findByText("1 occurrence moved.");
  expect(api.start).not.toHaveBeenCalled();
});
it("validates the offset before requesting a preview", async () => {
  mount(); await select();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Minutes" }), { target: { value: "0" } });
  expect((screen.getByRole("button", { name: "Preview 1 occurrence" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(api.preview).not.toHaveBeenCalled());
});

it("hides stale details and reloads the saved result on an event revision change", async () => {
  api.latest.mockResolvedValueOnce({ ...preview, status: "running" });
  let finish!: (value: OutlookMoveResult) => void;
  api.latest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<OutlookMoveDialog eventID={eventID} revision="1" onClose={vi.fn()} />);
  await screen.findByText(/changes will continue/);
  view.rerender(<OutlookMoveDialog eventID={eventID} revision="2" onClose={vi.fn()} />);
  expect(screen.queryByText(choices.title)).toBeNull();
  finish({ ...preview, status: "completed", items: [{ ...preview.items[0]!, status: "completed" }] });
  await screen.findByText("1 occurrence moved.");
  expect(api.start).not.toHaveBeenCalled();
});
