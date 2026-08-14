import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  formatTimeValue,
  parseTimeInput,
  TimePicker,
} from "./TimePicker";

describe("parseTimeInput", () => {
  it.each([
    ["9", "09:00"],
    ["9:30", "09:30"],
    ["930", "09:30"],
    ["21:15", "21:15"],
    ["9:30 pm", "21:30"],
    ["12 am", "00:00"],
    ["12:05 PM", "12:05"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected);
  });

  it.each(["", "24:00", "9:75", "13 pm", "noon"])(
    "rejects %s",
    (input) => {
      expect(parseTimeInput(input)).toBeNull();
    },
  );
});

describe("formatTimeValue", () => {
  it("uses the user's 12-hour preference", () => {
    expect(formatTimeValue("00:05", "12h")).toBe("12:05 AM");
    expect(formatTimeValue("13:30", "12h")).toBe("1:30 PM");
  });
});

function renderPicker(
  onChange: (value: string) => void,
  overrides: Partial<React.ComponentProps<typeof TimePicker>> = {},
) {
  return render(
    <TimePicker
      label="Start time"
      onChange={onChange}
      timeFormat="24h"
      value="09:00"
      {...overrides}
    />,
  );
}

describe("TimePicker", () => {
  it("labels an empty optional value and scrolls its list directly", async () => {
    const user = userEvent.setup();
    renderPicker(vi.fn(), { value: "" });

    const input = screen.getByRole("combobox", { name: "Start time" });
    expect(input.getAttribute("placeholder")).toBe("Select time");
    await user.click(input);

    const listbox = screen.getByRole("listbox");
    fireEvent.wheel(listbox, { deltaY: 120 });
    expect(listbox.scrollTop).toBe(120);
  });

  it("opens on the value and chooses the next step by keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onChange);

    const input = screen.getByRole("combobox", { name: "Start time" });
    await user.click(input);

    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "09:00" })
        .getAttribute("aria-selected"),
    ).toBe("true");

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("09:15");
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("commits a typed 12-hour time on Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onChange, { timeFormat: "12h" });

    const input = screen.getByRole("combobox", { name: "Start time" });
    expect((input as HTMLInputElement).value).toBe("9:00 AM");
    await user.click(input);
    await user.clear(input);
    expect((input as HTMLInputElement).value).toBe("");
    await user.type(input, "9:30 pm");
    expect((input as HTMLInputElement).value).toBe("9:30 pm");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("21:30");
    expect((input as HTMLInputElement).value).toBe("9:00 AM");
  });

  it("shows duration beside end-time options", async () => {
    const user = userEvent.setup();
    renderPicker(vi.fn(), {
      label: "End time",
      min: "09:15",
      relativeTo: "09:00",
      timeFormat: "12h",
      value: "10:00",
    });

    await user.click(
      screen.getByRole("combobox", { name: "End time" }),
    );

    expect(
      screen.getByRole("option", { name: "9:30 AM, +30m" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "10:00 AM, +1h" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "9:00 AM" }),
    ).toBeNull();
  });

  it("keeps focus and value when Escape closes the list", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker(onChange);

    const input = screen.getByRole("combobox", { name: "Start time" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe("09:00");
  });

  it("commits on blur without stealing focus back", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <TimePicker
          label="Start time"
          onChange={onChange}
          timeFormat="24h"
          value="09:00"
        />
        <button type="button">Next field</button>
      </>,
    );

    const input = screen.getByRole("combobox", { name: "Start time" });
    await user.click(input);
    await user.clear(input);
    await user.type(input, "10:20");
    await user.click(screen.getByRole("button", { name: "Next field" }));

    expect(onChange).toHaveBeenCalledWith("10:20");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Next field" }),
    );
  });
});
