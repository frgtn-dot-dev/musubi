import type { Calendar, Event, Settings } from "@musubi/types";
import { eventDayKeys, getMonthGrid } from "@musubi/calendar/layout";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getEventRangeLabel,
  getLongDateLabel,
  getWeekdayLabels,
} from "../calendar-math";
import { calendarLaneSpans, visibleLaneLimit } from "../all-day-lanes";
import { Popover, PopoverContent, PopoverTrigger } from "~/ui/Popover";
import { dayDelta, shiftDayKey, toDateKey } from "../date-key";
import { getReadableEventTextColor } from "../event-color";
import {
  canEditEvent,
  eventHomeCalendarId,
} from "../event-permissions";
import { useLayerDismissGuard } from "../layer-focus";
import { movePreviewRange } from "../time-grid-drag";
import { useDayRangeCreate, useMonthDrag } from "../use-time-grid-drag";
import { EventPopover } from "./EventPopover";
import type { EventActionHandlers } from "./EventDetailsPopover";
import {
  PollCalendarChip,
  type PollCalendarItem,
} from "./PollCalendarChip";
import styles from "./workspace.module.css";

const DEFAULT_EVENT_CAPACITY = 3;

function eventCapacityForGrid(grid: HTMLElement, rows: number) {
  // SSR, jsdom and a temporarily hidden workspace do not have a measurable
  // layout. Keep the established density until a real grid size is available.
  if (grid.clientHeight <= 0) return DEFAULT_EVENT_CAPACITY;

  const styles = window.getComputedStyle(grid);
  const fixedSpace =
    Number.parseFloat(
      styles.getPropertyValue("--month-day-fixed-space"),
    ) || 38;
  const eventHeight =
    Number.parseFloat(styles.getPropertyValue("--month-event-height")) || 21;
  const eventGap =
    Number.parseFloat(styles.getPropertyValue("--month-event-gap")) || 3;
  const rowHeight = grid.clientHeight / rows;
  const availableHeight = Math.max(0, rowHeight - fixedSpace);

  return Math.max(
    1,
    Math.floor((availableHeight + eventGap) / (eventHeight + eventGap)),
  );
}

type MonthCalendarProps = EventActionHandlers & {
  anchor: Date;
  /**
   * The exact grid to draw, as whole weeks. Defaults to the anchor's month,
   * which is what "Month" means; multi-week passes its own run of weeks and
   * gets the same cells, chips, overflow and drag behaviour for free.
   */
  days?: Date[];
  /** What a screen reader calls this grid. Defaults to the anchor's month. */
  gridLabel?: string;
  /**
   * Smallest a week row may get. Month leaves it at zero so six rows always fit
   * their area; a long multi-week run sets it and lets the area scroll.
   */
  rowMinHeight?: string;
  /**
   * Dim the days that fall outside the anchor's month. True for Month, where
   * the edges are padding; false wherever every day on screen is equally the
   * point.
   */
  dimOutsideMonth?: boolean;
  /** The event a write is in flight for, so its chip can say so. */
  busyEventId?: string;
  calendars: Calendar[];
  events: Event[];
  pollItems?: PollCalendarItem[];
  onOpenPoll?: (item: PollCalendarItem, trigger: HTMLButtonElement) => void;
  onCreateAtDate?: (
    date: string,
    target: HTMLElement,
    /** Set when days were dragged across: an all-day range. */
    endDate?: string,
  ) => void;
  /** The slot a quick-create popover is open for: the draft, shown as a pill. */
  /** Drops the draft the open quick create describes, before a new one starts. */
  onCancelDraft?: () => void;
  pendingCreate?: { color?: string; date: string; endDate?: string };
  /**
   * Move the draft to another day range while its popover is open. Absent leaves
   * the draft as a still pill.
   */
  onMoveDraft?: (input: { date: string; endDate: string }) => void;
  onMonthChange: (offset: number) => void;
  /**
   * Move an event by the days dragged, keeping its time. The origin is the day
   * the block was grabbed on, not the event's first day: a multi-day bar
   * grabbed in the middle keeps that offset instead of restarting on the drop
   * day, which is also what the preview draws. Absent leaves the month
   * read-only for direct manipulation.
   */
  onMoveEventToDate?: (input: {
    dayKey: string;
    event: Event;
    originDayKey: string;
  }) => Promise<unknown>;
  /**
   * Page presentation. When false, cells belonging to the neighbouring months
   * render empty — the cell itself stays so the month never changes height.
   */
  showAdjacentDays?: boolean;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

export function MonthCalendar({
  anchor,
  busyEventId,
  calendars,
  days: providedDays,
  dimOutsideMonth = true,
  events,
  gridLabel,
  pollItems = [],
  onOpenPoll,
  rowMinHeight,
  onCreateAtDate,
  onMonthChange,
  onMoveDraft,
  onMoveEventToDate,
  onCancelDraft,
  pendingCreate,
  showAdjacentDays = true,
  timeFormat,
  weekStartsOn,
  ...eventActions
}: MonthCalendarProps) {
  // A click that closed a layer is doing that and nothing else. Only the click
  // is guarded, not the press: a drag that begins over an open draft is meant
  // to replace it, which is a gesture and not a dismissal.
  const dismissGuard = useLayerDismissGuard();
  const {
    begin: beginRangeCreate,
    consumeClick,
    range,
  } = useDayRangeCreate({
    onSelected: ({ fromKey, toKey }, cell) => {
      // Dragging backwards is as valid as forwards.
      const [start, end] =
        fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
      // Anchor on the last day of the range, so the popover opens past the end
      // of the pill rather than across it.
      const endCell = document.querySelector<HTMLElement>(
        `[data-day-key="${end}"]`,
      );
      onCreateAtDate?.(start, endCell ?? cell, end);
    },
  });

  // The draft the open popover describes, as a day range. Dragging it moves the
  // whole range, so the pill is grabbable the way a real chip is.
  const { begin: beginDraftDrag, drag: draftDrag } = useMonthDrag<undefined>({
    onCommit: async ({ dayKey: targetKey, originDayKey }) => {
      if (!pendingCreate || !onMoveDraft) return;
      const shift = dayDelta(originDayKey, targetKey);
      onMoveDraft({
        date: shiftDayKey(pendingCreate.date, shift),
        endDate: shiftDayKey(
          pendingCreate.endDate ?? pendingCreate.date,
          shift,
        ),
      });
    },
    onError: eventActions.onNotice,
  });

  /**
   * The pill's range, whether it is being dragged out right now or already
   * belongs to an open draft.
   *
   * The live drag draws the same pill rather than tinting the cells it crosses:
   * the time grid paints the block you are about to create while you drag it, and
   * a month cell should answer the gesture with the thing it will produce too.
   */
  const draftRange = useMemo(() => {
    if (range) {
      const [first, second] = [range.fromKey, range.toKey];
      return first <= second
        ? { from: first, live: true, to: second }
        : { from: second, live: true, to: first };
    }
    if (!pendingCreate) return undefined;
    // While the pill is being dragged it follows the pointer, before anything
    // is written back to the intent.
    const shift = draftDrag
      ? dayDelta(draftDrag.originDayKey, draftDrag.dayKey)
      : 0;
    const from = shiftDayKey(pendingCreate.date, shift);
    const to = shiftDayKey(pendingCreate.endDate ?? pendingCreate.date, shift);
    return from <= to
      ? { from, live: false, to }
      : { from: to, live: false, to: from };
  }, [draftDrag, pendingCreate, range]);

  const { begin: beginMonthDrag, drag } = useMonthDrag({
    onCommit: async ({ dayKey: targetKey, event, originDayKey }) => {
      await onMoveEventToDate?.({ dayKey: targetKey, event, originDayKey });
    },
    onError: eventActions.onNotice,
  });
  /**
   * Where the dragged event would land, as a day range — derived the way
   * draftRange derives the pill's, so a move previews across the days it takes
   * instead of collapsing into the cell under the pointer.
   *
   * A timed event lives on its start day whatever hours it spans, because that
   * is the only cell segmentEventsByDay gives it, so it is the only cell to
   * preview.
   */
  const previewRange = useMemo(
    () =>
      drag
        ? movePreviewRange(
            drag.event.isAllDay
              ? eventDayKeys(drag.event)
              : [drag.originDayKey],
            dayDelta(drag.originDayKey, drag.dayKey),
          )
        : undefined,
    [drag],
  );
  const days = useMemo(
    () => providedDays ?? getMonthGrid(anchor, weekStartsOn),
    [anchor, providedDays, weekStartsOn],
  );
  const weekdayLabels = getWeekdayLabels(weekStartsOn);
  const rows = Math.max(1, Math.round(days.length / 7));
  const weeks = useMemo(
    () =>
      Array.from({ length: rows }, (_, weekIndex) =>
        days.slice(weekIndex * 7, weekIndex * 7 + 7),
      ),
    [days, rows],
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const dragPreviewColor = drag
    ? (calendarsById.get(eventHomeCalendarId(drag.event) ?? "")?.color ??
      drag.event.color)
    : "transparent";
  const todayKey = toDateKey(new Date());
  const initialFocusIndex = Math.max(
    0,
    days.findIndex((day) => toDateKey(day) === toDateKey(anchor)),
  );
  const [focusedIndex, setFocusedIndex] = useState(initialFocusIndex);
  const [eventCapacity, setEventCapacity] = useState(
    DEFAULT_EVENT_CAPACITY,
  );
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;

    function syncEventCapacity() {
      if (!grid) return;
      const nextCapacity = eventCapacityForGrid(grid, rows);
      setEventCapacity((current) =>
        current === nextCapacity ? current : nextCapacity,
      );
    }

    syncEventCapacity();
    const observer = new ResizeObserver(syncEventCapacity);
    observer.observe(grid);
    return () => observer.disconnect();
    // Row count changes the height each row gets, and with it how many chips
    // fit before "+N more" — a multi-week page re-measures when it grows.
  }, [rows]);

  function focusCell(index: number) {
    const bounded = Math.min(days.length - 1, Math.max(0, index));
    setFocusedIndex(bounded);
    requestAnimationFrame(() => cellRefs.current[bounded]?.focus());
  }

  function handleGridKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
  ) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const moves: Partial<Record<string, number>> = {
      ArrowDown: 7,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
    };
    const move = moves[event.key];

    if (move !== undefined) {
      event.preventDefault();
      const next = index + move;

      if (next < 0) {
        onMonthChange(-1);
      } else if (next >= days.length) {
        onMonthChange(1);
      } else {
        focusCell(next);
      }
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusCell(index - (index % 7));
    } else if (event.key === "End") {
      event.preventDefault();
      focusCell(index + (6 - (index % 7)));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      onMonthChange(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      onMonthChange(1);
    } else if (onCreateAtDate && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onCreateAtDate(toDateKey(days[index]!), event.currentTarget);
    }
  }

  return (
    <div
      className={styles.monthView}
      data-event-capacity={eventCapacity}
      role="grid"
      aria-label={gridLabel ?? `${anchor.toLocaleDateString("en", {
        month: "long",
        year: "numeric",
      })} calendar`}
    >
      <div className={styles.weekdayRow} role="row">
        {weekdayLabels.map((weekday) => (
          <div className={styles.weekday} role="columnheader" key={weekday}>
            {weekday}
          </div>
        ))}
      </div>
      <div
        className={styles.monthGrid}
        ref={gridRef}
        role="rowgroup"
        style={
          {
            "--month-rows": rows,
            ...(rowMinHeight ? { "--month-row-min": rowMinHeight } : {}),
          } as CSSProperties
        }
      >
        {weeks.map((week, weekIndex) => {
          const weekFrom = toDateKey(week[0]!);
          const weekTo = toDateKey(week[week.length - 1]!);
          // A range in play reserves a line in every cell of the rows it
          // touches, not only the ones it covers: an all-day event is one block
          // per cell, so a cell that did not step aside would break the bar it
          // carries a day short of the range.
          // ponytail: the reserved line is not charged against eventCapacity —
          // a full cell shows a sliver past its clip for the length of the
          // gesture. Charging it would fold a chip into "+N more" mid-drag and
          // put a hole in the very bar this is here to keep whole.
          const rowHits = (from: string, to: string) =>
            from <= weekTo && to >= weekFrom;
          const draftRow = Boolean(
            draftRange && rowHits(draftRange.from, draftRange.to),
          );
          // The two runs, not the span between them: a row that holds neither
          // the preview nor the ghost has nothing to step aside for.
          const previewRow = Boolean(
            previewRange &&
              (rowHits(previewRange.from, previewRange.to) ||
                rowHits(previewRange.originFrom, previewRange.originTo)),
          );
          const laneSpans = calendarLaneSpans(events, pollItems, week, true);
          const laneCount = Math.max(
            0,
            ...laneSpans.map((span) => span.lane + 1),
          );
          const visibleLaneCount = visibleLaneLimit(laneCount, eventCapacity);

          return (
          <div className={styles.monthWeek} role="row" key={weekFrom}>
            {week.map((day, dayIndex) => {
              const index = weekIndex * 7 + dayIndex;
              const dateKey = toDateKey(day);
              const dayLaneSpans = laneSpans.filter(
                (span) => span.startCol <= dayIndex && span.endCol >= dayIndex,
              );
              const inMonth =
                !dimOutsideMonth || day.getMonth() === anchor.getMonth();
              const isToday = dateKey === todayKey;
              // A hidden adjacent day keeps its cell (so the month keeps its
              // height) but shows nothing and takes no clicks.
              const muted = !inMonth && !showAdjacentDays;
              const inDraft = Boolean(
                draftRange &&
                  dateKey >= draftRange.from &&
                  dateKey <= draftRange.to,
              );
              const inPreview = Boolean(
                previewRange &&
                  dateKey >= previewRange.from &&
                  dateKey <= previewRange.to,
              );
              const dragged =
                previewRow && drag
                  ? dayLaneSpans.find(
                      (span) =>
                        span.kind === "event" && span.event.id === drag.event.id,
                    )
                  : undefined;
              const renderedSpans =
                inPreview && dragged
                  ? dayLaneSpans.filter((span) => span !== dragged)
                  : dayLaneSpans;
              const lastActiveLane = Math.max(
                -1,
                ...dayLaneSpans.map((span) => span.lane),
              );
              const visibleSlots = muted
                ? []
                : dragged
                  ? (inPreview
                      ? renderedSpans
                      : [
                          dragged,
                          ...renderedSpans.filter((span) => span !== dragged),
                        ]
                    ).slice(0, visibleLaneCount)
                  : Array.from(
                      {
                        length: Math.min(visibleLaneCount, lastActiveLane + 1),
                      },
                      (_, lane) =>
                        renderedSpans.find((span) => span.lane === lane) ?? null,
                    );
              const itemCount = dayLaneSpans.length;
              const overflow = muted
                ? 0
                : dayLaneSpans.filter((span) => span.lane >= visibleLaneCount)
                    .length;

              return (
                <div
                  className={`${styles.dayCell} ${
                    inMonth ? "" : styles.dayOutside
                  } ${isToday ? styles.dayToday : ""}`}
                  key={dateKey}
                  ref={(node) => {
                    cellRefs.current[index] = node;
                  }}
                  data-drop-target={
                    drag && drag.dayKey === dateKey ? "" : undefined
                  }
                  onPointerDown={(pointerEvent) => {
                    if (
                      muted ||
                      !onCreateAtDate ||
                      pointerEvent.button !== 0 ||
                      (pointerEvent.target instanceof Element &&
                        pointerEvent.target.closest("button"))
                    ) {
                      return;
                    }
                    // A new gesture replaces the old draft from its first
                    // press, not on release: leaving the previous popover open
                    // over a range being dragged reads as two pending events.
                    onCancelDraft?.();
                    beginRangeCreate({
                      cell: pointerEvent.currentTarget,
                      dayKey: dateKey,
                      pointerId: pointerEvent.pointerId,
                      pointerType: pointerEvent.pointerType,
                      time: pointerEvent.timeStamp,
                      x: pointerEvent.clientX,
                      y: pointerEvent.clientY,
                    });
                  }}
                  role="gridcell"
                  aria-label={
                    muted
                      ? getLongDateLabel(day)
                      : `${getLongDateLabel(day)}, ${itemCount} ${
                          itemCount === 1
                            ? "calendar item"
                            : "calendar items"
                        }`
                  }
                  tabIndex={focusedIndex === index ? 0 : -1}
                  data-day-key={dateKey}
                  onClick={(event) => {
                    // A drag already opened quick create for its range.
                    if (muted || consumeClick() || dismissGuard.consumeDismiss())
                      return;
                    onCreateAtDate?.(dateKey, event.currentTarget);
                  }}
                  onFocus={() => setFocusedIndex(index)}
                  onKeyDown={(event) => handleGridKeyDown(event, index)}
                >
                  <div className={styles.dayHeader}>
                    {muted ? null : (
                      <span className={styles.dayNumber}>{day.getDate()}</span>
                    )}
                    {isToday ? (
                      <span className={styles.todayLabel}>Today</span>
                    ) : null}
                  </div>
                  <div className={styles.dayEvents}>
                    {/* The draft, as one pill across the range it covers: a
                        month cell has no time axis, so this reads like the
                        all-day event it will become. Grabbing it moves the whole
                        range. It stays aria-hidden — the popover's own date
                        fields are the keyboard path to the same change. */}
                    {inDraft && draftRange ? (
                      <div
                        aria-hidden="true"
                        className={styles.dayDraft}
                        data-continues-after={
                          dateKey < draftRange.to && dayIndex < 6
                            ? ""
                            : undefined
                        }
                        data-continues-before={
                          dateKey > draftRange.from && dayIndex > 0
                            ? ""
                            : undefined
                        }
                        data-draft={
                          !draftRange.live && onMoveDraft ? "" : undefined
                        }
                        data-dragging={draftDrag ? "" : undefined}
                        // Nothing to grab while it is still being dragged out —
                        // the cell under it owns that gesture.
                        data-live={draftRange.live ? "" : undefined}
                        style={
                          pendingCreate?.color
                            ? ({
                                "--draft-accent": pendingCreate.color,
                              } as CSSProperties)
                            : undefined
                        }
                        onPointerDown={
                          draftRange.live
                            ? undefined
                            : (pointerEvent) => {
                                if (!onMoveDraft || pointerEvent.button !== 0) {
                                  return;
                                }
                                pointerEvent.stopPropagation();
                                beginDraftDrag({
                                  event: undefined,
                                  originDayKey: dateKey,
                                  pointerId: pointerEvent.pointerId,
                                  x: pointerEvent.clientX,
                                  y: pointerEvent.clientY,
                                });
                              }
                        }
                      >
                        {dateKey === draftRange.from || dayIndex === 0
                          ? "New event"
                          : ""}
                      </div>
                    ) : draftRow && !muted ? (
                      <div aria-hidden="true" className={styles.daySlot} />
                    ) : null}
                    {/* The dragged event across the days it would land on, drawn
                        the way the draft draws a range — one block per cell,
                        broken only at the week edge — but in the event's own
                        colour and shape, because this is a move and not a new
                        event. It sits on the line the whole row reserved, over
                        the ghost it is passing rather than pushing it down. */}
                    {inPreview && !muted && drag && previewRange ? (
                      <div
                        aria-hidden="true"
                        className={`${styles.eventChip} ${
                          drag.event.isAllDay ? styles.eventChipAllDay : ""
                        } ${
                          dateKey > previewRange.from && dayIndex > 0
                            ? styles.eventChipContinuesBefore
                            : ""
                        } ${
                          dateKey < previewRange.to && dayIndex < 6
                            ? styles.eventChipContinuesAfter
                            : ""
                        } ${
                          dateKey > previewRange.from &&
                          dayIndex > 0 &&
                          dateKey < previewRange.to &&
                          dayIndex < 6
                            ? styles.eventChipContinuesBoth
                            : ""
                        } ${styles.dragPreviewChip}`}
                        data-drag-preview=""
                        style={
                          {
                            "--event-color": dragPreviewColor,
                            "--event-foreground":
                              getReadableEventTextColor(dragPreviewColor),
                          } as CSSProperties
                        }
                      >
                        {!drag.event.isAllDay ? (
                          <span className={styles.eventTime}>
                            {
                              getEventRangeLabel(drag.event, timeFormat).split(
                                " ",
                              )[0]
                            }
                          </span>
                        ) : null}
                        <span className={styles.eventTitle}>
                          {dateKey > previewRange.from && dayIndex > 0
                            ? ""
                            : drag.event.title}
                        </span>
                      </div>
                    ) : dragged || muted ? null : previewRow ? (
                      <div aria-hidden="true" className={styles.daySlot} />
                    ) : null}
                    {visibleSlots.map((span, lane) => {
                      if (!span) {
                        return (
                          <div
                            aria-hidden="true"
                            className={styles.daySlot}
                            key={`lane:${lane}`}
                          />
                        );
                      }
                      if (span.kind === "poll") {
                        const item = span.items.find(
                          (candidate) => candidate.date === dateKey,
                        );
                        return item && onOpenPoll ? (
                          <PollCalendarChip
                            className={`${styles.eventChip} ${styles.eventChipAllDay}`}
                            continuesAfter={dayIndex < span.endCol}
                            continuesBefore={dayIndex > span.startCol}
                            item={item}
                            key={span.id}
                            onOpen={onOpenPoll}
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className={styles.daySlot}
                            key={`lane:${lane}`}
                          />
                        );
                      }
                      const event = span.event;
                      const labelColumn = Array.from(
                        { length: span.endCol - span.startCol + 1 },
                        (_, offset) => span.startCol + offset,
                      ).find((column) => {
                        const labelDay = week[column];
                        return Boolean(
                          labelDay &&
                            (showAdjacentDays ||
                              !dimOutsideMonth ||
                              labelDay.getMonth() === anchor.getMonth()),
                        );
                      });
                      return (
                        <EventPopover
                          calendar={calendarsById.get(
                            eventHomeCalendarId(event) ?? "",
                          )}
                          calendars={calendars}
                          continuesAfter={event.isAllDay && dayIndex < span.endCol}
                          continuesBefore={event.isAllDay && dayIndex > span.startCol}
                          ghost={drag?.event.id === event.id}
                          event={event}
                          pending={
                            busyEventId !== undefined &&
                            (event.id === busyEventId ||
                              event.id.startsWith(`${busyEventId}_`))
                          }
                          key={span.id}
                          onBeginDrag={
                            onMoveEventToDate &&
                            canEditEvent(
                              eventActions.getEventMaster(event),
                              calendars,
                            )
                              ? (pointerEvent) => {
                                  if (pointerEvent.button !== 0) return;
                                  beginMonthDrag({
                                    event,
                                    originDayKey: dateKey,
                                    pointerId: pointerEvent.pointerId,
                                    x: pointerEvent.clientX,
                                    y: pointerEvent.clientY,
                                  });
                                }
                              : undefined
                          }
                          showLabel={dayIndex === (labelColumn ?? span.startCol)}
                          timeFormat={timeFormat}
                          weekStartsOn={weekStartsOn}
                          {...eventActions}
                        />
                      );
                    })}
                    {overflow > 0 ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className={styles.moreEvents}
                            type="button"
                            onClick={(event) => event.stopPropagation()}
                          >
                            +{overflow} more
                          </button>
                        </PopoverTrigger>
                          <PopoverContent
                            align="center"
                            aria-label={`${getLongDateLabel(day)} events`}
                            className={styles.monthOverflowPopover}
                            collisionPadding={12}
                            role="dialog"
                            side="bottom"
                            sideOffset={8}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <div className={styles.monthOverflowHeader}>
                              <h2>{getLongDateLabel(day)}</h2>
                              <p>
                                {itemCount}{" "}
                                {itemCount === 1
                                  ? "calendar item"
                                  : "calendar items"}
                              </p>
                            </div>
                            <div className={styles.monthOverflowList}>
                              {dayLaneSpans.flatMap((span) => {
                                if (span.kind === "poll") {
                                  const item = span.items.find(
                                    (candidate) => candidate.date === dateKey,
                                  );
                                  return item && onOpenPoll
                                    ? [
                                        <PollCalendarChip
                                          className={`${styles.eventChip} ${styles.eventChipAllDay}`}
                                          item={item}
                                          key={span.id}
                                          onOpen={onOpenPoll}
                                        />,
                                      ]
                                    : [];
                                }
                                return [
                                  <EventPopover
                                    calendar={calendarsById.get(
                                      eventHomeCalendarId(span.event) ?? "",
                                    )}
                                    calendars={calendars}
                                    event={span.event}
                                    key={span.id}
                                    pending={
                                      busyEventId !== undefined &&
                                      (span.event.id === busyEventId ||
                                        span.event.id.startsWith(
                                          `${busyEventId}_`,
                                        ))
                                    }
                                    showLabel
                                    timeFormat={timeFormat}
                                    weekStartsOn={weekStartsOn}
                                    {...eventActions}
                                  />,
                                ];
                              })}
                            </div>
                          </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          );
        })}
      </div>
    </div>
  );
}
