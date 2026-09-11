import { chooseEventTimeKind } from "@musubi/calendar";
import {
	can,
	DEFAULT_CALENDAR_COLOR,
	providerDisplayName,
	type Calendar,
	type Event,
	type Settings,
} from "@musubi/types";
import {
	CalendarDays,
	Check,
	ChevronDown,
	Clock3,
	House,
	Link2,
	MapPin,
	Repeat2,
	UsersRound,
} from "lucide-react";
import {
	Fragment,
	type FormEvent,
	type KeyboardEvent,
	type RefCallback,
	type RefObject,
	useId,
	useState,
} from "react";
import { useNarrowViewport } from "~/design/use-narrow-viewport";
import { Button } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { DatePicker } from "~/ui/DatePicker";
import { Field } from "~/ui/Field";
import { Select } from "~/ui/Select";
import { Row } from "~/ui/Row";
import { Switch } from "~/ui/Switch";
import { SectionLabel } from "~/ui/SectionLabel";
import { minutesToTime, TimePicker, timeToMinutes } from "~/ui/TimePicker";
import { groupCalendars } from "../calendar-groups";
import { shiftDayKey } from "../date-key";
import {
	type EventFormValues,
	eventBoundaries,
	selectHomeCalendar,
	validateEventForm,
} from "../event-form";
import {
	connectionOfCalendar,
	federatedConnectionMap,
} from "../federation-routing";
import { useSnapshot } from "~/offline/SnapshotProvider";
import { createTimeGeometry } from "../time-geometry";
import { CalendarDot } from "./CalendarDot";
import { RecurrenceEditor } from "./RecurrenceEditor";
import styles from "./styles/event-editor.module.css";

type FormError = {
	message: string;
	requestId?: string;
};

const TIME_SNAP_MINUTES = createTimeGeometry().snapMinutes;
const LAST_MINUTE = 24 * 60 - 1;
const LATEST_START_TIME = minutesToTime(LAST_MINUTE - TIME_SNAP_MINUTES);
const LATEST_END_TIME = minutesToTime(LAST_MINUTE);

/** What the grid's draft is drawn from: when it is, and which calendar's colour. */
function draftSignature(values: EventFormValues): string {
	return [
		values.calendarId,
		values.date,
		values.endDate,
		values.endTime,
		values.isAllDay,
		values.startTime,
	].join("|");
}

/** The "when" fields a gesture outside the form can move under it. */
export type EventWhen = Pick<
	EventFormValues,
	"date" | "endDate" | "endTime" | "isAllDay" | "startTime" | "exactRange"
>;

type EventEditorFormProps = {
	rdateMaster?: Event;
	calendarLocked?: boolean;
	calendars: Calendar[];
	/**
	 * Quick create: only what a new event cannot do without — name, when, which
	 * calendar — with the rest behind one disclosure. Same form, same validation,
	 * same submit; only how much of it is on screen differs (R3, R5).
	 */
	compact?: boolean;
	/**
	 * Where "More options" leads when the extra fields belong somewhere else — a
	 * full page, in practice. It receives what is already filled in, so the draft
	 * travels with the user. Absent reveals the rest in place.
	 */
	onExpand?: (values: EventFormValues) => void;
	initialValues: EventFormValues;
	/** Retain a draft across an access-change unmount without retaining provider baselines. */
	onValuesChange?: (values: EventFormValues) => void;
	/** Panel editors own a scrolling body and fixed actions inside an inspector. */
	layout?: "page" | "popover" | "panel";
	/**
	 * The title field, for a shell that owns its own opening focus. `autoFocus`
	 * is enough on a page; inside a dialog the shell moves focus after mount and
	 * would take it away again.
	 */
	titleRef?: RefObject<HTMLInputElement | null>;
	/**
	 * A new "when" from outside the form — the draft block being dragged on the
	 * grid while this is open. Only these fields are replaced, so a title that is
	 * already typed survives the move.
	 */
	when?: EventWhen;
	/**
	 * Grid ← form. The draft on the grid is the same event this form describes, so
	 * editing the time, the length or the calendar has to move and recolour it —
	 * otherwise the block says one thing and the fields another. Only fires on a
	 * real change, so the `when` prop coming back the other way cannot loop.
	 */
	onDraftChange?: (draft: EventWhen & { color?: string }) => void;
	onCancel: () => void;
	onError: (error: unknown, values: EventFormValues) => FormError;
	onSubmit: (values: EventFormValues) => Promise<void>;
	submitLabel: string;
	submitRef?: RefCallback<HTMLButtonElement>;
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
};

export function EventEditorForm({
	rdateMaster,
	calendarLocked = false,
	calendars,
	compact = false,
	initialValues,
	onValuesChange,
	layout = "popover",
	onCancel,
	onDraftChange,
	onExpand,
	onError,
	onSubmit,
	submitLabel,
	submitRef,
	timeFormat,
	titleRef,
	weekStartsOn,
	when,
}: EventEditorFormProps) {
	const id = useId();
	const narrow = useNarrowViewport();
	const panel = layout === "panel";
	const fieldVariant = panel ? "plain" : "section";
	const Body = panel ? "div" : Fragment;
	// What the app knows, not what the browser guesses: a self-hosted server that
	// is down looks online to `navigator`.
	const { offline } = useSnapshot();
	const [values, setValues] = useState(initialValues);
	const [expanded, setExpanded] = useState(!compact);
	const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
	const [placementMessage, setPlacementMessage] = useState("");
	// Adjusted during render rather than from an effect: the form must never
	// paint a time the grid has already moved on from.
	const whenSignature = when ? JSON.stringify(when) : "";
	const [syncedWhen, setSyncedWhen] = useState(whenSignature);
	if (when && syncedWhen !== whenSignature) {
		setSyncedWhen(whenSignature);
		setValues((current) => ({ ...current, ...when, invalidatedExactEndpoints: undefined }));
	}
	const [error, setError] = useState<FormError>();
	const [saving, setSaving] = useState(false);
	const selectedCalendar = calendars.find(
		(calendar) => calendar.id === values.calendarId,
	);
	const selectedCalendarIds = new Set(values.calendarIds);
	const calendarGroups = groupCalendars(calendars);
	const homeServer = calendarServer(selectedCalendar);
	const calendarCount = values.calendarIds.length;
	const calendarDisclosure = panel || !expanded;
	const showCalendarList = !calendarDisclosure || calendarPickerOpen;

	function patch(next: Partial<EventFormValues>) {
		const changed = (keys: (keyof EventFormValues)[]) => keys.some((key) => key in next && next[key] !== values[key]);
		const invalidated = new Set(values.invalidatedExactEndpoints);
		if (changed(["date", "startTime", "isAllDay", "timeKind", "timeZone"])) invalidated.add("start");
		if (changed(["endDate", "endTime", "isAllDay", "timeKind", "timeZone"])) invalidated.add("end");
		const merged = { ...values, ...next, invalidatedExactEndpoints: [...invalidated] };

		setValues(merged);
		onValuesChange?.(merged);
		setError(undefined);
		if (onDraftChange && draftSignature(merged) !== draftSignature(values)) {
			let exactRange = merged.exactRange;
			if (!merged.isAllDay && (!merged.timeKind || merged.timeKind === "legacy-unknown")) {
				try {
					exactRange = eventBoundaries(merged);
				} catch {
					// Keep the last valid grid preview until the civil edit resolves.
					return;
				}
			}
			onDraftChange({
				color: calendars.find((calendar) => calendar.id === merged.calendarId)
					?.color,
				date: merged.date,
				exactRange: merged.isAllDay ? undefined : exactRange,
				endDate: merged.endDate,
				endTime: merged.endTime,
				isAllDay: merged.isAllDay,
				startTime: merged.startTime,
			});
		}
	}

	function changeStartTime(startTime: string) {
		const previousStart = timeToMinutes(values.startTime);
		const previousEnd = timeToMinutes(values.endTime);
		const nextStart = timeToMinutes(startTime);
		if (nextStart === null) return;

		const previousDuration =
			previousStart !== null && previousEnd !== null && previousEnd > previousStart
				? previousEnd - previousStart
				: 60;
		const nextEnd = Math.min(
			LAST_MINUTE,
			nextStart + Math.max(TIME_SNAP_MINUTES, previousDuration),
		);

		patch({
			endTime: minutesToTime(nextEnd),
			startTime,
		});
	}

	function changeHomeCalendar(calendar: Calendar) {
		const switchedServer = calendarServer(calendar) !== homeServer;
		const change = selectHomeCalendar(values, calendar.id, (calendarId) =>
			calendarServer(calendars.find((item) => item.id === calendarId)),
		);

		patch({
			calendarId: change.calendarId,
			calendarIds: change.calendarIds,
		});
		setPlacementMessage(
			switchedServer && change.removedCalendarCount > 0
				? `${calendar.name} is now home. ${change.removedCalendarCount} ${
						change.removedCalendarCount === 1 ? "calendar was" : "calendars were"
					} removed because an event cannot span Musubi servers.`
				: `${calendar.name} is now the home calendar.`,
		);
	}

	function changeCalendarMembership(calendar: Calendar, checked: boolean) {
		patch({
			calendarIds: checked
				? Array.from(new Set([...values.calendarIds, calendar.id]))
				: values.calendarIds.filter((calendarId) => calendarId !== calendar.id),
		});
		setPlacementMessage(
			checked
				? `Event will also appear in ${calendar.name}.`
				: `Event will no longer appear in ${calendar.name}.`,
		);
	}

	async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
		submitEvent.preventDefault();
		const validationError = validateEventForm(
			values,
			federatedConnectionMap(calendars),
		);

		if (validationError) {
			setError({ message: validationError });
			return;
		}

		setSaving(true);
		setError(undefined);

		try {
			await onSubmit(values);
		} catch (submitError) {
			setError(onError(submitError, values));
		} finally {
			setSaving(false);
		}
	}

	function handleExpand() {
		try {
			if (onExpand) onExpand(values);
			else setExpanded(true);
		} catch (error) {
			setError(onError(error, values));
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
		if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.requestSubmit();
		}
	}

	function changeTimeModel(next: Partial<EventFormValues>) {
		patch({
			...next,
			...(panel && next.isAllDay && values.endDate <= values.date
				? { endDate: shiftDayKey(values.date, 1) }
				: {}),
		});
	}

	function changeAllDay(checked: boolean) {
		changeTimeModel(values.timeKind && values.timeKind !== "legacy-unknown"
			? chooseEventTimeKind(values, checked ? "all-day" : "zoned")
			: { isAllDay: checked });
	}

	// Popovers grow down; narrow sheets grow up. Keep the toggle on the
	// anchored side of the conditional time row, with matching DOM/tab order.
	const allDayToggle = panel ? (
		<Row
			className={styles.toggleRow}
			size="compact"
			label="All day"
			trailing={<Switch label="All day" checked={values.isAllDay} disabled={saving} onCheckedChange={changeAllDay} />}
		/>
	) : (
		<Checkbox
			checked={values.isAllDay}
			className={styles.toggleRow}
			disabled={saving}
			label="All day"
			onChange={(event) => changeAllDay(event.target.checked)}
		/>
	);

	return (
		<form
			aria-busy={saving || undefined}
			className={styles.form}
			data-compact={!expanded ? "" : undefined}
			data-layout={layout}
			onKeyDown={handleKeyDown}
			onSubmit={handleSubmit}
		>
			<Body {...(panel ? { className: styles.formBody } : {})}>
			<Field
				className={styles.titleField}
				label="Event title"
				labelHidden={!panel}
				variant={fieldVariant}
			>
				<input
					autoFocus
					disabled={saving}
					placeholder="Event title"
					ref={titleRef}
					value={values.title}
					onChange={(event) => patch({ title: event.target.value })}
				/>
			</Field>

			<section
				aria-labelledby={`${id}-when-heading`}
				className={`${styles.section} ${styles.whenSection}`}
				data-editor-section="when"
			>
				<SectionLabel className={styles.sectionLabel} id={`${id}-when-heading`}>
					When
				</SectionLabel>
			{values.timeEditable && expanded && <>
				<Field label="Time model" variant={fieldVariant}>
					<Select label="Time model" value={values.timeKind === "legacy-unknown" ? "" : values.timeKind ?? ""} placeholder="Not specified" disabled={saving}
						options={[{ value: "zoned", label: "Event time zone" }, { value: "floating", label: "Floating local time" }, { value: "all-day", label: "All-day dates" }]}
						onChange={kind => changeTimeModel(chooseEventTimeKind(values, kind as "zoned" | "floating" | "all-day"))} />
				</Field>
				{values.timeKind === "zoned" && <Field label="Event time zone" description="For example Europe/Prague. Uses the dates and times shown below." variant={fieldVariant}>
					<input value={values.timeZone ?? ""} placeholder="Europe/Prague" disabled={saving} onChange={event => patch({ timeZone: event.target.value, timeLabel: event.target.value || "Choose an event time zone" })} />
				</Field>}
				<p className={styles.timeContext}>The selected model interprets the dates and times below. Changing it may change when the event occurs.</p>
			</>}
			{values.timeLabel && <p className={styles.timeContext}>{values.timeLabel}</p>}
				<div className={styles.pickerRow}>
					<CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
					<span aria-hidden="true" className={styles.pickerLabel}>
						Date
					</span>
					<DatePicker
						className={styles.pickerValue}
						disabled={saving}
						label="Date"
						value={values.date}
						weekStartsOn={weekStartsOn}
						onChange={(date) =>
							patch({
								date,
								...(!values.isAllDay && values.endDate === values.date
									? { endDate: date }
									: {}),
							})
						}
					/>
				</div>

				{!narrow ? allDayToggle : null}

				{!values.isAllDay ? (
					<div className={styles.timeRow}>
						<Clock3 aria-hidden="true" size={17} strokeWidth={1.5} />
						<span
							aria-hidden="true"
							className={`${styles.pickerLabel} ${styles.timeLabel}`}
						>
							Time
						</span>
						<TimePicker
							disabled={saving}
							label="Start time"
							max={LATEST_START_TIME}
							timeFormat={timeFormat}
							value={values.startTime}
							onChange={changeStartTime}
						/>
						<span className={styles.timeSeparator}>to</span>
						<TimePicker
							disabled={saving}
							label="End time"
							max={LATEST_END_TIME}
							min={
								values.endDate === values.date
									? minutesToTime(
											Math.min(
												LAST_MINUTE,
												(timeToMinutes(values.startTime) ?? 0) + TIME_SNAP_MINUTES,
											),
										)
									: undefined
							}
							timeFormat={timeFormat}
							value={values.endTime}
							onChange={(endTime) => patch({ endTime })}
						/>
					</div>
				) : null}
				<div className={styles.pickerRow}>
					<CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
					<span aria-hidden="true" className={styles.pickerLabel}>
						Ends
					</span>
					<DatePicker
						className={styles.pickerValue}
						disabled={saving}
						label="Ends"
						min={panel && values.isAllDay ? shiftDayKey(values.date, 1) : values.date}
						value={values.endDate}
						weekStartsOn={weekStartsOn}
						onChange={(endDate) => patch({ endDate })}
					/>
				</div>

				{panel && values.isAllDay ? <p className={styles.timeContext}>End date is not included.</p> : null}

				{narrow ? allDayToggle : null}

				{expanded ? (
					<Field
						className={`${styles.inlineField} ${styles.recurrenceField}`}
						label={
							<span className={styles.fieldLabel}>
								<Repeat2 aria-hidden="true" size={16} strokeWidth={1.5} />
								Repeat
							</span>
						}
						layout="inline"
						variant={fieldVariant}
					>
						<RecurrenceEditor
                            rdateMaster={rdateMaster}
                            weekStartsOn={weekStartsOn}
							allDay={values.timeKind === "all-day"}
							date={values.date}
							disabled={saving}
							value={values.recurrence}
							onChange={(recurrence) => patch({ recurrence })}
						/>
					</Field>
				) : null}
			</section>

			{expanded ? (
				<section
					aria-labelledby={`${id}-details-heading`}
					className={`${styles.section} ${styles.detailsSection}`}
					data-editor-section="details"
				>
					<SectionLabel className={styles.sectionLabel} id={`${id}-details-heading`}>
						Details
					</SectionLabel>
					<Checkbox
						checked={values.hasAttendees}
						className={styles.toggleRow}
						description="Guests can respond to this event."
						disabled={saving}
						label={
							<span className={styles.fieldLabel}>
								<UsersRound aria-hidden="true" size={16} strokeWidth={1.5} />
								Allow attendance
							</span>
						}
						onChange={(event) => patch({ hasAttendees: event.target.checked })}
					/>
					<Field
						label={
							<span className={styles.fieldLabel}>
								<MapPin aria-hidden="true" size={16} strokeWidth={1.5} />
								Location
							</span>
						}
						variant={fieldVariant}
					>
						<input
							disabled={saving}
							placeholder="Add location"
							value={values.location}
							onChange={(event) => patch({ location: event.target.value })}
						/>
					</Field>
					<Field
						label={
							<span className={styles.fieldLabel}>
								<Link2 aria-hidden="true" size={16} strokeWidth={1.5} />
								Link
							</span>
						}
						variant={fieldVariant}
					>
						<input
							disabled={saving}
							placeholder="Add link"
							type="url"
							value={values.url}
							onChange={(event) => patch({ url: event.target.value })}
						/>
					</Field>
					<Field
						className={styles.descriptionField}
						label="Description"
						variant={fieldVariant}
					>
						<textarea
							disabled={saving}
							placeholder="Add notes"
							rows={panel ? 8 : 3}
							value={values.description}
							onChange={(event) => patch({ description: event.target.value })}
						/>
					</Field>
				</section>
			) : null}

			<section
				aria-labelledby={`${id}-calendar-heading`}
				className={`${styles.section} ${styles.calendarSection}`}
				data-editor-section="calendars"
			>
				<SectionLabel className={styles.sectionLabel} id={`${id}-calendar-heading`}>
					Event calendars
				</SectionLabel>

				{calendarDisclosure ? (
					<button
						aria-controls={`${id}-calendar-list`}
						aria-expanded={calendarPickerOpen}
						aria-label={`Choose calendars. ${
							selectedCalendar?.name ?? "No calendar"
						} is home. Event appears in ${calendarCount} ${
							calendarCount === 1 ? "calendar" : "calendars"
						}.`}
						className={styles.calendarSummary}
						disabled={saving}
						type="button"
						onClick={() => setCalendarPickerOpen((current) => !current)}
					>
						<CalendarDot color={selectedCalendar?.color ?? DEFAULT_CALENDAR_COLOR} />
						<span className={styles.calendarSummaryCopy}>
							<strong>{selectedCalendar?.name ?? "Choose a calendar"}</strong>
							{/* The "home" idea only means something once an event is in more
                  than one calendar. On its own it read as a place, next to
                  "Only calendar", which read as a restriction — beside a button
                  that says Change. */}
							<span>
								{calendarCount > 1
									? `Home calendar · in ${calendarCount} calendars altogether`
									: "Appears in this calendar only"}
							</span>
						</span>
						<span className={styles.calendarSummaryAction}>
							Change
							<ChevronDown
								aria-hidden="true"
								data-open={calendarPickerOpen ? "" : undefined}
								size={15}
								strokeWidth={1.6}
							/>
						</span>
					</button>
				) : (
					<p className={styles.calendarHint} id={`${id}-calendar-hint`}>
						Choose where the event appears. Its home calendar owns updates,
						invitations, and the event color.
					</p>
				)}

				{showCalendarList ? (
					<fieldset
						aria-describedby={!calendarDisclosure ? `${id}-calendar-hint` : undefined}
						className={styles.calendarPlacement}
						data-ui="calendar-placement"
						id={`${id}-calendar-list`}
					>
						<legend className={styles.visuallyHidden}>
							Calendars for this event
						</legend>
						<div aria-hidden="true" className={styles.calendarPlacementHeader}>
							<span>Appears in</span>
							<span>Home</span>
						</div>

						{calendarGroups.map((group) => (
							<div className={styles.calendarGroup} key={group.key}>
								{calendarGroups.length > 1 ? (
									<div className={styles.calendarGroupHeading}>
										<strong>{group.title}</strong>
										<span>{group.detail}</span>
									</div>
								) : null}
								<ul>
									{group.calendars.map((calendar) => {
										const checked = selectedCalendarIds.has(calendar.id);
										const isHome = values.calendarId === calendar.id;
										const compatible = calendarServer(calendar) === homeServer;
										const membershipLocked =
											saving || isHome || !compatible || !can(calendar.role, "editEvents");
										const homeLocked =
											saving || calendarLocked || !can(calendar.role, "editEvents");
										const detail = !compatible
											? "Choose as home to switch Musubi server"
											: calendarSourceDetail(calendar);

										return (
											<li className={styles.calendarPlacementRow} key={calendar.id}>
												<label
													className={styles.calendarMembership}
													data-disabled={membershipLocked ? "" : undefined}
													data-home={isHome ? "" : undefined}
												>
													<input
														aria-label={`Show event in ${calendar.name}`}
														checked={checked}
														disabled={membershipLocked}
														type="checkbox"
														onChange={(event) =>
															changeCalendarMembership(calendar, event.target.checked)
														}
													/>
													<span aria-hidden="true" className={styles.calendarMembershipBox}>
														{checked ? <Check size={12} strokeWidth={2.2} /> : null}
													</span>
													<CalendarDot color={calendar.color} />
													<span className={styles.calendarPlacementCopy}>
														<strong>{calendar.name}</strong>
														<span>{detail}</span>
													</span>
												</label>

												{calendarLocked ? (
													isHome ? (
														<span
															aria-label="Home calendar"
															className={styles.homeMark}
															role="img"
														>
															<House aria-hidden="true" size={14} strokeWidth={1.7} />
														</span>
													) : (
														<span aria-hidden="true" />
													)
												) : (
													<label
														className={styles.homeChoice}
														data-checked={isHome ? "" : undefined}
														data-disabled={homeLocked ? "" : undefined}
													>
														<input
															aria-label={`${calendar.name} as home calendar`}
															checked={isHome}
															disabled={homeLocked}
															name={`${id}-home-calendar`}
															type="radio"
															value={calendar.id}
															onChange={() => changeHomeCalendar(calendar)}
														/>
														<span aria-hidden="true">
															<House size={14} strokeWidth={1.7} />
														</span>
														<span className={styles.visuallyHidden}>
															{isHome ? "Home" : "Make home"}
														</span>
													</label>
												)}
											</li>
										);
									})}
								</ul>
							</div>
						))}
					</fieldset>
				) : null}

				{placementMessage ? (
					<span aria-live="polite" className={styles.visuallyHidden} role="status">
						{placementMessage}
					</span>
				) : null}
			</section>

			{error ? (
				<div className={styles.formError} role="alert">
					<p>{error.message}</p>
					{error.requestId ? <span>Request ID: {error.requestId}</span> : null}
				</div>
			) : null}

			</Body>

			<div className={styles.actions}>
				{panel && expanded && onExpand ? (
					<Button disabled={saving} variant="secondary" onClick={handleExpand}>
						More options
					</Button>
				) : null}
				{expanded ? (
					<Button disabled={saving} variant="secondary" onClick={onCancel}>
						Cancel
					</Button>
				) : (
					// One disclosure, in place: the draft carries over because it is the
					// same form state, not a second editor.
					<Button
						disabled={saving}
						variant="secondary"
						onClick={handleExpand}
					>
						More options
					</Button>
				)}
				{/* The form stays open and keeps everything typed — a draft is worth
            more than a cleared screen — but the button says why it cannot go
            (`07-realtime-offline-federation.md:103`). */}
				<Button
					disabled={offline}
					loading={saving}
					ref={submitRef}
					title={
						offline
							? "The server cannot be reached — nothing can be saved yet"
							: undefined
					}
					type="submit"
				>
					{offline ? "No connection" : saving ? "Saving…" : submitLabel}
				</Button>
			</div>
		</form>
	);
}

function calendarServer(calendar: Calendar | undefined) {
	return connectionOfCalendar(calendar) ?? "home";
}

function calendarSourceDetail(calendar: Calendar) {
	if (calendar.provider) return providerDisplayName(calendar);
	if (calendar.isDefault) return "Personal calendar";
	return calendar.role === "owner" ? "Your calendar" : "Shared calendar";
}
