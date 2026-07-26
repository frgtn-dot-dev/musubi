import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event, Settings } from "@musubi/types";
import { providerDisplayName } from "@musubi/types";
import type { ReactElement } from "react";
import { useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  FileText,
  MapPin,
  Pencil,
  Repeat2,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import type { RemoveEventResponse } from "~/api/contracts";
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
  getEventHomeCalendar,
  getEditableCalendars,
  getEventMutationError,
  isQuickEditableEvent,
} from "../event-permissions";
import { EventEditorForm } from "./EventEditorForm";
import styles from "./workspace.module.css";

export type EventActionHandlers = {
  onNotice: (message: string) => void;
  onRemoveEvent: (event: Event) => Promise<RemoveEventResponse>;
  onUpdateEvent: (event: Event) => Promise<Event>;
};

type EventDetailsPopoverProps = EventActionHandlers & {
  calendar: Calendar | undefined;
  calendars: Calendar[];
  children: ReactElement;
  event: Event;
  timeFormat: Settings["timeFormat"];
};

export function EventDetailsPopover({
  calendar,
  calendars,
  children,
  event,
  onNotice,
  onRemoveEvent,
  onUpdateEvent,
  timeFormat,
}: EventDetailsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{
    message: string;
    requestId?: string;
  }>();
  const homeCalendar =
    getEventHomeCalendar(event, calendars) ?? calendar;
  const removeCalendar =
    getEditableCalendars(calendars).find((item) =>
      event.calendars.includes(item.id),
    ) ?? homeCalendar;
  const editable =
    canEditEvent(event, calendars) && isQuickEditableEvent(event);
  const removable =
    canRemoveEvent(event, calendars) && !event.recurrence;
  const editCalendars = homeCalendar ? [homeCalendar] : [];

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);

    if (!nextOpen) {
      setEditing(false);
      setConfirmingDelete(false);
      setDeleteError(undefined);
    }
  }

  async function handleUpdate(values: EventFormValues) {
    await onUpdateEvent(updateEventFromForm(event, values));
    onNotice("Event updated.");
    handleOpenChange(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(undefined);

    try {
      const result = await onRemoveEvent(event);
      onNotice(result.removed ? "Event deleted." : "Event removed.");
      handleOpenChange(false);
    } catch (error) {
      setDeleteError(
        getEventMutationError(error, "delete", removeCalendar),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${styles.popover} ${styles.detailPopover}`}
          align="start"
          aria-label={event.title}
          side="bottom"
          sideOffset={8}
          collisionPadding={14}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
        >
          {editing ? (
            <>
              <div className={styles.popoverHeader}>
                <h2>Edit event</h2>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="Close event editor"
                  onClick={() => setEditing(false)}
                >
                  <X aria-hidden="true" size={17} strokeWidth={1.6} />
                </button>
              </div>
              <EventEditorForm
                calendarLocked
                calendars={editCalendars}
                initialValues={eventFormValues(event)}
                onCancel={() => setEditing(false)}
                onError={(error) =>
                  getEventMutationError(error, "update", homeCalendar)
                }
                onSubmit={handleUpdate}
                submitLabel="Save"
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
                    {calendar?.name ?? "Calendar"}
                  </p>
                </div>
                <Popover.Close asChild>
                  <button
                    className={styles.iconButton}
                    type="button"
                    aria-label="Close event details"
                  >
                    <X aria-hidden="true" size={17} strokeWidth={1.6} />
                  </button>
                </Popover.Close>
              </div>

              <dl className={styles.detailList}>
                <div>
                  <CalendarDays
                    aria-hidden="true"
                    size={17}
                    strokeWidth={1.5}
                  />
                  <dt>Date</dt>
                  <dd>{getEventDateLabel(event)}</dd>
                </div>
                <div>
                  <Clock3
                    aria-hidden="true"
                    size={17}
                    strokeWidth={1.5}
                  />
                  <dt>Time</dt>
                  <dd>{getEventRangeLabel(event, timeFormat)}</dd>
                </div>
                {event.recurrence ? (
                  <div>
                    <Repeat2
                      aria-hidden="true"
                      size={17}
                      strokeWidth={1.5}
                    />
                    <dt>Repeat</dt>
                    <dd>Every week</dd>
                  </div>
                ) : null}
                {event.hasAttendees ? (
                  <div>
                    <UsersRound
                      aria-hidden="true"
                      size={17}
                      strokeWidth={1.5}
                    />
                    <dt>Attendees</dt>
                    <dd>Attendee tracking enabled</dd>
                  </div>
                ) : null}
                {event.location ? (
                  <div>
                    <MapPin
                      aria-hidden="true"
                      size={17}
                      strokeWidth={1.5}
                    />
                    <dt>Location</dt>
                    <dd>{event.location}</dd>
                  </div>
                ) : null}
                {event.description ? (
                  <div>
                    <FileText
                      aria-hidden="true"
                      size={17}
                      strokeWidth={1.5}
                    />
                    <dt>Notes</dt>
                    <dd>{event.description}</dd>
                  </div>
                ) : null}
              </dl>

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
                  {deleteError ? (
                    <div className={styles.formError} role="alert">
                      <p>{deleteError.message}</p>
                      {deleteError.requestId ? (
                        <span>Request {deleteError.requestId}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className={styles.deleteConfirmActions}>
                    <button
                      className={styles.textButton}
                      disabled={deleting}
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.dangerButton}
                      disabled={deleting}
                      type="button"
                      onClick={() => void handleDelete()}
                    >
                      {deleting ? "Deleting…" : "Delete"}
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
                      <Pencil
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.6}
                      />
                      Edit
                    </button>
                  ) : null}
                  {removable ? (
                    <button
                      className={styles.deleteTextButton}
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <Trash2
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.6}
                      />
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className={styles.prototypeNote}>
                  {event.recurrence
                    ? "Recurring event changes continue in the full editor."
                    : "You have view-only access to this event."}
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
