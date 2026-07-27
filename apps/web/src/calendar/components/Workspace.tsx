import type {
  Calendar,
  CreatePageRequest,
  Event,
  PageConfigV1,
  PageDocument,
  Settings,
  SettingsDocument,
  SettingsPatch,
  User,
} from "@musubi/types";
import { addDays, addMonthPages } from "@musubi/calendar/layout";
import type {
  Attendee,
  ImportedCalendar,
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
import type { Notify } from "../notice";
import {
  createTimeGeometry,
  densityFromPageConfig,
} from "../time-geometry";
import {
  calendarIdsForVisibility,
  toggleCalendarVisibility,
  visibilityEquals,
  type SavePageResult,
} from "../page-editor";
import type { CalendarViewId } from "../view-registry";
import { AccountDialog } from "./AccountDialog";
import { AgendaView } from "./AgendaView";
import { CalendarTransferDialog } from "./CalendarTransferDialog";
import { ConnectionsDialog } from "./ConnectionsDialog";
import { MonthCalendar } from "./MonthCalendar";
import {
  QuickCreate,
  type QuickCreateAnchor,
} from "./QuickCreate";
import { SaveBar } from "./SaveBar";
import { ShareCalendarDialog } from "./ShareCalendarDialog";
import { Sidebar } from "./Sidebar";
import { SettingsDialog } from "./SettingsDialog";
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
  onCreatePage?: (request: CreatePageRequest) => Promise<PageDocument>;
  onSavePage?: (input: {
    baseRevision: number;
    config: PageConfigV1;
    id: string;
    name: string;
  }) => Promise<SavePageResult>;
  onExportCalendar?: (
    calendarId: string,
    connectionId?: string,
  ) => Promise<string>;
  onImportCalendar?: (input: {
    color: string;
    ics: string;
    name: string;
  }) => Promise<ImportedCalendar>;
  onCreateCalendar?: (input: {
    color: string;
    name: string;
  }) => Promise<Calendar>;
  onUpdateCalendar?: (calendar: Calendar) => Promise<Calendar>;
  onRemoveCalendar?: (calendar: Calendar) => Promise<Calendar>;
  onAdoptSettings?: (document: SettingsDocument) => void;
  onGetSettingsDocument?: (
    signal?: AbortSignal,
  ) => Promise<SettingsDocument>;
  onPatchSettings?: (request: {
    baseRevision: number;
    patch: SettingsPatch;
  }) => Promise<SettingsDocument>;
  onRemoveEvent: (event: Event) => Promise<RemoveEventResponse>;
  onSetAttendance?: (input: {
    attending: boolean;
    // Identifies the owning calendar so a federated event is routed to its
    // server instead of the home one.
    calendarId?: string;
    eventId: string;
  }) => Promise<Attendee[]>;
  onSignOut: () => void;
  onUpdateEvent: (event: Event) => Promise<Event>;
  onViewChange: (view: CalendarViewId) => void;
  pageId: string;
  pages: PageDocument[];
  settings: Settings;
  user: Pick<User, "email" | "id" | "name">;
};

type CreateIntent = {
  anchor: QuickCreateAnchor;
  date: string;
  /** Set when days were dragged across in the month grid: an all-day range. */
  endDate?: string;
  /** Set when the interval was dragged, so the length carries over. */
  endTime?: string;
  id: number;
  startTime?: string;
};

const unavailableTargetMutation = async (): Promise<Event> => {
  throw new Error("This event action is unavailable.");
};

const unavailableAttendance = async (): Promise<Attendee[]> => {
  throw new Error("Attendance is unavailable.");
};

const unavailableExport = async (): Promise<string> => {
  throw new Error("Calendar export is unavailable.");
};

const unavailableImport = async (): Promise<ImportedCalendar> => {
  throw new Error("Calendar import is unavailable.");
};

const unavailableCalendarWrite = async (): Promise<Calendar> => {
  throw new Error("Calendar management is unavailable.");
};

const unavailableSettings = async (): Promise<SettingsDocument> => {
  throw new Error("Settings sync is unavailable.");
};

const unavailablePageSave = async (): Promise<SavePageResult> => {
  throw new Error("Page editing is unavailable.");
};

const unavailablePageCreate = async (): Promise<PageDocument> => {
  throw new Error("Page creation is unavailable.");
};

const ignoreSettings = () => undefined;

export function Workspace({
  activeView,
  baseEvents,
  calendars,
  date,
  events,
  isRefreshing,
  onCreateEvent,
  onAdoptSettings = ignoreSettings,
  onDateChange,
  onExportCalendar = unavailableExport,
  onForkEvent = unavailableTargetMutation,
  onLinkEvent = unavailableTargetMutation,
  onImportCalendar = unavailableImport,
  onCreateCalendar = unavailableCalendarWrite,
  onUpdateCalendar = unavailableCalendarWrite,
  onRemoveCalendar = unavailableCalendarWrite,
  onGetSettingsDocument = unavailableSettings,
  onCreatePage = unavailablePageCreate,
  onPageChange,
  onPatchSettings = unavailableSettings,
  onSavePage = unavailablePageSave,
  onRemoveEvent,
  onSetAttendance = unavailableAttendance,
  onSignOut,
  onUpdateEvent,
  onViewChange,
  pageId,
  pages,
  settings,
  user,
}: WorkspaceProps) {
  const anchor = useMemo(() => parseDateKey(date), [date]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Read-mode calendar toggles are a temporary local filter: a set of ids
  // flipped from what the Page config resolves to. Cleared when the Page or its
  // saved visibility changes.
  const [tempToggles, setTempToggles] = useState<Set<string>>(
    () => new Set(),
  );
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftVisibility, setDraftVisibility] = useState<
    PageConfigV1["calendarVisibility"]
  >({ hiddenCalendarIds: [], mode: "all" });
  // The view config carries presentation options (density, weekend,
  // showAdjacentDays); drafting it lets edit mode preview them live.
  const [draftView, setDraftView] = useState<PageConfigV1["view"]>({
    configVersion: 1,
    id: "month",
    showAdjacentDays: true,
  });
  // Revision captured when editing started. A realtime update from another
  // session bumps the cached Page under us; saving against this frozen base then
  // returns 409 instead of silently overwriting the remote change.
  const [draftBaseRevision, setDraftBaseRevision] = useState(1);
  const [savingPage, setSavingPage] = useState(false);
  const [pageConflict, setPageConflict] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    undo?: () => Promise<unknown> | void;
  }>();
  const notify = useCallback<Notify>(
    (message, undo) => setNotice({ message, undo }),
    [],
  );

  async function runUndo(undo: NonNullable<typeof notice>["undo"]) {
    // Take the offer away first: the toast is gone either way, and a second
    // click would replay the reversal.
    setNotice(undefined);
    try {
      await undo?.();
      notify("Change undone.");
    } catch {
      notify("That change could not be undone.");
    }
  }
  const [createIntent, setCreateIntent] = useState<CreateIntent>();
  const [calendarTransfersOpen, setCalendarTransfersOpen] =
    useState(false);
  const [shareCalendar, setShareCalendar] = useState<Calendar | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
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

  const activePage = useMemo(
    () => pages.find((page) => page.id === pageId) ?? pages[0],
    [pages, pageId],
  );

  // Editing shows the live draft; reading shows the saved Page visibility with
  // the session's temporary toggles layered on top.
  const visibleCalendarIds = useMemo(() => {
    if (editing) {
      return calendarIdsForVisibility(draftVisibility, calendars);
    }
    const visible = new Set(
      calendarIdsForVisibility(activePage.config.calendarVisibility, calendars),
    );
    for (const calendarId of tempToggles) {
      if (visible.has(calendarId)) {
        visible.delete(calendarId);
      } else {
        visible.add(calendarId);
      }
    }
    return calendars
      .map((calendar) => calendar.id)
      .filter((calendarId) => visible.has(calendarId));
  }, [activePage, calendars, draftVisibility, editing, tempToggles]);

  // Density lives in the Page config, so "this page shows time grids compactly"
  // is saved with the page rather than being a device preference.
  const geometry = useMemo(
    () =>
      createTimeGeometry(
        densityFromPageConfig(
          editing
            ? { ...activePage.config, view: draftView }
            : activePage.config,
        ),
      ),
    [activePage.config, draftView, editing],
  );

  // Presentation flags from the same config the geometry came from, so edit mode
  // previews them together.
  const presentationView = editing ? draftView : activePage.config.view;
  const showWeekend =
    "weekend" in presentationView ? presentationView.weekend : true;
  const showAdjacentDays =
    "showAdjacentDays" in presentationView
      ? presentationView.showAdjacentDays
      : true;

  const pageTitle = activePage.name;
  const pageDirty =
    editing &&
    (draftName.trim() !== activePage.name ||
      !visibilityEquals(
        draftVisibility,
        activePage.config.calendarVisibility,
      ) ||
      JSON.stringify(draftView) !== JSON.stringify(activePage.config.view));

  // The route remounts this component per page (key={pageId}), so switching
  // pages resets editing, conflict and the temporary read filter for free.

  useEffect(() => {
    if (!pageDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pageDirty]);

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

    // An offer to undo has to outlive a plain acknowledgement: it is only real
    // if it is still there when you notice the mistake.
    const timeout = window.setTimeout(
      () => setNotice(undefined),
      notice.undo ? 9_000 : 3_500,
    );
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
    {
      endDate,
      endTime,
      point,
    }: {
      endDate?: string;
      endTime?: string;
      point?: Pick<QuickCreateAnchor, "x" | "y">;
    } = {},
  ) {
    if (editableCalendars.length === 0) {
      notify("You need edit access to a calendar to create events.");
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
      endDate,
      endTime,
      id: Date.now(),
      startTime,
    });
  }

  function handleWorkspaceKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLocaleLowerCase() === "s"
    ) {
      if (editing && pageDirty) {
        event.preventDefault();
        void savePageChanges();
      }
      return;
    }

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
      point: { x: bounds.left + bounds.width / 2, y: bounds.top + 92 },
    });
  }

  function handleToggleCalendar(calendarId: string) {
    if (editing) {
      setDraftVisibility((current) =>
        toggleCalendarVisibility(current, calendarId, calendars),
      );
      return;
    }
    setTempToggles((current) => {
      const next = new Set(current);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      return next;
    });
  }

  function startEditing() {
    setDraftName(activePage.name);
    setDraftVisibility(activePage.config.calendarVisibility);
    setDraftView(activePage.config.view);
    setDraftBaseRevision(activePage.revision);
    setPageConflict(false);
    setEditing(true);
  }

  // Explicit discard (Save bar / conflict banner) — the user already chose to
  // drop the draft, so no extra confirm.
  function discardEditing() {
    setEditing(false);
    setPageConflict(false);
  }

  // Leaving edit mode via the toolbar toggle confirms first when dirty.
  function stopEditing() {
    if (
      pageDirty &&
      !window.confirm("Discard your unsaved page changes?")
    ) {
      return;
    }
    discardEditing();
  }

  function guardedPageChange(nextPageId: string) {
    if (
      pageDirty &&
      !window.confirm("Discard your unsaved page changes?")
    ) {
      return;
    }
    setEditing(false);
    setPageConflict(false);
    onPageChange(nextPageId);
  }

  const draftConfig = (): PageConfigV1 => ({
    ...activePage.config,
    calendarVisibility: draftVisibility,
    view: draftView,
  });

  async function savePageChanges() {
    if (!pageDirty || savingPage) return;
    setSavingPage(true);
    setPageConflict(false);
    try {
      const result = await onSavePage({
        baseRevision: draftBaseRevision,
        config: draftConfig(),
        id: activePage.id,
        name: draftName.trim(),
      });
      if (result.status === "conflict") {
        setPageConflict(true);
        notify("This page changed on another device.");
        return;
      }
      setEditing(false);
      notify("Page saved.");
    } catch {
      notify("This page could not be saved.");
    } finally {
      setSavingPage(false);
    }
  }

  async function savePageAsNew() {
    if (savingPage) return;
    setSavingPage(true);
    try {
      const created = await onCreatePage({
        config: draftConfig(),
        name: `${draftName.trim() || activePage.name} copy`,
      });
      setEditing(false);
      setPageConflict(false);
      notify("Saved as a new page.");
      onPageChange(created.id);
    } catch {
      notify("The new page could not be created.");
    } finally {
      setSavingPage(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <Sidebar
        activePageId={pageId}
        calendars={calendars}
        pages={pages}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onManageAccount={() => {
          setSidebarOpen(false);
          setAccountOpen(true);
        }}
        onManageCalendars={() => {
          setSidebarOpen(false);
          setCalendarTransfersOpen(true);
        }}
        onManageConnections={() => {
          setSidebarOpen(false);
          setConnectionsOpen(true);
        }}
        onOpenSettings={() => {
          setSidebarOpen(false);
          setSettingsOpen(true);
        }}
        onNotice={notify}
        onPageChange={guardedPageChange}
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
          draftDensity={
            "density" in draftView ? draftView.density : undefined
          }
          draftName={draftName}
          editing={editing}
          filtersOpen={filtersOpen}
          onDraftDensityChange={(density) =>
            setDraftView((current) =>
              "density" in current ? { ...current, density } : current,
            )
          }
          onDraftNameChange={setDraftName}
          draftShowWeekend={
            "weekend" in draftView ? draftView.weekend : undefined
          }
          onDraftShowWeekendChange={(weekend) =>
            setDraftView((current) =>
              "weekend" in current ? { ...current, weekend } : current,
            )
          }
          draftShowAdjacentDays={
            "showAdjacentDays" in draftView
              ? draftView.showAdjacentDays
              : undefined
          }
          onDraftShowAdjacentDaysChange={(showAdjacentDays) =>
            setDraftView((current) =>
              "showAdjacentDays" in current
                ? { ...current, showAdjacentDays }
                : current,
            )
          }
          onToggleEdit={editing ? stopEditing : startEditing}
          onCreateEvent={(target) =>
            openCreateAtDate(date, target)
          }
          onPeriodChange={changePeriod}
          onNotice={notify}
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
              onNotice={notify}
              onRemoveEvent={onRemoveEvent}
              onRestoreEvent={onCreateEvent}
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
              geometry={geometry}
              pendingCreate={
                createIntent
                  ? {
                      date: createIntent.date,
                      endTime: createIntent.endTime,
                      startTime: createIntent.startTime,
                    }
                  : undefined
              }
              onMoveEvent={async ({ end, event, start }) => {
                // The grid already shows the new position; this confirms it.
                // A rejection propagates so the drag reports it and the block
                // snaps back to the server's truth.
                await onUpdateEvent({ ...event, end, start });
                notify(
                  start.getTime() === event.start.getTime()
                    ? "Event resized."
                    : "Event moved.",
                  () => onUpdateEvent(event),
                );
              }}
              showWeekend={showWeekend}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onCreateAtTime={
                editableCalendars.length > 0
                  ? (nextDate, time, createAnchor, endTime) =>
                      openCreateAtDate(
                        nextDate,
                        createAnchor.returnFocus,
                        time,
                        { endTime, point: createAnchor },
                      )
                  : undefined
              }
              onNotice={notify}
              onRemoveEvent={onRemoveEvent}
              onRestoreEvent={onCreateEvent}
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
              showAdjacentDays={showAdjacentDays}
              onMoveEventToDate={async ({ dayKey, event }) => {
                // Only the date changes; the time of day and length are kept.
                const target = parseDateKey(dayKey);
                const shift =
                  target.getTime() -
                  new Date(
                    event.start.getFullYear(),
                    event.start.getMonth(),
                    event.start.getDate(),
                  ).getTime();
                await onUpdateEvent({
                  ...event,
                  end: new Date(event.end.getTime() + shift),
                  start: new Date(event.start.getTime() + shift),
                });
                notify("Event moved.", () => onUpdateEvent(event));
              }}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onCreateAtDate={
                editableCalendars.length > 0
                  ? (nextDate, target, endDate) =>
                      openCreateAtDate(nextDate, target, undefined, {
                        endDate,
                      })
                  : undefined
              }
              onMonthChange={changePeriod}
              pendingCreate={
                createIntent
                  ? { date: createIntent.date, endDate: createIntent.endDate }
                  : undefined
              }
              onNotice={notify}
              onRemoveEvent={onRemoveEvent}
              onRestoreEvent={onCreateEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
              weekStartsOn={settings.weekStartsOn}
            />
          )}
        </div>

        {pageConflict ? (
          <div className={styles.saveBar} role="alert">
            <div className={styles.saveBarCopy}>
              <strong>This page changed on another device</strong>
              <span>
                Your edits weren’t saved. Keep them as a new page, or discard
                them and use the latest version.
              </span>
            </div>
            <div className={styles.saveBarActions}>
              <button
                className={styles.secondaryButton}
                disabled={savingPage}
                type="button"
                onClick={discardEditing}
              >
                Discard my changes
              </button>
              <button
                className={styles.primaryButton}
                disabled={savingPage}
                type="button"
                onClick={() => void savePageAsNew()}
              >
                Save as a copy
              </button>
            </div>
          </div>
        ) : editing ? (
          <SaveBar
            dirty={pageDirty}
            onDiscard={discardEditing}
            onDismiss={discardEditing}
            onSave={() => void savePageChanges()}
            onSaveAsNew={() => void savePageAsNew()}
          />
        ) : null}

        <div className={styles.liveRegion} role="status" aria-live="polite">
          {notice ? (
            <div className={styles.toast}>
              <p>{notice.message}</p>
              {notice.undo ? (
                <button
                  className={styles.toastAction}
                  type="button"
                  onClick={() => void runUndo(notice.undo!)}
                >
                  Undo
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
      {createIntent ? (
        <QuickCreate
          anchor={createIntent.anchor}
          calendars={editableCalendars}
          date={createIntent.date}
          email={user.email}
          endDate={createIntent.endDate}
          endTime={createIntent.endTime}
          isAllDay={Boolean(createIntent.endDate)}
          key={createIntent.id}
          onCreate={onCreateEvent}
          onCreated={() => notify("Event created.")}
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
      <CalendarTransferDialog
        calendars={calendars}
        onCreate={onCreateCalendar}
        onExport={onExportCalendar}
        onImport={onImportCalendar}
        onManageMembers={(calendar) => {
          setCalendarTransfersOpen(false);
          setShareCalendar(calendar);
        }}
        onNotice={notify}
        onOpenChange={setCalendarTransfersOpen}
        onRemove={onRemoveCalendar}
        onUpdate={onUpdateCalendar}
        open={calendarTransfersOpen}
      />
      {connectionsOpen ? (
        <ConnectionsDialog
          calendars={calendars}
          onNotice={notify}
          onOpenChange={(open) => {
            if (!open) setConnectionsOpen(false);
          }}
          open
          userId={user.id}
        />
      ) : null}
      {accountOpen ? (
        <AccountDialog
          onNotice={notify}
          onOpenChange={(open) => {
            if (!open) setAccountOpen(false);
          }}
          open
        />
      ) : null}
      {shareCalendar ? (
        <ShareCalendarDialog
          calendar={shareCalendar}
          onNotice={notify}
          onOpenChange={(open) => {
            if (!open) setShareCalendar(null);
          }}
          userId={user.id}
        />
      ) : null}
      <SettingsDialog
        onAdopt={onAdoptSettings}
        onLoad={onGetSettingsDocument}
        onNotice={notify}
        onOpenChange={setSettingsOpen}
        onPatch={onPatchSettings}
        open={settingsOpen}
      />
    </div>
  );
}
