import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { RecurrenceEditor } from "./RecurrenceEditor";
afterEach(cleanup);
it("restores only the selected all-day exclusion and returns keyboard focus", async () => {
  const changed = vi.fn();
  function Editor() {
    const [value, setValue] = useState("RRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:20260329,20260330");
    return <RecurrenceEditor allDay date="2026-03-28" value={value} disabled={false} onChange={next => { changed(next); setValue(next); }} />;
  }
  render(<Editor />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Restore 2026-03-29" }));
  expect(changed).toHaveBeenLastCalledWith("RRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:20260330");
  expect(screen.queryByRole("button", { name: "Restore 2026-03-29" })).toBeNull();
  expect(screen.getByRole("button", { name: "Restore 2026-03-30" })).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Repeat" }));
});
for (const [allDay, value] of [[false, "RRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:20260329"], [true, "RRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:20260329,20260329"], [true, "RRULE:FREQ=DAILY;COUNT=4\nEXDATE;TZID=Europe/Prague:20260329T090000"]] as const) {
  it(`keeps unsupported exclusion evidence uneditable ${allDay} ${value}`, () => {
    render(<RecurrenceEditor allDay={allDay} date="2026-03-28" value={value} disabled={false} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Restore / })).toBeNull();
  });
}
