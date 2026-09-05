import type { Calendar, Event, Settings } from "@musubi/types";
import { ChevronRight, MapPin } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
	AGENDA_FREE_DAYS_MIN,
	AGENDA_GROUP_PAGE,
	freeDaysBetween,
	getAgendaGroups,
	getAgendaLabel,
	relativeDayName,
} from "../agenda-math";
import { getEventDateLabel, getEventRangeLabel } from "../calendar-math";
import { toDateKey } from "../date-key";
import { eventHomeCalendarId } from "../event-permissions";
import { EventMarks } from "./EventMarks";
import {
	EventDetailsPopover,
	type EventActionHandlers,
} from "./EventDetailsPopover";
import styles from "./workspace.module.css";

type AgendaViewProps = EventActionHandlers & {
	anchor: Date;
	calendars: Calendar[];
	events: Event[];
	timeFormat: Settings["timeFormat"];
	weekStartsOn: Settings["weekStartsOn"];
};

const dayFormatter = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
	weekday: "long",
});
const relativeDateFormatter = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
});

const monthFormatter = new Intl.DateTimeFormat("en", { month: "long" });

export function AgendaView({
	anchor,
	calendars,
	events,
	timeFormat,
	weekStartsOn,
	...eventActions
}: AgendaViewProps) {
	// One reading per render keeps the relative labels aligned.
	const now = new Date();
	const groups = getAgendaGroups(events, anchor);
	const calendarsById = useMemo(
		() => new Map(calendars.map((calendar) => [calendar.id, calendar])),
		[calendars],
	);
	const groupFingerprint = `${anchor.getTime()}:${events
		.map((event) => event.id)
		.join("|")}`;
	const [pagination, setPagination] = useState({
		fingerprint: groupFingerprint,
		shown: AGENDA_GROUP_PAGE,
	});
	const shown =
		pagination.fingerprint === groupFingerprint
			? pagination.shown
			: AGENDA_GROUP_PAGE;
	const rootRef = useRef<HTMLElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const visibleGroups = groups.slice(0, shown);
	const todayKey = toDateKey(now);

	useEffect(() => {
		const scrollRoot = rootRef.current?.parentElement;

		if (scrollRoot && typeof scrollRoot.scrollTo === "function") {
			scrollRoot.scrollTo({ behavior: "auto", top: 0 });
		}
	}, [groupFingerprint]);

	useEffect(() => {
		const sentinel = sentinelRef.current;

		if (
			!sentinel ||
			shown >= groups.length ||
			typeof IntersectionObserver === "undefined"
		) {
			return;
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					setPagination((current) => ({
						fingerprint: groupFingerprint,
						shown: Math.min(
							(current.fingerprint === groupFingerprint
								? current.shown
								: AGENDA_GROUP_PAGE) + AGENDA_GROUP_PAGE,
							groups.length,
						),
					}));
				}
			},
			{
				root: rootRef.current?.parentElement ?? null,
				// Match the mobile Agenda: prepare the next batch before the user
				// reaches the edge, so the list reads as one continuous timeline.
				rootMargin: "0px 0px 400px",
			},
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	}, [groupFingerprint, groups.length, shown]);

	return (
		<section
			className={styles.agendaView}
			aria-label={`${getAgendaLabel(anchor)} agenda`}
			ref={rootRef}
		>
			<ol className={styles.agendaList}>
				{visibleGroups.map((group, groupIndex) => {
					const previous = visibleGroups[groupIndex - 1]?.date;
					const isNewYear =
						groupIndex === 0 || previous?.getFullYear() !== group.date.getFullYear();
					const isNewMonth =
						!isNewYear && previous?.getMonth() !== group.date.getMonth();
					const isToday = group.key === todayKey;
					const relative = relativeDayName(group.date, now);
					// Days with nothing on them are not rendered, so the jump between two
					// groups is the only place free time can be shown at all.
					const freeDays = previous ? freeDaysBetween(previous, group.date) : 0;

					return (
						<Fragment key={group.key}>
							{isNewYear ? (
								<li
									className={styles.agendaYear}
									aria-hidden="true"
									data-agenda-year={group.date.getFullYear()}
								>
									<span>{group.date.getFullYear()}</span>
								</li>
							) : null}
							{isNewMonth ? (
								<li className={styles.agendaMonth} aria-hidden="true">
									<span>{monthFormatter.format(group.date)}</span>
								</li>
							) : null}
							{freeDays >= AGENDA_FREE_DAYS_MIN ? (
								<li className={styles.agendaGap}>
									<span>{freeDays} free days</span>
								</li>
							) : null}
							<li
								className={`${styles.agendaDay} ${
									isToday ? styles.agendaDayToday : ""
								}`}
								data-agenda-date={group.key}
							>
								<time className={styles.agendaDate} dateTime={group.key}>
									{relative ? (
										<>
											<strong>{relative}</strong>
											<span>{relativeDateFormatter.format(group.date)}</span>
										</>
									) : (
										dayFormatter.format(group.date)
									)}
								</time>
								<div className={styles.agendaEvents}>
									{group.items.map((event) => {
										const calendar = calendarsById.get(eventHomeCalendarId(event) ?? "");
										const eventColor = calendar?.color ?? event.color;
										const rangeLabel = getEventRangeLabel(event, timeFormat).replace(
											" – ",
											"–",
										);

										return (
											<EventDetailsPopover
												calendar={calendar}
												calendars={calendars}
												align="start"
												event={event}
												key={event.id}
												side="bottom"
												timeFormat={timeFormat}
												weekStartsOn={weekStartsOn}
												{...eventActions}
											>
												<button
													className={styles.agendaEvent}
													type="button"
													aria-label={`${event.title}, ${getEventDateLabel(
														event,
													)}, ${getEventRangeLabel(
														event,
														timeFormat,
													)}, ${calendar?.name ?? "calendar"}`}
													data-agenda-event={event.id}
												>
													<span className={styles.agendaEventTime}>{rangeLabel}</span>
													<span
														className={styles.agendaEventRule}
														style={{ backgroundColor: eventColor }}
													/>
													<span className={styles.agendaEventCopy}>
														<span className={styles.agendaEventTitle}>{event.title}</span>
														{/* Only what this event actually has: an agenda row
                                with empty slots reads as missing data. */}
														{event.location ? (
															<span className={styles.agendaEventWhere}>
																<MapPin aria-hidden="true" size={12} strokeWidth={1.6} />
																{event.location}
															</span>
														) : null}
													</span>
													{/* Always the cell, even when there is nothing to put in it:
													    EventMarks renders null for a plain event, and a missing
													    grid item slid the calendar name and the chevron a whole
													    column left on every one of those rows. */}
													<span className={styles.agendaEventMarks}>
														<EventMarks event={event} />
													</span>
													<span className={styles.agendaEventCalendar}>
														{calendar?.name ?? "Calendar"}
													</span>
													<ChevronRight
														className={styles.agendaEventChevron}
														aria-hidden="true"
														size={14}
														strokeWidth={1.4}
													/>
												</button>
											</EventDetailsPopover>
										);
									})}
								</div>
							</li>
						</Fragment>
					);
				})}
			</ol>
			{shown < groups.length ? (
				<div
					className={styles.agendaSentinel}
					data-agenda-sentinel
					ref={sentinelRef}
					role="status"
					aria-label="Loading more events"
				/>
			) : null}
		</section>
	);
}
