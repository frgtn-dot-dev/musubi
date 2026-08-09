import type { Settings } from "@musubi/types";
import { useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { toDateKey } from "../date-key";
import { PollDayPicker } from "./PollDayPicker";
import { Button } from "~/ui/Button";
import { DatePicker } from "~/ui/DatePicker";
import { Field } from "~/ui/Field";
import { TimePicker } from "~/ui/TimePicker";
import styles from "./styles/scheduling.module.css";

/**
 * Matches the API's cap. Beyond this a poll stops being a question and becomes a
 * survey — and the grid people have to answer stops fitting on a phone.
 */
const MAX_POLL_SLOTS = 60;

export type PollDraft = {
	/** Informational wall-clock hint only; the resulting event stays all-day. */
	approximateStartTime?: string;
	/** End of the chosen day, in the organizer's own zone. Absent means no limit. */
	deadline?: string;
	slots: Array<{ start: string }>;
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
	error,
	onSubmit,
	submitLabel = "Create the poll",
	timeFormat,
	weekStartsOn,
}: {
	busy?: boolean;
	error?: string;
	onSubmit: (draft: PollDraft) => void;
	submitLabel?: string;
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
}) {
	const [title, setTitle] = useState("");
	const [days, setDays] = useState<string[]>([]);
	const [approximateStartTime, setApproximateStartTime] = useState("");
	// Empty by default: most polls are answered in a day or two and a deadline
	// nobody asked for is one more decision at the point of writing the question.
	const [deadline, setDeadline] = useState("");

	// One option per day. Noon is only a stable internal date carrier; the optional
	// approximate time is stored separately and never controls the all-day event.
	const slots = days.map((day) => ({
		start: new Date(`${day}T12:00`).toISOString(),
	}));
	const tooMany = slots.length > MAX_POLL_SLOTS;
	const ready = title.trim().length > 0 && slots.length > 0 && !tooMany;

	return (
		<div className={styles.form}>
			<Field label="What is it about">
				<input
					placeholder="Studio planning"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
			</Field>

			<div className={styles.field}>
				<span className={styles.fieldLabel}>Which days</span>
				<ClientOnly>
					<PollDayPicker
						onChange={setDays}
						selected={days}
						weekStartsOn={weekStartsOn}
					/>
				</ClientOnly>
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

			<div className={styles.field}>
				<span className={styles.fieldLabel}>Approximate start (optional)</span>
				<TimePicker
					className={styles.timeInput}
					label="Approximate start time"
					timeFormat={timeFormat}
					value={approximateStartTime}
					onChange={setApproximateStartTime}
				/>
				<p className={styles.fieldHint}>
					Shown for context only. The calendar event stays all-day.
				</p>
			</div>

			{/* Optional, and last: a poll works without one, and the server refuses a
          vote after it rather than anything having to run on a schedule. */}
			<div className={styles.deadlineRow}>
				<span className={styles.deadlineLabel}>Answers close</span>
				{deadline ? (
					<>
						<DatePicker
							label="Answers close"
							min={toDateKey(new Date())}
							value={deadline}
							weekStartsOn={weekStartsOn}
							onChange={setDeadline}
						/>
						<button
							className={styles.clear}
							type="button"
							onClick={() => setDeadline("")}
						>
							No deadline
						</button>
					</>
				) : (
					<button
						className={styles.clear}
						type="button"
						onClick={() => setDeadline(toDateKey(new Date()))}
					>
						Set a date
					</button>
				)}
			</div>

			<p className={tooMany ? styles.error : styles.summary}>
				{slots.length === 0
					? "Pick at least one day."
					: `${slots.length} ${slots.length === 1 ? "day" : "days"}${
							tooMany
								? ` — ${MAX_POLL_SLOTS} is the most a poll can ask about`
								: ""
						}`}
			</p>

			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}

			<Button
				disabled={!ready}
				loading={busy}
				onClick={() =>
					onSubmit({
						...(approximateStartTime ? { approximateStartTime } : {}),
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
	);
}
