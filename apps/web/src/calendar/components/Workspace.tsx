import type {
  Calendar,
  CreatePageRequest,
  Event,
  PageConfigV1,
  PageDocument,
  PageIcon,
  Settings,
  SettingsDocument,
  SettingsPatch,
  User,
} from "@musubi/types";
import { seriesEditWrites, type EditScope } from "@musubi/calendar";
import type {
  Attendee,
  ImportedCalendar,
  RemoveEventResponse,
} from "~/api/contracts";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
} from "react";
import { SectionLabel } from "~/ui/SectionLabel";
import { StaleBanner } from "~/ui/StaleBanner";
import { Toast, type ToastTone } from "~/ui/Toast";
import {
  DEFAULT_MULTI_WEEK_WEEKS,
  multiWeekDays,
  viewDefinition,
} from "../view-registry";
import {
  getEventRangeLabel,
  parseDateKey,
} from "../calendar-math";
import { toDateKey } from "../date-key";
import type { EventFormValues } from "../event-form";
import { getEditableCalendars } from "../event-permissions";
import type { Notify } from "../notice";

import { shortcutFor } from "../shortcuts";
import { useSwipePeriod } from "../use-swipe-period";
import {
  useCompactViewport,
  useNarrowViewport,
} from "~/design/use-narrow-viewport";
import { createTimeGeometry, densityFromPageConfig } from "../time-geometry";
import {
  calendarIdsForVisibility,
  newPageConfig,
  type SavePageResult,
} from "../page-editor";
import type { CalendarViewId } from "../view-registry";
import { AccountDialog } from "./AccountDialog";
import { AgendaView } from "./AgendaView";
import { CalendarVisibilityPill } from "./CalendarVisibilityPill";
import { CalendarTransferDialog } from "./CalendarTransferDialog";
import { ConnectionsDialog } from "./ConnectionsDialog";
import { SchedulingDialog } from "./SchedulingDialog";
import { MonthCalendar } from "./MonthCalendar";
import { MultiWeekCalendar } from "./MultiWeekCalendar";
import { NewPageDialog, PageSettingsDialog } from "./PageSettingsDialog";
import { QuickCreate, type QuickCreateAnchor } from "./QuickCreate";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { ShareCalendarDialog } from "./ShareCalendarDialog";
import { Sidebar } from "./Sidebar";
import { SettingsDialog } from "./SettingsDialog";
import { TimeGridView } from "./TimeGridView";
import { Toolbar } from "./Toolbar";
import styles from "./workspace.module.css";

const TOAST_ACKNOWLEDGEMENT_MS = 3_500;
const TOAST_UNDO_MS = 9_000;

type WorkspaceProps = {
  activeView: CalendarViewId;
  baseEvents?: Event[];
  calendars: Calendar[];
  date: string;
  events: Event[];
  isRefreshing: boolean;
  /**
   * The server could not be reached, so what is on screen came from the local
   * snapshot. `snapshotAt` is when that snapshot was written.
   */
  offline?: boolean;
  snapshotAt?: number;
  /** On screen is snapshot data while a refresh is in flight (`05:295-306`). */
  stale?: boolean;
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
  onDeletePage?: (id: string) => Promise<unknown>;
  onReorderPages?: (pageIds: string[]) => Promise<unknown>;
  onSetDefaultPage?: (id: string) => Promise<unknown>;
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
  onDisconnectExternalCalendar?: (calendar: Calendar) => Promise<unknown>;
  onUpdateCalendar?: (calendar: Calendar) => Promise<Calendar>;
  onRemoveCalendar?: (calendar: Calendar) => Promise<Calendar>;
  onAdoptSettings?: (document: SettingsDocument) => void;
  onGetSettingsDocument?: (signal?: AbortSignal) => Promise<SettingsDocument>;
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
  /**
   * Open the full editor for a draft. An event identifies an update; without
   * one it is a new event. Absent keeps the compact form expanding in place,
   * which is what router-less embeddings use.
   */
  onOpenFullEditor?: (values: EventFormValues, event?: Event) => void;
  onSignOut: () => void;
  /** State of a provider link that finished while the browser was away. */
  providerLink?: {
    error?: string;
    importing: boolean;
    linked: boolean;
  };
  onUpdateEvent: (event: Event) => Promise<Event>;
  onViewChange: (view: CalendarViewId) => void;
  pageId: string;
  pages: PageDocument[];
  settings: Settings;
  user: Pick<User, "email" | "id" | "image" | "name">;
};

type CreateIntent = {
  anchor: QuickCreateAnchor;
  /** The chosen calendar's colour, so the draft block wears it too. */
  color?: string;
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

const unavailableCalendarDisconnect = async (): Promise<void> => {
  throw new Error("External calendar disconnect is unavailable.");
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

const unavailablePageDelete = async (): Promise<void> => {
  throw new Error("Page deletion is unavailable.");
};

const unavailablePageReorder = async (): Promise<void> => {
  throw new Error("Page reordering is unavailable.");
};

const unavailablePageDefault = async (): Promise<void> => {
  throw new Error("Changing the default Page is unavailable.");
};

const ignoreSettings = () => undefined;

export function Workspace({
  activeView,
  baseEvents,
  calendars,
  date,
  events,
  isRefreshing,
  offline = false,
  snapshotAt,
  stale = false,
  onCreateEvent,
  onAdoptSettings = ignoreSettings,
  onDateChange,
  onExportCalendar = unavailableExport,
  onForkEvent = unavailableTargetMutation,
  onLinkEvent = unavailableTargetMutation,
  onImportCalendar = unavailableImport,
  onCreateCalendar = unavailableCalendarWrite,
  onDisconnectExternalCalendar = unavailableCalendarDisconnect,
  onUpdateCalendar = unavailableCalendarWrite,
  onRemoveCalendar = unavailableCalendarWrite,
  onGetSettingsDocument = unavailableSettings,
  onCreatePage = unavailablePageCreate,
  onDeletePage = unavailablePageDelete,
  onPageChange,
  onReorderPages = unavailablePageReorder,
  onSetDefaultPage = unavailablePageDefault,
  onPatchSettings = unavailableSettings,
  onSavePage = unavailablePageSave,
  onRemoveEvent,
  onOpenFullEditor,
  onSetAttendance = unavailableAttendance,
  onSignOut,
  providerLink,
  onUpdateEvent,
  onViewChange,
  pageId,
  pages,
  settings,
  user,
}: WorkspaceProps) {
  const anchor = useMemo(() => parseDateKey(date), [date]);
  const swipePeriod = useSwipePeriod((offset) => changePeriod(offset));
  // Phone chrome has less room for a date label than it has date to spell out.
  const narrow = useNarrowViewport();
  // No Filters toggle fits in a compact toolbar, so the shelf is simply always
  // there — as a sideways-scrolling strip, like the native client's filter bar.
  const compact = useCompactViewport();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Sidebar calendar toggles are a temporary local filter: a set of ids flipped
  // from what the Page config resolves to. Never saved — the Page's own
  // visibility is edited explicitly in its settings dialog.
  const [tempToggles, setTempToggles] = useState<Set<string>>(() => new Set());
  // The page whose settings dialog is open. Any page in the sidebar, not just
  // the active one.
  const [settingsPage, setSettingsPage] = useState<PageDocument>();
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarModal, setSidebarModal] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const [notice, setNotice] = useState<{
    message: string;
    tone: ToastTone;
    undo?: () => Promise<unknown> | void;
  }>();
  const notify = useCallback<Notify>(
    (message, options) =>
      setNotice({
        message,
        tone: options?.tone ?? "neutral",
        undo: options?.undo,
      }),
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
      notify(
        // The undo is what failed, so the change it was reversing is still in
        // place — saying only "could not be undone" leaves that ambiguous.
        "That change could not be undone and is still applied. Try again.",
        { tone: "error" },
      );
    }
  }

  function askScope(occurrence: Event, start: Date, end: Date) {
    // Captured before the dialog steals focus, so Alt+arrow keyboard editing
    // lands back on the event block it started from.
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return new Promise<EditScope | undefined>((resolve) => {
      setScopeRequest({
        resolve: (scope) => {
          setScopeRequest(undefined);
          resolve(scope);
        },
        returnFocus,
        timeLabel: getEventRangeLabel(
          { ...occurrence, end, start },
          settings.timeFormat,
        ),
        title: occurrence.title,
      });
    });
  }

  /**
   * Write a new time for an event, whatever gesture produced it. A series first
   * asks which occurrences it applies to; dismissing that writes nothing, and
   * the block is already back where it was.
   */
  async function commitEventTimes({
    end,
    event,
    start,
  }: {
    end: Date;
    event: Event;
    start: Date;
  }) {
    const master = getEventMaster(event);
    let scope: EditScope = "series";

    if (master.recurrence) {
      const chosen = await askScope(event, start, end);
      if (!chosen) return;
      scope = chosen;
    }

    const created: Event[] = [];
    const { creates, updates } = seriesEditWrites({
      edited: { ...event, end, start },
      master,
      occurrence: event,
      scope,
    });

    setBusyEventId(master.id);
    try {
      // Sequential: the update carries the exclusion that keeps the created
      // event from briefly showing twice.
      for (const update of updates) {
        await onUpdateEvent(update);
      }
      for (const create of creates) {
        created.push(await onCreateEvent(create));
      }
    } finally {
      setBusyEventId(undefined);
    }

    notify(
      start.getTime() === event.start.getTime()
        ? "Event resized."
        : "Event moved.",
      {
        undo: async () => {
          for (const event of created) {
            await onRemoveEvent(event);
          }
          await onUpdateEvent(master);
        },
      },
    );
  }
  const [createIntent, setCreateIntent] = useState<CreateIntent>();
  const [scopeRequest, setScopeRequest] = useState<{
    resolve: (scope: EditScope | undefined) => void;
    returnFocus: HTMLElement | null;
    timeLabel: string;
    title: string;
  }>();
  const [calendarTransfersOpen, setCalendarTransfersOpen] = useState(false);
  const [shareCalendar, setShareCalendar] = useState<Calendar | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const schedulingTriggerRef = useRef<HTMLButtonElement>(null);
  // Coming back from a provider's consent screen, the dialog that started the
  // link is long gone — so it reopens itself onto the freshly imported account.
  // Derived rather than set in an effect, and dismissible like any other close.
  const [linkNoticeDismissed, setLinkNoticeDismissed] = useState(false);
  const showConnections =
    connectionsOpen || (Boolean(providerLink?.linked) && !linkNoticeDismissed);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The event a time write is in flight for. One gesture at a time, so one id.
  const [busyEventId, setBusyEventId] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
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

  // The saved Page visibility with the session's temporary toggles on top.
  const visibleCalendarIds = useMemo(() => {
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
  }, [activePage, calendars, tempToggles]);

  // Density lives in the Page config, so "this page shows time grids compactly"
  // is saved with the page rather than being a device preference.
  const geometry = useMemo(
    () => createTimeGeometry(densityFromPageConfig(activePage.config)),
    [activePage.config],
  );

  const presentationView = activePage.config.view;
  const showWeekend =
    "weekend" in presentationView ? presentationView.weekend : true;
  const showAdjacentDays =
    "showAdjacentDays" in presentationView
      ? presentationView.showAdjacentDays
      : true;
  // How many weeks a multi-week page shows. Read from the Page rather than from
  // settings: a planning page wants eight, a "this fortnight" page wants two.
  const weeks =
    "weeks" in presentationView
      ? presentationView.weeks
      : DEFAULT_MULTI_WEEK_WEEKS;
  const multiWeek = activeView === "multi-week";
  // Whole weeks, split into blocks. The matrix decides how they are arranged.
  const multiWeekBlocks = useMemo(() => {
    if (!multiWeek) return [];
    const days = multiWeekDays(anchor, settings.weekStartsOn, weeks);

    return Array.from({ length: days.length / 7 }, (_, index) =>
      days.slice(index * 7, index * 7 + 7),
    );
  }, [anchor, multiWeek, settings.weekStartsOn, weeks]);

  const pageTitle = activePage.name;

  // The route remounts this component per page (key={pageId}), so switching
  // pages resets the temporary read filter for free.

  const visibleEvents = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLocaleLowerCase();

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
      notice.undo ? TOAST_UNDO_MS : TOAST_ACKNOWLEDGEMENT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const view = viewDefinition(activeView);
  const periodLabel = view.title(anchor, {
    compact: narrow,
    weekStartsOn: settings.weekStartsOn,
    weeks,
  });

  function changePeriod(offset: number) {
    onDateChange(toDateKey(view.step(anchor, offset, { weeks })));
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
      notify("You need edit access to a calendar to create events.", {
        tone: "error",
      });
      return;
    }

    const bounds = target.getBoundingClientRect();
    setCreateIntent({
      anchor: {
        returnFocus: target,
        // Beside the slot, level with its top: the popover opens next to what it
        // describes instead of on top of it, so the draft stays grabbable.
        x: point?.x ?? bounds.right,
        y: point?.y ?? bounds.top,
      },
      date: nextDate,
      endDate,
      endTime,
      id: Date.now(),
      startTime,
    });
  }

  /**
   * Move the open draft to a new slot. The intent keeps its id, so the popover
   * is not remounted and a title already typed into it survives the drag.
   */
  function moveCreateDraft(when: {
    color?: string;
    date: string;
    endDate?: string;
    endTime?: string;
    startTime?: string;
  }) {
    setCreateIntent((current) => current && { ...current, ...when });
  }

  function handleWorkspaceKeyDown(event: globalThis.KeyboardEvent) {
    const target = event.target;
    // An open layer owns the keyboard: a letter behind a dialog must not switch
    // the view under it. Radix gives popovers and dialogs both role="dialog".
    if (target instanceof Element && target.closest('[role="dialog"]')) {
      return;
    }

    const command = shortcutFor(event, {
      // A button is not typing, but Space and Enter are its own, and a letter
      // pressed on it is not aimed at the calendar either.
      typing:
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement,
    });
    if (!command) {
      return;
    }

    // Every shortcut runs the same path as its control, so the two cannot drift.
    switch (command.kind) {
      case "create": {
        const main = mainRef.current;
        if (!main) return;
        event.preventDefault();
        const bounds = main.getBoundingClientRect();
        openCreateAtDate(date, main, undefined, {
          point: { x: bounds.left + bounds.width / 2, y: bounds.top + 92 },
        });
        return;
      }
      case "help":
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      case "next":
        event.preventDefault();
        changePeriod(1);
        return;
      case "previous":
        event.preventDefault();
        changePeriod(-1);
        return;
      // Saving belongs to the page settings dialog, which owns the draft and
      // traps focus while it is open.
      case "save":
        return;
      case "search":
        event.preventDefault();
        searchRef.current?.focus();
        return;
      case "today":
        event.preventDefault();
        onDateChange(toDateKey(new Date()));
        return;
      case "view":
        event.preventDefault();
        onViewChange(command.view);
        return;
    }
  }

  // Shortcuts listen on the window, not on the workspace element: an app-level
  // key has to work when nothing in particular is focused. The handler is read
  // through a ref so it always sees current state without re-registering.
  const keyHandlerRef = useRef(handleWorkspaceKeyDown);
  useEffect(() => {
    keyHandlerRef.current = handleWorkspaceKeyDown;
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) =>
      keyHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  function handleToggleCalendar(calendarId: string) {
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

  /**
   * A new Page takes its name and icon from the dialog and everything else from
   * the state it was created in; its settings dialog owns the rest afterwards.
   * Errors surface in the dialog, which stays open, so the typed name survives.
   */
  async function createNewPage(input: { icon: PageIcon; name: string }) {
    const created = await onCreatePage({
      config: {
        ...newPageConfig(
          activeView,
          activePage.config.view,
          visibleCalendarIds,
        ),
        icon: input.icon,
      },
      name: input.name,
    });
    onPageChange(created.id);
  }

  return (
    <div className={styles.workspace}>
      <Sidebar
        activePageId={pageId}
        anchor={anchor}
        pages={pages}
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        onCreatePage={() => setNewPageOpen(true)}
        onDateChange={(nextDate) => {
          onDateChange(nextDate);
          setSidebarOpen(false);
        }}
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
        onOpenScheduling={() => {
          setSidebarOpen(false);
          setSchedulingOpen(true);
        }}
        onEditPage={(page) => {
          setSidebarOpen(false);
          setSettingsPage(page);
        }}
        onModalStateChange={setSidebarModal}
        onOpenSettings={() => {
          setSidebarOpen(false);
          setSettingsOpen(true);
        }}
        onPageChange={onPageChange}
        onReorderPages={(pageIds) =>
          // Rethrown so the sidebar knows to stop showing the order it asked for.
          onReorderPages(pageIds).catch((error: unknown) => {
            notify(
              "That order could not be saved. The pages went back to the order they were in.",
              { tone: "error" },
            );
            throw error;
          })
        }
        onSignOut={onSignOut}
        returnFocusRef={sidebarTriggerRef}
        syncLabel={
          offline
            ? "Offline — showing saved data"
            : isRefreshing
              ? "Refreshing server data…"
              : "Connected to server"
        }
        user={user}
        weekStartsOn={settings.weekStartsOn}
      />

      <main
        className={styles.main}
        id="main-content"
        inert={sidebarModal ? true : undefined}
        ref={mainRef}
      >
        {offline ? (
          <StaleBanner
            savedAt={snapshotAt}
            suffix="Changes cannot be saved until it is back."
          />
        ) : stale ? (
          <StaleBanner savedAt={snapshotAt} tone="refreshing" />
        ) : null}
        <Toolbar
          activeView={activeView}
          canCreateEvents={editableCalendars.length > 0}
          filtersOpen={filtersOpen}
          navigationTriggerRef={sidebarTriggerRef}
          onCreateEvent={(target) => openCreateAtDate(date, target)}
          onPeriodChange={changePeriod}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSearch={setSearchQuery}
          onToday={() => onDateChange(toDateKey(new Date()))}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          onViewChange={onViewChange}
          pageTitle={pageTitle}
          periodLabel={periodLabel}
          periodNavigation={activeView !== "agenda"}
          periodName={activeView === "agenda" ? "agenda start" : activeView}
          searchQuery={searchQuery}
          searchRef={searchRef}
        />

        {filtersOpen || compact ? (
          <section
            className={styles.filterBar}
            aria-labelledby="calendar-filter-label"
          >
            <SectionLabel
              className={styles.filterBarLabel}
              id="calendar-filter-label"
            >
              Visible calendars
            </SectionLabel>
            <div className={styles.filterCalendarList}>
              {calendars.map((calendar) => (
                <CalendarVisibilityPill
                  calendar={calendar}
                  key={calendar.id}
                  visible={visibleCalendarIds.includes(calendar.id)}
                  onVisibleChange={() => handleToggleCalendar(calendar.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <div
          className={`${styles.calendarArea} ${
            activeView === "month" ? styles.calendarAreaMonth : ""
          }`}
          data-calendar-area=""
          // Flick sideways to move a period, like the native client's pager.
          // Agenda is one continuous list, so it has no period to page.
          onPointerDown={
            view.swipeable ? swipePeriod.onPointerDown : undefined
          }
        >
          {activeView === "agenda" ? (
            <AgendaView
              anchor={anchor}
              calendars={calendars}
              events={visibleEvents}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onNotice={notify}
              onOpenFullEditor={onOpenFullEditor}
              onRemoveEvent={onRemoveEvent}
              onRestoreEvent={onCreateEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
              weekStartsOn={settings.weekStartsOn}
            />
          ) : activeView === "day" || activeView === "week" ? (
            <TimeGridView
              anchor={anchor}
              busyEventId={busyEventId}
              calendars={calendars}
              events={visibleEvents}
              geometry={geometry}
              pendingCreate={
                createIntent
                  ? {
                      color: createIntent.color,
                      date: createIntent.date,
                      endTime: createIntent.endTime,
                      startTime: createIntent.startTime,
                    }
                  : undefined
              }
              // The grid already shows the new position; this confirms it. A
              // rejection propagates so the drag reports it and the block snaps
              // back to the server's truth.
              onMoveDraft={moveCreateDraft}
              onMoveEvent={commitEventTimes}
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
              onCancelDraft={() => setCreateIntent(undefined)}
              onNotice={notify}
              onOpenFullEditor={onOpenFullEditor}
              onRemoveEvent={onRemoveEvent}
              onRestoreEvent={onCreateEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
              view={activeView}
              weekStartsOn={settings.weekStartsOn}
            />
          ) : multiWeek ? (
            <MultiWeekCalendar
              busyEventId={busyEventId}
              calendars={calendars}
              events={visibleEvents}
              getEventMaster={getEventMaster}
              onForkEvent={onForkEvent}
              onLinkEvent={onLinkEvent}
              onNotice={notify}
              onOpenFullEditor={onOpenFullEditor}
              onRemoveEvent={onRemoveEvent}
              onRestoreEvent={onCreateEvent}
              onSetAttendance={onSetAttendance}
              onUpdateEvent={onUpdateEvent}
              timeFormat={settings.timeFormat}
              user={user}
              weeks={multiWeekBlocks}
              weekStartsOn={settings.weekStartsOn}
            />
          ) : (
            <MonthCalendar
              anchor={anchor}
              busyEventId={busyEventId}
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
                await commitEventTimes({
                  end: new Date(event.end.getTime() + shift),
                  event,
                  start: new Date(event.start.getTime() + shift),
                });
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
              onCancelDraft={() => setCreateIntent(undefined)}
              onMonthChange={changePeriod}
              onMoveDraft={moveCreateDraft}
              pendingCreate={
                createIntent
                  ? {
                      color: createIntent.color,
                      date: createIntent.date,
                      endDate: createIntent.endDate,
                    }
                  : undefined
              }
              onNotice={notify}
              onOpenFullEditor={onOpenFullEditor}
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

        <ShortcutsDialog
          onOpenChange={setShortcutsOpen}
          open={shortcutsOpen}
        />

        {scopeRequest ? (
          <RecurrenceScopeDialog
            onResolve={scopeRequest.resolve}
            returnFocus={scopeRequest.returnFocus}
            timeLabel={scopeRequest.timeLabel}
            title={scopeRequest.title}
          />
        ) : null}

        {notice ? (
          <Toast
            action={
              notice.undo
                ? {
                    label: "Undo",
                    onClick: () => void runUndo(notice.undo),
                  }
                : undefined
            }
            className={styles.workspaceToast}
            message={notice.message}
            tone={notice.tone}
          />
        ) : null}
      </main>
      {createIntent ? (
        <QuickCreate
          anchor={createIntent.anchor}
          // Movable, but only within the calendar it belongs to.
          bounds={() => mainRef.current?.getBoundingClientRect()}
          calendars={editableCalendars}
          date={createIntent.date}
          email={user.email}
          endDate={createIntent.endDate}
          endTime={createIntent.endTime}
          isAllDay={Boolean(createIntent.endDate)}
          key={createIntent.id}
          onCreate={onCreateEvent}
          onCreated={() => notify("Event created.")}
          // The block on the grid and the fields in here describe one event, so
          // editing the time, the length or the calendar moves and recolours it.
          onDraftChange={(draft) =>
            moveCreateDraft({
              color: draft.color,
              date: draft.date,
              endDate: draft.isAllDay ? draft.endDate : undefined,
              endTime: draft.isAllDay ? undefined : draft.endTime,
              startTime: draft.isAllDay ? undefined : draft.startTime,
            })
          }
          onMoreOptions={
            onOpenFullEditor
              ? (values) => {
                  setCreateIntent(undefined);
                  onOpenFullEditor(values);
                }
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) {
              setCreateIntent(undefined);
            }
          }}
          open
          startTime={createIntent.startTime}
          timeFormat={settings.timeFormat}
          userId={user.id}
          weekStartsOn={settings.weekStartsOn}
        />
      ) : null}
      <CalendarTransferDialog
        calendars={calendars}
        onCreate={onCreateCalendar}
        onDisconnect={onDisconnectExternalCalendar}
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
      {showConnections ? (
        <ConnectionsDialog
          calendars={calendars}
          importFailed={providerLink?.error}
          importing={providerLink?.importing}
          onNotice={notify}
          onOpenChange={(open) => {
            if (!open) {
              setConnectionsOpen(false);
              setLinkNoticeDismissed(true);
            }
          }}
          open
          userId={user.id}
        />
      ) : null}
      {schedulingOpen ? (
        <SchedulingDialog
          calendars={calendars}
          onNotice={notify}
          onOpenChange={(open) => {
            if (!open) setSchedulingOpen(false);
          }}
          returnFocus={schedulingTriggerRef}
          weekStartsOn={settings.weekStartsOn}
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
      {newPageOpen ? (
        <NewPageDialog
          onCreate={createNewPage}
          onOpenChange={(open) => {
            if (!open) setNewPageOpen(false);
          }}
        />
      ) : null}
      {settingsPage ? (
        <PageSettingsDialog
          calendars={calendars}
          // The last page can't go: the server would backfill a fresh default
          // on the next read anyway.
          canDelete={pages.length > 1}
          key={settingsPage.id}
          onCreatePage={onCreatePage}
          onDeletePage={onDeletePage}
          onNotice={notify}
          onOpenChange={(open) => {
            if (!open) setSettingsPage(undefined);
          }}
          onOpenPage={onPageChange}
          onSavePage={async (input) => {
            const result = await onSavePage(input);
            // The page now says what it shows, so a stale temporary toggle would
            // silently invert the choice just saved.
            if (result.status === "saved") setTempToggles(new Set());
            return result;
          }}
          onSetDefaultPage={onSetDefaultPage}
          page={settingsPage}
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
        onManageAccount={() => {
          setSettingsOpen(false);
          setAccountOpen(true);
        }}
        onNotice={notify}
        onOpenChange={setSettingsOpen}
        onPatch={onPatchSettings}
        open={settingsOpen}
      />
    </div>
  );
}
