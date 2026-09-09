import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ProviderOrganizerEditor,
  ProviderOrganizerCreateAction,
} from "./ProviderOrganizerEditor";
import type { Event, ProviderEventStateResponse } from "@musubi/types";
const api = vi.hoisted(() => ({ save: vi.fn(), observe: vi.fn() }));
vi.mock("~/api/resources", () => ({
  editProviderOrganizer: api.save,
  getOrganizerCalendar: api.observe,
}));
const calendarID = "00000000-0000-4000-8000-000000000001";
const event: Event = {
  id: "00000000-0000-4000-8000-000000000002",
  revision: 4,
  title: "Original",
  description: "Notes",
  location: "Room",
  start: new Date("2026-10-24T08:00:00Z"),
  end: new Date("2026-10-24T09:00:00Z"),
  timeModel: {
    kind: "zoned",
    timeZone: "Europe/Prague",
    startLocal: "2026-10-24T10:00:00.000",
    endLocal: "2026-10-24T11:00:00.000",
  },
  calendars: [calendarID],
  originCalendarID: calendarID,
  color: "red",
  creatorID: "owner",
  organizer: "owner",
  isAllDay: false,
  isCanceled: false,
  hasAttendees: false,
};
const observation: ProviderEventStateResponse = {
  state: null,
  version: "a".repeat(64),
  organizerEdit: { provider: "google", calendarID, expectedRevision: 4 },
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("creates with explicit external guests and freezes every field through an uncertain admission retry", async () => {
  api.save
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ status: "pending" });
  render(
    <ProviderOrganizerEditor
      calendarID={calendarID}
      color="red"
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Planning" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Guest email addresses" }),
    { target: { value: "guest@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create and send invitations" }),
  );
  await screen.findByText("offline");
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry saved meeting action" }),
  );
  await screen.findByRole("status");
  expect(api.save.mock.calls[1]).toEqual(api.save.mock.calls[0]);
  expect(api.save.mock.calls[0][0]).toMatchObject({
    action: "create",
    sendUpdates: "all",
    guests: [{ email: "guest@example.test", optional: false }],
  });
});
it("updates only explicitly touched fields, including a cleared note", async () => {
  api.save.mockResolvedValue({ status: "pending" });
  render(
    <ProviderOrganizerEditor
      event={event}
      observation={observation}
      calendarID={calendarID}
      color="red"
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
    target: { value: "" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save and notify guests" }),
  );
  await screen.findByRole("status");
  expect(api.save.mock.calls[0][0].patch).toEqual({ description: null });
  expect(api.save.mock.calls[0][0]).not.toHaveProperty("guests");
});
it("requires cancellation confirmation and retains its action on offline retry", async () => {
  api.save
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ status: "pending" });
  render(
    <ProviderOrganizerEditor
      event={event}
      observation={observation}
      calendarID={calendarID}
      color="red"
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel meeting and notify guests" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Cancel Google meeting",
  });
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Cancel meeting and notify guests",
    }),
  );
  await screen.findByText("offline");
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Cancel meeting and notify guests",
    }),
  );
  await screen.findByRole("status");
  expect(api.save.mock.calls[1]).toEqual(api.save.mock.calls[0]);
  expect(api.save.mock.calls[0][0].action).toBe("delete");
});
it("does not offer organizer creation without a verified primary calendar", async () => {
  api.observe.mockRejectedValue(new Error("disabled"));
  render(<ProviderOrganizerCreateAction calendarID={calendarID} color="red" />);
  await Promise.resolve();
  expect(
    screen.queryByRole("button", { name: "Create Google meeting" }),
  ).toBeNull();
});

it("allows correcting a guest after explicit pre-admission rejection", async () => {
  api.save
    .mockRejectedValueOnce(
      Object.assign(new Error("Choose external guests"), {
        organizerAdmissionRejected: true,
      }),
    )
    .mockResolvedValue({ status: "pending" });
  render(
    <ProviderOrganizerEditor
      calendarID={calendarID}
      color="red"
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Planning" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Guest email addresses" }),
    { target: { value: "owner@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create and send invitations" }),
  );
  await screen.findByText("Choose external guests");
  expect(
    (
      screen.getByRole("textbox", {
        name: "Guest email addresses",
      }) as HTMLTextAreaElement
    ).disabled,
  ).toBe(false);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Guest email addresses" }),
    { target: { value: "guest@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create and send invitations" }),
  );
  await screen.findByText(/Meeting change saved/);
  expect(api.save.mock.calls[1][0].guests[0].email).toBe("guest@example.test");
  expect(api.save.mock.calls[1][0].operationID).not.toBe(
    api.save.mock.calls[0][0].operationID,
  );
});

it("can correct a DST-invalid time after the server rejects admission", async () => {
  api.save
    .mockRejectedValueOnce(
      Object.assign(new Error("Check meeting time"), {
        organizerAdmissionRejected: true,
      }),
    )
    .mockResolvedValue({ status: "pending" });
  render(
    <ProviderOrganizerEditor
      calendarID={calendarID}
      color="red"
      event={event}
      observation={observation}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "2026-03-29T02:45" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: "2026-03-29T03:15" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save and notify guests" }),
  );
  await screen.findByText("Check meeting time");
  expect((screen.getByLabelText("Start") as HTMLInputElement).disabled).toBe(
    false,
  );
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "2026-03-29T03:00" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save and notify guests" }),
  );
  await screen.findByText(/Meeting change saved/);
  expect(api.save.mock.calls[1][0].patch.time.startLocal).toBe(
    "2026-03-29T03:00:00.000",
  );
  expect(api.save.mock.calls[1][0].operationID).not.toBe(
    api.save.mock.calls[0][0].operationID,
  );
});
