import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event } from "@musubi/types";
import { X } from "lucide-react";
import {
  createEventFromForm,
  defaultEventFormValues,
  type EventFormValues,
} from "../event-form";
import { getEventMutationError } from "../event-permissions";
import { EventEditorForm } from "./EventEditorForm";
import styles from "./workspace.module.css";

export type QuickCreateAnchor = {
  returnFocus?: HTMLElement | null;
  x: number;
  y: number;
};

type QuickCreateProps = {
  anchor: QuickCreateAnchor;
  calendars: Calendar[];
  date: string;
  email: string;
  onCreate: (event: Event) => Promise<Event>;
  onCreated: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  endDate?: string;
  endTime?: string;
  isAllDay?: boolean;
  open: boolean;
  startTime?: string;
  userId: string;
};

export function QuickCreate({
  anchor,
  calendars,
  date,
  email,
  onCreate,
  onCreated,
  onOpenChange,
  endDate,
  endTime,
  isAllDay,
  open,
  startTime,
  userId,
}: QuickCreateProps) {
  const defaultCalendar =
    calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const initialValues = defaultEventFormValues(
    defaultCalendar?.id ?? "",
    date,
    startTime,
    { endDate, endTime, isAllDay },
  );

  async function handleSubmit(values: EventFormValues) {
    const calendar = calendars.find(
      (item) => item.id === values.calendarId,
    );
    const event = createEventFromForm(
      values,
      { email, userId },
      calendar?.color ?? "#7a8ba3",
    );
    const created = await onCreate(event);
    onCreated(created);
    onOpenChange(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <span
          className={styles.quickCreateAnchor}
          style={{ left: anchor.x, top: anchor.y }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className={`${styles.popover} ${styles.createPopover}`}
          align="start"
          /* Beside the slot, not on top of it: the draft underneath stays
             grabbable, so its time can still be dragged while this is open.
             Radix flips to the other side when there is no room. */
          side="right"
          sideOffset={12}
          collisionPadding={14}
          aria-label="Create event"
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          onInteractOutside={(interaction) => {
            // Grabbing the draft this popover describes is not "outside" it —
            // that gesture changes the time in the form, so it must not dismiss.
            if (
              interaction.target instanceof Element &&
              interaction.target.closest("[data-draft]")
            ) {
              interaction.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            anchor.returnFocus?.focus();
          }}
        >
          <div className={styles.popoverHeader}>
            <h2>New event</h2>
            <Popover.Close asChild>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Close new event"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.6} />
              </button>
            </Popover.Close>
          </div>
          <EventEditorForm
            calendars={calendars}
            compact
            initialValues={initialValues}
            when={{
              date,
              endDate: endDate ?? date,
              endTime: initialValues.endTime,
              isAllDay: initialValues.isAllDay,
              startTime: initialValues.startTime,
            }}
            onCancel={() => onOpenChange(false)}
            onError={(error, values) =>
              getEventMutationError(
                error,
                "create",
                calendars.find(
                  (calendar) => calendar.id === values.calendarId,
                ),
              )
            }
            onSubmit={handleSubmit}
            submitLabel="Create"
          />
          <Popover.Arrow className={styles.popoverArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
