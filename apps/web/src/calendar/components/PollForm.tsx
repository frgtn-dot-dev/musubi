import type { Settings } from "@musubi/types";
import { useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { toDateKey } from "../date-key";
import { PollDayPicker } from "./PollDayPicker";
import { Button } from "~/ui/Button";
import { DatePicker } from "~/ui/DatePicker";
import { Field } from "~/ui/Field";
import { Row } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
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
	email?: string;
	name?: string;
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
	collectIdentity = false,
	error,
	onSubmit,
	submitLabel = "Create the poll",
	timeFormat,
	weekStartsOn,
}: {
	busy?: boolean;
	collectIdentity?: boolean;
	error?: string;
	onSubmit: (draft: PollDraft) => void;
	submitLabel?: string;
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
}) {
	const [title, setTitle] = useState("");
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
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
	const identityReady =
		!collectIdentity || (name.trim().length > 0 && email.trim().length > 0);
	const ready =
		title.trim().length > 0 && slots.length > 0 && !tooMany && identityReady;

	return (
		<div className={styles.form}>
			<Field label="What is it about">
				<input
					placeholder="Studio planning"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
			</Field>

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
					<span className={styles.fieldLabel}>Which days</span>
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
				<div className={styles.optionRows}>
					<Row
						detail="Shown as context; the calendar event remains all-day."
						label="Approximate start"
						trailing={
							<TimePicker
								className={styles.timeInput}
								label="Approximate start time"
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
							deadline ? (
								<div className={styles.deadlineControls}>
									<DatePicker
										label="Answers close"
										min={toDateKey(new Date())}
										value={deadline}
										weekStartsOn={weekStartsOn}
										onChange={setDeadline}
									/>
									<Button
										size="compact"
										variant="ghost"
										onClick={() => setDeadline("")}
									>
										Clear
									</Button>
								</div>
							) : (
								<Button
									size="compact"
									variant="secondary"
									onClick={() => setDeadline(toDateKey(new Date()))}
								>
									Set date
								</Button>
							)
						}
					/>
				</div>
			</section>

			<div className={styles.formActions}>
				<p className={tooMany ? styles.error : styles.summary}>
				{slots.length === 0
					? "Pick at least one day."
					: `${slots.length} ${slots.length === 1 ? "day" : "days"}${
							tooMany
								? ` — ${MAX_POLL_SLOTS} is the most a poll can ask about`
								: ""
						}`}
				</p>
				<Button
					disabled={!ready}
					loading={busy}
					onClick={() =>
						onSubmit({
							...(approximateStartTime ? { approximateStartTime } : {}),
							...(collectIdentity
								? { email: email.trim().toLowerCase(), name: name.trim() }
								: {}),
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
