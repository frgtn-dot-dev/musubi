import type { Event } from "@musubi/types";
import { useMutation } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, Info } from "lucide-react";
import { useState } from "react";
import { createEvent, getCalendars, publishEvent } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { toDateKey } from "~/calendar/date-key";
import { BrandMark } from "~/components/BrandMark";
import { EmailIdentity } from "~/components/EmailIdentity";
import { Button } from "~/ui/Button";
import { DatePicker } from "~/ui/DatePicker";
import { Field } from "~/ui/Field";
import { TimePicker } from "~/ui/TimePicker";
import styles from "~/components/public-page.module.css";

const TITLE = "Make an event page and share the link — Musubi";
const DESCRIPTION =
	"One page for when and where, with RSVPs. No app to install for the people you invite, and no password to invent for you.";

export const Route = createFileRoute("/new-event")({
	component: NewEventRoute,
	head: () => ({
		meta: [
			{ title: TITLE },
			{ content: DESCRIPTION, name: "description" },
			// The door is indexable; the pages it makes decide for themselves.
			{ content: "index, follow", name: "robots" },
			{ content: TITLE, property: "og:title" },
			{ content: DESCRIPTION, property: "og:description" },
			{ content: "website", property: "og:type" },
		],
	}),
});

type Draft = {
	date: string;
	end: string;
	location: string;
	notes: string;
	start: string;
	title: string;
};

/**
 * Making an event page without having an account first.
 *
 * Same shape as `/find-a-time`: fill the thing in, and only then confirm an
 * address — the account is made on the way past and the event lands in the
 * personal calendar the server creates with it, so there is nothing to choose.
 * Publishing follows immediately, because a link to share is the entire reason
 * somebody would start here rather than in the app.
 */
function NewEventRoute() {
	const session = authClient.useSession();
	const [draft, setDraft] = useState<Draft>({
		date: toDateKey(new Date()),
		end: "19:00",
		location: "",
		notes: "",
		start: "18:00",
		title: "",
	});
	const [asked, setAsked] = useState(false);
	const [url, setUrl] = useState<string>();
	const [copied, setCopied] = useState(false);

	const publish = useMutation({
		mutationFn: async (name: string) => {
			// The personal calendar every account is created with. Read rather than
			// chosen: a page made in thirty seconds should not open with a picker.
			const calendars = await getCalendars();
			const home =
				calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
			if (!home) {
				throw new Error(
					"This account has no calendar to put the event in yet. Open your calendar once and try again.",
				);
			}

			const event = await createEvent({
				calendars: [home.id],
				color: home.color,
				description: draft.notes.trim() || null,
				end: new Date(`${draft.date}T${draft.end}`),
				hasAttendees: true,
				id: crypto.randomUUID(),
				isAllDay: false,
				isCanceled: false,
				location: draft.location.trim() || null,
				organizer: name || session.data?.user.name || "",
				start: new Date(`${draft.date}T${draft.start}`),
				title: draft.title.trim(),
			} as Event);

			const share = await publishEvent({
				attendeeVisibility: "counts",
				eventId: event.id,
				// A page somebody has to be sent the link to. Search engines are a
				// separate decision, made in the app where the choice is explained.
				indexable: false,
				mode: "link",
				name: name || undefined,
				// Kept for API compatibility; the public page follows its reader's theme.
				theme: {
					cover: "wash",
					font: "serif",
					layout: "classic",
					palette: "sand",
				},
			});

			return share.url;
		},
		onSuccess: setUrl,
	});

	const ends = draft.end > draft.start;
	const ready = draft.title.trim().length > 0 && ends;

	return (
		<main className={styles.page} id="main-content" tabIndex={-1}>
			<div className={styles.themeRow}>
				<ThemeToggle />
			</div>

			<article className={styles.card}>
				<header className={styles.header}>
					<span aria-hidden="true" className={styles.brand}>
						<BrandMark focusable="false" />
					</span>
					<h1>Make an event page</h1>
					<p className={styles.lead}>
						When, where, and a link you can paste anywhere. People can say whether
						they are coming without installing anything, and it lands in your own
						calendar at the same time.
					</p>
				</header>

				{url ? (
					<section className={styles.step}>
						<h2>
							<Check aria-hidden="true" size={17} strokeWidth={2} /> “
							{draft.title.trim()}” is live
						</h2>
						<p className={styles.lead}>
							Send this link to whoever should come. The page shows the time in each
							reader's own timezone and collects their answers.
						</p>
						<div className={styles.linkRow}>
							<input
								aria-label="Event link"
								className={styles.linkField}
								readOnly
								value={url}
								onFocus={(event) => event.currentTarget.select()}
							/>
							<Button
								icon={<Copy size={14} strokeWidth={1.8} />}
								variant="secondary"
								onClick={() => {
									void navigator.clipboard?.writeText(url);
									setCopied(true);
								}}
							>
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>
						<p className={styles.lead}>
							The event is in your calendar too, where you can change the details or
							take the page down again.
						</p>
					</section>
				) : asked ? (
					<section className={styles.step}>
						<h2>Last thing: who is inviting?</h2>
						{/* The page as it will be published, read back before an address is
                handed over — the same review `/find-a-time` gives its poll. */}
						<dl className={styles.summary}>
							<dt>Event</dt>
							<dd>{draft.title.trim()}</dd>
							<dt>When</dt>
							<dd>
								{new Intl.DateTimeFormat(undefined, {
									day: "numeric",
									month: "long",
									weekday: "long",
								}).format(new Date(`${draft.date}T${draft.start}`))}
								, {draft.start} – {draft.end}
							</dd>
							{draft.location.trim() ? (
								<>
									<dt>Where</dt>
									<dd>{draft.location.trim()}</dd>
								</>
							) : null}
						</dl>
						<EmailIdentity
							busy={publish.isPending}
							confirmLabel="Confirm and publish"
							disclosure={
								<p className={styles.disclosure}>
									<Info aria-hidden="true" size={14} strokeWidth={1.7} />
									Confirming the code makes you a Musubi account with no password. Your
									name appears on the page as the organizer; your address does not.
								</p>
							}
							onIdentified={({ name }) => publish.mutate(name)}
						/>
						{publish.error ? (
							<p className={styles.error} role="alert">
								{publish.error.message}
							</p>
						) : null}
						<button
							className={styles.back}
							type="button"
							onClick={() => setAsked(false)}
						>
							Change the details
						</button>
					</section>
				) : (
					<div className={styles.form}>
						<Field label="What is happening">
							<input
								placeholder="Studio opening"
								value={draft.title}
								onChange={(event) => setDraft({ ...draft, title: event.target.value })}
							/>
						</Field>

						{/* Labelled above, not only through the control's accessible name:
                this page is read by people who have never seen the app. The
                label is hidden from assistive tech because the picker's own
                aria-label already says the same thing. */}
						<div className={styles.field}>
							<span aria-hidden="true" className={styles.fieldLabel}>
								Date
							</span>
							<ClientOnly>
								<DatePicker
									label="Date"
									value={draft.date}
									weekStartsOn="monday"
									onChange={(date) => setDraft({ ...draft, date })}
								/>
							</ClientOnly>
						</div>

						<div className={styles.times}>
							<div className={styles.field}>
								<span aria-hidden="true" className={styles.fieldLabel}>
									From
								</span>
								<TimePicker
									label="From"
									timeFormat="24h"
									value={draft.start}
									onChange={(start) =>
										setDraft({
											...draft,
											// Keep the length rather than the end: dragging the start
											// later should not silently make the event shorter.
											end: shiftEnd(draft.start, draft.end, start),
											start,
										})
									}
								/>
							</div>
							<div className={styles.field}>
								<span aria-hidden="true" className={styles.fieldLabel}>
									To
								</span>
								<TimePicker
									label="To"
									min={draft.start}
									timeFormat="24h"
									value={draft.end}
									onChange={(end) => setDraft({ ...draft, end })}
								/>
							</div>
						</div>

						<Field label="Where (optional)">
							<input
								placeholder="Studio, Brno"
								value={draft.location}
								onChange={(event) =>
									setDraft({ ...draft, location: event.target.value })
								}
							/>
						</Field>

						<Field label="Anything else (optional)">
							<textarea
								placeholder="Doors at six, bring something to drink."
								rows={3}
								value={draft.notes}
								onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
							/>
						</Field>

						{!ends ? (
							<p className={styles.error} role="alert">
								The end has to be after the start.
							</p>
						) : null}

						{publish.error && session.data ? (
							<p className={styles.error} role="alert">
								{publish.error.message}
							</p>
						) : null}

						<Button
							disabled={!ready}
							loading={publish.isPending}
							onClick={() => {
								if (session.data) {
									publish.mutate("");
									return;
								}
								// Held here: nothing is created before an address is confirmed.
								setAsked(true);
							}}
						>
							{session.data ? "Publish the page" : "Continue"}
						</Button>
					</div>
				)}
			</article>

			<p className={styles.footer}>
				<Link to="/">Open your calendar</Link> ·{" "}
				<Link to="/find-a-time">Find a time that suits everyone</Link>
			</p>
		</main>
	);
}

/** Moves the end by however much the start moved, keeping the length. */
function shiftEnd(start: string, end: string, nextStart: string): string {
	const minutes = (value: string) => {
		const [hour, minute] = value.split(":").map(Number);
		return (hour ?? 0) * 60 + (minute ?? 0);
	};
	const length = minutes(end) - minutes(start);
	if (length <= 0) return end;

	const shifted = Math.min(minutes(nextStart) + length, 23 * 60 + 59);

	return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(
		shifted % 60,
	).padStart(2, "0")}`;
}
