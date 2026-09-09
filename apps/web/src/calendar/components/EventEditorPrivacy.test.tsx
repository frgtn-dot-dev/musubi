import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Calendar, Event } from "@musubi/types";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { clearEventEditorBaseline, eventEditorBaseline, handoffEventEditor } from "../event-editor-draft";
import { eventFormValues } from "../event-form";
import { privateEditorSearch } from "../event-editor-privacy";
import { applyEventEditorSearch, eventEditorSearchSchema } from "../event-editor-search";

const mocks = vi.hoisted(() => ({ workspace: {} as Record<string, unknown>, search: {} as Record<string, unknown>, navigate: vi.fn(), update: vi.fn() }));
vi.mock("~/calendar/workspace-queries", () => ({ useWorkspaceQueries: () => mocks.workspace }));
vi.mock("~/calendar/event-mutations", () => ({ useEventMutations: () => ({ updateEvent: mocks.update }) }));
vi.mock("~/auth/use-session-user", () => ({ useSessionUser: () => ({ user: { id: "owner" } }) }));
vi.mock("@tanstack/react-router", async (original) => ({ ...await original<object>(), createFileRoute: () => (options: { component: unknown }) => ({ options, useParams: () => ({ eventId: "event", pageId: "page", view: "month" }), useSearch: () => mocks.search, useNavigate: () => mocks.navigate }) }));
vi.mock("./ProviderEventDetails", () => ({ ProviderEventDetails: () => null }));
vi.mock("./EventDeliveryDialog", () => ({ EventDeliveryDialog: () => null }));
import { Route } from "~/routes/app/p.$pageId.$view.event.$eventId";

const EditRoute = Route.options.component!;
describe.each(["google", "microsoft", "caldav"] as const)("%s privacy editor", provider => {
const calendar: Calendar = { id: "calendar", creatorID: "owner", color: "#112233", name: provider, provider, role: "owner", members: [] };
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
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true, search: expect.objectContaining({ title: "My draft", description: undefined, location: undefined, url: undefined, draftFields: ["title"] }) }));
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement).value).toBe("My draft");
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
  });

  it("retires a coalesced limited response without observing Busy", async () => {
    workspace(event); mocks.search = eventEditorSearchSchema.parse({}); handoffEventEditor(event);
    const view = render(<EditRoute />); const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Event title" }));
    await user.type(screen.getByRole("textbox", { name: "Event title" }), "Authored title");
    workspace({ ...event, revision: 6, providerReadRetiredRevision: 5, title: "Public title", description: null, location: null, url: null });
    view.rerender(<EditRoute />);
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
    expect(screen.getByDisplayValue("Authored title")).toBeTruthy();
  });

  it("does not promote copied legacy URL fields to authored after a coalesced retirement", () => {
    mocks.search = eventEditorSearchSchema.parse({ title: "Authored title", draftFields: ["title"], description: event.description, location: event.location, url: event.url });
    workspace({ ...event, revision: 6, providerReadRetiredRevision: 5, title: "Public title", description: null, location: null, url: null });
    render(<EditRoute />);
    expect(screen.queryByDisplayValue("Private notes")).toBeNull();
    expect(screen.getByDisplayValue("Authored title")).toBeTruthy();
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
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: expect.objectContaining({ title: "My retained draft", description: undefined, draftFields: ["title"] }) }));
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

  for (const compact of [false, true]) {
    it(`keeps an explicit clear across successive ${compact ? "compact" : "full"} privacy refreshes`, async () => {
      workspace(event); mocks.search = eventEditorSearchSchema.parse({}); handoffEventEditor(event);
      const user = userEvent.setup();
      const view = render(compact ? popover(event, event, [calendar]) : <EditRoute />);
      if (compact) {
        await user.click(screen.getByRole("button", { name: "Open event" }));
        await user.click(screen.getByRole("button", { name: /^Edit$/ }));
        if (!screen.queryByRole("textbox", { name: "Description" })) await user.click(screen.getByRole("button", { name: "More options" }));
      }
      await user.clear(screen.getByRole("textbox", { name: "Description" }));
      for (const current of [busy, { ...busy, revision: 6, title: "Readable title", description: "New provider note" }, { ...busy, revision: 7 }]) {
        workspace(current, [viewer]); view.rerender(compact ? popover(current, current, [viewer]) : <EditRoute />);
        workspace(current, [calendar]); view.rerender(compact ? popover(current, current, [calendar]) : <EditRoute />);
        if (compact && !screen.queryByRole("textbox", { name: "Description" })) await user.click(screen.getByRole("button", { name: "More options" }));
        expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("");
      }
      if (!compact) expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: expect.objectContaining({ description: "", draftFields: expect.arrayContaining(["description"]) }) }));
    });
  }

  it("treats legacy ownership markers without URL values as explicit clears", () => {
    workspace(event); mocks.search = eventEditorSearchSchema.parse({ draftFields: ["description"] });
    const view = render(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("");
    workspace(busy, [viewer]); view.rerender(<EditRoute />);
    workspace(busy); view.rerender(<EditRoute />);
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("");
    expect(mocks.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: expect.objectContaining({ description: "", draftFields: ["description"] }) }));
  });

  it("carries authored empty values through the full-editor URL handoff", () => {
    const values = { ...eventFormValues(busy), privateDraftFields: ["description" as const] };
    const search = privateEditorSearch(values, busy);
    expect(search.description).toBe("");
    expect(search.draftFields).toContain("description");
    expect(applyEventEditorSearch(eventFormValues(event), eventEditorSearchSchema.parse(search)).description).toBe("");
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

});
