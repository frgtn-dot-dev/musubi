import type { Settings } from "@musubi/types";
import { Plus, X } from "lucide-react";
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
	/** End of the chosen day, in the organizer's own zone. Absent means no limit. */
	deadline?: string;
	slots: Array<{ start: string }>;
	title: string;
};

/**
 * What a poll asks: which days and at what times.
 *
 * Days and times are separate on purpose — one time covers every day picked, so
 * three weeks of evenings is a drag and a time rather than twenty-one rows.
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
	const [times, setTimes] = useState<string[]>(["18:00"]);
	const [newTime, setNewTime] = useState("19:00");
	// Empty by default: most polls are answered in a day or two and a deadline
	// nobody asked for is one more decision at the point of writing the question.
	const [deadline, setDeadline] = useState("");

	// Days × times. Written out because it is what the poll actually asks, and
	// because seeing "6 days × 2 times = 12 options" is what stops somebody
	// producing sixty by accident.
	const slots = days.flatMap((day) =>
		times.map((time) => ({ start: new Date(`${day}T${time}`).toISOString() })),
	);
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
				<span className={styles.fieldLabel}>At what time</span>
				{/* One set of times for every chosen day. That is the whole trick for a
            long horizon: three weeks of evenings is three weeks and one time,
            not twenty-one rows. */}
				<div className={styles.times}>
					{times.map((time) => (
						<Button
							aria-label={`Remove ${time}`}
							icon={<X size={13} strokeWidth={1.8} />}
							key={time}
							size="compact"
							variant="secondary"
							onClick={() =>
								setTimes((current) => current.filter((item) => item !== time))
							}
						>
							{time}
						</Button>
					))}
					<TimePicker
						className={styles.timeInput}
						label="Add a time"
						timeFormat={timeFormat}
						value={newTime}
						onChange={setNewTime}
					/>
					<Button
						disabled={!newTime || times.includes(newTime)}
						icon={<Plus size={14} strokeWidth={1.8} />}
						size="compact"
						variant="secondary"
						onClick={() => {
							setTimes((current) => [...current, newTime].sort());
							setNewTime("");
						}}
					>
						Add
					</Button>
				</div>
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
					? "Pick at least one day and one time."
					: `${days.length} ${days.length === 1 ? "day" : "days"} × ${
							times.length
						} ${
							times.length === 1 ? "time" : "times"
						} = ${slots.length} options${
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
