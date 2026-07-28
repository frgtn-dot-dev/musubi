import * as Popover from "@radix-ui/react-popover";
import {
  endSeriesBefore,
  excludeOccurrence,
} from "@musubi/calendar";
import type { Calendar, Event, Settings } from "@musubi/types";
import { providerDisplayName } from "@musubi/types";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
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
  Attendee,
  RemoveEventResponse,
} from "~/api/contracts";
import { getEventAttendees } from "~/api/resources";
import { connectionOfCalendar } from "../federation-routing";
import {
  getEventDateLabel,
  getEventRangeLabel,
} from "../calendar-math";
import {
  eventFormValues,
  updateEventFromForm,
  type EventFormValues,
} from "../event-form";
import {
  canEditEvent,
  canRemoveEvent,
  getEditableCalendars,
  getEventHomeCalendar,
  getEventMutationError,
} from "../event-permissions";
import type { Notify } from "../notice";
import { EventEditorForm } from "./EventEditorForm";
import styles from "./workspace.module.css";

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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteScope, setDeleteScope] =
    useState<DeleteScope>("occurrence");
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
  // A delete only needs confirming when Undo cannot honestly cover it: a series
  // needs a scope first, and a provider-backed event has already left for the
  // other system, where a restore lands as a new event rather than the old one.
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
      setConfirmingDelete(false);
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

  async function handleDelete() {
    setBusyAction("delete");
    setActionError(undefined);

    try {
      if (
        master.recurrence &&
        deleteScope !== "series" &&
        !(
          deleteScope === "following" &&
          event.start.getTime() <= master.start.getTime()
        )
      ) {
        const recurrence =
          deleteScope === "occurrence"
            ? excludeOccurrence(master.recurrence, event.start)
            : endSeriesBefore(master.recurrence, event.start);
        await onUpdateEvent({ ...master, recurrence });
        onNotice(
          deleteScope === "occurrence"
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
      handleOpenChange(false);
    } catch (error) {
      setActionError(
        getEventMutationError(
          error,
          master.recurrence && deleteScope !== "series"
            ? "update"
            : "delete",
          removeCalendar,
        ),
      );
    } finally {
      setBusyAction(undefined);
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

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          aria-label={event.title}
          className={`${styles.popover} ${styles.detailPopover}`}
          collisionPadding={14}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          side="bottom"
          sideOffset={8}
        >
          {editing ? (
            <>
              <div className={styles.popoverHeader}>
                <h2>{master.recurrence ? "Edit series" : "Edit event"}</h2>
                <button
                  aria-label="Close event editor"
                  className={styles.iconButton}
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  <X aria-hidden="true" size={17} strokeWidth={1.6} />
                </button>
              </div>
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
                weekStartsOn={weekStartsOn}
              />
            </>
          ) : (
            <>
              <div className={styles.popoverHeader}>
                <div>
                  <h2>{event.title}</h2>
                  <p className={styles.detailCalendar}>
                    <span
                      className={styles.calendarDot}
                      style={{
                        backgroundColor: calendar?.color ?? event.color,
                      }}
                    />
                    {event.calendars
                      .map(
                        (calendarId) =>
                          calendars.find((item) => item.id === calendarId)
                            ?.name,
                      )
                      .filter(Boolean)
                      .join(" · ") || "Calendar"}
                  </p>
                </div>
                <Popover.Close asChild>
                  <button
                    aria-label="Close event details"
                    className={styles.iconButton}
                    type="button"
                  >
                    <X aria-hidden="true" size={17} strokeWidth={1.6} />
                  </button>
                </Popover.Close>
              </div>

              <dl className={styles.detailList}>
                <DetailRow
                  icon={<CalendarDays size={17} strokeWidth={1.5} />}
                  label="Date"
                  value={getEventDateLabel(event)}
                />
                <DetailRow
                  icon={<Clock3 size={17} strokeWidth={1.5} />}
                  label="Time"
                  value={getEventRangeLabel(event, timeFormat)}
                />
                {event.recurrence ? (
                  <DetailRow
                    icon={<Repeat2 size={17} strokeWidth={1.5} />}
                    label="Repeat"
                    value="Recurring series"
                  />
                ) : null}
                {event.location ? (
                  <DetailRow
                    icon={<MapPin size={17} strokeWidth={1.5} />}
                    label="Location"
                    value={event.location}
                  />
                ) : null}
                {event.url ? (
                  <DetailRow
                    icon={<Link2 size={17} strokeWidth={1.5} />}
                    label="Link"
                    value={
                      <a href={event.url} rel="noreferrer" target="_blank">
                        Open event link
                      </a>
                    }
                  />
                ) : null}
                {event.description ? (
                  <DetailRow
                    icon={<FileText size={17} strokeWidth={1.5} />}
                    label="Notes"
                    value={event.description}
                  />
                ) : null}
              </dl>

              {master.hasAttendees ? (
                <section className={styles.attendeeSection}>
                  <div>
                    <UsersRound aria-hidden="true" size={16} />
                    <strong>
                      {!attendees
                        ? "Loading attendees…"
                        : `${attendees?.length ?? 0} attending`}
                    </strong>
                  </div>
                  {attendees ? (
                    <>
                      <p>
                        {attendees.map((item) => item.name).join(", ") ||
                          "Be the first to attend."}
                      </p>
                      <button
                        className={styles.secondaryButton}
                        disabled={busyAction === "attendance"}
                        type="button"
                        onClick={() => void handleAttendance()}
                      >
                        {isAttending ? "Leave" : "Attend"}
                      </button>
                    </>
                  ) : null}
                </section>
              ) : null}

              {targetCalendars.length > 0 ? (
                <section className={styles.linkSection}>
                  <select
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
                  </select>
                  <button
                    className={styles.textButton}
                    disabled={Boolean(busyAction)}
                    type="button"
                    onClick={() => void handleTargetAction("link")}
                  >
                    <Link2 aria-hidden="true" size={14} />
                    Link
                  </button>
                  <button
                    className={styles.textButton}
                    disabled={Boolean(busyAction)}
                    type="button"
                    onClick={() => void handleTargetAction("fork")}
                  >
                    <CopyPlus aria-hidden="true" size={14} />
                    Fork
                  </button>
                </section>
              ) : null}

              {actionError ? (
                <div className={styles.formError} role="alert">
                  <p>{actionError.message}</p>
                  {actionError.requestId ? (
                    <span>Request {actionError.requestId}</span>
                  ) : null}
                </div>
              ) : null}

              {confirmingDelete ? (
                <div className={styles.deleteConfirm}>
                  <AlertTriangle
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.5}
                  />
                  <div>
                    <strong>Delete “{event.title}”?</strong>
                    <p>
                      {removeCalendar?.provider
                        ? `This change will also be sent to ${providerDisplayName(
                            removeCalendar,
                          )}.`
                        : "This cannot be undone."}
                    </p>
                  </div>
                  {master.recurrence ? (
                    <select
                      aria-label="Recurring event delete scope"
                      className={styles.deleteScope}
                      disabled={busyAction === "delete"}
                      value={deleteScope}
                      onChange={(changeEvent) =>
                        setDeleteScope(
                          changeEvent.target.value as DeleteScope,
                        )
                      }
                    >
                      <option value="occurrence">This event</option>
                      <option value="following">
                        This and following events
                      </option>
                      <option value="series">Entire series</option>
                    </select>
                  ) : null}
                  <div className={styles.deleteConfirmActions}>
                    <button
                      className={styles.textButton}
                      disabled={busyAction === "delete"}
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.dangerButton}
                      disabled={busyAction === "delete"}
                      type="button"
                      onClick={() => void handleDelete()}
                    >
                      {busyAction === "delete" ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ) : editable || removable ? (
                <div className={styles.detailActions}>
                  {editable ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil aria-hidden="true" size={15} strokeWidth={1.6} />
                      {master.recurrence ? "Edit series" : "Edit"}
                    </button>
                  ) : null}
                  {removable ? (
                    <button
                      className={styles.deleteTextButton}
                      disabled={busyAction === "delete"}
                      type="button"
                      onClick={() =>
                        undoableDelete
                          ? void handleDelete()
                          : setConfirmingDelete(true)
                      }
                    >
                      <Trash2 aria-hidden="true" size={15} strokeWidth={1.6} />
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className={styles.prototypeNote}>
                  You have view-only access to this event.
                </p>
              )}
            </>
          )}
          <Popover.Arrow className={styles.popoverArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: ReactElement;
  label: string;
  value: ReactElement | string;
}) {
  return (
    <div>
      <span aria-hidden="true">{icon}</span>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
