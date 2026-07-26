import type { Calendar, Event, Settings, User } from "@musubi/types";
import { addDays, addMonthPages } from "@musubi/calendar/layout";
import { useEffect, useMemo, useState } from "react";
import {
  AGENDA_WINDOW_DAYS,
  getAgendaRange,
  getAgendaRangeLabel,
} from "../agenda-math";
import {
  getMonthLabel,
  parseDateKey,
} from "../calendar-math";
import { toDateKey } from "../date-key";
import { pageStubs } from "~/pages/page-stubs";
import type { CalendarViewId } from "../view-registry";
import { AgendaView } from "./AgendaView";
import { MonthCalendar } from "./MonthCalendar";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import styles from "./workspace.module.css";

type WorkspaceProps = {
  activeView: CalendarViewId;
  calendars: Calendar[];
  date: string;
  events: Event[];
  isRefreshing: boolean;
  onDateChange: (date: string) => void;
  onPageChange: (pageId: string) => void;
  onSignOut: () => void;
  onViewChange: (view: CalendarViewId) => void;
  pageId: string;
  settings: Settings;
  user: Pick<User, "email" | "name">;
};

export function Workspace({
  activeView,
  calendars,
  date,
  events,
  isRefreshing,
  onDateChange,
  onPageChange,
  onSignOut,
  onViewChange,
  pageId,
  settings,
  user,
}: WorkspaceProps) {
  const anchor = parseDateKey(date);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");

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
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

    return events.filter(
      (event) =>
        event.calendars.some((calendarId) =>
          visibleCalendarIds.includes(calendarId),
        ) &&
        (normalizedQuery.length === 0 ||
          event.title.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [events, searchQuery, visibleCalendarIds]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(""), 3_500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const agendaRange = getAgendaRange(anchor);
  const periodLabel =
    activeView === "agenda"
      ? getAgendaRangeLabel(agendaRange.start, agendaRange.end)
      : getMonthLabel(anchor);

  function changePeriod(offset: number) {
    const nextDate =
      activeView === "agenda"
        ? addDays(anchor, offset * AGENDA_WINDOW_DAYS)
        : addMonthPages(anchor, offset);

    onDateChange(toDateKey(nextDate));
  }

  function openCreateAtDate(nextDate: string) {
    setNotice(
      `Event creation for ${nextDate} arrives in the next authenticated write slice.`,
    );
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

      <main className={styles.main} id="main-content">
        <Toolbar
          activeView={activeView}
          filtersOpen={filtersOpen}
          onPeriodChange={changePeriod}
          onNotice={setNotice}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSearch={setSearchQuery}
          onToday={() => onDateChange(toDateKey(new Date()))}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          onViewChange={onViewChange}
          pageTitle={pageTitle}
          periodLabel={periodLabel}
          periodName={activeView === "agenda" ? "agenda window" : "month"}
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
              timeFormat={settings.timeFormat}
            />
          ) : (
            <MonthCalendar
              anchor={anchor}
              calendars={calendars}
              events={visibleEvents}
              onCreateAtDate={openCreateAtDate}
              onMonthChange={changePeriod}
              timeFormat={settings.timeFormat}
              weekStartsOn={settings.weekStartsOn}
            />
          )}
        </div>

        <div className={styles.liveRegion} role="status" aria-live="polite">
          {notice ? <p className={styles.toast}>{notice}</p> : null}
        </div>
      </main>
    </div>
  );
}
