import type { Event } from "@musubi/types";
import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  getMonthLabel,
  parseDateKey,
} from "../calendar-math";
import { toDateKey } from "../date-key";
import { fixtureCalendars, fixtureEvents, fixturePages } from "../fixtures";
import type { CalendarViewId } from "../view-registry";
import {
  selectCalendarIds,
  selectPageDirty,
  usePageDraftStore,
} from "~/pages/draft-store";
import { MonthCalendar } from "./MonthCalendar";
import { SaveBar } from "./SaveBar";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import styles from "./workspace.module.css";

type WorkspaceProps = {
  activeView: CalendarViewId;
  date: string;
  onDateChange: (date: string) => void;
  onPageChange: (pageId: string) => void;
  onViewChange: (view: CalendarViewId) => void;
  pageId: string;
};

export function Workspace({
  activeView,
  date,
  onDateChange,
  onPageChange,
  onViewChange,
  pageId,
}: WorkspaceProps) {
  const anchor = parseDateKey(date);
  const [events, setEvents] = useState<Event[]>(fixtureEvents);
  const [createDate, setCreateDate] = useState(date);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveBarDismissed, setSaveBarDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const visibleCalendarIds = usePageDraftStore(selectCalendarIds(pageId));
  const dirty = usePageDraftStore(selectPageDirty(pageId));
  const discard = usePageDraftStore((state) => state.discard);
  const save = usePageDraftStore((state) => state.save);
  const toggleCalendar = usePageDraftStore((state) => state.toggleCalendar);

  const pageTitle =
    fixturePages.find((page) => page.id === pageId)?.name ?? "My calendar";

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

  function changeMonth(offset: number) {
    onDateChange(toDateKey(addMonths(anchor, offset)));
  }

  function openCreateAtDate(nextDate: string) {
    setCreateDate(nextDate);
    setCreateOpen(true);
  }

  function handleCreate(event: Event) {
    setEvents((current) => [...current, event]);
    setNotice(`Saved “${event.title}” to this local prototype.`);
  }

  function handleToggleCalendar(calendarId: string) {
    toggleCalendar(pageId, calendarId);
    setSaveBarDismissed(false);
  }

  return (
    <div className={styles.workspace}>
      <Sidebar
        activePageId={pageId}
        calendars={fixtureCalendars}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNotice={setNotice}
        onPageChange={onPageChange}
        onToggleCalendar={handleToggleCalendar}
        visibleCalendarIds={visibleCalendarIds}
      />

      <main className={styles.main} id="main-content">
        <Toolbar
          activeView={activeView}
          calendars={fixtureCalendars}
          createDate={createDate}
          createOpen={createOpen}
          dirty={dirty}
          filtersOpen={filtersOpen}
          monthLabel={getMonthLabel(anchor)}
          onCreate={handleCreate}
          onCreateOpenChange={setCreateOpen}
          onMonthChange={changeMonth}
          onNotice={setNotice}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSearch={setSearchQuery}
          onToday={() => onDateChange(toDateKey(new Date()))}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          onViewChange={onViewChange}
          pageTitle={pageTitle}
          searchQuery={searchQuery}
        />

        {filtersOpen ? (
          <div className={styles.filterBar} aria-label="Active calendar filters">
            <span>Visible calendars</span>
            {fixtureCalendars.map((calendar) => {
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
          <MonthCalendar
            anchor={anchor}
            calendars={fixtureCalendars}
            events={visibleEvents}
            onCreateAtDate={openCreateAtDate}
            onMonthChange={changeMonth}
          />
        </div>

        <SaveBar
          dirty={dirty && !saveBarDismissed}
          onDiscard={() => {
            discard(pageId);
            setNotice("Page changes discarded.");
          }}
          onDismiss={() => setSaveBarDismissed(true)}
          onSave={() => {
            save(pageId);
            setNotice("Page saved in the local prototype.");
          }}
          onSaveAsNew={() => {
            save(pageId);
            setNotice(`Saved a local copy of “${pageTitle}”.`);
          }}
        />

        <div className={styles.liveRegion} role="status" aria-live="polite">
          {notice ? <p className={styles.toast}>{notice}</p> : null}
        </div>
      </main>
    </div>
  );
}
