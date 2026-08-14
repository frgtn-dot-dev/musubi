import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEventFormValues, type EventFormValues } from "../event-form";
import { fixtureCalendars } from "../fixtures";
import { EventEditorForm } from "./EventEditorForm";
import { RecurrenceEditor } from "./RecurrenceEditor";

afterEach(cleanup);

const baseValues: EventFormValues = {
	...defaultEventFormValues("personal", "2026-07-08", "09:00"),
	title: "Planning",
};

function renderEditor(
	recurrence = "",
	onSubmit = vi.fn<(values: EventFormValues) => Promise<void>>(() =>
		Promise.resolve(),
	),
) {
	render(
		<EventEditorForm
			calendars={fixtureCalendars}
			initialValues={{ ...baseValues, recurrence }}
			onCancel={vi.fn()}
			onError={() => ({ message: "Save failed" })}
			onSubmit={onSubmit}
			submitLabel="Save"
			timeFormat="24h"
			weekStartsOn="monday"
		/>,
	);
	return onSubmit;
}

async function chooseRepeat(
	user: ReturnType<typeof userEvent.setup>,
	name: string,
) {
	await user.click(screen.getByRole("combobox", { name: "Repeat" }));
	await user.click(screen.getByRole("option", { name }));
}

describe("EventEditorForm custom recurrence", () => {
	it("submits an exact every-two-weeks rule on selected days after N occurrences", async () => {
		const user = userEvent.setup();
		const onSubmit = renderEditor();

		await chooseRepeat(user, "Custom recurrence");
		const interval = screen.getByRole("spinbutton", {
			name: "Recurrence interval",
		});
		await user.click(interval);
		await user.keyboard("{Control>}a{/Control}2");
		await user.click(screen.getByRole("button", { name: "Monday" }));
		await user.click(screen.getByRole("radio", { name: "After" }));
		const count = screen.getByRole("spinbutton", { name: "Occurrence count" });
		await user.click(count);
		await user.keyboard("{Control>}a{/Control}5");

		expect(screen.getByText(/^Every /).textContent).toBe(
			"Every 2 weeks on Mon, Wed, 5 times",
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit).toHaveBeenCalledOnce();
		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(
			"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5",
		);
	});

	it("moves an ordinary weekly preset with the event date", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn<(values: EventFormValues) => Promise<void>>(() =>
			Promise.resolve(),
		);
		const props = {
			calendars: fixtureCalendars,
			initialValues: {
				...baseValues,
				recurrence: "FREQ=WEEKLY;BYDAY=WE",
			},
			onCancel: vi.fn(),
			onError: () => ({ message: "Save failed" }),
			onSubmit,
			submitLabel: "Save",
			timeFormat: "24h" as const,
			weekStartsOn: "monday" as const,
		};
		const { rerender } = render(<EventEditorForm {...props} />);

		rerender(
			<EventEditorForm
				{...props}
				when={{
					date: "2026-07-09",
					endDate: "2026-07-09",
					endTime: baseValues.endTime,
					isAllDay: false,
					startTime: baseValues.startTime,
				}}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe("FREQ=WEEKLY;BYDAY=TH");
	});

	it("moves a weekly preset with the date without dropping UNTIL", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn<(values: EventFormValues) => Promise<void>>(() =>
			Promise.resolve(),
		);
		const recurrence =
			"RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T225959Z\nEXDATE:20260805T070000Z";
		const props = {
			calendars: fixtureCalendars,
			initialValues: { ...baseValues, recurrence },
			onCancel: vi.fn(),
			onError: () => ({ message: "Save failed" }),
			onSubmit,
			submitLabel: "Save",
			timeFormat: "24h" as const,
			weekStartsOn: "monday" as const,
		};
		const { rerender } = render(<EventEditorForm {...props} />);

		await chooseRepeat(user, "Every week");
		rerender(
			<EventEditorForm
				{...props}
				when={{
					date: "2026-07-09",
					endDate: "2026-07-09",
					endTime: baseValues.endTime,
					isAllDay: false,
					startTime: baseValues.startTime,
				}}
			/>,
		);
		expect(
			screen.getByRole("combobox", { name: "Repeat" }).textContent,
		).toContain("Every week");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(
			"RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231T225959Z\nEXDATE:20260805T070000Z",
		);
	});

	it("keeps manually chosen custom weekdays when the date moves", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn<(values: EventFormValues) => Promise<void>>(() =>
			Promise.resolve(),
		);
		const props = {
			calendars: fixtureCalendars,
			initialValues: {
				...baseValues,
				recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
			},
			onCancel: vi.fn(),
			onError: () => ({ message: "Save failed" }),
			onSubmit,
			submitLabel: "Save",
			timeFormat: "24h" as const,
			weekStartsOn: "monday" as const,
		};
		const { rerender } = render(<EventEditorForm {...props} />);

		rerender(
			<EventEditorForm
				{...props}
				when={{
					date: "2026-07-09",
					endDate: "2026-07-09",
					endTime: baseValues.endTime,
					isAllDay: false,
					startTime: baseValues.startTime,
				}}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(
			"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
		);
	});

	it("does not allow removing the final weekly day", async () => {
		const user = userEvent.setup();
		renderEditor();

		await chooseRepeat(user, "Custom recurrence");

		expect(
			(screen.getByRole("button", { name: "Wednesday" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("initializes an existing supported custom rule", () => {
		renderEditor("FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,TH;COUNT=7");

		expect(
			screen.getByRole("combobox", { name: "Repeat" }).textContent,
		).toContain("Custom recurrence");
		expect(
			(
				screen.getByRole("spinbutton", {
					name: "Recurrence interval",
				}) as HTMLInputElement
			).value,
		).toBe("3");
		expect(
			screen
				.getByRole("button", { name: "Tuesday" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText("Every 3 weeks on Tue, Thu, 7 times")).toBeTruthy();
	});

	it("keeps an unsupported imported rule raw until explicit replacement", async () => {
		const user = userEvent.setup();
		const raw = "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1";
		const onSubmit = renderEditor(raw);

		expect(screen.getByText(/cannot safely change/)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(raw);

		await user.click(
			screen.getByRole("button", { name: "Replace with editable rule" }),
		);
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(onSubmit.mock.calls[1]?.[0].recurrence).toBe("FREQ=WEEKLY;BYDAY=WE");
	});

	it("keeps the visible count and saved COUNT aligned through Never and After", async () => {
		const user = userEvent.setup();
		const onSubmit = renderEditor("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=7");
		const ending = within(
			screen.getByRole("radiogroup", { name: "Recurrence ending" }),
		);

		await user.click(ending.getByRole("radio", { name: "Never" }));
		await user.click(ending.getByRole("radio", { name: "After" }));
		expect(
			(
				screen.getByRole("spinbutton", {
					name: "Occurrence count",
				}) as HTMLInputElement
			).value,
		).toBe("7");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(
			"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=7",
		);
	});

	it("restores empty recurrence numbers on blur instead of hiding stale rules", async () => {
		const user = userEvent.setup();
		const onSubmit = renderEditor("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=7");
		const interval = screen.getByRole("spinbutton", {
			name: "Recurrence interval",
		});
		const count = screen.getByRole("spinbutton", { name: "Occurrence count" });

		await user.clear(interval);
		await user.tab();
		expect((interval as HTMLInputElement).value).toBe("2");
		await user.clear(count);
		await user.tab();
		expect((count as HTMLInputElement).value).toBe("7");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(
			"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=7",
		);
	});

	it("syncs numeric inputs when a controlled recurrence changes externally", () => {
		const { rerender } = render(
			<RecurrenceEditor
				date="2026-07-08"
				disabled={false}
				value="FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=5"
				onChange={vi.fn()}
			/>,
		);

		rerender(
			<RecurrenceEditor
				date="2026-07-08"
				disabled={false}
				value="FREQ=WEEKLY;INTERVAL=4;BYDAY=WE;COUNT=8"
				onChange={vi.fn()}
			/>,
		);

		expect(
			(
				screen.getByRole("spinbutton", {
					name: "Recurrence interval",
				}) as HTMLInputElement
			).value,
		).toBe("4");
		expect(
			(
				screen.getByRole("spinbutton", {
					name: "Occurrence count",
				}) as HTMLInputElement
			).value,
		).toBe("8");
	});

	it("preserves EXDATE and UNTIL while editing an editable rule", async () => {
		const user = userEvent.setup();
		const onSubmit = renderEditor(
			"RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261231T225959Z\nEXDATE:20260805T070000Z",
		);

		expect(screen.getByText(/currently ends on 2026-12-31/)).toBeTruthy();
		const interval = screen.getByRole("spinbutton", {
			name: "Recurrence interval",
		});
		await user.clear(interval);
		await user.type(interval, "3");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onSubmit.mock.calls[0]?.[0].recurrence).toBe(
			"RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=WE;UNTIL=20261231T225959Z\nEXDATE:20260805T070000Z",
		);

		const ending = within(
			screen.getByRole("radiogroup", { name: "Recurrence ending" }),
		);
		await user.click(ending.getByRole("radio", { name: "Never" }));
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(onSubmit.mock.calls[1]?.[0].recurrence).toBe(
			"RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=WE\nEXDATE:20260805T070000Z",
		);
	});
});
