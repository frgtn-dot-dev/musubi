import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event } from "@musubi/types";
import { GripHorizontal, X } from "lucide-react";
import { useRef } from "react";
import {
  createEventFromForm,
  defaultEventFormValues,
  type EventFormValues,
} from "../event-form";
import { getEventMutationError } from "../event-permissions";
import { useWindowDrag } from "../use-window-drag";
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
  /**
   * Where this window may be dragged. Absent pins it where it opened.
   */
  bounds?: () => DOMRect | undefined;
  /** Hand the draft to the full editor. Absent expands in place instead. */
  onMoreOptions?: (values: EventFormValues) => void;
  endDate?: string;
  endTime?: string;
  isAllDay?: boolean;
  open: boolean;
  startTime?: string;
  userId: string;
};

export function QuickCreate({
  anchor,
  bounds,
  calendars,
  date,
  email,
  onCreate,
  onCreated,
  onMoreOptions,
  onOpenChange,
  endDate,
  endTime,
  isAllDay,
  open,
  startTime,
  userId,
}: QuickCreateProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  // The window can be moved out of the way of whatever it covers, but only
  // inside the calendar it belongs to.
  const windowDrag = useWindowDrag({
    bounds: () => bounds?.(),
    element: () => contentRef.current,
  });
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
          data-moved={windowDrag.moved ? "" : undefined}
          ref={contentRef}
          style={{
            transform: windowDrag.moved
              ? `translate(${windowDrag.offset.x}px, ${windowDrag.offset.y}px)`
              : undefined,
          }}
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
          <div
            className={styles.popoverHeader}
            data-drag-handle={bounds ? "" : undefined}
            onPointerDown={(pointerEvent) => {
              if (
                !bounds ||
                pointerEvent.button !== 0 ||
                (pointerEvent.target instanceof Element &&
                  pointerEvent.target.closest("button"))
              ) {
                return;
              }
              windowDrag.begin({
                pointerId: pointerEvent.pointerId,
                x: pointerEvent.clientX,
                y: pointerEvent.clientY,
              });
            }}
          >
            {bounds ? (
              <GripHorizontal
                aria-hidden="true"
                className={styles.dragHandleMark}
                size={15}
                strokeWidth={1.6}
              />
            ) : null}
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
            onExpand={onMoreOptions}
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
