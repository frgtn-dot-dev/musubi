import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/http";
import { fixtureCalendars, fixtureEvents } from "../fixtures";
import { Workspace } from "./Workspace";

const commonProps = {
  activeView: "month" as const,
  calendars: fixtureCalendars,
  date: "2026-07-26",
  events: fixtureEvents,
  isRefreshing: false,
  onCreateEvent: vi.fn(async (event) => event),
  onDateChange: vi.fn(),
  onPageChange: vi.fn(),
  onRemoveEvent: vi.fn(async (event) => ({
    calendars: [],
    id: event.id,
    removed: true,
  })),
  onSignOut: vi.fn(),
  onUpdateEvent: vi.fn(async (event) => event),
  onViewChange: vi.fn(),
  onCreatePage: vi.fn(),
  onSavePage: vi.fn(),
  pageId: "my-calendar",
  pages: [
    {
      config: {
        calendarVisibility: { hiddenCalendarIds: [], mode: "all" as const },
        filters: [],
        icon: "house" as const,
        schemaVersion: 1 as const,
        view: {
          configVersion: 1 as const,
          id: "month" as const,
          showAdjacentDays: true,
        },
      },
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      id: "my-calendar",
      isDefault: true,
      name: "My calendar",
      position: 0,
      revision: 1,
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ],
  settings: {
    dateFormat: "dmy" as const,
    defaultCalendarView: "month" as const,
    notificationsOnByDefault: true,
    showKanji: true,
    theme: "system" as const,
    timeFormat: "24h" as const,
    weekStartsOn: "monday" as const,
  },
  user: {
    email: "alex@example.com",
    id: "alex",
    name: "Alex",
  },
};

describe("Workspace", () => {
  it("keeps calendar visibility changes as a temporary read filter", async () => {
    const user = userEvent.setup();

    render(<Workspace {...commonProps} />);

    // Visibility is a filter, so it lives on the filter shelf — the sidebar no
    // longer carries a second copy of the same switches.
    await user.click(screen.getByRole("button", { name: "Filters" }));
    // Scoped: event blocks in the grid answer to the calendar's name too.
    const shelf = within(
      screen.getByRole("region", { name: "Visible calendars" }),
    );
    const studio = shelf.getByRole("button", { name: "Studio" });
    expect(studio.getAttribute("aria-pressed")).toBe("true");

    await user.click(studio);

    expect(studio.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: /Quarterly planning/ })).toBeNull();
  });

  it("saves name, icon and visibility from the page settings dialog", async () => {
    const user = userEvent.setup();
    const onSavePage = vi.fn<
      (input: {
        baseRevision: number;
        config: { calendarVisibility: unknown; icon?: string };
        id: string;
        name: string;
      }) => Promise<{ page: (typeof commonProps.pages)[0]; status: "saved" }>
    >(async () => ({
      page: commonProps.pages[0]!,
      status: "saved" as const,
    }));

    render(<Workspace {...commonProps} onSavePage={onSavePage} />);

    await user.click(
      screen.getByRole("button", { name: "Edit My calendar" }),
    );
    const dialog = within(screen.getByRole("dialog"));

    // Nothing to save until something actually changes.
    expect(dialog.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

    await user.clear(dialog.getByLabelText("Page name"));
    await user.type(dialog.getByLabelText("Page name"), "Studio only");
    await user.click(dialog.getByRole("radio", { name: "Star" }));
    await user.click(dialog.getByRole("button", { name: "Studio" }));
    await user.click(dialog.getByRole("button", { name: "Save" }));

    expect(onSavePage).toHaveBeenCalledTimes(1);
    const request = onSavePage.mock.calls[0]![0];
    expect(request).toMatchObject({
      baseRevision: 1,
      id: "my-calendar",
      name: "Studio only",
    });
    expect(request.config.icon).toBe("star");
    expect(request.config.calendarVisibility).toEqual({
      hiddenCalendarIds: ["studio"],
      mode: "all",
    });
  });

  it("creates a page from the calendars currently visible", async () => {
    const user = userEvent.setup();
    const onCreatePage = vi.fn<
      (request: {
        config: unknown;
        name: string;
      }) => Promise<(typeof commonProps.pages)[0]>
    >(async () => ({
      ...commonProps.pages[0]!,
      id: "work",
      isDefault: false,
      name: "Work",
    }));
    const onPageChange = vi.fn();

    render(
      <Workspace
        {...commonProps}
        onCreatePage={onCreatePage}
        onPageChange={onPageChange}
      />,
    );

    // Hide one calendar first: the new page has to start from what is on screen,
    // not from the saved config of the page it was branched off.
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(
      within(screen.getByRole("region", { name: "Visible calendars" }))
        .getByRole("button", { name: "Studio" }),
    );
    await user.click(screen.getByRole("button", { name: "New page" }));

    const dialog = within(screen.getByRole("dialog"));
    // Nothing to create without a name.
    expect(
      dialog.getByRole("button", { name: "Create page" }).hasAttribute("disabled"),
    ).toBe(true);

    await user.type(dialog.getByLabelText("Page name"), "Work");
    await user.click(dialog.getByRole("radio", { name: "Briefcase" }));
    await user.click(dialog.getByRole("button", { name: "Create page" }));

    expect(onCreatePage).toHaveBeenCalledTimes(1);
    expect(onCreatePage.mock.calls[0]![0]).toEqual({
      config: {
        // `include`, not `all` — a curated page must not gain calendars added later.
        calendarVisibility: {
          calendarIds: ["personal", "client-work", "family-calendar"],
          mode: "include",
        },
        filters: [],
        icon: "briefcase",
        schemaVersion: 1,
        view: { configVersion: 1, id: "month", showAdjacentDays: true },
      },
      name: "Work",
    });
    expect(onPageChange).toHaveBeenCalledWith("work");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes a page from its settings, but never the last one", async () => {
    const user = userEvent.setup();
    const onDeletePage = vi.fn(async () => undefined);
    const secondPage = {
      ...commonProps.pages[0]!,
      id: "work",
      isDefault: false,
      name: "Work",
      position: 1,
    };
    const single = render(
      <Workspace {...commonProps} onDeletePage={onDeletePage} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Edit My calendar" }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: "Delete page",
      }),
    ).toBeNull();
    single.unmount();

    render(
      <Workspace
        {...commonProps}
        onDeletePage={onDeletePage}
        pages={[...commonProps.pages, secondPage]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit Work" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete page",
      }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Delete “Work”?" }),
      ).getByRole("button", { name: "Delete page" }),
    );

    expect(onDeletePage).toHaveBeenCalledWith("work");
  });

  it("sets a Page as default without discarding its unsaved draft", async () => {
    const user = userEvent.setup();
    const onSetDefaultPage = vi.fn(async () => undefined);
    const workPage = {
      ...commonProps.pages[0]!,
      id: "work",
      isDefault: false,
      name: "Work",
      position: 1,
    };

    render(
      <Workspace
        {...commonProps}
        onSetDefaultPage={onSetDefaultPage}
        pages={[...commonProps.pages, workPage]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit Work" }));
    const dialog = within(
      screen.getByRole("dialog", { name: "Page settings" }),
    );
    await user.clear(dialog.getByLabelText("Page name"));
    await user.type(dialog.getByLabelText("Page name"), "Deep work");
    await user.click(
      dialog.getByRole("button", { name: "Set as default" }),
    );

    expect(onSetDefaultPage).toHaveBeenCalledWith("work");
    expect(dialog.getByText("Default", { selector: "span" })).not.toBeNull();
    expect(
      (dialog.getByLabelText("Page name") as HTMLInputElement).value,
    ).toBe("Deep work");
    expect(
      dialog.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("keeps an unsaved page draft when the discard confirm is declined", async () => {
    const user = userEvent.setup();
    const onSavePage = vi.fn();

    render(<Workspace {...commonProps} onSavePage={onSavePage} />);

    await user.click(
      screen.getByRole("button", { name: "Edit My calendar" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Studio" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    // Cancelling the product confirmation leaves the editor and draft alone.
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Discard page changes?" }),
      ).getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Page settings" }),
    ).not.toBeNull();
    expect(onSavePage).not.toHaveBeenCalled();

    await user.click(
      within(
        screen.getByRole("dialog", { name: "Page settings" }),
      ).getByRole("button", { name: "Cancel" }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Discard page changes?" }),
      ).getByRole("button", { name: "Discard changes" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    // The page itself never changed, so the filter shelf still shows it on.
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(
      within(screen.getByRole("region", { name: "Visible calendars" }))
        .getByRole("button", { name: "Studio" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("filters visible server events through the toolbar search", async () => {
    const user = userEvent.setup();

    render(<Workspace {...commonProps} />);

    await user.type(screen.getByRole("searchbox", { name: "Search events" }), "quarterly");

    expect(screen.getByRole("button", { name: /Quarterly planning/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Design review/ })).toBeNull();
  });

  it("renders future event days as one continuous Agenda", () => {
    const { container } = render(
      <Workspace
        {...commonProps}
        activeView="agenda"
      />,
    );

    expect(screen.getByText("From Jul 26, 2026")).not.toBeNull();
    expect(container.querySelectorAll("[data-agenda-date]")).toHaveLength(5);
    expect(
      container.querySelector('[data-agenda-date="2026-07-26"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Board games/ })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Previous agenda start" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Next agenda start" }),
    ).toBeNull();
  });

  it("exposes Agenda as an enabled view", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();

    render(<Workspace {...commonProps} onViewChange={onViewChange} />);

    await user.click(screen.getByRole("radio", { name: "Agenda" }));

    expect(onViewChange).toHaveBeenCalledWith("agenda");
  });

  it("limits the initial Agenda DOM to fourteen event-day groups", () => {
    const manyEvents = Array.from({ length: 20 }, (_, index) => {
      const start = new Date(2026, 6, 27 + index, 10);
      const end = new Date(2026, 6, 27 + index, 11);

      return {
        ...fixtureEvents[1]!,
        end,
        id: `agenda-${index}`,
        recurrence: null,
        start,
        title: `Agenda item ${index}`,
      };
    });
    const { container } = render(
      <Workspace
        {...commonProps}
        activeView="agenda"
        events={manyEvents}
      />,
    );

    expect(container.querySelectorAll("[data-agenda-date]")).toHaveLength(14);
    expect(
      container.querySelector("[data-agenda-sentinel]"),
    ).not.toBeNull();
  });

  it("renders one shared time grid for Day and pages by one day", async () => {
    const user = userEvent.setup();
    const onDateChange = vi.fn();
    const { container } = render(
      <Workspace
        {...commonProps}
        activeView="day"
        date="2026-07-27"
        onDateChange={onDateChange}
      />,
    );

    expect(screen.getByText("Monday, July 27, 2026")).not.toBeNull();
    expect(container.querySelectorAll("[data-time-grid-day]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Board games/ })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(onDateChange).toHaveBeenCalledWith("2026-07-28");
  });

  it("renders seven Week columns with a continuous all-day span", () => {
    const { container } = render(
      <Workspace {...commonProps} activeView="week" />,
    );

    expect(screen.getByText("Jul 20 – 26, 2026")).not.toBeNull();
    expect(container.querySelectorAll("[data-time-grid-day]")).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: /All-day event, Family holiday/ }),
    ).not.toBeNull();
  });

  it("creates an event through the anchored quick form", async () => {
    const user = userEvent.setup();
    const onCreateEvent = vi.fn(async (event) => event);

    render(
      <Workspace
        {...commonProps}
        onCreateEvent={onCreateEvent}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /^Event$/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Event title" }),
      "Release check",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        calendars: ["personal"],
        creatorID: "alex",
        title: "Release check",
      }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Event created.",
    );
  });

  it("edits and deletes an event when its home calendar is writable", async () => {
    const user = userEvent.setup();
    const onUpdateEvent = vi.fn(async (event) => event);
    const onRemoveEvent = vi.fn(async (event) => ({
      calendars: [],
      id: event.id,
      removed: true,
    }));

    render(
      <Workspace
        {...commonProps}
        onRemoveEvent={onRemoveEvent}
        onUpdateEvent={onUpdateEvent}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Board game pub/ }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByRole("textbox", { name: "Event title" });
    await user.clear(title);
    await user.type(title, "Board games");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "board-game", title: "Board games" }),
    );

    // A plain event deletes on the first click: Undo, not a confirm step, is
    // what makes it safe.
    await user.click(screen.getByRole("button", { name: /Board game pub/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onRemoveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "board-game" }),
    );

    // Undo puts it back, and the reversal is announced.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(commonProps.onCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "board-game" }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Change undone.",
    );
  });

  it("still confirms a delete that Undo cannot cover", async () => {
    const user = userEvent.setup();
    const onRemoveEvent = vi.fn(async (event) => ({
      calendars: [],
      id: event.id,
      removed: true,
    }));
    // A provider-backed calendar: the delete leaves for the other system, so a
    // restore would land there as a new event.
    const providerCalendars = fixtureCalendars.map((calendar) => ({
      ...calendar,
      provider: "google" as const,
    }));

    render(
      <Workspace
        {...commonProps}
        calendars={providerCalendars}
        onRemoveEvent={onRemoveEvent}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Board game pub/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemoveEvent).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemoveEvent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("reveals the rest of the create form in place when there is no editor page", async () => {
    const user = userEvent.setup();

    render(<Workspace {...commonProps} />);

    await user.click(screen.getByRole("button", { name: /^Event$/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Event title" }),
      "Studio time",
    );
    // Quick create carries only the essentials.
    expect(screen.queryByPlaceholderText("Add location")).toBeNull();

    // Without an editor page wired in, the disclosure expands here — and the
    // draft is the same form state, so what was typed stays.
    await user.click(screen.getByRole("button", { name: "More options" }));

    expect(screen.getByPlaceholderText("Add location")).not.toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "Event title" }) as HTMLInputElement)
        .value,
    ).toBe("Studio time");
  });

  it("hands the draft to the editor page when one is wired in", async () => {
    const user = userEvent.setup();
    const onOpenFullEditor = vi.fn();

    render(
      <Workspace {...commonProps} onOpenFullEditor={onOpenFullEditor} />,
    );

    await user.click(screen.getByRole("button", { name: /^Event$/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Event title" }),
      "Studio time",
    );
    await user.click(screen.getByRole("button", { name: "More options" }));

    expect(onOpenFullEditor).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Studio time" }),
    );
    // The bubble is gone: the page owns the draft now.
    expect(screen.queryByRole("textbox", { name: "Event title" })).toBeNull();
  });

  it("does not expose write controls for viewer-only calendars", async () => {
    const user = userEvent.setup();
    const viewerCalendars = fixtureCalendars.map((calendar) => ({
      ...calendar,
      role: "viewer",
    }));

    render(
      <Workspace
        {...commonProps}
        calendars={viewerCalendars}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Event$/ }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: /Board game pub/ }));
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("view-only access", { exact: false })).not.toBeNull();
  });

  it("marks a read-only block in the grid, not only in its popover", () => {
    const { container } = render(
      <Workspace
        {...commonProps}
        activeView="day"
        date="2026-07-06"
        calendars={fixtureCalendars.map((calendar) => ({
          ...calendar,
          role: "viewer",
        }))}
      />,
    );

    const blocks = container.querySelectorAll("[data-time-event]");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.getAttribute("data-readonly")).toBe("");
      expect(block.querySelector(".lucide-lock")).not.toBeNull();
    }
  });

  it("keeps a provider-backed form open after an unconfirmed save", async () => {
    const user = userEvent.setup();
    const providerCalendar = {
      ...fixtureCalendars[0]!,
      provider: "google",
    };
    const onCreateEvent = vi.fn().mockRejectedValue(
      new ApiError("Provider unavailable", 502, "provider-request"),
    );

    render(
      <Workspace
        {...commonProps}
        calendars={[providerCalendar]}
        events={[]}
        onCreateEvent={onCreateEvent}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /^Event$/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Event title" }),
      "Provider event",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "Google Calendar did not confirm this change",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "provider-request",
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Event title",
        }) as HTMLInputElement
      ).value,
    ).toBe("Provider event");
  });
});
