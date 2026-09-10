import { buildDayAxis, singleDayAxis, sharedWeekAxis, coordinateToInstant, coordinateBoundaryInstant, instantToCoordinate, intervalAxisSegments, civilCandidates, utcOffsetLabel, type TimeAxis } from "../day-axis";
import { availabilityDaySegments, type GridAvailabilityInterval } from "../availability-grid";
import { DEFAULT_CALENDAR_COLOR, type Calendar, type Event, type Settings } from "@musubi/types";
import {
	addDays,
	assignOverlapColumns,
	dayKey,
	type getDaySegments,
	isSameDay,
	startOfDay,
} from "@musubi/calendar/layout";
import {
	type CSSProperties,
	type KeyboardEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { calendarLaneSpans, visibleLaneLimit } from "../all-day-lanes";
import { getEventDateLabel, getEventRangeLabel } from "../calendar-math";
import { Popover, PopoverContent, PopoverTrigger } from "~/ui/Popover";
import { useLayerDismissGuard } from "../layer-focus";
import { getReadableEventTextColor } from "../event-color";
import {
	durationToHeight,
	minutesToY,
	yToMinutes,
	type TimeGeometry,
} from "../time-geometry";
import { canEditEvent, eventHomeCalendarId } from "../event-permissions";
import { EventMarks } from "./EventMarks";
import {
	nextAxisDragTimes,
	type DragMode,
	type DragTimes,
} from "../time-grid-drag";
import {
	useDragToCreate,
	useTimeGridDrag,
	type BeginDragInput,
} from "../use-time-grid-drag";
import {
	getTimeGridDays,
	axisOpenScroll,
	holeSegments,
	overlapPlacement,
	type TimeGridViewId,
} from "../time-grid-math";
import {
	EventDetailsPopover,
	type EventActionHandlers,
} from "./EventDetailsPopover";
import { EventPopover } from "./EventPopover";
import styles from "./workspace.module.css";

const ALL_DAY_LANES = 3;
const longWeekdayFormatter = new Intl.DateTimeFormat("en", {
	weekday: "long",
});
const shortWeekdayFormatter = new Intl.DateTimeFormat("en", {
	weekday: "short",
});
const hour12Formatter = new Intl.DateTimeFormat("en", {
	hour: "numeric",
	hour12: true,
});
const timeZoneFormatter = new Intl.DateTimeFormat("en", {
	timeZoneName: "shortOffset",
});

type TimeGridViewProps = EventActionHandlers & {
  availabilityIntervals?: GridAvailabilityInterval[];
	anchor: Date;
	/** The event a write is in flight for, so its block can say so. */
	busyEventId?: string;
	calendars: Calendar[];
	events: Event[];
	geometry: TimeGeometry;
	/**
	 * Commit a drag or resize. Absent (or returning without moving) leaves the
	 * grid read-only for direct manipulation.
	 */
	onMoveEvent?: (input: {
		dayOffset: number;
		end: Date;
		event: Event;
		start: Date;
	}) => Promise<unknown>;
	/**
	 * The slot a quick-create popover is currently open for. The selection stays
	 * visible for as long as the popover is, so the interval being described never
	 * disappears out from under it.
	 */
	/** Drops the draft the open quick create describes, before a new one starts. */
	onCancelDraft?: () => void;
	pendingCreate?: {
		exactRange?: { start: Date; end: Date };
		color?: string;
		date: string;
		endTime?: string;
		startTime?: string;
	};
	/**
	 * Move or resize the draft a drag-to-create laid down, while its popover is
	 * open. Absent leaves the draft as a still highlight.
	 */
	onMoveDraft?: (input: {
		exactRange?: { start: Date; end: Date };
		date: string;
		endTime: string;
		startTime: string;
	}) => void;
	/** Page presentation: a five-column working week when false. */
	showWeekend?: boolean;
	onCreateAtTime?: (
		date: string,
		time: string,
		anchor: { returnFocus: HTMLElement; x: number; y: number },
		/** Present when the interval was dragged rather than clicked. */
		endTime?: string,
		exactRange?: { start: Date; end: Date },
	) => void;
	timeFormat: Settings["timeFormat"];
	view: TimeGridViewId;
	weekStartsOn: Settings["weekStartsOn"];
};

type TimelineEventProps = EventActionHandlers & {
	calendar: Calendar | undefined;
	calendars: Calendar[];
	dayIndex: number;
	daySegment: ReturnType<typeof getDaySegments<Event>>[number];
	detailBoundary: HTMLElement | null;
	detailInsideTrigger: boolean;
	/** Live times while this event is being dragged, else undefined. */
	dragTimes?: DragTimes;
	/**
	 * This event is being moved somewhere else: what stays here is the shape it
	 * would leave behind, so the origin is still legible while it travels.
	 */
	ghost?: boolean;
	/** A write for this event is in flight. */
	pending?: boolean;
	draggable: boolean;
	geometry: TimeGeometry;
	axis: TimeAxis;
	onBeginDrag: (input: BeginDragInput) => void;
	onKeyboardAdjust: (event: Event, times: DragTimes) => void;
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
};

function hourLabel(hour: number, timeFormat: Settings["timeFormat"]) {
	if (timeFormat === "24h") {
		return `${String(hour).padStart(2, "0")}:00`;
	}

	return hour12Formatter.format(new Date(2026, 0, 1, hour));
}

/** `HH:MM` back to a minute of the day. */
function clockMinutes(value: string): number {
	const [hour, minute] = value.split(":");
	return Number(hour ?? 0) * 60 + Number(minute ?? 0);
}

function clockAt(axis: TimeAxis, column: number, coordinate: number, edge: "start" | "end" = "start") {
  const instant = coordinateBoundaryInstant(axis, column, coordinate, edge);
  if (instant === null) return "";
  return civilClock(new Date(instant));
}
function civilClock(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function realRunHeight(axis: TimeAxis, column: number, start: number, geometry: TimeGeometry) {
  let end = Math.floor(start);
  while (end < axis.rows.length && axis.columns[column]?.[end]) end++;
  return Math.max(0, end - start) * geometry.pxPerMinute;
}
function previewPieces(axis: TimeAxis, column: number, times: DragTimes) {
  const start = times.exactRange?.start.getTime() ?? coordinateToInstant(axis, column, times.startMinutes);
  const end = times.exactRange?.end.getTime() ?? coordinateBoundaryInstant(axis, column, times.endMinutes, "end");
  return start === null || end === null ? [] : intervalAxisSegments(axis, column, start, end);
}
function axisTimeLabel(axis: TimeAxis, column: number, coordinate: number, format: Settings["timeFormat"], edge: "start" | "end" = "start") {
  const instant = coordinateBoundaryInstant(axis, column, coordinate, edge);
  if (instant === null) return "";
  const date = new Date(instant);
  const value = axis.columns[column]?.[Math.min(axis.rows.length - 1, Math.floor(coordinate))];
  const label = minuteLabel(date.getHours() * 60 + date.getMinutes(), format);
  return value && civilCandidates(axis.days[column]!, value.minute).length > 1 ? `${label} ${utcOffsetLabel(value.offsetMinutes)} ${value.fold ? "second" : "first"}` : label;
}
function tickLabel(axis: TimeAxis, coordinate: number, timeFormat: Settings["timeFormat"]) {
  const row = axis.rows[coordinate]!;
  const repeated = axis.rows.some(other => other.minute === row.minute && other.fold !== row.fold);
  const time = row.minute % 60 === 0 ? hourLabel(row.minute / 60, timeFormat) : minuteLabel(row.minute, timeFormat);
  if (!repeated) return time;
  const value = axis.columns.map(column => column[coordinate]).find(Boolean)!;
  return `${time} ${utcOffsetLabel(value.offsetMinutes)} ${row.fold === 0 ? "first" : "second"}`;
}

/** A minute of the day as a clock time, for live drag feedback. */
function minuteLabel(
	minutes: number,
	timeFormat: Settings["timeFormat"],
): string {
	const hour = Math.floor(minutes / 60) % 24;
	const minute = Math.floor(minutes % 60);

	if (timeFormat === "12h") {
		return new Intl.DateTimeFormat("en", {
			hour: "numeric",
			hour12: true,
			minute: "2-digit",
		}).format(new Date(2026, 0, 1, hour, minute));
	}
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeZoneLabel(date: Date) {
	return (
		timeZoneFormatter
			.formatToParts(date)
			.find((part) => part.type === "timeZoneName")?.value ?? "Local"
	);
}

const TimelineEvent = memo(function TimelineEvent({
	axis,
	calendar,
	calendars,
	dayIndex,
	daySegment,
	detailBoundary,
	detailInsideTrigger,
	dragTimes,
	draggable,
	geometry,
	ghost = false,
	onBeginDrag,
	pending = false,
	onKeyboardAdjust,
	timeFormat,
	weekStartsOn,
	...eventActions
}: TimelineEventProps) {
	const { col, cols, event } = daySegment;
	const editable = canEditEvent(eventActions.getEventMaster(event), calendars);
	// While dragging, the block follows the ghost times rather than the data.
	const startMin = dragTimes?.startMinutes ?? daySegment.startMin;
  const endMin = dragTimes?.endMinutes ?? daySegment.endMin;
	const eventColor = calendar?.color ?? event.color;
	const renderStart = (dragTimes?.exactRange?.start ?? event.start).getTime();
  const renderEnd = (dragTimes?.exactRange?.end ?? event.end).getTime();
  const pieces = intervalAxisSegments(axis, dayIndex, renderStart, Math.max(renderEnd, renderStart + 60_000));
  function pieceHeight(piece: { start: number; end: number }) {
    return Math.min(realRunHeight(axis, dayIndex, piece.start, geometry), Math.max(pieces.length > 1 ? (piece.end - piece.start) * geometry.pxPerMinute - 2 : durationToHeight(piece.end - piece.start, geometry) - 2, pieces.length > 1 ? 1 : geometry.minEventHeight));
  }
  const lastPiece = pieces.at(-1);
  const actionHeight = lastPiece ? (lastPiece.start - pieces[0]!.start) * geometry.pxPerMinute + pieceHeight(lastPiece) : 0;


	/**
	 * Keyboard equivalent of dragging (docs/ui/calendar-ui.md R10): Alt+Up/Down
	 * moves by one snap interval, adding Shift changes the length instead. Without
	 * this, direct manipulation would be mouse-only.
	 */
	function handleKeyDown(keyEvent: ReactKeyboardEvent<HTMLElement>) {
		if (!draggable || !keyEvent.altKey) return;
		if (keyEvent.key !== "ArrowUp" && keyEvent.key !== "ArrowDown") return;

		keyEvent.preventDefault();
		keyEvent.stopPropagation();
		if (keyEvent.shiftKey && event.end.getTime() > axis.days[dayIndex]!.end) { eventActions.onNotice("Resize this event from its final day."); return; }
		const step = (keyEvent.key === "ArrowDown" ? 1 : -1) * geometry.snapMinutes;
		const times = nextAxisDragTimes({
			axis, originDayIndex: dayIndex, dayIndex, exactRange: { start: event.start, end: event.end },
			deltaMinutes: step,
			geometry,
			mode: keyEvent.shiftKey ? "resize-end" : "move",
			originEndMinutes: daySegment.endMin,
			originStartMinutes: daySegment.startMin,
		});

		if (!times) { eventActions.onNotice("No local time at that position. The event was not changed."); return; }
		if (
			times.startMinutes === daySegment.startMin &&
			times.endMinutes === daySegment.endMin
		) {
			return;
		}
		onKeyboardAdjust(event, times);
	}

	function startDrag(
		pointerEvent: ReactPointerEvent<HTMLElement>,
		mode: DragMode,
	) {
		// Only the primary button, and only where a move is actually allowed.
		if (!draggable || pointerEvent.button !== 0) return;
		onBeginDrag({
			dayIndex,
			exactRange: { start: event.start, end: event.end },
			endMinutes: daySegment.endMin,
			event,
			mode,
			pointerId: pointerEvent.pointerId,
			startMinutes: daySegment.startMin,
			x: pointerEvent.clientX,
			y: pointerEvent.clientY,
		});
	}
	// One placement rule for Day and Week: a column is a column, and the reason a
	// block is narrow is that something overlaps it, not which view you are in.
	//
	// While it is being dragged it takes the whole column, the way Google's does:
	// the block you are holding is the one you need to read, and its lane is about
	// to change anyway. Dropping it puts it back in whatever lane it lands in.
	const { left, width } = dragTimes
		? overlapPlacement(0, 1)
		: overlapPlacement(col, cols);

	return (
		<EventDetailsPopover
			anchorInsideTrigger={detailInsideTrigger}
			calendar={calendar}
			calendars={calendars}
			collisionBoundary={detailBoundary}
			event={event}
			timeFormat={timeFormat}
			weekStartsOn={weekStartsOn}
			{...eventActions}
		>
			<button
				className={styles.timelineEventAction}
        style={{ left, width, top: minutesToY(pieces[0]?.start ?? startMin, geometry), height: actionHeight }}
				type="button"
				aria-label={`${event.title}, ${getEventDateLabel(
					event,
				 )}, ${getEventRangeLabel(event, timeFormat)}, ${axisTimeLabel(axis, dayIndex, daySegment.startMin, timeFormat)}, ${calendar?.name ?? "calendar"}`}
				aria-busy={pending || undefined}
				data-dragging={dragTimes ? "" : undefined}
				data-ghost={ghost ? "" : undefined}
				data-draggable={draggable ? "" : undefined}
				data-pending={pending ? "" : undefined}
				data-overlapping={col > 0 ? "" : undefined}
				data-readonly={editable ? undefined : ""}
				data-time-event={event.id}
				onKeyDown={handleKeyDown}
				onPointerDown={(pointerEvent) => startDrag(pointerEvent, "move")}
			>
			{pieces.map((piece, pieceIndex) => (
			<span className={styles.timelineEvent} data-linked-segment={pieces.length > 1 ? "" : undefined} data-draggable={draggable ? "" : undefined} data-pending={pending ? "" : undefined} data-overlapping={col > 0 ? "" : undefined} key={piece.start}
				style={
					{
						"--event-color": eventColor,
            padding: realRunHeight(axis, dayIndex, piece.start, geometry) < 12 ? 0 : undefined,
						// A ghost is drawn as an outline over the page, not as a filled
						// block, so the event's own foreground would be white on a 18%
						// tint. Ink is what stays readable there.
						"--event-foreground": ghost
							? "var(--text-secondary)"
							: getReadableEventTextColor(eventColor),
						height: `${pieceHeight(piece)}px`,
						left: 0,
						top: `${((piece.start - (pieces[0]?.start ?? startMin)) * geometry.pxPerMinute)}px`,
						width: "100%",
						zIndex: col + 1,
					} as CSSProperties
				}
			>
				{/* What fits is the block's own business: the rows below are all
            rendered and the container queries in CSS drop them as the box gets
            shorter. A JS threshold on duration would disagree with the box the
            moment density or zoom changed it. */}
				<span className={styles.timelineEventTime}>
					{/* While dragging, show the time the drop would produce — the
              answer the user is actually looking for. */}
					{dragTimes
						? `${axisTimeLabel(axis, dayIndex, startMin, timeFormat)}–${axisTimeLabel(axis, dayIndex, endMin, timeFormat, "end")}`
						: getEventRangeLabel(event, timeFormat).replace(" – ", "–")}
				</span>
				<span className={styles.timelineEventTitle}>
					{event.title}
					<EventMarks event={event} readOnly={!editable} />
				</span>
				{event.location ? (
					<span className={styles.timelineEventMeta}>{event.location}</span>
				) : null}
				{draggable ? (
					<>
						{/* Resize has its own handles and its own state, so a move can
                never be mistaken for a length change. */}
						<span
							aria-hidden="true"
							className={styles.resizeHandleTop}
							hidden={pieceIndex !== 0 || (dragTimes?.exactRange?.start ?? event.start).getTime() < axis.days[dayIndex]!.start}
							onPointerDown={(pointerEvent) => {
								pointerEvent.stopPropagation();
								startDrag(pointerEvent, "resize-start");
							}}
						/>
						<span
							aria-hidden="true"
							className={styles.resizeHandleBottom}
							hidden={pieceIndex !== pieces.length - 1 || (dragTimes?.exactRange?.end ?? event.end).getTime() > axis.days[dayIndex]!.end}
							onPointerDown={(pointerEvent) => {
								pointerEvent.stopPropagation();
								startDrag(pointerEvent, "resize-end");
							}}
						/>
					</>
				) : null}
			</span>
			))}
			</button>
		</EventDetailsPopover>
	);
});

export function TimeGridView({
  availabilityIntervals = [],
	anchor,
	calendars,
	events,
	geometry: baseGeometry,
	onCancelDraft,
	onCreateAtTime,
	onMoveEvent,
	busyEventId,
	onMoveDraft,
	pendingCreate,
	showWeekend = true,
	timeFormat,
	view,
	weekStartsOn,
	...eventActions
}: TimeGridViewProps) {
	const days = useMemo(
		() =>
			getTimeGridDays(anchor, view, weekStartsOn, {
				includeWeekend: showWeekend,
			}),
		[anchor, showWeekend, view, weekStartsOn],
	);
	const axis = useMemo(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const axes = days.map(day => buildDayAxis(dayKey(day), timezone));
    return view === "day" ? singleDayAxis(axes[0]!) : sharedWeekAxis(axes);
  }, [days, view]);
  const geometry = useMemo(() => ({ ...baseGeometry, visibleDayEndMinutes: axis.rows.length }), [baseGeometry, axis]);
  const ticks = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of axis.rows) counts.set(row.minute, (counts.get(row.minute) ?? 0) + 1);
    return axis.rows.flatMap((row, coordinate) => row.minute % 60 === 0 || coordinate === 0 || axis.rows[coordinate - 1]!.minute !== row.minute - 1 || ((counts.get(row.minute) ?? 0) > 1 && (counts.get(row.minute - 1) ?? 0) < 2) ? [{ row, coordinate }] : []);
  }, [axis]);
  const segmentsByDay = useMemo(() => days.map((day, column) => {
    const eventSegments = assignOverlapColumns(events.filter(event => !event.isAllDay).flatMap(event => {
      const pieces = intervalAxisSegments(axis, column, event.start.getTime(), Math.max(event.end.getTime(), event.start.getTime() + 60_000));
      return pieces.length ? [{ event, kind: "event" as const, startMin: pieces[0]!.start, endMin: pieces.at(-1)!.end, col: 0, cols: 1 }] : [];
    }));
    return [...eventSegments, ...assignOverlapColumns(availabilityDaySegments(availabilityIntervals, day, axis, column))];
  }), [days, axis, events, availabilityIntervals]);
	const calendarsById = useMemo(
		() => new Map(calendars.map((calendar) => [calendar.id, calendar])),
		[calendars],
	);
	const allDaySpans = useMemo(
		() => calendarLaneSpans(events, days),
		[days, events],
	);
	const allDayLaneTotal = Math.max(
		0,
		...allDaySpans.map((span) => span.lane + 1),
	);
	const visibleAllDayLaneCount = visibleLaneLimit(
		allDayLaneTotal,
		ALL_DAY_LANES,
	);
	const visibleAllDaySpans = allDaySpans.filter(
		(span) => span.lane < visibleAllDayLaneCount,
	);
	const hiddenAllDaySpans = allDaySpans.filter(
		(span) => span.lane >= visibleAllDayLaneCount,
	);
	const hiddenAllDayCount = hiddenAllDaySpans.length;
	const allDayLaneCount = Math.max(1, Math.min(allDayLaneTotal, ALL_DAY_LANES));
	const [now, setNow] = useState(() => new Date());
	const hasToday = days.some((day) => isSameDay(day, now));
	const dayMode = view === "day";
	const [detailBoundary, setDetailBoundary] = useState<HTMLElement | null>(null);
	const dismissGuard = useLayerDismissGuard();
	const rootRef = useRef<HTMLElement>(null);
	const availabilityPress = useRef(false);
  const [keyboardSlot, setKeyboardSlot] = useState<{ dayIndex: number; coordinate: number } | null>(null);
	const setRoot = useCallback((element: HTMLElement | null) => {
		rootRef.current = element;
		setDetailBoundary(element?.parentElement ?? null);
	}, []);
	const canvasRef = useRef<HTMLDivElement>(null);
	// Last applied geometry, so a density change can rescale scroll instead of
	// resetting it.
	const geometryRef = useRef(geometry);

	const readColumns = useCallback(() => {
		const bounds = canvasRef.current?.getBoundingClientRect();
		// The time gutter is part of the canvas but is not a day column.
		const gutter = bounds ? Math.min(64, bounds.width) : 0;
		const width = bounds ? (bounds.width - gutter) / days.length : 0;
		return {
			count: days.length,
			left: (bounds?.left ?? 0) + gutter,
			width,
		};
	}, [days.length]);

	const { begin: beginDrag, drag } = useTimeGridDrag({
		axis,
		columns: readColumns,
		geometry,
		onCommit: async ({ dayOffset, event, times }) => {
			if (!onMoveEvent) return;
			const day = addDays(startOfDay(event.start), dayOffset);
			await onMoveEvent({
				dayOffset,
				end: times.exactRange?.end ?? new Date(day.getTime() + times.endMinutes * 60_000),
				event,
				start: times.exactRange?.start ?? new Date(day.getTime() + times.startMinutes * 60_000),
			});
		},
		onError: eventActions.onNotice,
		scrollRoot: () => rootRef.current?.parentElement,
	});

	/**
	 * Apply a keyboard nudge. Announced through the notice live region, because a
	 * screen-reader user gets no visual confirmation from the block moving.
	 */
	async function adjustByKeyboard(event: Event, times: DragTimes) {
		if (!onMoveEvent) return;
		const day = startOfDay(event.start);
		try {
			await onMoveEvent({
				dayOffset: 0,
				end: times.exactRange?.end ?? new Date(day.getTime() + times.endMinutes * 60_000),
				event,
				start: times.exactRange?.start ?? new Date(day.getTime() + times.startMinutes * 60_000),
			});
			eventActions.onNotice(
				`${event.title} now ${axisTimeLabel(axis, days.findIndex(value => dayKey(value) === dayKey(day)), times.startMinutes, timeFormat)}–${axisTimeLabel(axis, days.findIndex(value => dayKey(value) === dayKey(day)), times.endMinutes, timeFormat, "end")}.`,
			);
		} catch (error) {
			eventActions.onNotice(
				error instanceof Error
					? error.message
					: "That change could not be saved. The original time was restored.",
				{ tone: "error" },
			);
		}
	}

	const {
		begin: beginCreateDrag,
		consumeClick,
		selection: liveSelection,
	} = useDragToCreate({
		axis,
		geometry,
		onSelected: (dragged, column) => {
			const day = days[dragged.dayIndex];
			if (!day || !onCreateAtTime) return;
			const bounds = column.getBoundingClientRect();
			onCreateAtTime(
				dayKey(day),
				clockAt(axis, dragged.dayIndex, dragged.startMinutes),
				{
					returnFocus: column,
					// The column's edge, so the popover lands beside the draft rather
					// than over it.
					x: bounds.right,
					y: bounds.top + minutesToY(dragged.startMinutes, geometry),
				},
				clockAt(axis, dragged.dayIndex, dragged.endMinutes, "end"),
				dragged.exactRange,
			);
		},
	});
	// Where the open quick-create popover's slot sits on the grid. This is the
	// draft: a laid-down block, not just a highlight.
	const draftSlot = useMemo(() => {
		if (!pendingCreate?.startTime) return undefined;

		const dayIndex = days.findIndex((day) => dayKey(day) === pendingCreate.date);
		if (dayIndex < 0) return undefined;

    const day = axis.days[dayIndex]!;
    const start = pendingCreate.exactRange?.start.getTime() ?? civilCandidates(day, clockMinutes(pendingCreate.startTime))[0]?.instant;
    if (start === undefined) return undefined;
    const end = pendingCreate.exactRange?.end.getTime() ?? (pendingCreate.endTime ? civilCandidates(day, clockMinutes(pendingCreate.endTime))[0]?.instant : start + 60 * 60_000);
    if (end === undefined || end <= start) return undefined;
    const pieces = intervalAxisSegments(axis, dayIndex, start, end);
    if (!pieces.length) return undefined;
    return { dayIndex, startMinutes: pieces[0]!.start, endMinutes: pieces.at(-1)!.end, exactRange: { start: new Date(start), end: new Date(end) } };
  }, [days, axis, pendingCreate]);

	// A second pointer machine, for the draft: same threshold, snapping,
	// auto-scroll and Escape as a real event, but it commits into the open form
	// instead of to the server.
	const { begin: beginDraftDrag, drag: draftDrag } = useTimeGridDrag<undefined>({
		axis,
		columns: readColumns,
		geometry,
		onCommit: async ({ dayOffset, mode, times }) => {
			if (!draftSlot || !onMoveDraft) return;
			const day =
				days[
					Math.max(
						0,
						Math.min(
							days.length - 1,
							draftSlot.dayIndex + (mode === "move" ? dayOffset : 0),
						),
					)
				];
			if (!day) return;
			onMoveDraft({
				date: dayKey(times.exactRange?.start ?? day),
				endTime: times.exactRange ? civilClock(times.exactRange.end) : clockAt(axis, days.indexOf(day), times.endMinutes, "end"),
				startTime: times.exactRange ? civilClock(times.exactRange.start) : clockAt(axis, days.indexOf(day), times.startMinutes),
				exactRange: times.exactRange,
			});
		},
		onError: eventActions.onNotice,
		scrollRoot: () => rootRef.current?.parentElement,
	});
	const dragPreviewColor = drag
		? (calendarsById.get(eventHomeCalendarId(drag.event) ?? "")?.color ??
			drag.event.color)
		: "transparent";

	// Three sources, in the order they win: the create gesture in progress, the
	// draft being dragged, and the draft at rest. A plain click also produces a
	// draft, so it too shows what "when" it picked.
	const selection = useMemo(() => {
		if (liveSelection) return liveSelection;
		if (draftDrag && draftSlot) {
			return {
				dayIndex:
					draftDrag.mode === "move" ? draftDrag.dayIndex : draftSlot.dayIndex,
				exactRange: draftDrag.times.exactRange,
				endMinutes: draftDrag.times.endMinutes,
				startMinutes: draftDrag.times.startMinutes,
			};
		}
		return draftSlot;
	}, [draftDrag, draftSlot, liveSelection]);

	/** Grab the draft to move it, or one of its edges to resize it. */
	function startDraftDrag(
		pointerEvent: ReactPointerEvent<HTMLElement>,
		mode: DragMode,
	) {
		if (!draftSlot || !onMoveDraft || pointerEvent.button !== 0) return;
		pointerEvent.stopPropagation();
		beginDraftDrag({
			dayIndex: draftSlot.dayIndex,
			exactRange: draftSlot.exactRange,
			endMinutes: draftSlot.endMinutes,
			event: undefined,
			mode,
			pointerId: pointerEvent.pointerId,
			startMinutes: draftSlot.startMinutes,
			x: pointerEvent.clientX,
			y: pointerEvent.clientY,
		});
	}

	const layoutStyle = {
		"--day-count": days.length,
		"--axis-height": `${axis.rows.length * geometry.pxPerMinute}px`,
		"--all-day-height": `${allDayLaneCount * 24 + 8}px`,
		// The CSS grid derives its height from the same number as the event maths.
		"--hour-height": `${geometry.hourHeight}px`,
	} as CSSProperties;

	// One effect owns where the grid is scrolled.
	//
	// Opening a range anchors near the working day rather than midnight. A density
	// change is different: it rewrites the pixel↔time mapping, so keeping the same
	// scrollTop would silently show a different hour. Then we rescale instead,
	// because the visible *time* is what the user is holding onto.
	useEffect(() => {
		const scrollRoot = rootRef.current?.parentElement;
		const previousHourHeight = geometryRef.current.hourHeight;
		geometryRef.current = geometry;

		if (!scrollRoot) return;

		scrollRoot.scrollTo?.({
			top:
				previousHourHeight === geometry.hourHeight
					? minutesToY(axisOpenScroll(axis, new Date(), hasToday), geometry) - 12
					: scrollRoot.scrollTop * (geometry.hourHeight / previousHourHeight),
		});
	}, [anchor, axis, geometry, hasToday, view, weekStartsOn]);

	useEffect(() => {
		if (!hasToday) {
			return;
		}

		const timer = window.setInterval(() => setNow(new Date()), 60_000);
		return () => window.clearInterval(timer);
	}, [hasToday]);

	function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (event.target !== event.currentTarget) {
			return;
		}

		const scrollRoot = rootRef.current?.parentElement;

		if (!scrollRoot) {
			return;
		}

		if (event.key === "ArrowDown" || event.key === "PageDown") {
			event.preventDefault();
			scrollRoot.scrollBy({
				behavior: "smooth",
				top:
					event.key === "PageDown" ? 4 * geometry.hourHeight : geometry.hourHeight,
			});
		} else if (event.key === "ArrowUp" || event.key === "PageUp") {
			event.preventDefault();
			scrollRoot.scrollBy({
				behavior: "smooth",
				top:
					event.key === "PageUp" ? -4 * geometry.hourHeight : -geometry.hourHeight,
			});
		} else if (event.key === "Home") {
			event.preventDefault();
			scrollRoot.scrollTo({ behavior: "smooth", top: 0 });
		} else if (event.key === "End") {
			event.preventDefault();
			scrollRoot.scrollTo({
				behavior: "smooth",
				top: scrollRoot.scrollHeight,
			});
		}
	}

	return (
		<section
			className={`${styles.timeGridView} ${dayMode ? styles.timeGridViewDay : ""}`}
			aria-label={`${view === "day" ? "Day" : "Week"} time grid`}
			onKeyDown={handleKeyDown}
			ref={setRoot}
			style={layoutStyle}
			tabIndex={0}
		>
			<div className={styles.timeGridSticky}>
				<div className={styles.timeGridDayHeader}>
					{/* The corner above the hour axis: this names the zone every hour on
              the axis is written in, so it belongs at the top of that axis. It
              used to be dropped 490px down the scrolling canvas, where it read
              as a label for whatever hour it happened to land between. */}
					<span className={styles.timeGridZone}>{timeZoneLabel(now)}</span>
					{days.map((day) => {
						const today = isSameDay(day, now);

						return (
							<time
								className={today ? styles.timeGridDayToday : ""}
								data-time-grid-day={dayKey(day)}
								dateTime={dayKey(day)}
								key={dayKey(day)}
							>
								<span>
									{(dayMode ? longWeekdayFormatter : shortWeekdayFormatter).format(day)}
								</span>
								<strong>{day.getDate()}</strong>
							</time>
						);
					})}
				</div>

				<div className={styles.timeGridAllDay}>
					<span className={styles.timeGridAllDayLabel}>All day</span>
					<div className={styles.timeGridAllDayTrack}>
						{visibleAllDaySpans.flatMap((span) => {
							const calendar = calendarsById.get(
								eventHomeCalendarId(span.event) ?? "",
							);
							const eventColor = calendar?.color ?? span.event.color;
							return [
								<EventDetailsPopover
									anchorInsideTrigger={dayMode}
									calendar={calendar}
									calendars={calendars}
									collisionBoundary={detailBoundary}
									event={span.event}
									key={span.id}
									side={dayMode ? "right" : "bottom"}
									timeFormat={timeFormat}
									weekStartsOn={weekStartsOn}
									{...eventActions}
								>
									<button
										className={styles.timeGridAllDayEvent}
										type="button"
										aria-label={`All-day event, ${span.event.title}, ${getEventDateLabel(
											span.event,
										)}, ${calendar?.name ?? "calendar"}`}
										data-all-day-event={span.event.id}
										style={
											{
												"--event-color": eventColor,
												"--event-foreground": getReadableEventTextColor(eventColor),
												left: `${(span.startCol / days.length) * 100}%`,
												top: `${span.lane * 24 + 4}px`,
												width: `${
													((span.endCol - span.startCol + 1) / days.length) * 100
												}%`,
											} as CSSProperties
										}
									>
										{span.event.title}
									</button>
								</EventDetailsPopover>,
							];
						})}
						{hiddenAllDayCount > 0 ? (
							<Popover>
								<PopoverTrigger asChild>
									<button
										aria-label={`${hiddenAllDayCount} more all-day ${
											hiddenAllDayCount === 1 ? "item" : "items"
										}`}
										className={styles.timeGridAllDayMore}
										style={{
											top: `${Math.max(0, allDayLaneCount - 1) * 24 + 8}px`,
										}}
										type="button"
									>
										+{hiddenAllDayCount}
									</button>
								</PopoverTrigger>
								<PopoverContent
									align="end"
									aria-label="Hidden all-day items"
									className={styles.monthOverflowPopover}
									collisionPadding={12}
									role="dialog"
									side="bottom"
									sideOffset={8}
								>
									<div className={styles.monthOverflowList}>
										{hiddenAllDaySpans.flatMap((span) => {
											return [
												<EventPopover
													calendar={calendarsById.get(eventHomeCalendarId(span.event) ?? "")}
													calendars={calendars}
													event={span.event}
													key={span.id}
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
			</div>

			<div className={styles.timeGridCanvas} ref={canvasRef}>
				{ticks.map(({ row, coordinate }) => (
					<div
						className={styles.timeGridHour}
						key={row.key}
						style={{ top: `${minutesToY(coordinate, geometry)}px` }}
					>
						{coordinate > 0 ? <span>{tickLabel(axis, coordinate, timeFormat)}</span> : null}
					</div>
				))}
				<div className={styles.timeGridColumns}>
					{days.map((day, dayIndex) => {
						const today = isSameDay(day, now);
						const nowMinutes = instantToCoordinate(axis, dayIndex, now.getTime());

						return (
							<div
								className={styles.timeGridColumn}
								data-drop-target={
									drag && drag.mode === "move" && drag.dayIndex === dayIndex
										? ""
										: undefined
								}
								data-time-grid-column={dayKey(day)}
								key={dayKey(day)}
								tabIndex={onCreateAtTime ? 0 : -1}
                role="group"
                aria-label={`${dayKey(day)} time slots${keyboardSlot?.dayIndex === dayIndex ? `, ${axisTimeLabel(axis, dayIndex, keyboardSlot.coordinate, timeFormat)}` : ""}`}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !onCreateAtTime) return;
                  let coordinate = keyboardSlot?.dayIndex === dayIndex ? keyboardSlot.coordinate : axisOpenScroll(axis, new Date(), false);
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault(); event.stopPropagation();
                    const step = event.key === "ArrowDown" ? geometry.snapMinutes : -geometry.snapMinutes;
                    let next = coordinate + step;
                    while (next >= 0 && next < axis.rows.length && coordinateToInstant(axis, dayIndex, next) === null) next += step;
                    if (next < 0 || next >= axis.rows.length) return;
                    coordinate = next;
                    setKeyboardSlot({ dayIndex, coordinate });
                    const scrollRoot = rootRef.current?.parentElement;
                    if (scrollRoot) scrollRoot.scrollTo?.({ top: Math.max(0, minutesToY(coordinate, geometry) - scrollRoot.clientHeight / 2) });
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault(); event.stopPropagation();
                    const instant = coordinateToInstant(axis, dayIndex, coordinate);
                    if (instant === null) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    onCreateAtTime(dayKey(day), clockAt(axis, dayIndex, coordinate), { returnFocus: event.currentTarget, x: bounds.right, y: bounds.top + minutesToY(coordinate, geometry) }, undefined, { start: new Date(instant), end: new Date(Math.min(axis.days[dayIndex]!.end, instant + 60 * 60_000)) });
                  }
                }}
								onPointerDown={(pointerEvent) => {
									availabilityPress.current = pointerEvent.target instanceof Element && !!pointerEvent.target.closest("[data-availability-interval]");
									if (
										!onCreateAtTime ||
										pointerEvent.button !== 0 ||
										// This press is dismissing a preview or a menu; it must not
										// also leave a draft behind the thing it just closed.
										dismissGuard.pressDismissedLayer() ||
										(pointerEvent.target instanceof Element &&
											pointerEvent.target.closest("button,[data-availability-interval]"))
									) {
										return;
									}
									if (coordinateToInstant(axis, dayIndex, yToMinutes(pointerEvent.clientY - pointerEvent.currentTarget.getBoundingClientRect().top, geometry)) === null) return;
									// Same as the month grid: the previous draft goes on press,
									// so two pending events are never on screen at once.
									onCancelDraft?.();
									beginCreateDrag({
										clientY: pointerEvent.clientY,
										column: pointerEvent.currentTarget,
										dayIndex,
										pointerId: pointerEvent.pointerId,
									});
								}}
								onClick={(event) => {
									// A release outside the static block can target this column.
									if (availabilityPress.current) { availabilityPress.current = false; return; }
									if (
										!onCreateAtTime ||
										// A drag already answered "when" — don't create twice.
										consumeClick() ||
										// The press this click belongs to closed a layer. Radix
										// dismisses on pointerdown, so nothing is open to ask about
										// by now — the press had to be remembered.
										dismissGuard.consumeDismiss() ||
										(event.target instanceof Element && event.target.closest("button,[data-availability-interval]"))
									) {
										return;
									}

									const bounds = event.currentTarget.getBoundingClientRect();
									// Same geometry the grid is drawn with, so the created time is
									// the time the user pointed at (snapped and clamped there).
									const minutes = yToMinutes(event.clientY - bounds.top, geometry);
									const instant = coordinateToInstant(axis, dayIndex, minutes);
									if (instant === null) return;
									const exactRange = { start: new Date(instant), end: new Date(Math.min(axis.days[dayIndex]!.end, instant + 60 * 60_000)) };

									onCreateAtTime(
										dayKey(day),
										clockAt(axis, dayIndex, minutes),
										{
											returnFocus: event.currentTarget,
											// Beside the column, level with the slot that was clicked
											// — same rule as a dragged slot.
											x: event.currentTarget.getBoundingClientRect().right,
											y: event.clientY,
										},
										undefined, exactRange,
									);
								}}
							>
                {keyboardSlot?.dayIndex === dayIndex ? <div aria-hidden="true" className={styles.timeGridKeyboardSlot} style={{ top: minutesToY(keyboardSlot.coordinate, geometry), height: geometry.snapMinutes * geometry.pxPerMinute }} /> : null}
                {holeSegments(axis, dayIndex).map(hole => <div key={hole.start} className={styles.timeGridHole} data-time-axis-hole="" style={{ top: minutesToY(hole.start, geometry), height: (hole.end - hole.start) * geometry.pxPerMinute }}>No local time</div>)}
								{/* The draft: visible from the first pixel of the create
                    gesture, and once laid down it can be moved and resized like
                    a real block. It stays aria-hidden — the popover's own date
                    and time fields are the keyboard path to the same change. */}
								{selection?.dayIndex === dayIndex ? previewPieces(axis, dayIndex, selection).map((piece, pieceIndex, pieces) => (
									<div
										aria-hidden="true"
										className={styles.timeGridSelection}
                    key={piece.start}
										data-draft={draftSlot && onMoveDraft ? "" : undefined}
										data-dragging={draftDrag ? "" : undefined}
										style={
											{
												"--draft-accent": pendingCreate?.color,
                        padding: realRunHeight(axis, dayIndex, piece.start, geometry) < 12 ? 0 : undefined,
                        borderWidth: realRunHeight(axis, dayIndex, piece.start, geometry) < 2 ? 0 : undefined,
                        overflow: "hidden",
												height: `${Math.min(realRunHeight(axis, dayIndex, piece.start, geometry), durationToHeight(piece.end - piece.start, geometry))}px`,
												top: `${minutesToY(piece.start, geometry)}px`,
											} as CSSProperties
										}
										onPointerDown={(pointerEvent) => startDraftDrag(pointerEvent, "move")}
									>
										<span className={styles.timeGridSelectionTime}>
											{axisTimeLabel(axis, dayIndex, selection.startMinutes, timeFormat)}–
											{axisTimeLabel(axis, dayIndex, selection.endMinutes, timeFormat, "end")}
										</span>
										{/* Named once it is laid down, so it reads as the event it
                        is about to become rather than as a selection. */}
										{draftSlot && !liveSelection ? (
											<span className={styles.timeGridSelectionTitle}>New event</span>
										) : null}
										{draftSlot && onMoveDraft ? (
											<>
												<span
													hidden={pieceIndex !== 0 || (selection.exactRange !== undefined && selection.exactRange.start.getTime() < axis.days[dayIndex]!.start)}
                          className={styles.resizeHandleTop}
													onPointerDown={(pointerEvent) =>
														startDraftDrag(pointerEvent, "resize-start")
													}
												/>
												<span
													hidden={pieceIndex !== pieces.length - 1 || (selection.exactRange !== undefined && selection.exactRange.end.getTime() > axis.days[dayIndex]!.end)}
                          className={styles.resizeHandleBottom}
													onPointerDown={(pointerEvent) =>
														startDraftDrag(pointerEvent, "resize-end")
													}
												/>
											</>
										) : null}
									</div>
								)) : null}
								{/* The event where it is being dragged to — the answer to
                    "where will this land", including across days. */}
								{drag && drag.mode === "move" && drag.dayIndex === dayIndex ? previewPieces(axis, dayIndex, drag.times).map(piece => (
									<div
										aria-hidden="true"
										className={styles.dragPreview}
                    key={piece.start}
										data-drag-preview=""
										style={
											{
												"--event-color": dragPreviewColor,
                        padding: realRunHeight(axis, dayIndex, piece.start, geometry) < 12 ? 0 : undefined,
												"--event-foreground": getReadableEventTextColor(dragPreviewColor),
												height: `${Math.min(realRunHeight(axis, dayIndex, piece.start, geometry), durationToHeight(piece.end - piece.start, geometry))}px`,
												top: `${minutesToY(piece.start, geometry)}px`,
											} as CSSProperties
										}
									>
										<span className={styles.dragPreviewTime}>
											{axisTimeLabel(axis, dayIndex, drag.times.startMinutes, timeFormat)}–
											{axisTimeLabel(axis, dayIndex, drag.times.endMinutes, timeFormat, "end")}
										</span>
										<span className={styles.dragPreviewTitle}>{drag.event.title}</span>
									</div>
								)) : null}
								{segmentsByDay[dayIndex]?.map((segment) => segment.kind === "availability" ? (
                  <div key={`${segment.interval.sourceId}:${segment.interval.start}:${segment.interval.end}:${segment.startMin}`} className={styles.timelineAvailability} data-availability-interval="" role="note" aria-label={`Busy, ${segment.interval.label}, ${dayKey(day)}, ${axisTimeLabel(axis, dayIndex, segment.startMin, timeFormat)}–${axisTimeLabel(axis, dayIndex, segment.endMin, timeFormat, "end")}`} style={{ "--event-color": DEFAULT_CALENDAR_COLOR, "--event-foreground": getReadableEventTextColor(DEFAULT_CALENDAR_COLOR), top: `${minutesToY(segment.startMin, geometry)}px`, height: `${Math.min(realRunHeight(axis, dayIndex, segment.startMin, geometry), durationToHeight(segment.endMin - segment.startMin, geometry))}px`, padding: Math.min(realRunHeight(axis, dayIndex, segment.startMin, geometry), durationToHeight(segment.endMin - segment.startMin, geometry)) < 12 ? 0 : undefined, ...overlapPlacement(segment.col, segment.cols), zIndex: 0 } as CSSProperties}>
                    <span className={styles.timelineEventTime}>{axisTimeLabel(axis, dayIndex, segment.startMin, timeFormat)}–{axisTimeLabel(axis, dayIndex, segment.endMin, timeFormat, "end")}</span>
                    <span className={styles.timelineEventTitle}>Busy</span>
                    <span className={styles.timelineEventMeta}>{segment.interval.label}</span>
                  </div>
                ) : (
									<TimelineEvent
										axis={axis}
										detailBoundary={detailBoundary}
										detailInsideTrigger={dayMode}
										pending={
											busyEventId !== undefined &&
											(segment.event.id === busyEventId ||
												segment.event.id.startsWith(`${busyEventId}_`))
										}
										calendar={calendarsById.get(eventHomeCalendarId(segment.event) ?? "")}
										calendars={calendars}
										dayIndex={dayIndex}
										daySegment={segment}
										dragTimes={
											// A resize grows the block in place. A move leaves this one
											// where it was, as a ghost, and travels as its own preview
											// in whichever column the pointer is over.
											drag?.event.id === segment.event.id && drag.mode !== "move"
												? drag.times
												: undefined
										}
										ghost={drag?.event.id === segment.event.id && drag.mode === "move"}
										draggable={
											Boolean(onMoveEvent) &&
											canEditEvent(eventActions.getEventMaster(segment.event), calendars)
										}
										geometry={geometry}
										key={segment.event.id}
										onBeginDrag={beginDrag}
										onKeyboardAdjust={adjustByKeyboard}
										timeFormat={timeFormat}
										weekStartsOn={weekStartsOn}
										{...eventActions}
									/>
								))}
								{today && nowMinutes !== null ? (
									<div
										className={styles.timeGridNow}
										data-current-time
										style={{
											top: `${minutesToY(nowMinutes, geometry)}px`,
										}}
									>
										<span />
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
