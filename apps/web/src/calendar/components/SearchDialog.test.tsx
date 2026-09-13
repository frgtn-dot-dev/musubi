import { TaskSchema } from "@musubi/types";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fixtureCalendars, fixtureEvents } from "../fixtures";
import { SearchDialog } from "./SearchDialog";

function Example(props: Partial<ComponentProps<typeof SearchDialog>>) {
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  return <SearchDialog activeView="month" canCreateEvents events={[]} inputRef={input} returnFocus={trigger} onCreateEvent={vi.fn()} onEventSelect={vi.fn()} onOpenChange={vi.fn()} onToday={vi.fn()} onViewChange={vi.fn()} open query={query} setQuery={setQuery} {...props} />;
}

describe("account search", () => {
  it("finds hidden tasks and distant events, prioritizes visible calendars, and opens by keyboard", async () => {
    const user = userEvent.setup();
    const event = { ...fixtureEvents[0]!, id: "distant", title: "Kontrola kalendáře", calendars: [fixtureCalendars[0]!.id], start: new Date("2031-01-01T12:00:00Z") };
    const task = TaskSchema.parse({ id: "hidden-task", creatorID: "owner", calendarID: fixtureCalendars[1]!.id, title: "Kontrola úkolu" });
    const visibleEvent = { ...event, id: "visible", start: new Date("2026-09-13T12:00:00Z"), title: "Kontrola dnes" };
    const onTaskSelect = vi.fn();
    render(<Example calendars={fixtureCalendars} visibleCalendarIds={[fixtureCalendars[0]!.id]} visibleEventIds={[visibleEvent.id]} accountSource={{ data: { events: [event, visibleEvent], tasks: [task], calendars: fixtureCalendars }, loading: false, error: false, retry: vi.fn() }} onTaskSelect={onTaskSelect} />);
    const input = screen.getByRole("searchbox");
    await user.type(input, "kontrola");
    expect((await screen.findByRole("region", { name: "Visible events" })).textContent).toContain(visibleEvent.title);
    expect(screen.getByRole("region", { name: "Outside current range" }).textContent).toContain(event.title);
    expect(screen.getByRole("region", { name: "Elsewhere in your account" }).textContent).toContain(task.title);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onTaskSelect).toHaveBeenCalledWith(task);
  });

  it("keeps vertical navigation in its column and changes columns horizontally", async () => {
    const user = userEvent.setup();
    const onCreateEvent = vi.fn();
    const onEventSelect = vi.fn();
    render(<Example events={[fixtureEvents[0]!]} onCreateEvent={onCreateEvent} onEventSelect={onEventSelect} />);
    await user.type(screen.getByRole("searchbox"), fixtureEvents[0]!.title);
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(onEventSelect).toHaveBeenCalledWith(fixtureEvents[0]);
    await user.keyboard("{ArrowRight}{ArrowDown}{ArrowUp}{Enter}");
    expect(onCreateEvent).toHaveBeenCalledOnce();
    await user.keyboard("{ArrowLeft}{Enter}");
    expect(onEventSelect).toHaveBeenCalledTimes(2);
  });

  it("omits the current view and offers meeting creation", async () => {
    const user = userEvent.setup();
    const onCreateMeeting = vi.fn();
    render(<Example canCreateMeetings onCreateMeeting={onCreateMeeting} />);
    expect(screen.queryByRole("button", { name: /Switch to Month/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "New meeting" }));
    expect(onCreateMeeting).toHaveBeenCalledOnce();
  });

  it("renders refreshed account data without retaining redacted or removed content", async () => {
    const user = userEvent.setup();
    const original = { ...fixtureEvents[0]!, title: "Confidential review", description: "Private notes" };
    const source = { data: { events: [original], tasks: [], calendars: fixtureCalendars }, loading: false, error: false, retry: vi.fn() };
    const { rerender } = render(<Example accountSource={source} />);
    await user.type(screen.getByRole("searchbox"), "Private notes");
    expect(screen.getByRole("button", { name: /Confidential review/ })).toBeTruthy();
    rerender(<Example accountSource={{ ...source, data: { ...source.data, events: [{ ...original, title: "Busy", description: "" }] } }} />);
    expect(screen.queryByRole("button", { name: /Confidential review/ })).toBeNull();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "Busy");
    expect(screen.getByRole("button", { name: /Busy/ })).toBeTruthy();
    rerender(<Example accountSource={{ ...source, data: { ...source.data, events: [] } }} />);
    expect(screen.queryByRole("button", { name: /Busy/ })).toBeNull();
  });

  it("reports account errors and requests a retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<Example events={fixtureEvents} accountSource={{ loading: false, error: true, retry }} />);
    await user.type(screen.getByRole("searchbox"), fixtureEvents[0]!.title);
    expect(await screen.findByText(/Account search could not load/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Visible events" })).getByRole("button").textContent).toContain(fixtureEvents[0]!.title);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
