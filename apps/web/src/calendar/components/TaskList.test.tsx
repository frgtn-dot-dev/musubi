import { useState } from "react";
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

import { cleanup, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
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

it("updates status inline without dropping recurrence", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "inline", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Inline task", recurrence: "FREQ=WEEKLY" });
  const props = { ...emptyTaskProps(), tasks: [task], onUpdate: vi.fn(async () => task) };
  render(<TaskList {...props} />);
  await user.click(screen.getByRole("combobox", { name: "Status of Inline task" }));
  await user.click(screen.getByRole("option", { name: "Completed" }));
  expect(props.onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ status: "completed", percentComplete: 100, completedAt: expect.any(Date), recurrence: "FREQ=WEEKLY" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("preserves completion on priority edits and exposes failed writes", async () => {
  const user = userEvent.setup();
  const completedAt = new Date();
  const task = TaskSchema.parse({ id: "inline", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Inline task", status: "completed", completedAt, percentComplete: 100 });
  const props = { ...emptyTaskProps(), tasks: [task], onUpdate: vi.fn(async () => { throw new Error("offline"); }) };
  render(<TaskList {...props} />);
  await user.click(screen.getByRole("combobox", { name: "Priority of Inline task" }));
  await user.click(screen.getByRole("option", { name: "High (1)" }));
  expect(props.onUpdate).toHaveBeenCalledWith(task.id, expect.objectContaining({ priority: 1, status: "completed", completedAt, percentComplete: 100 }));
  expect(await screen.findByRole("dialog", { name: "Edit task" })).toBeTruthy();
  expect(screen.getByText(/This task could not be updated/)).toBeTruthy();
});


it("returns keyboard focus to the status control after moving between groups", async () => {
  const user = userEvent.setup();
  const task = TaskSchema.parse({ id: "focus", creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: "Focus task" });
  function Example() {
    const [tasks, setTasks] = useState([task]);
    return <TaskList {...emptyTaskProps()} tasks={tasks} onUpdate={async (_id, update) => {
      const updated = { ...task, ...update };
      setTasks([updated]);
      return updated;
    }} />;
  }
  render(<Example />);
  for (const status of ["Completed", "Needs action"]) {
    await user.click(screen.getByRole("combobox", { name: "Status of Focus task" }));
    await user.click(screen.getByRole("option", { name: status }));
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Status of Focus task" }));
  }
});


it("groups every task under its own phase", () => {
  const statuses = ["needs-action", "in-process", "completed", "cancelled"] as const;
  const labels = ["Needs action", "In progress", "Completed", "Cancelled"];
  const tasks = statuses.map(status => TaskSchema.parse({ id: status, creatorID: "owner", calendarID: fixtureCalendars[0]!.id, title: `Task ${status}`, status }));
  render(<TaskList {...emptyTaskProps()} tasks={tasks} />);
  statuses.forEach((status, index) => {
    const group = screen.getByRole("heading", { name: `${labels[index]} 1` }).closest("section")!;
    expect(within(group).getByRole("button", { name: new RegExp(`Task ${status}`) })).toBeTruthy();
    expect(group.querySelectorAll("li")).toHaveLength(1);
  });
});


it("shows all four Kanban columns and creates tasks directly in their phase", async () => {
  const user = userEvent.setup();
  const props = emptyTaskProps();
  render(<TaskList {...props} layout="kanban" />);
  for (const name of ["Needs action", "In progress", "Completed", "Cancelled"]) {
    expect(screen.getByRole("region", { name })).toBeTruthy();
  }
  await user.click(within(screen.getByRole("region", { name: "Completed" })).getByRole("button", { name: "Add task" }));
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Already done");
  await user.click(screen.getByRole("button", { name: "Save task" }));
  expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", percentComplete: 100, completedAt: expect.any(Date) }));
});

it("offers a keyboard path from the drag handle to the status selector", async () => {
  const task = TaskSchema.parse({ id: "drag", title: "Drag task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id });
  render(<TaskList {...emptyTaskProps()} tasks={[task]} layout="kanban" />);
  fireEvent.click(screen.getByRole("button", { name: /Drag Drag task to another status/ }), { detail: 0 });
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Status of Drag task" }));
});

it("keeps read-only Kanban cards visible without drag or create actions", () => {
  const task = TaskSchema.parse({ id: "readonly", title: "Read only task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id });
  render(<TaskList {...emptyTaskProps()} tasks={[task]} editableCalendarIds={new Set()} offline layout="kanban" />);
  expect(screen.getByText("Read only task")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Drag Read only task/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add task" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Status of Read only task" })).toHaveProperty("disabled", true);
});

it("lets touch gestures scroll the card while keeping touch drag on its handle", () => {
  const task = TaskSchema.parse({ id: "touch", title: "Touch task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id });
  render(<TaskList {...emptyTaskProps()} tasks={[task]} layout="kanban" />);
  const card = screen.getByRole("button", { name: "Touch task" }).closest("[data-task-id]")!;
  const press = () => Object.assign(new Event("pointerdown", { bubbles: true, cancelable: true }), { pointerType: "touch", pointerId: 8, button: 0, clientX: 20, clientY: 20 });
  const scrollStart = press();
  fireEvent(card, scrollStart);
  expect(scrollStart.defaultPrevented).toBe(false);
  expect(document.querySelector("[data-drag-preview]")).toBeNull();
  fireEvent(screen.getByRole("button", { name: /Drag Touch task to another status/ }), press());
  expect(document.querySelector("[data-drag-preview]")).not.toBeNull();
  // Unmount's cleanup also cancels the animation frame and removes the preview.
  cleanup();
  expect(document.querySelector("[data-drag-preview]")).toBeNull();
});

it("follows the active pointer even when a child stops move and release propagation", async () => {
  const task = TaskSchema.parse({ id: "pointer", title: "Pointer task", creatorID: "owner", calendarID: fixtureCalendars[0]!.id });
  render(<TaskList {...emptyTaskProps()} tasks={[task]} layout="kanban" />);
  const card = screen.getByRole("button", { name: "Pointer task" }).closest("[data-task-id]")!;
  const pointer = (type: string, x: number, id = 7) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    pointerType: "mouse", pointerId: id, button: 0, clientX: x, clientY: 20,
  });
  const originalHit = document.elementFromPoint;
  document.elementFromPoint = () => card;
  const stop = (event: Event) => event.stopPropagation();
  card.addEventListener("pointermove", stop);
  card.addEventListener("pointerup", stop);
  try {
    fireEvent(card, pointer("pointerdown", 20));
    const preview = document.querySelector<HTMLElement>("[data-drag-preview]")!;
    fireEvent(card, pointer("pointermove", 150, 99));
    expect(preview.style.transform).toContain("translate3d(0px");
    fireEvent(card, pointer("pointermove", 150));
    expect(preview.style.transform).toContain("translate3d(130px");
    fireEvent.mouseMove(card, { clientX: 190, clientY: 20, buttons: 1 });
    expect(preview.style.transform).toContain("translate3d(170px");
    fireEvent(card, pointer("pointerup", 150));
    await waitFor(() => expect(document.querySelector("[data-drag-preview]")).toBeNull());
  } finally {
    document.elementFromPoint = originalHit;
    card.removeEventListener("pointermove", stop);
    card.removeEventListener("pointerup", stop);
    cleanup();
  }
});
