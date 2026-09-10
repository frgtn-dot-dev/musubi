import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createEventFromForm, type EventFormValues } from "../event-form";
import { fixtureCalendars } from "../fixtures";
import { EventEditorForm } from "./EventEditorForm";
import { QuickCreate } from "./QuickCreate";

afterEach(cleanup);

it.each(["00", "01"])("carries Prague's %s:30Z fold through quick create and full editor writes", async (hour) => {
  const user = userEvent.setup();
  const exactRange = { start: new Date(`2026-10-25T${hour}:30:00Z`), end: new Date(`2026-10-25T${hour}:45:00Z`) };
  const onCreate = vi.fn(async (event) => event);
  const onMoreOptions = vi.fn();
  const props = {
    anchor: { x: 10, y: 10 }, calendars: fixtureCalendars, date: "2026-10-25", email: "alex@example.com",
    startTime: "02:30", endTime: "02:45", exactRange, onCreate, onCreated: vi.fn(),
    onOpenChange: vi.fn(), onMoreOptions, open: true, timeFormat: "24h" as const, userId: "alex", weekStartsOn: "monday" as const,
  };
  const quick = render(<QuickCreate {...props} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Fold meeting");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject(exactRange);
  await user.click(screen.getByRole("button", { name: "More options" }));
  const values = onMoreOptions.mock.calls[0]![0] as EventFormValues;
  quick.unmount();
  const fullWrite = vi.fn();
  render(<EventEditorForm calendars={fixtureCalendars} initialValues={values} onCancel={vi.fn()} onError={(error) => ({ message: String(error) })}
    onSubmit={async (draft) => { fullWrite(createEventFromForm(draft, { email: props.email, userId: props.userId }, "#b3492f")); }}
    submitLabel="Save" timeFormat="24h" weekStartsOn="monday" />);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(fullWrite).toHaveBeenCalledOnce();
  expect(fullWrite.mock.calls[0]![0]).toMatchObject(exactRange);
});

it("moves a titled draft between identical civil fold fields using the exact range", async () => {
  const user = userEvent.setup();
  const first = { start: new Date("2026-10-25T00:30:00Z"), end: new Date("2026-10-25T00:45:00Z") };
  const second = { start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T01:45:00Z") };
  const onCreate = vi.fn(async (event) => event);
  const props = { anchor: { x: 10, y: 10 }, calendars: fixtureCalendars, date: "2026-10-25", email: "alex@example.com", startTime: "02:30", endTime: "02:45", onCreate, onCreated: vi.fn(), onOpenChange: vi.fn(), open: true, timeFormat: "24h" as const, userId: "alex", weekStartsOn: "monday" as const };
  const view = render(<QuickCreate {...props} exactRange={first} />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Moved fold");
  view.rerender(<QuickCreate {...props} exactRange={second} />);
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ ...second, title: "Moved fold" });
});

it("refuses a typed spring gap without sending a create write", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async (event) => event);
  render(<QuickCreate anchor={{ x: 10, y: 10 }} calendars={fixtureCalendars} date="2026-03-29" email="alex@example.com" startTime="01:30" endTime="03:30"
    exactRange={{ start: new Date("2026-03-29T00:30:00Z"), end: new Date("2026-03-29T01:30:00Z") }}
    onCreate={onCreate} onCreated={vi.fn()} onOpenChange={vi.fn()} open timeFormat="24h" userId="alex" weekStartsOn="monday" />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Gap meeting");
  const start = screen.getByRole("combobox", { name: "Start time" });
  await user.clear(start);
  await user.type(start, "02:30");
  await user.tab();
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("missing or occurs twice");
});

it("keeps the untouched second-fold start when the end is edited", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async (event) => event);
  render(<QuickCreate anchor={{ x: 10, y: 10 }} calendars={fixtureCalendars} date="2026-10-25" email="alex@example.com" startTime="02:30" endTime="02:45"
    exactRange={{ start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T01:45:00Z") }}
    onCreate={onCreate} onCreated={vi.fn()} onOpenChange={vi.fn()} open timeFormat="24h" userId="alex" weekStartsOn="monday" />);
  await user.type(screen.getByRole("textbox", { name: "Event title" }), "Longer fold meeting");
  const end = screen.getByRole("combobox", { name: "End time" });
  await user.clear(end);
  await user.type(end, "03:30");
  await user.tab();
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0]![0]).toMatchObject({ start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T02:30:00Z") });
});
