import { isGoogleEditorPrivacyRefresh, refreshPrivateEditorBaseline, refreshPrivateEditorValues, rememberPrivateEditorChanges, type PrivateEditorField } from "../event-editor-privacy";
import { focusMovedToAnotherLayer } from "../layer-focus";
import { Empty } from "~/ui/Empty";
import { ProviderRsvpEditor } from "./ProviderRsvpEditor";
import { ProviderReminderEditor } from "./ProviderReminderEditor";
import { getServerOrigin } from "~/api/query-keys";
import type { ProviderEventStateResponse } from "@musubi/types";
import { ProviderEventDetails } from "./ProviderEventDetails";
import { hasKnownEventTime, type EventScopeRequest } from "@musubi/types";
import { eventScopeRequest } from "@musubi/calendar";
import {
	requireEventRevision,
	editedEvent,
	EventMutationError,
} from "@musubi/types";
import {
	endSeriesBefore,
	excludeOccurrence,
	noteParts,
	seriesEditWrites,
	withSeriesEditIntent,
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
import { EventDeliveryDialog } from "./EventDeliveryDialog";
import { getEventAttendees } from "~/api/resources";
import { Avatar } from "~/ui/Avatar";
import { Disclosure } from "~/ui/Disclosure";
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
import { Inspector as Popover, InspectorTrigger as PopoverTrigger, InspectorClose as PopoverClose, InspectorContent as PopoverContent } from "~/ui/Inspector";

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
	inheritedEventReminder,
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
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import styles from "./styles/event-details.module.css";

type TargetMutation = {
	expectedRevision?: number;
	calendarId: string;
	eventId: string;
};

export type EventActionHandlers = {
	onApplyEventScope?: (event: Event, request: EventScopeRequest) => Promise<unknown>;
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
	onApplyEventScope,
	reminders,
	timeFormat,
	user,
	weekStartsOn,
}: EventDetailsPopoverProps) {
	const liveMaster = getEventMaster(event);
	const [draft, setDraft] = useState<{ event: Event; master: Event; values?: EventFormValues; ownedFields?: PrivateEditorField[]; privacyRevision?: number }>();
  const privacyChanged = draft && draft.privacyRevision !== liveMaster.revision && isGoogleEditorPrivacyRefresh(draft.master, liveMaster, calendars);
  if (privacyChanged) {
    setDraft({
      event: refreshPrivateEditorBaseline(draft.event, event),
      master: refreshPrivateEditorBaseline(draft.master, liveMaster),
      values: refreshPrivateEditorValues(draft.values ?? eventFormValues(draft.event), draft.event, event, draft.ownedFields),
      ownedFields: draft.ownedFields,
      privacyRevision: liveMaster.revision,
    });
  }
	const master = draft?.master ?? liveMaster;
	const occurrence = draft?.event ?? event;
	const titleId = useId();
	const notesTitleId = useId();
	const guestsTitleId = useId();
	const targetActionTitleId = useId();
	const reminderTitleId = useId();
	const [open, setOpen] = useState(false);
	const [deliveryTarget, setDeliveryTarget] = useState<{ context: string; eventId: string }>();
  const [providerRsvpEditor, setProviderRsvpEditor] = useState<{ context: string; eventId: string; occurrence: boolean; observation: ProviderEventStateResponse }>();
  const [providerReminderEditor, setProviderReminderEditor] = useState<{ context: string; eventId: string; occurrence: boolean; observation: ProviderEventStateResponse }>();
	const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteButtonElement, setDeleteButtonElement] = useState<HTMLButtonElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => { if (wasEditing.current && !editing && open) editButtonRef.current?.focus(); wasEditing.current = editing; }, [editing, open]);
  const [discardAction, setDiscardAction] = useState<(() => void)>();
  const draftDirty = editing && draft?.values && JSON.stringify(draft.values) !== JSON.stringify(eventFormValues(master.recurrence && onRestoreEvent ? occurrence : master));
  function requestExit(after: () => void, closePanel = true) {
    if (pendingEdit || saving || busyAction) return;
    const finish = () => { if (closePanel) handleOpenChange(false, true); else { setEditing(false); setDraft(undefined); } after(); };
    if (draftDirty) setDiscardAction(() => finish); else finish();
  }
	const [deletePrompt, setDeletePrompt] = useState<DeletePrompt>();
	// The edit waiting for its scope answer, kept whole so nothing typed is lost
	// if the question is dismissed.
	const [pendingEdit, setPendingEdit] = useState<Event>();
	const [pendingEditScope, setPendingEditScope] = useState<EditScope>();
	const [pendingDeleteScope, setPendingDeleteScope] = useState<DeleteScope>();
  if (privacyChanged) {
    if (pendingEdit) setPendingEdit(undefined);
    if (pendingEditScope) setPendingEditScope(undefined);
    if (pendingDeleteScope) setPendingDeleteScope(undefined);
    if (deletePrompt) setDeletePrompt(undefined);
  }
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);
	const [busyAction, setBusyAction] = useState<string>();
	const [targetAction, setTargetAction] = useState<TargetAction>();
	const [pendingTargetId, setPendingTargetId] = useState<string>();
	const linkActionRef = useRef<HTMLButtonElement>(null);
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
  const providerReminderContext = JSON.stringify([getServerOrigin(), user.id, homeConnectionId, event.id, event.seriesID, event.originalStart, event.revision, liveMaster.revision]);
  if (deliveryTarget && deliveryTarget.context !== providerReminderContext) setDeliveryTarget(undefined);
  if (providerReminderEditor && providerReminderEditor.context !== providerReminderContext) setProviderReminderEditor(undefined);
  if (providerRsvpEditor && providerRsvpEditor.context !== providerReminderContext) setProviderRsvpEditor(undefined);
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
		: master.recurrence && !hasKnownEventTime(master)
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
			setDraft(undefined);
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
			setPendingEdit(updateEventFromForm(occurrence, values));
			return;
		}

    setSaving(true);
    try {
		await onUpdateEvent(updateEventFromForm(master, values));
		onNotice("Event updated.");
    setEditing(false);
    setDraft(undefined);
    } finally { setSaving(false); }
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

		let savedMaster: Event | undefined;
		try {
			if (hasKnownEventTime(master)) {
                if (!onApplyEventScope) throw new Error("Scope editing is unavailable. Refresh before saving.");
                await onApplyEventScope(master, eventScopeRequest(master, occurrence, scope, edited));
                onNotice("Recurring event updated.");
                setPendingEdit(undefined);
                handleOpenChange(false, true);
                return;
            }
			const { creates, updates } = withSeriesEditIntent(
				seriesEditWrites({
					edited,
					master,
					occurrence,
					scope,
				}),
			);

			// Sequential: the update carries the exclusion that keeps the created
			// event from briefly showing twice.
			for (const update of updates) {
				savedMaster = await onUpdateEvent(update);
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
				"timeEdit" in edited ? undefined : {
					undo: async () => {
						for (const event of created) {
							await onRemoveEvent(event);
						}
						await onUpdateEvent(
							withSeriesEditIntent({
								updates: [editedEvent(savedMaster!, master)],
								creates: [],
							}).updates[0],
						);
					},
				},
			);
			setPendingEdit(undefined);
			handleOpenChange(false, true);
		} catch (error) {
			setActionError(
				getEventMutationError(
					savedMaster
						? new EventMutationError(
								"Part of this recurring edit was saved. Later delivery was not confirmed. Your draft was kept; refresh and reconcile before retrying.",
								true,
							)
						: error,
					"update",
					homeCalendar,
				),
			);
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
            if (master.recurrence && hasKnownEventTime(master)) {
                if (!onApplyEventScope) throw new Error("Scope editing is unavailable. Refresh before saving.");
                await onApplyEventScope(master, eventScopeRequest(master, occurrence, scope));
                onNotice("Recurring event removed.");
                handleOpenChange(false, true);
                return;
            }
			if (
				master.recurrence &&
				scope !== "series" &&
				!(scope === "following" && event.start.getTime() <= master.start.getTime())
			) {
				const recurrence =
					scope === "occurrence"
						? excludeOccurrence(master.recurrence, event.start)
						: endSeriesBefore(master.recurrence, event.start);
				const { updates } = withSeriesEditIntent({
					updates: [{ ...master, recurrence }],
					creates: [],
				});
				const savedMaster = await onUpdateEvent(updates[0]);
				onNotice(
					scope === "occurrence"
						? "Occurrence removed."
						: "Following occurrences removed.",
					// Only the rule changed, so putting the old one back restores the
					// occurrences exactly.
					{
						undo: () =>
							onUpdateEvent(
								withSeriesEditIntent({
									updates: [editedEvent(savedMaster, master)],
									creates: [],
								}).updates[0],
							),
					},
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
					expectedRevision: requireEventRevision(master),
				});
				onNotice("Event linked to calendar.");
			} else {
				await onForkEvent({
					calendarId,
					eventId: master.id,
					expectedRevision: requireEventRevision(master),
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
				onNotice("Reminder follows its inherited setting again.");
				return;
			}

			const next =
				reminderKind === "timed"
					? withTimed(reminder.rule, value)
					: withAllDay(reminder.rule, value);
			// Only store an override where it actually differs. Writing one for
			// every glance would make each event an exception, and a later change
			// to the inherited rule would then reach none of them.
			const base = inheritedEventReminder(reminders, master).rule;
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
			<Popover open={open} onOpenChange={handleOpenChange} onRequestClose={after => requestExit(after)}>
				<PopoverTrigger
					asChild
					onClick={(clickEvent) => {
						setTriggerElement(clickEvent.currentTarget);

					}}
				>
					{children}
				</PopoverTrigger>
				<PopoverContent
					aria-labelledby={titleId}
					className={styles.detailPopover}
					onClick={(clickEvent) => clickEvent.stopPropagation()}
					/* React portals bubble events to the React parent, not the DOM
               one: without this a press on the title reaches the day cell this
               popover is rendered from and starts its drag-to-create gesture, so
               selecting text opened a draft instead. Click was already stopped
               for the same reason. */
					onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
          accessibleTitle={editing ? "Edit event" : event.title}
          onFocusOutside={focusEvent => focusEvent.preventDefault()}
          onInteractOutside={outsideEvent => {
            const target = outsideEvent.target;
            if (editing || focusMovedToAnotherLayer(target) || (target instanceof Element && target.closest("[data-inspector-trigger]"))) outsideEvent.preventDefault();
          }}
					onEscapeKeyDown={(escapeEvent) => {
						if (!targetAction) return;
						escapeEvent.preventDefault();
						hideTargetCalendars();
					}}
					style={surfaceStyle}
				>
					{editing && !editable ? (
            <>
              <header className={styles.editorHeader}>
                <h2 id={titleId}>This event is read-only</h2>
                <IconButton label="Close event editor" size="compact" onClick={() => requestExit(() => {})}>
                  <X size={17} strokeWidth={1.6} />
                </IconButton>
              </header>
              <Empty title="Your draft is kept" description="Your own changes are kept while this editor is open." />
            </>
          ) : editing ? (
						<>
							<header className={styles.editorHeader}>
								<h2 id={titleId}>{master.recurrence ? "Edit series" : "Edit event"}</h2>
								<IconButton
									label="Close event editor"
									size="compact"
									onClick={() => requestExit(() => {}, false)}
								>
									<X size={17} strokeWidth={1.6} />
								</IconButton>
							</header>
							<EventEditorForm
                rdateMaster={homeCalendar?.provider === "caldav" && !liveMaster.seriesID ? liveMaster : undefined}
                key={draft?.privacyRevision ?? "initial"}
                onValuesChange={(values) => setDraft(current => current ? { ...current, values, ownedFields: rememberPrivateEditorChanges(current.values ?? eventFormValues(master.recurrence && onRestoreEvent ? occurrence : master), values, current.ownedFields) } : current)}
								calendarLocked
								calendars={calendars}
                layout="panel"
								initialValues={draft?.values ?? eventFormValues(
									master.recurrence && onRestoreEvent ? occurrence : master,
								)}
								onCancel={() => requestExit(() => {}, false)}
								onExpand={
									onOpenFullEditor
										? (values) => {
												// The full editor explicitly edits the master. Carry the
												// draft's changes, not the occurrence's anchor dates.
												const expandedDraft =
													master.recurrence && onRestoreEvent
														? eventFormValues(
																seriesEditWrites({
																	edited: updateEventFromForm(occurrence, values),
																	master,
																	occurrence,
																	scope: "series",
																}).updates[0]!,
															)
														: values;
												handleOpenChange(false);
												onOpenFullEditor({ ...expandedDraft, privateDraftFields: draft?.ownedFields }, master);
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
                    {event.description.length > 240 ? <><p>{event.description.slice(0, 220)}…</p><Disclosure density="compact" label="Read full notes" icon={<FileText size={18} strokeWidth={1.5} />}>
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
										</p></Disclosure></> : <>
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
										</p></>}
									</section>
								) : null}

								{homeCalendar?.provider ? <ProviderEventDetails presentation="panel" event={event} seriesMaster={!event.seriesID && liveMaster.recurrence ? liveMaster : undefined} revision={event.seriesID ? event.revision : liveMaster.revision} occurrence={!!event.seriesID} eventId={event.seriesID ? event.id : master.id} series={!event.seriesID && !!master.recurrence} userId={user.id} connectionId={homeConnectionId} onRespond={observation => { setOpen(false); setProviderRsvpEditor({ context: providerReminderContext, occurrence: !!event.seriesID, eventId: event.seriesID ? event.id : master.id, observation }); }} onEditReminders={observation => { setOpen(false); setProviderReminderEditor({ context: providerReminderContext, occurrence: !!event.seriesID, eventId: event.seriesID ? event.id : master.id, observation }); }} /> : null}

								{reminder ? (
									<section aria-labelledby={reminderTitleId} className={styles.notes}>
										<div className={styles.sectionHeading}>
											<BellRing aria-hidden="true" size={17} />
											<SectionLabel id={reminderTitleId} level={3}>
												{homeCalendar?.provider ? "Musubi reminder" : "Remind me"}
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
															Use inherited setting
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
													{attendees ? `${homeCalendar?.provider ? "Musubi attendees" : "Attendees"} · ${going.length}` : "Attendees"}
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

                <div className={styles.deliveryActions}>
								<Button variant="ghost" size="compact" onClick={() => { setOpen(false); setDeliveryTarget({ context: providerReminderContext, eventId: event.seriesID ? event.id : liveMaster.id }); }}>{event.seriesID ? "Occurrence delivery details" : "Delivery details"}</Button>
                {event.seriesID && liveMaster.id !== event.id ? <Button variant="ghost" size="compact" onClick={() => { setOpen(false); setDeliveryTarget({ context: providerReminderContext, eventId: liveMaster.id }); }}>Series delivery details</Button> : null}
                </div>
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
											ref={editButtonRef}
                      icon={<Pencil size={16} strokeWidth={1.6} />}
											size="compact"
											variant="primary"
											onClick={() => {
												setDraft({
													event: structuredClone(event),
													master: structuredClone(liveMaster),
												});
												setEditing(true);
											}}
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
											ref={setDeleteButtonElement} icon={<Trash2 size={16} strokeWidth={1.6} />}
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
									{homeCalendar?.provider === "microsoft"
										? `${providerDisplayName(homeCalendar)} reports this calendar as read-only, so its events can't be changed in Musubi.`
										: "You have view-only access to this event."}
								</p>
							) : null}
						</>
					)}
				</PopoverContent>
			</Popover>
      <ConfirmationDialog elevated open={!!discardAction} onOpenChange={value => { if (!value) setDiscardAction(undefined); }} returnFocus={editSubmitElement} title="Discard unsaved changes?" description="Your changes have not been saved." closeLabel="Keep editing" cancelLabel="Keep editing" confirmLabel="Discard changes" onConfirm={() => { const finish = discardAction; setDiscardAction(undefined); finish?.(); }}><p>The original event will stay unchanged.</p></ConfirmationDialog>

            {providerRsvpEditor?.context === providerReminderContext ? <ProviderRsvpEditor
              occurrence={providerRsvpEditor.occurrence} eventId={providerRsvpEditor.eventId} connectionId={homeConnectionId}
              observation={providerRsvpEditor.observation} returnFocus={open ? deleteButtonElement : triggerElement} onClose={() => setProviderRsvpEditor(undefined)} /> : null}
            {providerReminderEditor?.context === providerReminderContext ? <ProviderReminderEditor
              key={providerReminderEditor.context} occurrence={providerReminderEditor.occurrence} eventId={providerReminderEditor.eventId} connectionId={homeConnectionId}
              observation={providerReminderEditor.observation} returnFocus={open ? deleteButtonElement : triggerElement} onClose={() => setProviderReminderEditor(undefined)} /> : null}

            {deliveryTarget?.context === providerReminderContext ? <EventDeliveryDialog key={`${user.id}:${homeConnectionId ?? "home"}:${deliveryTarget.eventId}`}
              eventId={deliveryTarget.eventId} userId={user.id} connectionId={homeConnectionId}
              returnFocus={open ? deleteButtonElement : triggerElement} onClose={() => setDeliveryTarget(undefined)} /> : null}

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
					returnFocus={open ? deleteButtonElement : triggerElement}
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
				returnFocus={open ? deleteButtonElement : triggerElement}
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
