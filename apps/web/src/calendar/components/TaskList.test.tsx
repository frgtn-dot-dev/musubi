import { describe, expect, it, vi } from "vitest";
import {
  replaceTaskDate,
  replaceTaskTime,
  taskDateKey,
  taskTime,
} from "./TaskList";

describe("task editor date values", () => {
  it("keeps the local clock when changing a task date", () => {
    const original = new Date(2026, 0, 2, 14, 35, 20);
    const next = replaceTaskDate(original, "2026-02-03");

    expect(taskDateKey(next)).toBe("2026-02-03");
    expect(taskTime(next)).toBe("14:35");
    expect(next.getSeconds()).toBe(20);
  });

  it("replaces only the local time without serializing through UTC", () => {
    const original = new Date(2026, 0, 2, 14, 35, 20);
    const next = replaceTaskTime(original, "09:05");

    expect(taskDateKey(next)).toBe("2026-01-02");
    expect(taskTime(next)).toBe("09:05");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskSchema } from "@musubi/types";
import { TaskList } from "./TaskList";
import { fixtureCalendars } from "../fixtures";

it("refreshes a coalesced retired baseline and keeps an explicit clear through repeated retirement", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Private title", description: "Private description" });
  const onUpdate = vi.fn(async () => task);
  const props = { calendars: fixtureCalendars, tasks: [task], createRequest: 0, editableCalendarIds: new Set([task.calendarID]), offline: false, tasksResolved: true, onCreateRequestHandled: vi.fn(), onCreate: vi.fn(), onUpdate, onRemove: vi.fn(), settings: { timeFormat: "24h" as const, weekStartsOn: "monday" as const } };
  const view = render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: /Private title/ }));
  await user.clear(screen.getByRole("textbox", { name: "Notes" }));
  view.rerender(<TaskList {...props} tasks={[{ ...task, title: "Fresh permitted title", description: "Fresh permitted description", providerReadRetiredGeneration: 1 }]} />);
  expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Fresh permitted title");
  expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLInputElement).value).toBe("");
  view.rerender(<TaskList {...props} tasks={[{ ...task, title: "Second permitted title", description: "Second permitted description", providerReadRetiredGeneration: 2 }]} />);
  expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLInputElement).value).toBe("");
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: "Second permitted title", description: null, expectedProviderReadRetiredGeneration: 2 }));
});

it("retires a removed source only after confirmed task data, retaining authored title", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Private title", description: "Private description" });
  const props = { calendars: fixtureCalendars, tasks: [task], createRequest: 0, editableCalendarIds: new Set([task.calendarID]), offline: false, onCreateRequestHandled: vi.fn(), onCreate: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn(), settings: { timeFormat: "24h" as const, weekStartsOn: "monday" as const } };
  const view = render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: /Private title/ }));
  await user.clear(screen.getByRole("textbox", { name: "Title" }));
  await user.type(screen.getByRole("textbox", { name: "Title" }), "My draft");
  view.rerender(<TaskList {...props} tasks={[]} tasksResolved={false} />);
  expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLInputElement).value).toBe("Private description");
  view.rerender(<TaskList {...props} sourceCalendars={[]} calendarsResolved tasksResolved={false} />);
  expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("My draft");
  expect((screen.getByRole("button", { name: "Save task" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/no longer available from its source/)).toBeTruthy();
});
