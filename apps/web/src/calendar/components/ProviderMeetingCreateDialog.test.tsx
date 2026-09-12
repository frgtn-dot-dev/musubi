import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Calendar } from "@musubi/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderMeetingCreateDialog } from "./ProviderMeetingCreateDialog";

const api = vi.hoisted(() => ({ save: vi.fn(), observe: vi.fn() }));
vi.mock("~/api/resources", () => ({ editProviderOrganizer: api.save, getOrganizerCalendar: api.observe }));
const google: Calendar = { id: "00000000-0000-4000-8000-000000000001", name: "Work", color: "red", creatorID: "owner", members: [], role: "owner", provider: "google", accountLabel: "work@example.test" };
const outlook: Calendar = { ...google, id: "00000000-0000-4000-8000-000000000002", name: "Outlook team", provider: "microsoft", accountLabel: "office@example.test" };
const calendars = [google, outlook];
const capability = (calendar: Calendar) => calendar.provider === "google"
  ? { calendarID: calendar.id, provider: "google", sendUpdates: "all" }
  : { calendarID: calendar.id, provider: calendar.provider, notificationPolicy: "server-invite", createTime: "utc-or-all-day", actions: ["create"] };

beforeEach(() => {
  api.observe.mockImplementation(async (id: string) => capability(calendars.find(calendar => calendar.id === id)!));
  api.save.mockResolvedValue({ status: "pending" });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const value = (label: string) => (screen.getByLabelText(label, { exact: true }) as HTMLInputElement).value;
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
async function choose(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Calendar" }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}
async function ready(props: Partial<Parameters<typeof ProviderMeetingCreateDialog>[0]> = {}) {
  const result = render(<ProviderMeetingCreateDialog calendars={calendars} initialDate="2026-09-12" onClose={vi.fn()} {...props} />);
  await screen.findByLabelText("Title", { exact: true });
  return result;
}
it("keeps provider invitation information behind Info while retaining the explicit create action", async () => {
  await ready();
  expect(screen.queryByText(/Google will be asked to notify all guests/)).toBeNull();
  expect(screen.getByRole("button", { name: "Create and send invitations" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Meeting invitation information" }));
  expect(await screen.findByText(/Google will be asked to notify all guests/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close meeting invitation information" }));
  await choose("Outlook team");
  fireEvent.click(screen.getByRole("button", { name: "Meeting invitation information" }));
  expect(await screen.findByText(/Outlook will be asked to notify all guests/)).toBeTruthy();
  expect(api.save).not.toHaveBeenCalled();
});
function fillDraft() {
  change("Title", "Planning");
  change("Notes", "Keep these notes");
  change("Location", "Room 2");
  change("Guest email addresses", "guest@example.test");
  change("Start", "2026-09-12T11:00");
  change("End", "2026-09-12T12:00");
  change("Event time zone", "Europe/Prague");
}

it("offers only owner event calendars with a matching successful local capability", async () => {
  const excluded = [
    { ...google, id: "native", provider: null },
    { ...google, id: "federated", provider: "musubi" },
    { ...google, id: "viewer", role: "viewer" },
    { ...google, id: "tasks", supportsEvents: false, supportsTasks: true },
    { ...google, id: "unavailable", name: "Unavailable" },
    { ...google, id: "mismatch", name: "Wrong identity" },
  ];
  api.observe.mockImplementation(async (id: string) => {
    if (id === google.id) return capability(google);
    if (id === "mismatch") return capability(outlook);
    throw new Error("Unsupported");
  });
  await ready({ calendars: [google, ...excluded] });
  expect(api.observe.mock.calls.map(call => call[0])).toEqual([google.id, "unavailable", "mismatch"]);
  fireEvent.click(screen.getByRole("combobox", { name: "Calendar" }));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("Work");
  expect(api.save).not.toHaveBeenCalled();
});

it("presets the requested calendar and workspace date", async () => {
  await ready({ initialCalendarID: outlook.id, initialDate: "2026-12-31" });
  expect(screen.getByRole("combobox", { name: "Calendar" }).textContent).toContain("Outlook team");
  expect(value("Start")).toBe("2026-12-31T09:00");
  expect(value("Event time zone")).toBe("UTC");
  expect(screen.getByLabelText("Event time zone")).toHaveProperty("disabled", true);
});

it("keeps the same form and common draft while converting Google time exactly for Outlook", async () => {
  await ready();
  const dialog = screen.getByRole("dialog", { name: "Create meeting" });
  const title = screen.getByLabelText("Title");
  fillDraft();
  await choose("Outlook team");
  expect(screen.getByRole("dialog", { name: "Create meeting" })).toBe(dialog);
  expect(screen.getByLabelText("Title")).toBe(title);
  expect(value("Title")).toBe("Planning");
  expect(value("Notes")).toBe("Keep these notes");
  expect(value("Location")).toBe("Room 2");
  expect(value("Guest email addresses")).toBe("guest@example.test");
  expect(value("Start")).toBe("2026-09-12T09:00");
  expect(value("End")).toBe("2026-09-12T10:00");
  expect(value("Event time zone")).toBe("UTC");
  fireEvent.click(screen.getByRole("button", { name: "Create and send invitations" }));
  await screen.findByText(/Meeting change saved/);
  expect(api.save.mock.calls[0][0]).toMatchObject({ calendarID: outlook.id, provider: "microsoft", content: { title: "Planning", description: "Keep these notes", location: "Room 2" }, guests: [{ email: "guest@example.test", optional: false }], time: { kind: "zoned", startLocal: "2026-09-12T09:00:00.000", endLocal: "2026-09-12T10:00:00.000", timeZone: "UTC" } });
});

it("keeps the selected calendar and draft when a DST fold prevents exact conversion", async () => {
  await ready();
  fillDraft();
  change("Start", "2026-10-25T02:30");
  change("End", "2026-10-25T03:30");
  await choose("Outlook team");
  await screen.findByText(/Your draft has been kept/);
  expect(screen.getByRole("combobox", { name: "Calendar" }).textContent).toContain("Work");
  expect(value("Start")).toBe("2026-10-25T02:30");
  expect(value("Title")).toBe("Planning");
  expect(value("Event time zone")).toBe("Europe/Prague");
  expect(api.save).not.toHaveBeenCalled();
});

it("uses an exclusive next-day end when creating an all-day meeting from one timed day", async () => {
  await ready();
  fillDraft();
  fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
  expect(value("Start")).toBe("2026-09-12");
  expect(value("End")).toBe("2026-09-13");
  await choose("Outlook team");
  fireEvent.click(screen.getByRole("button", { name: "Create and send invitations" }));
  await screen.findByText(/Meeting change saved/);
  expect(api.save.mock.calls[0][0]).toMatchObject({ calendarID: outlook.id, time: { kind: "all-day", startDate: "2026-09-12", endDate: "2026-09-13" } });
});

it("locks the calendar and draft during admission and retries the same request after a calendar refresh", async () => {
  let reject!: (error: Error) => void;
  api.save.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const result = await ready();
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create and send invitations" }));
  expect(screen.getByRole("combobox", { name: "Calendar" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Title")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Retry saved meeting action" }));
  expect(api.save).toHaveBeenCalledTimes(1);
  reject(new Error("Response lost"));
  await screen.findByText("Response lost");
  result.rerender(<ProviderMeetingCreateDialog calendars={[outlook]} initialCalendarID={outlook.id} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText("Checking calendars…")).toBeNull());
  expect(screen.getByRole("combobox", { name: "Calendar" }).textContent).toContain("Work");
  expect(screen.getByRole("combobox", { name: "Calendar" })).toHaveProperty("disabled", true);
  change("Title", "Should not move");
  fireEvent.click(screen.getByRole("button", { name: "Retry saved meeting action" }));
  await screen.findByText(/Meeting change saved/);
  expect(api.save.mock.calls[1][0]).toBe(api.save.mock.calls[0][0]);
  expect(api.save.mock.calls[1][0]).toMatchObject({ calendarID: google.id, content: { title: "Planning" } });
});

it("unlocks after explicit pre-admission rejection and uses a new operation for a changed calendar", async () => {
  api.save.mockRejectedValueOnce(Object.assign(new Error("Choose external guests"), { organizerAdmissionRejected: true }));
  await ready();
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: "Create and send invitations" }));
  await screen.findByText("Choose external guests");
  expect(screen.getByRole("combobox", { name: "Calendar" })).toHaveProperty("disabled", false);
  await choose("Outlook team");
  fireEvent.click(screen.getByRole("button", { name: "Create and send invitations" }));
  await screen.findByText(/Meeting change saved/);
  expect(api.save.mock.calls[1][0].operationID).not.toBe(api.save.mock.calls[0][0].operationID);
  expect(api.save.mock.calls[1][0].calendarID).toBe(outlook.id);
});

it("shows an honest empty state and retries capability checks without writing", async () => {
  api.observe.mockRejectedValueOnce(new Error("Offline"));
  render(<ProviderMeetingCreateDialog calendars={[google]} onClose={vi.fn()} />);
  await screen.findByText("No calendars available for meetings");
  expect(screen.queryByRole("button", { name: "Create and send invitations" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Title");
  expect(api.observe).toHaveBeenCalledTimes(2);
  expect(api.save).not.toHaveBeenCalled();
});


it("requires an explicit choice when the requested calendar loses meeting access", async () => {
  api.observe.mockImplementation(async (id: string) => {
    if (id === google.id) throw new Error("No longer supported");
    return capability(outlook);
  });
  render(<ProviderMeetingCreateDialog calendars={calendars} initialCalendarID={google.id} initialDate="2026-12-31" onClose={vi.fn()} />);
  await screen.findByText("This calendar is not available for meetings. Choose another calendar.");
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(screen.queryByRole("button", { name: "Create and send invitations" })).toBeNull();
  await choose("Outlook team");
  expect(value("Start")).toBe("2026-12-31T09:00");
  expect(value("Event time zone")).toBe("UTC");
  expect(screen.queryByText(/This calendar is not available/)).toBeNull();
  expect(api.save).not.toHaveBeenCalled();
});

it("ignores a stale capability result after the calendar list changes", async () => {
  let resolveOld!: (result: ReturnType<typeof capability>) => void;
  api.observe.mockImplementation((id: string) => id === google.id
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve(capability(outlook)));
  const result = render(<ProviderMeetingCreateDialog calendars={[google]} onClose={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "Calendar" })).toHaveProperty("disabled", true);
  result.rerender(<ProviderMeetingCreateDialog calendars={[outlook]} onClose={vi.fn()} />);
  await screen.findByLabelText("Title");
  resolveOld(capability(google));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Calendar" }).textContent).toContain("Outlook team"));
  fireEvent.click(screen.getByRole("combobox", { name: "Calendar" }));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("Outlook team");
  expect(api.save).not.toHaveBeenCalled();
});
