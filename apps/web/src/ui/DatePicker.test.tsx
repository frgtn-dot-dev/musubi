import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

function renderPicker(
  onChange: (value: string) => void,
  overrides: Partial<React.ComponentProps<typeof DatePicker>> = {},
) {
  return render(
    <DatePicker
      label="Date"
      value="2026-07-28"
      weekStartsOn="monday"
      onChange={onChange}
      {...overrides}
    />,
  );
}

describe("DatePicker", () => {
  it("opens on the selected date and chooses with the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onChange);

    const trigger = screen.getByRole("button", {
      name: /Date: Tuesday, July 28, 2026/,
    });
    await user.click(trigger);

    const selected = screen.getByRole("gridcell", {
      name: "Tuesday, July 28, 2026",
    });
    await waitFor(() => expect(document.activeElement).toBe(selected));
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{ArrowRight}");
    const nextDay = screen.getByRole("gridcell", {
      name: "Wednesday, July 29, 2026",
    });
    await waitFor(() => expect(document.activeElement).toBe(nextDay));
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("2026-07-29");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports exact typed entry without a native date input", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onChange);

    await user.click(screen.getByRole("button", { name: /Date:/ }));
    const input = screen.getByRole("textbox", { name: "Exact date" });
    await user.clear(input);
    await user.type(input, "2026-08-05{Enter}");

    expect(onChange).toHaveBeenCalledWith("2026-08-05");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables dates before the minimum and will not focus them", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onChange, {
      min: "2026-07-30",
      value: "2026-07-30",
    });

    await user.click(screen.getByRole("button", { name: /Date:/ }));
    const selected = screen.getByRole("gridcell", {
      name: "Thursday, July 30, 2026",
    });
    const unavailable = screen.getByRole("gridcell", {
      name: "Wednesday, July 29, 2026",
    });
    expect((unavailable as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(selected));

    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(selected);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses PageDown to preserve the day in the next month", async () => {
    const user = userEvent.setup();
    renderPicker(vi.fn());

    await user.click(screen.getByRole("button", { name: /Date:/ }));
    const selected = screen.getByRole("gridcell", {
      name: "Tuesday, July 28, 2026",
    });
    await waitFor(() => expect(document.activeElement).toBe(selected));
    await user.keyboard("{PageDown}");

    const nextMonth = screen.getByRole("gridcell", {
      name: "Friday, August 28, 2026",
    });
    await waitFor(() => expect(document.activeElement).toBe(nextMonth));
  });
});
