import { afterEach, describe, expect, it, vi } from "vitest";
import {
  replaceTaskDate,
  replaceTaskTime,
  taskDateKey,
  taskTime,
  taskRecurrenceSummary,
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

describe("task recurrence summaries", () => {
  it("describes known rules without inventing a weekday for an undated task", () => {
    expect(taskRecurrenceSummary("FREQ=WEEKLY")).toBe("Every week");
    expect(taskRecurrenceSummary("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5")).toBe("Every week on Mon, Wed, 5 times");
  });

  it("does not approximate imported rules or omit their exceptions", () => {
    expect(taskRecurrenceSummary("FREQ=MONTHLY;BYDAY=2MO")).toBe("Custom recurrence");
    expect(taskRecurrenceSummary("RRULE:FREQ=DAILY\nEXDATE:20260912T090000Z")).toBe("Custom recurrence");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
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

it("refreshes untouched task fields after separate retirement and same-generation restoration before saving", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Original private task", description: "Original notes", url: "https://private.example.test/old", relatedTo: "old-related" });
  const onUpdate = vi.fn(async () => task);
  const props = { calendars: fixtureCalendars, tasks: [task], createRequest: 0, editableCalendarIds: new Set([task.calendarID]), offline: false, tasksResolved: true, onCreateRequestHandled: vi.fn(), onCreate: vi.fn(), onUpdate, onRemove: vi.fn(), settings: { timeFormat: "24h" as const, weekStartsOn: "monday" as const } };
  const view = render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: /Original private task/ }));
  const retired = { ...task, title: "Private task", description: null, url: null, relatedTo: null, providerReadRetiredGeneration: 1 };
  view.rerender(<TaskList {...props} tasks={[retired]} />);
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Private task");
  expect(screen.getByRole("textbox", { name: "Notes" })).toHaveProperty("value", "");
  const restored = { ...task, title: "Restored provider title", description: "Restored provider notes", url: "https://private.example.test/restored", relatedTo: "restored-related", providerReadRetiredGeneration: 1 };
  view.rerender(<TaskList {...props} tasks={[restored]} />);
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", restored.title);
  expect(screen.getByRole("textbox", { name: "Notes" })).toHaveProperty("value", restored.description);
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: restored.title, description: restored.description, url: restored.url, relatedTo: restored.relatedTo, expectedProviderReadRetiredGeneration: 1 }));
});

it("preserves authored title and explicit note clear through separate retirement and restoration", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Private draft source", description: "Private notes" });
  const onUpdate = vi.fn(async () => task);
  const props = { calendars: fixtureCalendars, tasks: [task], createRequest: 0, editableCalendarIds: new Set([task.calendarID]), offline: false, tasksResolved: true, onCreateRequestHandled: vi.fn(), onCreate: vi.fn(), onUpdate, onRemove: vi.fn(), settings: { timeFormat: "24h" as const, weekStartsOn: "monday" as const } };
  const view = render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: /Private draft source/ }));
  await user.clear(screen.getByRole("textbox", { name: "Title" }));
  await user.type(screen.getByRole("textbox", { name: "Title" }), "My authored title");
  await user.clear(screen.getByRole("textbox", { name: "Notes" }));
  view.rerender(<TaskList {...props} tasks={[{ ...task, title: "Private task", description: null, providerReadRetiredGeneration: 1 }]} />);
  view.rerender(<TaskList {...props} tasks={[{ ...task, title: "Authorized restored title", description: "Authorized restored notes", providerReadRetiredGeneration: 1 }]} />);
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "My authored title");
  expect(screen.getByRole("textbox", { name: "Notes" })).toHaveProperty("value", "");
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: "My authored title", description: null, expectedProviderReadRetiredGeneration: 1 }));
});


afterEach(cleanup);

function emptyTaskProps() {
  return { calendars: fixtureCalendars, tasks: [], createRequest: 0, editableCalendarIds: new Set([fixtureCalendars[0]!.id]), offline: false, onCreateRequestHandled: vi.fn(), onCreate: vi.fn(async input => TaskSchema.parse({ ...input, creatorID: "owner" })), onUpdate: vi.fn(), onRemove: vi.fn(), settings: { timeFormat: "24h" as const, weekStartsOn: "monday" as const } };
}

it("keeps a folded imported recurrence unchanged when saving another field", async () => {
  const user = userEvent.setup();
  const recurrence = "RRULE:FREQ=MONTHLY;BYDAY=2MO\nEXDATE:20260914T090000Z";
  const task = TaskSchema.parse({ id: "task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Plan workshop", recurrence });
  const props = { ...emptyTaskProps(), tasks: [task], onUpdate: vi.fn(async () => task) };
  render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: /Plan workshop/ }));
  expect(screen.getAllByText("Custom recurrence").length).toBeGreaterThan(0);
  expect(screen.getByRole("textbox", { name: "Recurrence rule" }).closest("details")).toHaveProperty("open", false);
  await user.type(screen.getByRole("textbox", { name: "Title" }), " together");
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(props.onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ title: "Plan workshop together", recurrence }));
});

it("creates the first task through the empty state's existing task editor", async () => {
  const user = userEvent.setup();
  const props = emptyTaskProps();
  render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: "Create task" }));
  expect(screen.getByRole("dialog", { name: "New task" })).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Prepare workshop");
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "Prepare workshop", calendarID: fixtureCalendars[0]!.id }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers no empty-state creation while offline or without an editable calendar", () => {
  const props = emptyTaskProps();
  const view = render(<TaskList {...props} offline />);
  expect(screen.getByRole("heading", { name: "No saved tasks" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  view.rerender(<TaskList {...props} editableCalendarIds={new Set()} />);
  expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  expect(screen.getByText("Tasks from the calendars on this Page will appear here.")).toBeTruthy();
  expect(props.onCreate).not.toHaveBeenCalled();
});

it("keeps due-only recurrence anchored without adding a start", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Weekly review", due: new Date(2026, 8, 14), start: null });
  const props = { ...emptyTaskProps(), tasks: [task], onUpdate: vi.fn(async () => task) };
  render(<TaskList {...props} />);
  await user.click(screen.getByRole("button", { name: /Weekly review/ }));
  await user.click(screen.getByText("Recurrence", { exact: true }));
  await user.click(screen.getByRole("combobox", { name: "Repeat" }));
  await user.click(screen.getByRole("option", { name: "Every week" }));
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(props.onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ recurrence: "FREQ=WEEKLY;BYDAY=MO", start: null }));
});
