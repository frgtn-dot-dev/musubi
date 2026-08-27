import {
	endSeriesBefore,
	excludeOccurrence,
	noteParts,
	seriesEditWrites,
	shortUrlLabel,
	type EditScope,
} from "@musubi/calendar";
import type { Calendar, Event, Settings } from "@musubi/types";
import { providerDisplayName, sameRule } from "@musubi/types";
import {
	AlertTriangle,
	ArrowLeft,
	BellRing,
	CalendarDays,
	ChevronDown,
	ChevronUp,
	Check,
	Clock3,
	CopyPlus,
	FileText,
	Link2,
	MapPin,
	Pencil,
	Repeat2,
	Share2,
	Star,
	Trash2,
	UsersRound,
	X,
} from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { Attendee, RemoveEventResponse } from "~/api/contracts";
import {
	answerLabel,
	ATTENDANCE_CHOICES,
	groupAttendees,
	type AttendanceChoice,
} from "../attendance";
import { getEventAttendees } from "~/api/resources";
import { Avatar } from "~/ui/Avatar";
import { AvatarStack } from "~/ui/AvatarStack";
import { Button, IconButton } from "~/ui/Button";
import {
	ConfirmationDialog,
	ConfirmationNotice,
} from "~/ui/ConfirmationDialog";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuSeparator,
	MenuTrigger,
} from "~/ui/Menu";
import {
	Popover,
	PopoverAnchor,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from "~/ui/Popover";
import { InlineError } from "~/ui/InlineError";
import { RowAction } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { getEventDateLabel, getEventRangeLabel } from "../calendar-math";
import {
	eventFormValues,
	updateEventFromForm,
	type EventFormValues,
} from "../event-form";
import { connectionOfCalendar } from "../federation-routing";
import { focusMovedToAnotherLayer } from "../layer-focus";
import {
	canEditEvent,
	canRemoveEvent,
	eventHomeCalendarId,
	getEditableCalendars,
	getEventHomeCalendar,
	getEventMutationError,
} from "../event-permissions";
import type { Notify } from "../notice";
import {
	eventReminder,
	type EventReminder,
	type ReminderControl,
} from "../reminder-control";
import {
	allDayValue,
	optionsFor,
	timedValue,
	withAllDay,
	withTimed,
} from "@musubi/types";
import { CalendarDot } from "./CalendarDot";
import { EventEditorForm } from "./EventEditorForm";
import { ShareEventDialog } from "./ShareEventDialog";

import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import styles from "./styles/event-details.module.css";

type TargetMutation = {
	calendarId: string;
	eventId: string;
};

export type EventActionHandlers = {
	getEventMaster: (event: Event) => Event;
	onForkEvent: (input: TargetMutation) => Promise<Event>;
	onLinkEvent: (input: TargetMutation) => Promise<Event>;
	onNotice: Notify;
	onOpenFullEditor?: (values: EventFormValues, event: Event) => void;
	onRemoveEvent: (event: Event) => Promise<RemoveEventResponse>;
	/** Creates detached occurrences and split series for scoped recurrence edits. */
	onRestoreEvent?: (event: Event) => Promise<unknown>;
	onSetAttendance: (input: {
		calendarId?: string;
		eventId: string;
		status: AttendanceChoice;
	}) => Promise<Attendee[]>;
	onUpdateEvent: (event: Event) => Promise<Event>;
	/** Absent where reminders are not loaded yet — the control simply hides. */
	reminders?: ReminderControl;
	user: { id: string; name: string };
};

/** Sentinel for the menu item that removes an override rather than setting one. */
const INHERIT = "inherit";

function reminderLabel(reminder: EventReminder, kind: "allDay" | "timed") {
	const value =
		kind === "timed" ? timedValue(reminder.rule) : allDayValue(reminder.rule);
	const option = optionsFor(reminder.rule, kind).find(
		(entry) => entry.value === value,
	);
	return option?.label ?? "Off";
}

/** Faces before the pile turns into "+N", the same count the phone shows. */
const FACEPILE_LIMIT = 7;

type DeleteScope = "occurrence" | "following" | "series";
type DeletePrompt = "confirm" | "scope";
type TargetAction = "fork" | "link";

type EventDetailsPopoverProps = EventActionHandlers & {
	/**
	 * Where the preview opens. The default sits it beside a calendar block; a
	 * full-width row has no room to its right, so a list passes its own side and
	 * alignment rather than letting collision detection flip the card leftwards.
	 */
	align?: "center" | "end" | "start";
	anchorInsideTrigger?: boolean;
	collisionBoundary?: Element | null;
	side?: "bottom" | "left" | "right" | "top";
	calendar: Calendar | undefined;
	calendars: Calendar[];
	children: ReactElement;
	event: Event;
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
};

export function EventDetailsPopover({
	align = "start",
	anchorInsideTrigger = false,
	collisionBoundary,
	side = "right",
	calendar,
	calendars,
	children,
	event,
	getEventMaster,
	onForkEvent,
	onLinkEvent,
	onNotice,
	onOpenFullEditor,
	onRemoveEvent,
	onRestoreEvent,
	onSetAttendance,
	onUpdateEvent,
	reminders,
	timeFormat,
	user,
	weekStartsOn,
}: EventDetailsPopoverProps) {
	const master = getEventMaster(event);
	const titleId = useId();
	const notesTitleId = useId();
	const guestsTitleId = useId();
	const targetActionTitleId = useId();
	const reminderTitleId = useId();
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [deletePrompt, setDeletePrompt] = useState<DeletePrompt>();
	// The edit waiting for its scope answer, kept whole so nothing typed is lost
	// if the question is dismissed.
	const [pendingEdit, setPendingEdit] = useState<Event>();
	const [pendingEditScope, setPendingEditScope] = useState<EditScope>();
	const [pendingDeleteScope, setPendingDeleteScope] = useState<DeleteScope>();
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);
	const [anchorPoint, setAnchorPoint] = useState<{ x: number; y: number }>();
	const [busyAction, setBusyAction] = useState<string>();
	const [targetAction, setTargetAction] = useState<TargetAction>();
	const [pendingTargetId, setPendingTargetId] = useState<string>();
	const linkActionRef = useRef<HTMLButtonElement>(null);
	const shareActionRef = useRef<HTMLButtonElement>(null);
	const [editSubmitElement, setEditSubmitElement] =
		useState<HTMLButtonElement | null>(null);
	const forkActionRef = useRef<HTMLButtonElement>(null);
	const targetListRef = useRef<HTMLDivElement>(null);
	const [actionError, setActionError] = useState<{
		message: string;
		requestId?: string;
	}>();
	const homeCalendar = getEventHomeCalendar(master, calendars) ?? calendar;
	const homeCalendarId = eventHomeCalendarId(master);
	// A primitive, so the attendees effect can depend on it without re-running on
	// every re-render of the calendar list.
	const homeConnectionId = connectionOfCalendar(homeCalendar);
	const removeCalendar =
		getEditableCalendars(calendars).find((item) =>
			master.calendars.includes(item.id),
		) ?? homeCalendar;
	const editable = canEditEvent(master, calendars);
	const removable = canRemoveEvent(master, calendars);
	const targetCalendars = getEditableCalendars(calendars).filter(
		(item) => !master.calendars.includes(item.id),
	);
	const canAddToCalendar = targetCalendars.length > 0;
	const [attendees, setAttendees] = useState<Attendee[]>();
	const [attendeesOpen, setAttendeesOpen] = useState(false);
	const mine = attendees?.find((attendee) => attendee.id === user.id)?.status;
	// The count and the facepile are about who is coming; a "can't go" belongs in
	// the list, not in the row of faces.
	const going =
		attendees?.filter((attendee) => attendee.status === "going") ?? [];
	const eventCalendars = event.calendars
		.map((calendarId) => calendars.find((item) => item.id === calendarId))
		.filter((item): item is Calendar => Boolean(item));
	// The home calendar owns the colour, so the accent matches the block on the
	// grid instead of whichever membership happens to sort first.
	const accentColor = homeCalendar?.color ?? calendar?.color ?? event.color;
	const deleteConsequence = removeCalendar?.provider
		? `This change will also be sent to ${providerDisplayName(removeCalendar)}.`
		: master.recurrence
			? "You can undo changes to individual occurrences after choosing."
			: "This cannot be undone.";

	useEffect(() => {
		if (!open || !master.hasAttendees) return;
		const controller = new AbortController();
		let active = true;
		getEventAttendees(master.id, controller.signal, homeConnectionId)
			.then((nextAttendees) => {
				if (active) setAttendees(nextAttendees);
			})
			.catch(() => {
				if (active) setAttendees(undefined);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [homeConnectionId, master.hasAttendees, master.id, open]);

	useEffect(() => {
		if (!targetAction) return;
		requestAnimationFrame(() => {
			targetListRef.current
				?.querySelector<HTMLButtonElement>("button:not(:disabled)")
				?.focus();
		});
	}, [targetAction]);

	function handleOpenChange(nextOpen: boolean, force = false) {
		// Firefox and WebKit treat the nested recurrence dialog as an outside
		// interaction. Keep the editor mounted until that dialog resolves.
		if (!nextOpen && pendingEdit && !force) return;
		setOpen(nextOpen);

		if (!nextOpen) {
			setEditing(false);
			setActionError(undefined);
			setTargetAction(undefined);
			setPendingTargetId(undefined);
		}
	}

	async function handleUpdate(values: EventFormValues) {
		// A series has to be asked which occurrences an edit belongs to — the same
		// question dragging and deleting one already ask. Answering it before the
		// write is why the form's own submit hands over rather than saving here.
		if (master.recurrence && onRestoreEvent) {
			setPendingEdit(updateEventFromForm(event, values));
			return;
		}

		await onUpdateEvent(updateEventFromForm(master, values));
		onNotice("Event updated.");
		handleOpenChange(false);
	}

	/**
	 * Apply an edit at the chosen scope. `onRestoreEvent` creates the detached
	 * occurrence or the split-off series, which is the only new event any scope
	 * produces.
	 */
	async function applyScopedEdit(edited: Event, scope: EditScope) {
		setBusyAction("update");
		setPendingEditScope(scope);
		setActionError(undefined);

		const { creates, updates } = seriesEditWrites({
			edited,
			master,
			occurrence: event,
			scope,
		});

		try {
			// Sequential: the update carries the exclusion that keeps the created
			// event from briefly showing twice.
			for (const update of updates) {
				await onUpdateEvent(update);
			}
			const created: Event[] = [];
			for (const create of creates) {
				created.push((await onRestoreEvent!(create)) as Event);
			}

			onNotice(
				scope === "series"
					? "Recurring series updated."
					: scope === "following"
						? "This and following events updated."
						: "Occurrence updated.",
				{
					undo: async () => {
						for (const event of created) {
							await onRemoveEvent(event);
						}
						await onUpdateEvent(master);
					},
				},
			);
			setPendingEdit(undefined);
			handleOpenChange(false, true);
		} catch (error) {
			setActionError(getEventMutationError(error, "update", homeCalendar));
		} finally {
			setBusyAction(undefined);
			setPendingEditScope(undefined);
		}
	}

	async function handleDelete(scope: DeleteScope = "series") {
		setBusyAction("delete");
		setPendingDeleteScope(scope);
		setActionError(undefined);

		try {
			if (
				master.recurrence &&
				scope !== "series" &&
				!(scope === "following" && event.start.getTime() <= master.start.getTime())
			) {
				const recurrence =
					scope === "occurrence"
						? excludeOccurrence(master.recurrence, event.start)
						: endSeriesBefore(master.recurrence, event.start);
				await onUpdateEvent({ ...master, recurrence });
				onNotice(
					scope === "occurrence"
						? "Occurrence removed."
						: "Following occurrences removed.",
					// Only the rule changed, so putting the old one back restores the
					// occurrences exactly.
					{ undo: () => onUpdateEvent(master) },
				);
			} else {
				const result = await onRemoveEvent(master);
				onNotice(result.removed ? "Event deleted." : "Event removed.");
			}
			setDeletePrompt(undefined);
			handleOpenChange(false);
		} catch (error) {
			setActionError(
				getEventMutationError(
					error,
					master.recurrence && scope !== "series" ? "update" : "delete",
					removeCalendar,
				),
			);
		} finally {
			setBusyAction(undefined);
			setPendingDeleteScope(undefined);
		}
	}

	function beginDelete() {
		if (master.recurrence) {
			setDeletePrompt("scope");
		} else {
			setDeletePrompt("confirm");
		}
	}

	async function handleTargetAction(action: TargetAction, calendarId: string) {
		setBusyAction(action);
		setPendingTargetId(calendarId);
		setActionError(undefined);

		try {
			if (action === "link") {
				await onLinkEvent({
					calendarId,
					eventId: master.id,
				});
				onNotice("Event linked to calendar.");
			} else {
				await onForkEvent({
					calendarId,
					eventId: master.id,
				});
				onNotice("Independent event copy created.");
			}
			setTargetAction(undefined);
			handleOpenChange(false);
		} catch (error) {
			setActionError(
				getEventMutationError(
					error,
					"update",
					calendars.find((item) => item.id === calendarId),
				),
			);
		} finally {
			setBusyAction(undefined);
			setPendingTargetId(undefined);
		}
	}

	function showTargetCalendars(action: TargetAction) {
		setActionError(undefined);
		setTargetAction(action);
	}

	function hideTargetCalendars() {
		const previousAction = targetAction;
		setActionError(undefined);
		setTargetAction(undefined);
		requestAnimationFrame(() => {
			(previousAction === "link"
				? linkActionRef.current
				: forkActionRef.current
			)?.focus();
		});
	}

	const reminder = reminders ? eventReminder(reminders, master) : undefined;
	const reminderKind = master.isAllDay ? "allDay" : "timed";

	async function handleReminder(value: string) {
		if (!reminders || !reminder) return;
		setBusyAction("reminder");
		setActionError(undefined);

		try {
			if (value === INHERIT) {
				await reminders.onChange(master.id, null);
				onNotice("Reminder follows the calendar again.");
				return;
			}

			const next =
				reminderKind === "timed"
					? withTimed(reminder.rule, value)
					: withAllDay(reminder.rule, value);
			// Only store an override where it actually differs. Writing one for
			// every glance would make each event an exception, and a later change
			// to the calendar rule would then reach none of them.
			const base = eventReminder(
				{ ...reminders, document: { ...reminders.document, events: {} } },
				master,
			).rule;
			await reminders.onChange(master.id, sameRule(next, base) ? null : next);
			onNotice("Reminder saved.");
		} catch (error) {
			setActionError(getEventMutationError(error, "update", homeCalendar));
		} finally {
			setBusyAction(undefined);
		}
	}

	async function handleAnswer(next: AttendanceChoice) {
		setBusyAction("attendance");
		setActionError(undefined);

		try {
			setAttendees(
				await onSetAttendance({
					calendarId: homeCalendar?.id,
					eventId: master.id,
					status: next,
				}),
			);
			onNotice(next === "none" ? "Answer cleared." : "Answer saved.");
		} catch (error) {
			setActionError(getEventMutationError(error, "update", homeCalendar));
		} finally {
			setBusyAction(undefined);
		}
	}

	const surfaceStyle = {
		"--event-accent": accentColor,
	} as CSSProperties;

	return (
		<>
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger
					asChild
					onClick={(clickEvent) => {
						setTriggerElement(clickEvent.currentTarget);
						if (anchorInsideTrigger) {
							const bounds = clickEvent.currentTarget.getBoundingClientRect();
							setAnchorPoint({ x: bounds.left, y: bounds.top });
						}
					}}
				>
					{children}
				</PopoverTrigger>
				{anchorInsideTrigger && anchorPoint ? (
					<PopoverAnchor asChild>
						<span
							aria-hidden="true"
							style={{
								position: "fixed",
								left: anchorPoint.x,
								top: anchorPoint.y,
							}}
						/>
					</PopoverAnchor>
				) : null}
				<PopoverContent
					aria-labelledby={titleId}
					className={styles.detailPopover}
					collisionBoundary={collisionBoundary}
					collisionPadding={14}
					align={align}
					/* This surface scrolls its own overflow, which makes it a scroll
               container: an arrow poking out of its edge is clipped by the very
               overflow rule that lets long details scroll, and still counts
               toward scrollWidth — a phantom horizontal scrollbar for a
               decoration nobody can see. */
					showArrow={false}
					onClick={(clickEvent) => clickEvent.stopPropagation()}
					/* React portals bubble events to the React parent, not the DOM
               one: without this a press on the title reaches the day cell this
               popover is rendered from and starts its drag-to-create gesture, so
               selecting text opened a draft instead. Click was already stopped
               for the same reason. */
					onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
					/* Selecting the title or notes moves focus off the text and out of
               the layer, which Radix reads as an interaction outside — so the
               preview closed the moment you tried to copy anything out of it.
               A modal opening over it still takes it away. */
					onFocusOutside={(focusEvent) => {
						if (!focusMovedToAnotherLayer(focusEvent.target)) {
							focusEvent.preventDefault();
						}
					}}
					onEscapeKeyDown={(escapeEvent) => {
						if (!targetAction) return;
						escapeEvent.preventDefault();
						hideTargetCalendars();
					}}
					/* Keep the detail surface beside its event. Collision handling may
               flip right to left, but it no longer compresses the card into
               the small strip above or below a late-month event. */
					side={side}
					sideOffset={12}
					style={surfaceStyle}
				>
					{editing ? (
						<>
							<header className={styles.editorHeader}>
								<h2 id={titleId}>{master.recurrence ? "Edit series" : "Edit event"}</h2>
								<IconButton
									label="Close event editor"
									size="compact"
									onClick={() => setEditing(false)}
								>
									<X size={17} strokeWidth={1.6} />
								</IconButton>
							</header>
							<EventEditorForm
								calendarLocked
								calendars={calendars}
								compact
								initialValues={eventFormValues(master)}
								onCancel={() => setEditing(false)}
								onExpand={
									onOpenFullEditor
										? (values) => {
												handleOpenChange(false);
												onOpenFullEditor(values, master);
											}
										: undefined
								}
								onError={(error) =>
									getEventMutationError(error, "update", homeCalendar)
								}
								onSubmit={handleUpdate}
								submitLabel="Save"
								submitRef={setEditSubmitElement}
								timeFormat={timeFormat}
								weekStartsOn={weekStartsOn}
							/>
						</>
					) : (
						<>
							<header className={styles.detailsHeader}>
								<div className={styles.titleBlock}>
									<h2 id={titleId}>{event.title}</h2>
									{event.recurrence ? (
										<span className={styles.recurrenceMark}>
											<Repeat2 aria-hidden="true" size={13} />
											Recurring
										</span>
									) : null}
								</div>
								{/* In the header, not the action row: that row already holds
                      four buttons in equal columns, and a fifth would squeeze
                      every label. Publishing is also a different kind of act
                      from editing — it hands the event to people who have no
                      account here. */}
								{editable ? (
									<IconButton
										label="Share event"
										ref={shareActionRef}
										size="compact"
										title="Publish as a page"
										onClick={() => setSharing(true)}
									>
										<Share2 size={16} strokeWidth={1.6} />
									</IconButton>
								) : null}
								<PopoverClose asChild>
									<IconButton label="Close event details" size="compact">
										<X size={17} strokeWidth={1.6} />
									</IconButton>
								</PopoverClose>
							</header>

							<div className={styles.detailsBody}>
								<dl className={styles.whenList}>
									<DetailRow
										icon={<CalendarDays size={18} strokeWidth={1.5} />}
										label="Date"
										value={getEventDateLabel(event)}
									/>
									<DetailRow
										icon={<Clock3 size={18} strokeWidth={1.5} />}
										label="Time"
										value={
											<span className={styles.timeValue}>
												<span>{getEventRangeLabel(event, timeFormat)}</span>
												{!event.isAllDay ? (
													<>
														<span aria-hidden="true">·</span>
														<span>{getDurationLabel(event)}</span>
													</>
												) : null}
											</span>
										}
									/>
								</dl>

								<ul aria-label="Calendars" className={styles.calendarPills}>
									{eventCalendars.length > 0 ? (
										eventCalendars.map((item) => (
											<li className={styles.calendarPill} key={item.id}>
												{/* The home calendar's mark replaces its dot rather
                              than sitting next to it: both say "this calendar",
                              and the star says which one owns the event — the
                              colour, the invitations and where an edit lands. */}
												{item.id === homeCalendarId ? (
													<Star
														aria-label="Home calendar"
														className={styles.homePillMark}
														fill={item.color}
														size={12}
														strokeWidth={1.6}
														style={{ color: item.color }}
													/>
												) : (
													<CalendarDot color={item.color} />
												)}
												{item.name}
											</li>
										))
									) : (
										<li className={styles.calendarPill}>
											<CalendarDot color={accentColor} />
											Calendar
										</li>
									)}
								</ul>

								{event.location || event.url ? (
									<dl className={styles.infoList}>
										{event.location ? (
											<DetailRow
												icon={<MapPin size={18} strokeWidth={1.5} />}
												label="Location"
												value={event.location}
											/>
										) : null}
										{event.url ? (
											<DetailRow
												icon={<Link2 size={18} strokeWidth={1.5} />}
												label="Link"
												value={<ExternalEventLink url={event.url} />}
											/>
										) : null}
									</dl>
								) : null}

								{event.description ? (
									<section aria-labelledby={notesTitleId} className={styles.notes}>
										<div className={styles.sectionHeading}>
											<FileText aria-hidden="true" size={17} />
											<SectionLabel id={notesTitleId} level={3}>
												Notes
											</SectionLabel>
										</div>
										<p>
											{noteParts(event.description).map((part, index) =>
												part.href ? (
													<a
														aria-label={`Open ${part.href}`}
														href={part.href}
														key={`${part.href}-${index}`}
														rel="noreferrer"
														target="_blank"
														title={part.href}
													>
														{part.text}
													</a>
												) : (
													part.text
												),
											)}
										</p>
									</section>
								) : null}

								{reminder ? (
									<section aria-labelledby={reminderTitleId} className={styles.notes}>
										<div className={styles.sectionHeading}>
											<BellRing aria-hidden="true" size={17} />
											<SectionLabel id={reminderTitleId} level={3}>
												Remind me
											</SectionLabel>
											<Menu>
												<MenuTrigger asChild>
													<Button
														className={styles.answerTrigger}
														loading={busyAction === "reminder"}
														size="compact"
														variant={reminder.inherited ? "secondary" : "primary"}
													>
														{reminderLabel(reminder, reminderKind)}
														<ChevronDown aria-hidden="true" size={14} />
													</Button>
												</MenuTrigger>
												<MenuContent align="end" label="Reminder">
													{optionsFor(reminder.rule, reminderKind).map((option) => {
														const current =
															reminderKind === "timed"
																? timedValue(reminder.rule)
																: allDayValue(reminder.rule);
														return (
															<MenuItem
																icon={
																	!reminder.inherited && current === option.value ? (
																		<Check aria-hidden="true" size={15} />
																	) : undefined
																}
																key={option.value}
																onSelect={() => void handleReminder(option.value)}
															>
																{option.label}
															</MenuItem>
														);
													})}
													{reminder.inherited ? null : (
														<MenuItem onSelect={() => void handleReminder(INHERIT)}>
															Use the calendar's setting
														</MenuItem>
													)}
												</MenuContent>
											</Menu>
										</div>
									</section>
								) : null}

								{master.hasAttendees ? (
									<section
										aria-busy={!attendees}
										aria-labelledby={guestsTitleId}
										className={styles.attendeeSection}
									>
										{/* Same anatomy as the phone: the count doubles as the
                          expand toggle, the answer sits on the right. */}
										<div className={styles.attendeeHeader}>
											{/* The button lives inside the heading, not the other
                            way round: a heading is not phrasing content, so a
                            button wrapping it is invalid markup. */}
											<SectionLabel
												className={styles.attendeeHeading}
												id={guestsTitleId}
												level={3}
											>
												<Button
													aria-expanded={attendeesOpen}
													className={styles.attendeeToggle}
													disabled={!attendees}
													icon={
														<UsersRound aria-hidden="true" size={15} strokeWidth={1.6} />
													}
													size="compact"
													variant="secondary"
													onClick={() => setAttendeesOpen((open) => !open)}
												>
													{attendees ? `Attendees · ${going.length}` : "Attendees"}
													{attendeesOpen ? (
														<ChevronUp aria-hidden="true" size={14} />
													) : (
														<ChevronDown aria-hidden="true" size={14} />
													)}
												</Button>
											</SectionLabel>
											{/* A menu, not three buttons: three labels beside the
                          heading overflowed the popover, and what fell off the
                          edge was the answer. Radix owns the menu's focus and
                          dismissal, and it layers above the popover it opens
                          from — both surfaces sit at the same z-index, and this
                          one mounts second. */}
											{attendees ? (
												<Menu>
													<MenuTrigger asChild>
														<Button
															className={styles.answerTrigger}
															loading={busyAction === "attendance"}
															size="compact"
															variant={mine ? "primary" : "secondary"}
														>
															{answerLabel(mine) ?? "Answer"}
															<ChevronDown aria-hidden="true" size={14} />
														</Button>
													</MenuTrigger>
													<MenuContent align="end" label="Your answer">
														{ATTENDANCE_CHOICES.map((choice) => (
															<MenuItem
																icon={
																	mine === choice.value ? (
																		<Check aria-hidden="true" size={15} />
																	) : undefined
																}
																key={choice.value}
																onSelect={() => void handleAnswer(choice.value)}
															>
																{choice.label}
															</MenuItem>
														))}
														{mine ? (
															<>
																<MenuSeparator />
																<MenuItem onSelect={() => void handleAnswer("none")}>
																	Clear answer
																</MenuItem>
															</>
														) : null}
													</MenuContent>
												</Menu>
											) : null}
										</div>

										{/* The facepile falls apart into the list — one or the
                          other, never both. */}
										{!attendees ? (
											<p>Loading guests…</p>
										) : attendees.length === 0 ? (
											<p>Be the first to answer.</p>
										) : attendeesOpen ? (
											<ul className={styles.attendeeGroups}>
												{groupAttendees(attendees).map((group) => (
													<li key={group.status}>
														<p className={styles.attendeeGroupTitle}>{group.title}</p>
														<ul className={styles.attendeeList}>
															{group.items.map((item) => (
																<li key={item.id}>
																	<Avatar image={item.image} name={item.name} size="default" />
																	<span>{item.name}</span>
																</li>
															))}
														</ul>
													</li>
												))}
											</ul>
										) : (
											<AvatarStack
												label="Show every answer"
												limit={FACEPILE_LIMIT}
												people={going}
												onClick={() => setAttendeesOpen(true)}
											/>
										)}
									</section>
								) : null}

								{targetAction && targetCalendars.length > 0 ? (
									<section
										aria-labelledby={targetActionTitleId}
										className={styles.calendarActions}
									>
										<>
											<div className={styles.targetActionHeader}>
												<IconButton
													disabled={Boolean(busyAction)}
													label="Back to add options"
													size="compact"
													onClick={hideTargetCalendars}
												>
													<ArrowLeft size={16} strokeWidth={1.6} />
												</IconButton>
												<div>
													<h3 id={targetActionTitleId}>
														{targetAction === "link"
															? "Link to a calendar"
															: "Make an independent copy"}
													</h3>
													<p>
														{targetAction === "link"
															? "It stays one event, so future changes appear in every linked calendar."
															: "The copy can be changed later without affecting this event."}
													</p>
												</div>
											</div>
											<div className={styles.targetCalendarList} ref={targetListRef}>
												{targetCalendars.map((item) => {
													const pending =
														pendingTargetId === item.id && busyAction === targetAction;

													return (
														<RowAction
															aria-label={
																targetAction === "link"
																	? `Link to ${item.name}`
																	: `Make copy in ${item.name}`
															}
															aria-busy={pending || undefined}
															className={styles.targetCalendar}
															detail={targetCalendarDetail(item)}
															disabled={Boolean(busyAction)}
															icon={<CalendarDot color={item.color} />}
															key={item.id}
															label={item.name}
															showChevron={false}
															value={
																pending
																	? targetAction === "link"
																		? "Linking…"
																		: "Copying…"
																	: undefined
															}
															onClick={() => void handleTargetAction(targetAction, item.id)}
														/>
													);
												})}
											</div>
											{actionError ? (
												<InlineError
													className={styles.actionError}
													requestId={actionError.requestId}
												>
													{actionError.message}
												</InlineError>
											) : null}
										</>
									</section>
								) : null}

								{actionError && !targetAction ? (
									<InlineError
										className={styles.actionError}
										requestId={actionError.requestId}
									>
										{actionError.message}
									</InlineError>
								) : null}
							</div>

							{!targetAction && (editable || removable || canAddToCalendar) ? (
								<footer aria-label="Event actions" className={styles.detailActions}>
									{editable ? (
										<Button
											icon={<Pencil size={16} strokeWidth={1.6} />}
											size="compact"
											variant="secondary"
											onClick={() => setEditing(true)}
										>
											{/* Just "Edit": the header already badges this as a
                            series, four labels have to fit one row, and the
                            scope dialog asks which occurrences anyway. */}
											Edit
										</Button>
									) : null}
									{/* Adding this event to another calendar is a second step —
                        which calendar — so these open the picker rather than
                        writing. Compact buttons, because the preview's job is to
                        show the event, not to explain both options up front. */}
									{canAddToCalendar ? (
										<>
											<Button
												icon={<Link2 size={15} strokeWidth={1.6} />}
												ref={linkActionRef}
												size="compact"
												title="Keep one event shared across calendars"
												variant="secondary"
												onClick={() => showTargetCalendars("link")}
											>
												Link
											</Button>
											<Button
												icon={<CopyPlus size={15} strokeWidth={1.6} />}
												ref={forkActionRef}
												size="compact"
												title="Create a copy you can change separately"
												variant="secondary"
												onClick={() => showTargetCalendars("fork")}
											>
												{/* "Copy", not "Fork": the picker this opens already
                              says "Make an independent copy", and forking is
                              something people do to repositories. */}
												Copy
											</Button>
										</>
									) : null}
									{removable ? (
										<Button
											className={styles.deleteAction}
											icon={<Trash2 size={16} strokeWidth={1.6} />}
											loading={busyAction === "delete"}
											size="compact"
											// Same shape as its three neighbours; the colour is what
											// marks it destructive, not a different silhouette.
											variant="secondary"
											onClick={beginDelete}
										>
											Delete
										</Button>
									) : null}
								</footer>
							) : !targetAction ? (
								<p className={styles.viewOnly}>
									You have view-only access to this event.
								</p>
							) : null}
						</>
					)}
				</PopoverContent>
			</Popover>

			{sharing ? (
				<ShareEventDialog
					/* The master, like every other write here: an occurrence is addressed
             as "<uuid>_<timestamp>" and only the master exists as a row. */
					event={master}
					onNotice={onNotice}
					onSaveEvent={onUpdateEvent}
					onOpenChange={(open) => {
						if (!open) setSharing(false);
					}}
					returnFocus={shareActionRef}
					timeFormat={timeFormat}
				/>
			) : null}

			{pendingEdit ? (
				<RecurrenceScopeDialog
					busyScope={pendingEditScope}
					error={actionError}
					onResolve={(scope) => {
						if (scope) {
							void applyScopedEdit(pendingEdit, scope);
						} else {
							setPendingEdit(undefined);
						}
					}}
					returnFocus={editSubmitElement}
					/* Only when the edit actually moved it: otherwise the dialog would
             announce a time change that never happened. */
					timeLabel={
						pendingEdit.start.getTime() === event.start.getTime() &&
						pendingEdit.end.getTime() === event.end.getTime()
							? undefined
							: getEventRangeLabel(pendingEdit, timeFormat)
					}
					title={pendingEdit.title}
				/>
			) : null}

			{deletePrompt === "scope" ? (
				<RecurrenceScopeDialog
					action="delete"
					busyScope={pendingDeleteScope}
					consequence={deleteConsequence}
					error={actionError}
					onResolve={(scope) => {
						if (scope) {
							void handleDelete(scope);
						} else {
							setDeletePrompt(undefined);
						}
					}}
					returnFocus={triggerElement}
					title={event.title}
				/>
			) : null}

			<ConfirmationDialog
				closeLabel="Close delete event dialog"
				confirmLabel="Delete"
				description={`“${event.title}” will be removed from your calendar.`}
				loading={busyAction === "delete"}
				onConfirm={() => void handleDelete()}
				onOpenChange={(nextOpen) => nextOpen || setDeletePrompt(undefined)}
				open={deletePrompt === "confirm"}
				returnFocus={triggerElement}
				title="Delete event?"
			>
				<ConfirmationNotice icon={<AlertTriangle size={19} strokeWidth={1.5} />}>
					<p>{deleteConsequence}</p>
				</ConfirmationNotice>
				{actionError ? (
					<InlineError requestId={actionError.requestId}>
						{actionError.message}
					</InlineError>
				) : null}
			</ConfirmationDialog>
		</>
	);
}

function ExternalEventLink({ url }: { url: string }) {
	return (
		<a
			aria-label={`Open event link, ${shortUrlLabel(url)}`}
			href={url}
			rel="noreferrer"
			target="_blank"
		>
			{shortUrlLabel(url)}
		</a>
	);
}

function DetailRow({
	icon,
	label,
	value,
}: {
	icon: ReactElement;
	label: string;
	value: ReactNode;
}) {
	return (
		<div className={styles.detailRow}>
			<span aria-hidden="true" className={styles.detailIcon}>
				{icon}
			</span>
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

function getDurationLabel(event: Event): string {
	const totalMinutes = Math.max(
		1,
		Math.round((event.end.getTime() - event.start.getTime()) / 60_000),
	);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	if (!hours) return `${minutes} min`;
	if (!minutes) return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
	return `${hours} ${hours === 1 ? "hr" : "hrs"} ${minutes} min`;
}

function targetCalendarDetail(calendar: Calendar) {
	if (calendar.provider) return providerDisplayName(calendar);
	if (calendar.isDefault) return "Personal calendar";
	return calendar.role === "owner" ? "Your calendar" : "Shared calendar";
}
