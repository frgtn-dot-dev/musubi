import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RecurrenceEditor } from "./RecurrenceEditor";

afterEach(cleanup);

it("preserves a task's weekly rule when its date changes and uses the new date only for an explicit choice", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const props = {
    disabled: false,
    followStartDate: false,
    onChange,
    value: "FREQ=WEEKLY;BYDAY=MO",
  };
  const { rerender } = render(<RecurrenceEditor {...props} date="2026-09-14" />);

  rerender(<RecurrenceEditor {...props} date="2026-09-16" />);
  expect(onChange).not.toHaveBeenCalled();

  await user.click(screen.getByRole("combobox", { name: "Repeat" }));
  await user.click(screen.getByRole("option", { name: "Every day" }));
  await user.click(screen.getByRole("combobox", { name: "Repeat" }));
  await user.click(screen.getByRole("option", { name: "Every week" }));
  expect(onChange).toHaveBeenLastCalledWith("FREQ=WEEKLY;BYDAY=WE");
});

it("continues following the event date by default", () => {
  const onChange = vi.fn();
  const props = { disabled: false, onChange, value: "FREQ=WEEKLY;BYDAY=MO" };
  const { rerender } = render(<RecurrenceEditor {...props} date="2026-09-14" />);

  rerender(<RecurrenceEditor {...props} date="2026-09-16" />);
  expect(onChange).toHaveBeenCalledExactlyOnceWith("FREQ=WEEKLY;BYDAY=WE");
});
