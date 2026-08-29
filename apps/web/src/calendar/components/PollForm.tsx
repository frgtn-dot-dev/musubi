import { can, type Calendar, type Settings } from "@musubi/types";
import { useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { toDateKey } from "../date-key";
import { PollDayPicker } from "./PollDayPicker";
import { Button } from "~/ui/Button";
import { DatePicker } from "~/ui/DatePicker";
import { Field } from "~/ui/Field";
import { Row } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { Select } from "~/ui/Select";
import { TimePicker } from "~/ui/TimePicker";
import styles from "./styles/scheduling.module.css";

/**
 * Matches the API's cap. Beyond this a poll stops being a question and becomes a
 * survey — and the grid people have to answer stops fitting on a phone.
 */
const MAX_POLL_SLOTS = 60;
const ALL_DAY_DURATION_MINUTES = 24 * 60;

const DURATION_OPTIONS = [
	{ label: "All day", textValue: "All day", value: "1440" },
	{ label: "30 minutes", textValue: "30 minutes", value: "30" },
	{ label: "45 minutes", textValue: "45 minutes", value: "45" },
	{ label: "1 hour", textValue: "1 hour", value: "60" },
	{ label: "1.5 hours", textValue: "1.5 hours", value: "90" },
	{ label: "2 hours", textValue: "2 hours", value: "120" },
] as const;

export type PollDraft = {
	/** Exact start for timed polls; optional context for all-day polls. */
	approximateStartTime?: string;
	/** Where the decided event lands. Absent when there is nothing to choose from. */
	calendarId?: string;
	/** End of the chosen day, in the organizer's own zone. Absent means no limit. */
	deadline?: string;
	description?: string;
	durationMinutes: number;
	email?: string;
	name?: string;
	slots: Array<{ date: string; start: string }>;
	title: string;
};

/**
 * What a poll asks: which days work. One optional wall-clock time is shown as
 * context only and does not turn the resulting all-day event into a timed one.
 *
 * It reports a draft and nothing else. Inside the app that draft goes straight to
 * the server; on the public page it waits for an address to be confirmed first,
 * and neither host should have to know about the other.
 */
export function PollForm({
	busy = false,
	calendars = [],
	collectIdentity = false,
	error,
	onSubmit,
	submitLabel = "Create the poll",
	timeFormat,
	weekStartsOn,
}: {
	busy?: boolean;
	/**
	 * Calendars the decided event could land in. Empty on the public page, where
	 * the poll is written before its author has an account — that one resolves to
	 * their own calendar when they pick a day.
	 */
	calendars?: Calendar[];
	collectIdentity?: boolean;
	error?: string;
	onSubmit: (draft: PollDraft) => void;
	submitLabel?: string;
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
}) {
	const writable = calendars.filter((calendar) =>
		can(calendar.role, "editEvents"),
	);
	const [title, setTitle] = useState("");
	// Their own calendar first: a poll usually decides into the same place their
	// other events live, so the common answer is the one already filled in.
	const [calendarId, setCalendarId] = useState(
		() =>
			writable.find((calendar) => calendar.isDefault)?.id ?? writable[0]?.id ?? "",
	);
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [days, setDays] = useState<string[]>([]);
	const [approximateStartTime, setApproximateStartTime] = useState("");
	const [description, setDescription] = useState("");
	const [durationMinutes, setDurationMinutes] = useState(
		ALL_DAY_DURATION_MINUTES,
	);
	// Empty by default: most polls are answered in a day or two and a deadline
	// nobody asked for is one more decision at the point of writing the question.
	const [deadline, setDeadline] = useState("");

	const timed = durationMinutes !== ALL_DAY_DURATION_MINUTES;
	const slots = days.map((day) => ({
		date: day,
		start: new Date(
			timed && approximateStartTime
				? `${day}T${approximateStartTime}:00`
				: `${day}T12:00:00.000Z`,
		).toISOString(),
	}));
	const tooMany = slots.length > MAX_POLL_SLOTS;
	const identityReady =
		!collectIdentity || (name.trim().length > 0 && email.trim().length > 0);
	const ready =
		title.trim().length > 0 &&
		slots.length > 0 &&
		!tooMany &&
		identityReady &&
		(!timed || approximateStartTime.length > 0);

	return (
		<div className={styles.form}>
			{/* The placeholder carries it — the label above an empty first field was
          a second heading under the dialog's own. Beside it, where the decided
          event will land: the same two answers a new event asks for. */}
			<div className={styles.titleRow}>
				<Field label="What is it about" labelHidden>
					<input
						placeholder="Studio planning"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</Field>
				{writable.length > 0 ? (
					<Select
						className={styles.calendarSelect}
						label="Calendar"
						options={writable.map((calendar) => ({
							icon: (
								<span
									className={styles.calendarDot}
									style={{ background: calendar.color }}
								/>
							),
							label: calendar.name,
							value: calendar.id,
						}))}
						value={calendarId}
						onChange={setCalendarId}
					/>
				) : null}
			</div>

			{collectIdentity ? (
				<>
					<Field label="Your name">
						<input
							autoComplete="name"
							placeholder="How participants know you"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</Field>
					<Field label="Email">
						<input
							autoCapitalize="none"
							autoComplete="email"
							inputMode="email"
							placeholder="you@example.com"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</Field>
				</>
			) : null}

			<div className={styles.field}>
				<div className={styles.fieldHeader}>
					{days.length > 0 ? (
						<button
							className={styles.clear}
							type="button"
							onClick={() => setDays([])}
						>
							Clear {days.length} {days.length === 1 ? "day" : "days"}
						</button>
					) : null}
				</div>
				<ClientOnly>
					<PollDayPicker
						onChange={setDays}
						selected={days}
						weekStartsOn={weekStartsOn}
					/>
				</ClientOnly>
			</div>

			<section className={styles.optionalSection}>
				<SectionLabel level={3}>Optional details</SectionLabel>
				<Field label="Organizer note" labelHidden>
					<textarea
						maxLength={2000}
						placeholder="What should participants know?"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</Field>
				<div className={styles.optionRows}>
					<Row
						detail={
							timed
								? "Length of the decided calendar event."
								: "The decided event stays all-day."
						}
						label="Duration"
						trailing={
							<Select
								className={styles.optionInput}
								label="Duration"
								onChange={(value) => setDurationMinutes(Number(value))}
								options={DURATION_OPTIONS}
								size="compact"
								value={String(durationMinutes)}
							/>
						}
					/>
					<Row
						detail={
							timed
								? "Required for a timed event."
								: "Optional context for an all-day event."
						}
						label={timed ? "Starts at" : "Approximate start"}
						trailing={
							<TimePicker
								className={styles.optionInput}
								label={timed ? "Start time" : "Approximate start time"}
								timeFormat={timeFormat}
								value={approximateStartTime}
								onChange={setApproximateStartTime}
							/>
						}
					/>
					<Row
						detail="Stops new answers at the end of the selected day."
						label="Answers close"
						trailing={
							// Reads like the time above it: the picker itself asks, and only a
							// chosen day turns into a deadline. Taking it back lives inside the
							// picker, so this row never changes width.
							<DatePicker
								className={styles.dateInput}
								label="Answers close"
								min={toDateKey(new Date())}
								placeholder="Set deadline"
								value={deadline}
								weekStartsOn={weekStartsOn}
								onChange={setDeadline}
								onClear={deadline ? () => setDeadline("") : undefined}
							/>
						}
					/>
				</div>
			</section>

			<div className={styles.formActions}>
				<p className={tooMany ? styles.error : styles.summary}>
					{slots.length === 0
						? "Pick at least one day."
						: `${slots.length} ${slots.length === 1 ? "day" : "days"}${
								tooMany ? ` — ${MAX_POLL_SLOTS} is the most a poll can ask about` : ""
							}`}
				</p>
				<Button
					disabled={!ready}
					loading={busy}
					onClick={() =>
						onSubmit({
							...(approximateStartTime ? { approximateStartTime } : {}),
							...(description.trim() ? { description: description.trim() } : {}),
							...(collectIdentity
								? { email: email.trim().toLowerCase(), name: name.trim() }
								: {}),
							durationMinutes,
							slots,
							title: title.trim(),
							// The end of that day where the organizer is, not midnight UTC: a
							// deadline of "Friday" that expires at 2am Friday would be a trap.
							...(deadline
								? { deadline: new Date(`${deadline}T23:59:59`).toISOString() }
								: {}),
						})
					}
				>
					{submitLabel}
				</Button>
			</div>

			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
