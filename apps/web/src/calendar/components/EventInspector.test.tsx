import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Calendar, Event } from "@musubi/types";
import { EventDetailsPopover } from "./EventDetailsPopover";

vi.mock("./ProviderEventDetails", () => ({ ProviderEventDetails: () => null }));
vi.mock("./EventDeliveryDialog", () => ({ EventDeliveryDialog: () => null }));

const calendar: Calendar = { id: "calendar", creatorID: "owner", color: "#112233", name: "Personal", role: "owner", members: [] };
const event: Event = { id: "event", creatorID: "owner", originCalendarID: "calendar", calendars: ["calendar"], revision: 4, title: "Private appointment", description: "Private notes", location: "Private room", organizer: "owner", color: "#112233", start: new Date("2026-07-08T09:00:00Z"), end: new Date("2026-07-08T10:00:00Z"), isAllDay: false, isCanceled: false, hasAttendees: false };
const otherEvent = { ...event, id: "other", title: "Other appointment" };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function inspector(current: Event, update = vi.fn()) {
  return <EventDetailsPopover calendar={calendar} calendars={[calendar]} event={current} getEventMaster={() => current} user={{ id: "owner", name: "Owner" }} onNotice={vi.fn()} onForkEvent={vi.fn()} onLinkEvent={vi.fn()} onUpdateEvent={update} onRemoveEvent={vi.fn()} onRestoreEvent={vi.fn()} onSetAttendance={vi.fn()} timeFormat="24h" weekStartsOn="monday"><button>{`Open ${current.id}`}</button></EventDetailsPopover>;
}

it("keeps a dirty draft when cancellation is declined, then discards it explicitly", async () => {
  const user = userEvent.setup();
  const update = vi.fn();
  render(inspector(event, update));
  await user.click(screen.getByRole("button", { name: "Open event" }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByRole("textbox", { name: "Event title" }));
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "My unsaved appointment");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  const confirmation = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
  await user.click(within(confirmation).getAllByRole("button", { name: "Keep editing" }).at(-1)!);
  expect(screen.getByDisplayValue("My unsaved appointment")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
  expect(screen.getByRole("dialog", { name: event.title })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByDisplayValue(event.title)).toBeTruthy();
  expect(screen.queryByDisplayValue("My unsaved appointment")).toBeNull();
  expect(update).not.toHaveBeenCalled();
});

it("blocks close and selection while saving and keeps a rejected save recoverable", async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  const update = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce({ ...event, title: "My saved appointment" });
  render(<>{inspector(event, update)}{inspector(otherEvent)}</>);
  await user.click(screen.getByRole("button", { name: "Open event" }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByRole("textbox", { name: "Event title" }));
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "My saved appointment");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(update).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Close event editor" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Open other" }));
  expect(screen.getByDisplayValue("My saved appointment")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: otherEvent.title })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
  await act(async () => reject(new Error("offline")));
  expect(screen.getByRole("alert").textContent).toBeTruthy();
  expect(screen.getByDisplayValue("My saved appointment")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(update).toHaveBeenCalledTimes(2);
  expect(update.mock.calls[1][0]).toEqual(expect.objectContaining({ title: "My saved appointment" }));
  expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Open other" }));
  expect(screen.getByRole("dialog", { name: otherEvent.title })).toBeTruthy();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
