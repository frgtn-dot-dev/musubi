import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Calendar, Event } from "@musubi/types";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { clearEventEditorBaseline, eventEditorBaseline, handoffEventEditor } from "../event-editor-draft";
import { eventEditorSearchSchema } from "../event-editor-search";

const mocks = vi.hoisted(() => ({ workspace: {} as Record<string, unknown>, search: {} as Record<string, unknown>, navigate: vi.fn(), update: vi.fn() }));
vi.mock("~/calendar/workspace-queries", () => ({ useWorkspaceQueries: () => mocks.workspace }));
vi.mock("~/calendar/event-mutations", () => ({ useEventMutations: () => ({ updateEvent: mocks.update }) }));
vi.mock("~/auth/use-session-user", () => ({ useSessionUser: () => ({ user: { id: "owner" } }) }));
vi.mock("@tanstack/react-router", async (original) => ({ ...await original<object>(), createFileRoute: () => (options: { component: unknown }) => ({ options, useParams: () => ({ eventId: "event", pageId: "page", view: "month" }), useSearch: () => mocks.search, useNavigate: () => mocks.navigate }) }));
vi.mock("./ProviderEventDetails", () => ({ ProviderEventDetails: () => null }));
vi.mock("./EventDeliveryDialog", () => ({ EventDeliveryDialog: () => null }));
import { Route } from "~/routes/app/p.$pageId.$view.event.$eventId";

const EditRoute = Route.options.component!;
const calendar: Calendar = { id: "calendar", creatorID: "owner", color: "#112233", name: "Google", provider: "google", role: "owner", members: [] };
const event: Event = { id: "event", creatorID: "owner", originCalendarID: "calendar", calendars: ["calendar"], revision: 4, title: "Private appointment", description: "Private notes", location: "Private room", url: "https://private.example.test", organizer: "private@example.test", color: "#112233", start: new Date("2026-07-08T09:00:00Z"), end: new Date("2026-07-08T10:00:00Z"), isAllDay: false, isCanceled: false, hasAttendees: false };
const busy: Event = { ...event, revision: 5, title: "Busy", description: undefined, location: undefined, url: undefined, organizer: "" };
const viewer = { ...calendar, role: "viewer" };
function workspace(current: Event | undefined, calendars = [calendar], pending = false) {
  mocks.workspace = { mergedEvents: { baseEvents: current ? [current] : [] }, mergedCalendars: calendars, calendars: { isPending: false }, events: { isPending: pending, isFetching: pending, isPlaceholderData: false }, federated: { isPending: false }, settings: { isPending: false, data: {} } };
}
afterEach(() => { cleanup(); clearEventEditorBaseline(event.id); vi.clearAllMocks(); });

function popover(current: Event, master: Event, calendars: Calendar[]) {
  return <EventDetailsPopover calendar={calendars[0]} calendars={calendars} event={current} getEventMaster={() => master} user={{ id: "owner", name: "Owner" }} onNotice={vi.fn()} onForkEvent={vi.fn()} onLinkEvent={vi.fn()} onUpdateEvent={vi.fn()} onRemoveEvent={vi.fn()} onRestoreEvent={vi.fn()} onSetAttendance={vi.fn()} timeFormat="24h" weekStartsOn="monday"><button>Open event</button></EventDetailsPopover>;
}

describe("Google private editor refresh", () => {
  for (const generated of [false, true]) {
    it(`clears copied compact ${generated ? "generated occurrence" : "one-off"} content and preserves a typed title`, async () => {
      const master = generated ? { ...event, recurrence: "FREQ=DAILY" } : event;
      const occurrence = generated ? { ...master, id: "event_occurrence", seriesID: "event" } : master;
      const refreshedMaster = { ...master, ...busy };
      const refreshedOccurrence = { ...occurrence, ...busy, id: occurrence.id };
      const user = userEvent.setup();
      const view = render(popover(occurrence, master, [calendar]));
      await user.click(screen.getByRole("button", { name: "Open event" }));
      await user.click(screen.getByRole("button", { name: /^Edit$/ }));
      await user.clear(screen.getByRole("textbox", { name: "Event title" }));
      await user.type(screen.getByRole("textbox", { name: "Event title" }), "My typed title");
      view.rerender(popover(refreshedOccurrence, refreshedMaster, [viewer]));
      expect(screen.queryByDisplayValue("Private notes")).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
      view.rerender(popover(refreshedOccurrence, refreshedMaster, [calendar]));
      expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("My typed title");
      expect(screen.queryByDisplayValue("Private room")).toBeNull();
      expect(screen.queryByDisplayValue("Private notes")).toBeNull();
    });
  }

  it("sanitizes full-editor baseline, copied URL fields and typed draft across downgrade and regain", async () => {
    workspace(event);
    mocks.search = eventEditorSearchSchema.parse({ title: event.title, description: event.description, location: event.location, url: event.url });
    handoffEventEditor(event);
    const view = render(<EditRoute />);
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Event title" }));
    await user.type(screen.getByRole("textbox", { name: "Event title" }), "My draft");
    workspace(busy, [viewer]); view.rerender(<EditRoute />);
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
    expect(eventEditorBaseline(event.id)?.title).toBe("Busy");
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true, search: expect.objectContaining({ title: undefined, description: undefined, location: undefined, url: undefined }) }));
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("My draft");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("handles a batched regained role plus Busy without a rendered viewer state", () => {
    workspace(event); mocks.search = eventEditorSearchSchema.parse({}); handoffEventEditor(event);
    const view = render(<EditRoute />);
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Busy");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("keeps the editor through pending data but scrubs a confirmed removal", async () => {
    workspace(event); mocks.search = eventEditorSearchSchema.parse({ title: event.title, description: event.description }); handoffEventEditor(event);
    const view = render(<EditRoute />);
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Event title" }));
    await user.type(screen.getByRole("textbox", { name: "Event title" }), "My retained draft");
    workspace(undefined, [calendar], true); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("My retained draft");
    workspace(undefined, []); view.rerender(<EditRoute />);
    expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
    expect(eventEditorBaseline(event.id)).toBeUndefined();
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: expect.objectContaining({ title: undefined, description: undefined }) }));
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("My retained draft");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("discards old copied URL content on reload into a Busy event while keeping marked authored deltas", () => {
    workspace(busy);
    mocks.search = eventEditorSearchSchema.parse({ title: "Authored URL draft", description: event.description, draftFields: ["title"] });
    render(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Authored URL draft");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("waits for calendar identity before classifying a Busy event's legacy URL fields", () => {
    workspace(busy, []);
    mocks.workspace.calendars = { isPending: true, isFetching: true };
    mocks.search = eventEditorSearchSchema.parse({ title: event.title, description: event.description });
    const view = render(<EditRoute />);
    expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Busy");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("opens a cached event when its known calendar has a failed background refetch", () => {
    workspace(event);
    mocks.workspace.calendars = { isPending: false, isFetching: false, isError: true };
    mocks.search = eventEditorSearchSchema.parse({});
    render(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe(event.title);
    expect(screen.getByDisplayValue("Private notes")).toBeTruthy();
  });

  it("captures delayed calendar provenance before a source disappears", () => {
    workspace(event, []);
    mocks.workspace.calendars = { isPending: true, isFetching: true };
    mocks.search = eventEditorSearchSchema.parse({ title: event.title, description: event.description });
    const view = render(<EditRoute />);
    workspace(event); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe(event.title);
    workspace(undefined, []); view.rerender(<EditRoute />);
    expect(eventEditorBaseline(event.id)).toBeUndefined();
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: expect.objectContaining({ title: undefined, description: undefined }) }));
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Busy");
  });

  it("cannot reuse a sanitized handoff to reintroduce copied old URL content", () => {
    workspace(busy);
    handoffEventEditor(busy, true);
    mocks.search = eventEditorSearchSchema.parse({ title: event.title, description: event.description });
    render(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Busy");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("retains explicitly typed notes when a batched privacy refresh clears the untouched title", async () => {
    workspace(event); mocks.search = eventEditorSearchSchema.parse({}); handoffEventEditor(event);
    const view = render(<EditRoute />);
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "My own notes");
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Busy");
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("My own notes");
  });

  it("clears copied URL snapshots for an event absent on the initial settled read", () => {
    workspace(undefined, []);
    mocks.search = eventEditorSearchSchema.parse({ title: event.title, description: event.description });
    handoffEventEditor(event);
    render(<EditRoute />);
    expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
    expect(eventEditorBaseline(event.id)).toBeUndefined();
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: expect.objectContaining({ title: undefined, description: undefined }) }));
  });

  it("does not reset an unrelated local draft on ordinary revision updates", async () => {
    workspace(event, [{ ...calendar, provider: undefined }]); mocks.search = eventEditorSearchSchema.parse({});
    const view = render(<EditRoute />);
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Event title" }));
    await user.type(screen.getByRole("textbox", { name: "Event title" }), "Local draft");
    workspace(busy, [{ ...calendar, provider: undefined }]); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("Local draft");
    expect(screen.getByDisplayValue("Private notes")).toBeTruthy();
  });
});
