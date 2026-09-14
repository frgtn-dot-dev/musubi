import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EventSchema, type Calendar } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { clearEventEditorBaseline } from "../event-editor-draft";
const mocks = vi.hoisted(() => ({ workspace: {} as Record<string, unknown>, navigate: vi.fn(), update: vi.fn(), apply: vi.fn() }));
vi.mock("~/calendar/workspace-queries", () => ({ useWorkspaceQueries: () => mocks.workspace }));
vi.mock("~/calendar/event-mutations", () => ({ useEventMutations: () => ({ updateEvent: mocks.update, applyEventScope: mocks.apply }) }));
vi.mock("~/auth/use-session-user", () => ({ useSessionUser: () => ({ user: { id: "owner" } }) }));
vi.mock("@tanstack/react-router", async original => ({ ...await original<object>(), createFileRoute: () => (options: { component: unknown }) => ({ options, useParams: () => ({ eventId: "00000000-0000-4000-8000-000000000992", pageId: "page", view: "month" }), useSearch: () => ({}), useNavigate: () => mocks.navigate }) }));
vi.mock("./ProviderEventDetails", () => ({ ProviderEventDetails: () => null }));
vi.mock("./EventDeliveryDialog", () => ({ EventDeliveryDialog: () => null }));
import { Route } from "~/routes/app/p.$pageId.$view.event.$eventId";
const EditRoute = Route.options.component!;
const calendar: Calendar = { id: "calendar", creatorID: "owner", color: "red", name: "Personal", provider: "caldav", role: "owner", members: [] };
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000992", creatorID: "owner", organizer: "", originCalendarID: calendar.id, calendars: [calendar.id], revision: 1, title: "Personal", color: "red", isCanceled: false, recurrence: null, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-23T02:30:00", endLocal: "2026-10-23T03:30:00" }) });
afterEach(() => { cleanup(); clearEventEditorBaseline(event.id); vi.clearAllMocks(); });
for (const full of [false, true]) it(`routes ${full ? "full" : "compact"} personal CalDAV edits through scope`, async () => {
  mocks.workspace = { mergedEvents: { baseEvents: [event] }, mergedCalendars: [calendar], calendars: { isPending: false }, events: { isPending: false }, federated: { isPending: false }, settings: { isPending: false, data: {} } };
  const user = userEvent.setup();
  if (full) render(<EditRoute />);
  else {
    render(<EventDetailsPopover calendar={calendar} calendars={[calendar]} event={event} getEventMaster={() => event} user={{ id: "owner", name: "Owner" }} onNotice={vi.fn()} onForkEvent={vi.fn()} onLinkEvent={vi.fn()} onUpdateEvent={mocks.update} onRemoveEvent={vi.fn()} onRestoreEvent={vi.fn()} onSetAttendance={vi.fn()} onApplyEventScope={mocks.apply} timeFormat="24h" weekStartsOn="monday"><button>Open event</button></EventDetailsPopover>);
    await user.click(screen.getByRole("button", { name: "Open event" }));
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
  }
  await user.clear(screen.getByRole("textbox", { name: "Event title" }));
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Renamed");
  await user.click(screen.getByRole("button", { name: /^Save$/ }));
  expect(mocks.apply).toHaveBeenCalledWith(event, expect.objectContaining({ action: "update", scope: "series", patch: { title: "Renamed" }, expectedRevision: 1 }));
  expect(mocks.apply.mock.calls[0]![1].time).toBeUndefined();
  expect(mocks.update).not.toHaveBeenCalled();
});
