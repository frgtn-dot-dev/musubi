import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Workspace } from "./Workspace";

describe("Workspace", () => {
  it("keeps calendar visibility changes as an explicit Page draft", async () => {
    const user = userEvent.setup();

    render(
      <Workspace
        activeView="month"
        date="2026-07-26"
        pageId="my-calendar"
        onDateChange={vi.fn()}
        onPageChange={vi.fn()}
        onViewChange={vi.fn()}
      />,
    );

    const studioToggle = screen.getByRole("checkbox", { name: "Studio" });
    expect((studioToggle as HTMLInputElement).checked).toBe(true);

    await user.click(studioToggle);

    expect((studioToggle as HTMLInputElement).checked).toBe(false);
    expect(
      screen.getByRole("region", { name: "Unsaved page changes" }),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect((studioToggle as HTMLInputElement).checked).toBe(true);
    expect(
      screen.queryByRole("region", { name: "Unsaved page changes" }),
    ).toBeNull();
  });

  it("filters visible fixture events through the toolbar search", async () => {
    const user = userEvent.setup();

    render(
      <Workspace
        activeView="month"
        date="2026-07-26"
        pageId="my-calendar"
        onDateChange={vi.fn()}
        onPageChange={vi.fn()}
        onViewChange={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search events" }), "quarterly");

    expect(screen.getByRole("button", { name: /Quarterly planning/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Design review/ })).toBeNull();
  });
});
