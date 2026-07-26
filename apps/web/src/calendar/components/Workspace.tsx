import type { Calendar, Event, Settings, User } from "@musubi/types";
import { addDays, addMonthPages } from "@musubi/calendar/layout";
import type {
  Attendee,
  RemoveEventResponse,
} from "~/api/contracts";
import {
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useCallback,
  useState,
} from "react";
import { getAgendaLabel } from "../agenda-math";
import {
  getMonthLabel,
  parseDateKey,
} from "../calendar-math";
import { toDateKey } from "../date-key";
import {
  getTimeGridDays,
  getTimeGridLabel,
} from "../time-grid-math";
import { getEditableCalendars } from "../event-permissions";
import { pageStubs } from "~/pages/page-stubs";
import type { CalendarViewId } from "../view-registry";
import { AgendaView } from "./AgendaView";
import { MonthCalendar } from "./MonthCalendar";
import {
  QuickCreate,
  type QuickCreateAnchor,
} from "./QuickCreate";
import { Sidebar } from "./Sidebar";
import { TimeGridView } from "./TimeGridView";
import { Toolbar } from "./Toolbar";
import styles from "./workspace.module.css";

type WorkspaceProps = {
  activeView: CalendarViewId;
  baseEvents?: Event[];
  calendars: Calendar[];
  date: string;
  events: Event[];
  isRefreshing: boolean;
  onCreateEvent: (event: Event) => Promise<Event>;
  onDateChange: (date: string) => void;
  onForkEvent?: (input: {
    calendarId: string;
    eventId: string;
  }) => Promise<Event>;
  onLinkEvent?: (input: {
    calendarId: string;
    eventId: string;
  }) => Promise<Event>;
  onPageChange: (pageId: string) => void;
  onRemoveEvent: (event: Event) => Promise<RemoveEventResponse>;
  onSetAttendance?: (input: {
    attending: boolean;
    eventId: string;
  }) => Promise<Attendee[]>;
  onSignOut: () => void;
  onUpdateEvent: (event: Event) => Promise<Event>;
  onViewChange: (view: CalendarViewId) => void;
  pageId: string;
  settings: Settings;
  user: Pick<User, "email" | "id" | "name">;
};

type CreateIntent = {
  anchor: QuickCreateAnchor;
  date: string;
  id: number;
  startTime?: string;
};

const unavailableTargetMutation = async (): Promise<Event> => {
  throw new Error("This event action is unavailable.");
};

const unavailableAttendance = async (): Promise<Attendee[]> => {
  throw new Error("Attendance is unavailable.");
};

export function Workspace({
  activeView,
  baseEvents,
  calendars,
  date,
  events,
  isRefreshing,
  onCreateEvent,
  onDateChange,
  onForkEvent = unavailableTargetMutation,
  onLinkEvent = unavailableTargetMutation,
  onPageChange,
  onRemoveEvent,
  onSetAttendance = unavailableAttendance,
  onSignOut,
  onUpdateEvent,
  onViewChange,
  pageId,
  settings,
  user,
}: WorkspaceProps) {
  const anchor = useMemo(() => parseDateKey(date), [date]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [createIntent, setCreateIntent] = useState<CreateIntent>();
  const editableCalendars = useMemo(
    () => getEditableCalendars(calendars),
    [calendars],
  );
  const sourceEvents = baseEvents ?? events;
  const eventMasters = useMemo(() => {
    const masters = new Map(
      sourceEvents.map((baseEvent) => [baseEvent.id, baseEvent]),
    );
    const recurring = sourceEvents.filter((baseEvent) => baseEvent.recurrence);

    for (const visibleEvent of events) {
      if (masters.has(visibleEvent.id)) continue;
      const master = recurring.find((baseEvent) =>
        visibleEvent.id.startsWith(`${baseEvent.id}_`),
      );
      if (master) masters.set(visibleEvent.id, master);
    }

    return masters;
  }, [sourceEvents, events]);
  const getEventMaster = useCallback(
    (event: Event) => eventMasters.get(event.id) ?? event,
    [eventMasters],
  );

  const visibleCalendarIds = useMemo(
    () =>
      calendars
        .map((calendar) => calendar.id)
        .filter((calendarId) => !hiddenCalendarIds.has(calendarId)),
    [calendars, hiddenCalendarIds],
  );

  const pageTitle =
    pageStubs.find((page) => page.id === pageId)?.name ?? "My calendar";

  const visibleEvents = useMemo(() => {
    const normalizedQuery = deferredSearchQuery
      .trim()
      .toLocaleLowerCase();

    return events.filter(
      (event) =>
        event.calendars.some((calendarId) =>
          visibleCalendarIds.includes(calendarId),
        ) &&
        (normalizedQuery.length === 0 ||
          event.title.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [deferredSearchQuery, events, visibleCalendarIds]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(""), 3_500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const timeGridDays =
    activeView === "day" || activeView === "week"
      ? getTimeGridDays(anchor, activeView, settings.weekStartsOn)
      : [];
  const periodLabel =
    activeView === "agenda"
      ? getAgendaLabel(anchor)
      : activeView === "day" || activeView === "week"
        ? getTimeGridLabel(timeGridDays, activeView)
        : getMonthLabel(anchor);

  function changePeriod(offset: number) {
    const nextDate = (() => {
      if (activeView === "day") {
        return addDays(anchor, offset);
      }

      if (activeView === "week") {
        return addDays(anchor, offset * 7);
      }

      if (activeView === "agenda") {
        return addDays(anchor, offset * 28);
      }

      return addMonthPages(anchor, offset);
    })();

    onDateChange(toDateKey(nextDate));
  }

  function openCreateAtDate(
    nextDate: string,
    target: HTMLElement,
    startTime?: string,
    point?: Pick<QuickCreateAnchor, "x" | "y">,
  ) {
    if (editableCalendars.length === 0) {
      setNotice("You need edit access to a calendar to create events.");
      return;
    }

    const bounds = target.getBoundingClientRect();
    setCreateIntent({
      anchor: {
        returnFocus: target,
        x: point?.x ?? bounds.left + Math.min(bounds.width / 2, 180),
        y: point?.y ?? bounds.top + Math.min(bounds.height, 48),
      },
      date: nextDate,
      id: Date.now(),
      startTime,
    });
  }

  function handleWorkspaceKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key.toLocaleLowerCase() !== "c" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLButtonElement
    ) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openCreateAtDate(date, event.currentTarget, undefined, {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + 92,
    });
  }

  function handleToggleCalendar(calendarId: string) {
    setHiddenCalendarIds((current) => {
      const next = new Set(current);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      return next;
    });
  }

  return (
    <div className={styles.workspace}>
      <Sidebar
        activePageId={pageId}
        calendars={calendars}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNotice={setNotice}
        onPageChange={onPageChange}
        onSignOut={onSignOut}
        onToggleCalendar={handleToggleCalendar}
        syncLabel={isRefreshing ? "Refreshing server data…" : "Connected to server"}
        user={user}
        visibleCalendarIds={visibleCalendarIds}
      />

      <main
        className={styles.main}
        id="main-content"
        onKeyDown={handleWorkspaceKeyDown}
      >
        <Toolbar
          activeView={activeView}
          canCreateEvents={editableCalendars.length > 0}
          filtersOpen={filtersOpen}
          onCreateEvent={(target) =>
            openCreateAtDate(date, target)
          }
          onPeriodChange={changePeriod}
          onNotice={setNotice}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSearch={setSearchQuery}
          onToday={() => onDateChange(toDateKey(new Date()))}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          onViewChange={onViewChange}
          pageTitle={pageTitle}
          periodLabel={periodLabel}
          periodName={
            activeView === "agenda" ? "agenda start" : activeView
          }
          searchQuery={searchQuery}
        />

        {filtersOpen ? (
          <div className={styles.filterBar} aria-label="Active calendar filters">
            <span>Visible calendars</span>
            {calendars.map((calendar) => {
              const active = visibleCalendarIds.includes(calendar.id);

              return (
                <button
                  className={active ? styles.filterChipActive : ""}
                  type="button"
                  aria-pressed={active}
                  key={calendar.id}
                  onClick={() => handleToggleCalendar(calendar.id)}
                >
                  <span
                    className={styles.calendarDot}
                    style={{ backgroundColor: calendar.color }}
                  />
                  {calendar.name}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className={styles.calendarArea}>
          {activeView === "agenda" ? (
            <AgendaView
              anchor={anchor}
              calendars={calendars}
              events={visibleEvents}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onNotice={setNotice}
              onRemoveEvent={onRemoveEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
            />
          ) : activeView === "day" || activeView === "week" ? (
            <TimeGridView
              anchor={anchor}
              calendars={calendars}
              events={visibleEvents}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onCreateAtTime={
                editableCalendars.length > 0
                  ? (nextDate, time, createAnchor) =>
                      openCreateAtDate(
                        nextDate,
                        createAnchor.returnFocus,
                        time,
                        createAnchor,
                      )
                  : undefined
              }
              onNotice={setNotice}
              onRemoveEvent={onRemoveEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
              view={activeView}
              weekStartsOn={settings.weekStartsOn}
            />
          ) : (
            <MonthCalendar
              anchor={anchor}
              calendars={calendars}
              events={visibleEvents}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onCreateAtDate={
                editableCalendars.length > 0
                  ? (nextDate, target) =>
                      openCreateAtDate(nextDate, target)
                  : undefined
              }
              onMonthChange={changePeriod}
              onNotice={setNotice}
              onRemoveEvent={onRemoveEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
              weekStartsOn={settings.weekStartsOn}
            />
          )}
        </div>

        <div className={styles.liveRegion} role="status" aria-live="polite">
          {notice ? <p className={styles.toast}>{notice}</p> : null}
        </div>
      </main>
      {createIntent ? (
        <QuickCreate
          anchor={createIntent.anchor}
          calendars={editableCalendars}
          date={createIntent.date}
          email={user.email}
          key={createIntent.id}
          onCreate={onCreateEvent}
          onCreated={() => setNotice("Event created.")}
          onOpenChange={(open) => {
            if (!open) {
              setCreateIntent(undefined);
            }
          }}
          open
          startTime={createIntent.startTime}
          userId={user.id}
        />
      ) : null}
    </div>
  );
}
