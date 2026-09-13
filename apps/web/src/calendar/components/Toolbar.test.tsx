import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { calendarCoverageNotice } from "@musubi/calendar";
import { Toolbar } from "./Toolbar";

const commonProps = {
  activeView: "month" as const,
  canCreateEvents: true,
  canCreateMeetings: true,
  canCreateTasks: true,
  onCreateEvent: vi.fn(),
  onCreateMeeting: vi.fn(),
  onCreateTask: vi.fn(),
  onOpenSearch: vi.fn(),
  onOpenSidebar: vi.fn(),
  onPeriodChange: vi.fn(),
  onToday: vi.fn(),
  onViewChange: vi.fn(),
  pageTitle: "My calendar",
  periodLabel: "September 2026",
  periodName: "month",
};

describe("Toolbar sync coverage", () => {
  it("keeps provider limits behind a named action and returns keyboard focus", async () => {
    const user = userEvent.setup();
    const notice = calendarCoverageNotice([{ provider: "microsoft", supportsEvents: true }])!;
    render(<Toolbar {...commonProps} coverageNotice={notice} />);

    const trigger = screen.getByRole("button", { name: "Calendar sync coverage" });
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Calendar sync coverage" })).toBe(trigger);
    expect(screen.queryByText(notice)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Calendar sync coverage" });
    expect(within(dialog).getByText(notice).id).toBe(dialog.getAttribute("aria-describedby"));
    expect(dialog.getAttribute("data-mobile-surface")).toBe("sheet");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close sync coverage" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("omits the action when no visible calendar has a coverage limit", () => {
    render(<Toolbar {...commonProps} coverageNotice={null} />);
    expect(screen.queryByRole("button", { name: "Calendar sync coverage" })).toBeNull();
  });
});
