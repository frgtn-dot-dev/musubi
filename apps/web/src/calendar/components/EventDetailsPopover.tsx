import * as Popover from "@radix-ui/react-popover";
import { endSeriesBefore, excludeOccurrence } from "@musubi/calendar";
import type { Calendar, Event, Settings } from "@musubi/types";
import { providerDisplayName } from "@musubi/types";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  CopyPlus,
  FileText,
  Link2,
  MapPin,
  Pencil,
  Repeat2,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import type {
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react";
import { useEffect, useId, useState } from "react";
import type { Attendee, RemoveEventResponse } from "~/api/contracts";
import { getEventAttendees } from "~/api/resources";
import { Button, IconButton } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { SectionLabel } from "~/ui/SectionLabel";
import { Select } from "~/ui/Select";
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
  getEditableCalendars,
  getEventHomeCalendar,
  getEventMutationError,
} from "../event-permissions";
import type { Notify } from "../notice";
import { EventEditorForm } from "./EventEditorForm";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import styles from "./styles/event-details.module.css";
import workspaceStyles from "./workspace.module.css";

type TargetMutation = {
  calendarId: string;
  eventId: string;
};

export type EventActionHandlers = {
  getEventMaster: (event: Event) => Event;
  onForkEvent: (input: TargetMutation) => Promise<Event>;
  onLinkEvent: (input: TargetMutation) => Promise<Event>;
  onNotice: Notify;
  onRemoveEvent: (event: Event) => Promise<RemoveEventResponse>;
  /**
   * Puts a deleted event back. Absent means a delete cannot be offered as
   * undoable, so it has to be confirmed up front instead.
   */
  onRestoreEvent?: (event: Event) => Promise<unknown>;
  onSetAttendance: (input: {
    attending: boolean;
    calendarId?: string;
    eventId: string;
  }) => Promise<Attendee[]>;
  onUpdateEvent: (event: Event) => Promise<Event>;
  user: { id: string; name: string };
};

type DeleteScope = "occurrence" | "following" | "series";
type DeletePrompt = "confirm" | "scope";

type EventDetailsPopoverProps = EventActionHandlers & {
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
  onRemoveEvent,
  onRestoreEvent,
  onSetAttendance,
  onUpdateEvent,
  timeFormat,
  user,
  weekStartsOn,
}: EventDetailsPopoverProps) {
  const master = getEventMaster(event);
  const titleId = useId();
  const notesTitleId = useId();
  const guestsTitleId = useId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt>();
  const [pendingDeleteScope, setPendingDeleteScope] =
    useState<DeleteScope>();
  const [triggerElement, setTriggerElement] =
    useState<HTMLElement | null>(null);
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<{
    message: string;
    requestId?: string;
  }>();
  const homeCalendar =
    getEventHomeCalendar(master, calendars) ?? calendar;
  // A primitive, so the attendees effect can depend on it without re-running on
  // every re-render of the calendar list.
  const homeConnectionId = connectionOfCalendar(homeCalendar);
  const removeCalendar =
    getEditableCalendars(calendars).find((item) =>
      master.calendars.includes(item.id),
    ) ?? homeCalendar;
  // Provider-backed deletes cannot be faithfully undone: restoring there makes
  // a new remote event rather than bringing the original one back.
  const undoableDelete = Boolean(
    onRestoreEvent && !master.recurrence && !removeCalendar?.provider,
  );
  const editable = canEditEvent(master, calendars);
  const removable = canRemoveEvent(master, calendars);
  const targetCalendars = getEditableCalendars(calendars).filter(
    (item) => !master.calendars.includes(item.id),
  );
  const [targetCalendarId, setTargetCalendarId] = useState("");
  const selectedTargetId =
    targetCalendarId || targetCalendars[0]?.id || "";
  const [attendees, setAttendees] = useState<Attendee[]>();
  const isAttending =
    attendees?.some((attendee) => attendee.id === user.id) ?? false;
  const eventCalendars = event.calendars
    .map((calendarId) =>
      calendars.find((item) => item.id === calendarId),
    )
    .filter((item): item is Calendar => Boolean(item));
  const accentColor =
    calendar?.color ?? eventCalendars[0]?.color ?? event.color;
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

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);

    if (!nextOpen) {
      setEditing(false);
      setActionError(undefined);
    }
  }

  async function handleUpdate(values: EventFormValues) {
    await onUpdateEvent(updateEventFromForm(master, values));
    onNotice(
      master.recurrence ? "Recurring series updated." : "Event updated.",
    );
    handleOpenChange(false);
  }

  async function handleDelete(scope: DeleteScope = "series") {
    setBusyAction("delete");
    setPendingDeleteScope(scope);
    setActionError(undefined);

    try {
      if (
        master.recurrence &&
        scope !== "series" &&
        !(
          scope === "following" &&
          event.start.getTime() <= master.start.getTime()
        )
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
          () => onUpdateEvent(master),
        );
      } else {
        const result = await onRemoveEvent(master);
        onNotice(
          result.removed ? "Event deleted." : "Event removed.",
          undoableDelete ? () => onRestoreEvent!(master) : undefined,
        );
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
    } else if (undoableDelete) {
      void handleDelete();
    } else {
      setDeletePrompt("confirm");
    }
  }

  async function handleTargetAction(action: "link" | "fork") {
    if (!selectedTargetId) return;
    setBusyAction(action);
    setActionError(undefined);

    try {
      if (action === "link") {
        await onLinkEvent({
          calendarId: selectedTargetId,
          eventId: master.id,
        });
        onNotice("Event linked to calendar.");
      } else {
        await onForkEvent({
          calendarId: selectedTargetId,
          eventId: master.id,
        });
        onNotice("Independent event copy created.");
      }
      handleOpenChange(false);
    } catch (error) {
      setActionError(
        getEventMutationError(
          error,
          "update",
          calendars.find((item) => item.id === selectedTargetId),
        ),
      );
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleAttendance() {
    setBusyAction("attendance");
    setActionError(undefined);

    try {
      const nextAttendees = await onSetAttendance({
        attending: !isAttending,
        calendarId: homeCalendar?.id,
        eventId: master.id,
      });
      setAttendees(nextAttendees);
      onNotice(isAttending ? "Attendance removed." : "Attendance confirmed.");
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
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          asChild
          onClick={(clickEvent) =>
            setTriggerElement(clickEvent.currentTarget)
          }
        >
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            aria-labelledby={titleId}
            className={`${workspaceStyles.popover} ${styles.detailPopover}`}
            collisionPadding={14}
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            side="bottom"
            sideOffset={8}
            style={surfaceStyle}
          >
            {editing ? (
              <>
                <header className={styles.editorHeader}>
                  <h2 id={titleId}>
                    {master.recurrence ? "Edit series" : "Edit event"}
                  </h2>
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
                  initialValues={eventFormValues(master)}
                  onCancel={() => setEditing(false)}
                  onError={(error) =>
                    getEventMutationError(error, "update", homeCalendar)
                  }
                  onSubmit={handleUpdate}
                  submitLabel="Save"
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
                      <span className={styles.recurrenceBadge}>
                        <Repeat2 aria-hidden="true" size={13} />
                        Recurring
                      </span>
                    ) : null}
                  </div>
                  <Popover.Close asChild>
                    <IconButton
                      label="Close event details"
                      size="compact"
                    >
                      <X size={17} strokeWidth={1.6} />
                    </IconButton>
                  </Popover.Close>
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

                  <ul
                    aria-label="Calendars"
                    className={styles.calendarPills}
                  >
                    {eventCalendars.length > 0 ? (
                      eventCalendars.map((item) => (
                        <li className={styles.calendarPill} key={item.id}>
                          <span
                            aria-hidden="true"
                            className={styles.calendarDot}
                            style={{ backgroundColor: item.color }}
                          />
                          {item.name}
                        </li>
                      ))
                    ) : (
                      <li className={styles.calendarPill}>
                        <span
                          aria-hidden="true"
                          className={styles.calendarDot}
                          style={{ backgroundColor: accentColor }}
                        />
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
                          value={
                            <a
                              aria-label={`Open event link, ${getUrlLabel(event.url)}`}
                              href={event.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {getUrlLabel(event.url)}
                            </a>
                          }
                        />
                      ) : null}
                    </dl>
                  ) : null}

                  {event.description ? (
                    <section
                      aria-labelledby={notesTitleId}
                      className={styles.notes}
                    >
                      <div className={styles.sectionHeading}>
                        <FileText aria-hidden="true" size={17} />
                        <SectionLabel id={notesTitleId} level={3}>
                          Notes
                        </SectionLabel>
                      </div>
                      <p>{event.description}</p>
                    </section>
                  ) : null}

                  {master.hasAttendees ? (
                    <section
                      aria-busy={!attendees}
                      aria-labelledby={guestsTitleId}
                      className={styles.attendeeSection}
                    >
                      <div className={styles.sectionHeading}>
                        <UsersRound aria-hidden="true" size={17} />
                        <SectionLabel id={guestsTitleId} level={3}>
                          Guests
                        </SectionLabel>
                      </div>
                      <strong>
                        {!attendees
                          ? "Loading guests…"
                          : `${attendees.length} attending`}
                      </strong>
                      {attendees ? (
                        <>
                          <p>
                            {attendees.map((item) => item.name).join(", ") ||
                              "Be the first to attend."}
                          </p>
                          <Button
                            loading={busyAction === "attendance"}
                            size="compact"
                            variant="secondary"
                            onClick={() => void handleAttendance()}
                          >
                            {isAttending ? "Leave" : "Attend"}
                          </Button>
                        </>
                      ) : null}
                    </section>
                  ) : null}

                  {targetCalendars.length > 0 ? (
                    <section className={styles.calendarActions}>
                      <label>
                        <span>Add to calendar</span>
                        <Select
                          aria-label="Target calendar"
                          disabled={Boolean(busyAction)}
                          value={selectedTargetId}
                          onChange={(changeEvent) =>
                            setTargetCalendarId(changeEvent.target.value)
                          }
                        >
                          {targetCalendars.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <div>
                        <Button
                          disabled={Boolean(busyAction)}
                          icon={<Link2 size={15} />}
                          loading={busyAction === "link"}
                          size="compact"
                          variant="secondary"
                          onClick={() => void handleTargetAction("link")}
                        >
                          Link
                        </Button>
                        <Button
                          disabled={Boolean(busyAction)}
                          icon={<CopyPlus size={15} />}
                          loading={busyAction === "fork"}
                          size="compact"
                          variant="text"
                          onClick={() => void handleTargetAction("fork")}
                        >
                          Fork
                        </Button>
                      </div>
                    </section>
                  ) : null}

                  {actionError ? (
                    <ActionError
                      message={actionError.message}
                      requestId={actionError.requestId}
                    />
                  ) : null}
                </div>

                {editable || removable ? (
                  <footer
                    aria-label="Event actions"
                    className={styles.detailActions}
                  >
                    {editable ? (
                      <Button
                        icon={<Pencil size={16} strokeWidth={1.6} />}
                        size="compact"
                        variant="secondary"
                        onClick={() => setEditing(true)}
                      >
                        {master.recurrence ? "Edit series" : "Edit"}
                      </Button>
                    ) : null}
                    {removable ? (
                      <Button
                        className={styles.deleteAction}
                        icon={<Trash2 size={16} strokeWidth={1.6} />}
                        loading={busyAction === "delete"}
                        size="compact"
                        variant="text"
                        onClick={beginDelete}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </footer>
                ) : (
                  <p className={styles.viewOnly}>
                    You have view-only access to this event.
                  </p>
                )}
              </>
            )}
            <Popover.Arrow className={workspaceStyles.popoverArrow} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {deletePrompt === "scope" ? (
        <RecurrenceScopeDialog
          action="delete"
          busyScope={pendingDeleteScope}
          consequence={deleteConsequence}
          error={
            actionError ? (
              <>
                <p>{actionError.message}</p>
                {actionError.requestId ? (
                  <span>Request {actionError.requestId}</span>
                ) : null}
              </>
            ) : undefined
          }
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

      <Dialog
        closeLabel="Close delete event dialog"
        description={`“${event.title}” will be removed from your calendar.`}
        footer={
          <>
            <Button
              disabled={busyAction === "delete"}
              variant="text"
              onClick={() => setDeletePrompt(undefined)}
            >
              Cancel
            </Button>
            <Button
              loading={busyAction === "delete"}
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </>
        }
        onOpenChange={(nextOpen) =>
          nextOpen || setDeletePrompt(undefined)
        }
        open={deletePrompt === "confirm"}
        returnFocus={triggerElement}
        size="compact"
        title="Delete event?"
      >
        <div className={styles.deleteConsequence}>
          <AlertTriangle aria-hidden="true" size={19} strokeWidth={1.5} />
          <p>{deleteConsequence}</p>
        </div>
        {actionError ? (
          <ActionError
            message={actionError.message}
            requestId={actionError.requestId}
          />
        ) : null}
      </Dialog>
    </>
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

function ActionError({
  message,
  requestId,
}: {
  message: string;
  requestId?: string;
}) {
  return (
    <div className={styles.actionError} role="alert">
      <p>{message}</p>
      {requestId ? <span>Request {requestId}</span> : null}
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

function getUrlLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
