import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureCalendars, fixtureEvents } from "../fixtures";
import { Workspace } from "./Workspace";

const commonProps = {
  activeView: "month" as const,
  calendars: fixtureCalendars,
  date: "2026-07-26",
  events: fixtureEvents,
  isRefreshing: false,
  onDateChange: vi.fn(),
  onPageChange: vi.fn(),
  onSignOut: vi.fn(),
  onViewChange: vi.fn(),
  pageId: "my-calendar",
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
    name: "Alex",
  },
};

describe("Workspace", () => {
  it("keeps calendar visibility changes as a temporary read filter", async () => {
    const user = userEvent.setup();

    render(<Workspace {...commonProps} />);

    const studioToggle = screen.getByRole("checkbox", { name: "Studio" });
    expect((studioToggle as HTMLInputElement).checked).toBe(true);

    await user.click(studioToggle);

    expect((studioToggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: /Quarterly planning/ })).toBeNull();
  });

  it("filters visible server events through the toolbar search", async () => {
    const user = userEvent.setup();

    render(<Workspace {...commonProps} />);

    await user.type(screen.getByRole("searchbox", { name: "Search events" }), "quarterly");

    expect(screen.getByRole("button", { name: /Quarterly planning/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Design review/ })).toBeNull();
  });

  it("renders only future event days and pages the Agenda anchor", async () => {
    const user = userEvent.setup();
    const onDateChange = vi.fn();
    const { container } = render(
      <Workspace
        {...commonProps}
        activeView="agenda"
        onDateChange={onDateChange}
      />,
    );

    expect(screen.getByText("From Jul 26, 2026")).not.toBeNull();
    expect(container.querySelectorAll("[data-agenda-date]")).toHaveLength(5);
    expect(
      container.querySelector('[data-agenda-date="2026-07-26"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Board games/ })).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Next agenda start" }),
    );

    expect(onDateChange).toHaveBeenCalledWith("2026-08-23");
  });

  it("exposes Agenda as an enabled view", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();

    render(<Workspace {...commonProps} onViewChange={onViewChange} />);

    await user.click(screen.getByRole("button", { name: "Agenda" }));

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
});
