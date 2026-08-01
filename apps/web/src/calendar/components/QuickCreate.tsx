import {
  DEFAULT_CALENDAR_COLOR,
  type Calendar,
  type Event,
  type Settings,
} from "@musubi/types";
import { GripHorizontal, X } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "~/ui/Button";
import {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
} from "~/ui/Popover";
import {
  createEventFromForm,
  defaultEventFormValues,
  type EventFormValues,
} from "../event-form";
import { getEventMutationError } from "../event-permissions";
import { useWindowDrag } from "../use-window-drag";
import { focusMovedToAnotherLayer } from "../layer-focus";
import { type EventWhen, EventEditorForm } from "./EventEditorForm";
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
  /** Keeps the block on the grid in step with the fields describing it. */
  onDraftChange?: (draft: EventWhen & { color?: string }) => void;
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
  timeFormat: Settings["timeFormat"];
  userId: string;
  weekStartsOn: Settings["weekStartsOn"];
};

export function QuickCreate({
  anchor,
  bounds,
  calendars,
  date,
  email,
  onCreate,
  onDraftChange,
  onCreated,
  onMoreOptions,
  onOpenChange,
  endDate,
  endTime,
  isAllDay,
  open,
  startTime,
  timeFormat,
  userId,
  weekStartsOn,
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
      calendar?.color ?? DEFAULT_CALENDAR_COLOR,
    );
    const created = await onCreate(event);
    onCreated(created);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span
          className={styles.quickCreateAnchor}
          style={{ left: anchor.x, top: anchor.y }}
        />
      </PopoverAnchor>
        <PopoverContent
          className={styles.createPopover}
          data-moved={windowDrag.moved ? "" : undefined}
          showArrow={!windowDrag.moved}
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
          /* Same as the click above: a portal bubbles into its React parent, so
             without this a press in the form starts the grid's create gesture. */
          onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
          /* Focus wandering out is not a decision to discard a draft — pressing
             outside or Escape is. It especially must not be, because a draft this
             one replaces restores focus to its own origin as it unmounts, which
             would otherwise dismiss the replacement the instant it arrives. */
          onFocusOutside={(focusEvent) => {
            if (!focusMovedToAnotherLayer(focusEvent.target)) {
              focusEvent.preventDefault();
            }
          }}
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
            <PopoverClose asChild>
              <IconButton label="Close new event" size="compact">
                <X aria-hidden="true" size={17} strokeWidth={1.6} />
              </IconButton>
            </PopoverClose>
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
            onDraftChange={onDraftChange}
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
            timeFormat={timeFormat}
            weekStartsOn={weekStartsOn}
          />
        </PopoverContent>
    </Popover>
  );
}
