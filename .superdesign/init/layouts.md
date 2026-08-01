# Layout inventory

Generated from the real codebase on 2026-08-01. The selected sources capture
application providers, desktop chrome, native navigation and onboarding framing.

## Layout hierarchy

- Web: root providers -> authenticated app route -> calendar workspace with
  toolbar, sidebar, content canvas and portal layers.
- Native: root providers -> Expo Router stacks -> tab shell or auth/onboarding
  stack -> screen-owned content and modal portals.
- Web responds at 599 / 1023 / 1439 px. Mobile uses platform navigation and
  safe-area insets rather than pretending to be the desktop shell.

## apps/web/src/routes/__root.tsx

```tsx
/// <reference types="vite/client" />

import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { type ReactNode, useSyncExternalStore } from "react";
import { AppErrorBoundary } from "~/components/AppErrorBoundary";
import { NotFound } from "~/components/NotFound";
import { useFocusMode } from "~/design/focus-mode";
import globalCss from "~/design/global.css?url";
import {
  getAppliedTheme,
  subscribeToTheme,
  THEME_BOOTSTRAP_SCRIPT,
} from "~/design/theme";
import tokensCss from "~/design/tokens.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: tokensCss },
      { rel: "stylesheet", href: globalCss },
    ],
    meta: [
      { title: "Musubi" },
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        name: "theme-color",
        content: "#f4f1e8",
      },
      {
        name: "description",
        content: "Musubi — the open, self-hostable shared calendar.",
      },
    ],
  }),
  errorComponent: (props) => (
    <RootDocument>
      <AppErrorBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: NotFound,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function ThemeSynchronizer() {
  useSyncExternalStore(subscribeToTheme, getAppliedTheme, () => "light");
  return null;
}

function FocusMode() {
  useFocusMode();
  return null;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          // Theme is applied before the body is painted to avoid a light flash.
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT,
          }}
        />
      </head>
      <body>
        <ThemeSynchronizer />
        <FocusMode />
        <a className="skip-link" href="#main-content">
          Skip to calendar
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

## apps/web/src/routes/app.tsx

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SessionGate } from "~/auth/SessionGate";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  return <SessionGate />;
}
```

## apps/web/src/calendar/components/Toolbar.tsx

```tsx
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { RefObject } from "react";
import { Button, IconButton } from "~/ui/Button";
import { Segmented } from "~/ui/Segmented";
import { Select } from "~/ui/Select";
import { useNarrowViewport } from "~/design/use-narrow-viewport";
import { calendarViews, type CalendarViewId } from "../view-registry";
import styles from "./workspace.module.css";

type ToolbarProps = {
  activeView: CalendarViewId;
  canCreateEvents: boolean;
  filtersOpen: boolean;
  navigationTriggerRef?: RefObject<HTMLButtonElement | null>;
  onCreateEvent: (target: HTMLElement) => void;
  onOpenSidebar: () => void;
  onPeriodChange: (offset: number) => void;
  onSearch: (query: string) => void;
  onToday: () => void;
  onToggleFilters: () => void;
  onViewChange: (view: CalendarViewId) => void;
  pageTitle: string;
  periodLabel: string;
  periodNavigation?: boolean;
  periodName: string;
  searchQuery: string;
  /** So the "/" shortcut can put the caret in the field. */
  searchRef?: RefObject<HTMLInputElement | null>;
};

export function Toolbar({
  activeView,
  canCreateEvents,
  filtersOpen,
  navigationTriggerRef,
  onCreateEvent,
  onOpenSidebar,
  onPeriodChange,
  onSearch,
  onToday,
  onToggleFilters,
  onViewChange,
  pageTitle,
  periodLabel,
  periodNavigation = true,
  periodName,
  searchQuery,
  searchRef,
}: ToolbarProps) {
  // A flick moves the period on touch, so the arrows are desktop furniture.
  const narrow = useNarrowViewport();

  return (
    <header className={styles.toolbar}>
      {/* The page name lives in the sidebar, its settings in the page dialog and
          the theme in Settings, so the toolbar carries no page strip at all. */}
      <h1 className={styles.srOnly}>{pageTitle}</h1>

      <div className={styles.toolbarControls}>
        <div className={styles.dateControls}>
          <IconButton
            className={styles.sidebarMenuButton}
            label="Open navigation"
            ref={navigationTriggerRef}
            size="compact"
            onClick={onOpenSidebar}
          >
            <Menu aria-hidden="true" size={18} strokeWidth={1.6} />
          </IconButton>
          <Button
            className={styles.todayButton}
            size="compact"
            variant="secondary"
            onClick={onToday}
          >
            Today
          </Button>
          {periodNavigation && !narrow ? (
            <div className={styles.navPair}>
              <IconButton
                label={`Previous ${periodName}`}
                size="compact"
                onClick={() => onPeriodChange(-1)}
              >
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.6} />
              </IconButton>
              <IconButton
                label={`Next ${periodName}`}
                size="compact"
                onClick={() => onPeriodChange(1)}
              >
                <ChevronRight aria-hidden="true" size={18} strokeWidth={1.6} />
              </IconButton>
            </div>
          ) : null}
          <p className={styles.monthTitle}>{periodLabel}</p>
        </div>

        {/* Four chips need a row of their own on a phone, and that row was the
            difference between a calendar and a control panel. Same choice, one
            control, on the line it already shares with the date. */}
        {narrow ? (
          <Select
            className={styles.viewSelect}
            label="Calendar view"
            options={calendarViews.map((view) => ({
              disabled: !view.enabled,
              label: view.label,
              value: view.id,
            }))}
            size="compact"
            value={activeView}
            onChange={(value) => onViewChange(value as CalendarViewId)}
          />
        ) : (
          <Segmented<CalendarViewId>
            className={styles.viewSwitcher}
            label="Calendar view"
            options={calendarViews.map((view) => ({
              disabled: !view.enabled,
              label: view.label,
              value: view.id,
            }))}
            value={activeView}
            onChange={onViewChange}
          />
        )}

        <div className={styles.toolbarActions}>
          <label className={styles.searchField}>
            <Search aria-hidden="true" size={17} strokeWidth={1.6} />
            <span className={styles.srOnly}>Search events</span>
            <input
              placeholder="Search"
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <Button
            aria-expanded={filtersOpen}
            className={styles.filterButton}
            icon={
              <SlidersHorizontal
                aria-hidden="true"
                size={17}
                strokeWidth={1.6}
              />
            }
            size="compact"
            variant="secondary"
            onClick={onToggleFilters}
          >
            Filters
          </Button>
          {canCreateEvents ? (
            <Button
              aria-label="Event"
              className={styles.eventButton}
              icon={<Plus aria-hidden="true" size={18} strokeWidth={1.7} />}
              size="compact"
              onClick={(event) => onCreateEvent(event.currentTarget)}
            >
              Event
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
```

## apps/web/src/calendar/components/Sidebar.tsx

```tsx
import {
  CircleCheck,
  Layers3,
  Link2,
  LogOut,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type {
  PageDocument,
  Settings as UserSettings,
  User,
} from "@musubi/types";
import type { CSSProperties } from "react";
import {
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { BrandMark } from "~/components/BrandMark";
import { Avatar } from "~/ui/Avatar";
import { IconButton } from "~/ui/Button";
import { RowAction } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { moveItem, previewIndex } from "../list-reorder";
import { sortPagesBy } from "../page-editor";
import { pageIconComponent, resolvePageIcon } from "../page-icons";
import { useListReorder } from "../use-list-reorder";
import { MiniCalendar } from "./MiniCalendar";
import styles from "./workspace.module.css";

type SidebarProps = {
  activePageId: string;
  /** The date the main view is on, so the mini calendar can mark it. */
  anchor: Date;
  isOpen: boolean;
  onClose: () => void;
  onCreatePage: () => void;
  onDateChange: (date: string) => void;
  onEditPage: (page: PageDocument) => void;
  onManageAccount: () => void;
  onManageCalendars: () => void;
  onManageConnections: () => void;
  onModalStateChange?: (modal: boolean) => void;
  onOpenSettings: () => void;
  onPageChange: (pageId: string) => void;
  /** The full page order after a move, which is what the endpoint takes. */
  onReorderPages: (pageIds: string[]) => Promise<unknown> | void;
  onSignOut: () => void;
  pages: PageDocument[];
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  syncLabel: string;
  user: Pick<User, "email" | "image" | "name">;
  weekStartsOn: UserSettings["weekStartsOn"];
};

export function Sidebar({
  activePageId,
  anchor,
  isOpen,
  onClose,
  onCreatePage,
  onEditPage,
  onManageAccount,
  onManageCalendars,
  onManageConnections,
  onModalStateChange,
  onOpenSettings,
  onDateChange,
  onPageChange,
  onReorderPages,
  onSignOut,
  pages,
  returnFocusRef,
  syncLabel,
  user,
  weekStartsOn,
}: SidebarProps) {
  const [signingOut, setSigningOut] = useState(false);
  const pageRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [reorderMessage, setReorderMessage] = useState("");
  /**
   * The order a drop asked for, held locally until the server's list shows it.
   *
   * Not cosmetic: React Query notifies subscribers in a later tick, so relying on
   * it would clear the drag's transforms one frame *before* the new order arrived
   * — and that frame shows the old order, which is the blink on drop. Owning the
   * order locally makes both changes land in the same commit.
   */
  const [committedOrder, setCommittedOrder] = useState<string[]>();
  const {
    begin: beginReorder,
    consumeClick: consumeReorderClick,
    drag: reorderDrag,
    settling: reorderSettling,
  } = useListReorder({
    onCommit: ({ from, to }) => {
      const pageIds = moveItem(pages, from, to).map((page) => page.id);
      setCommittedOrder(pageIds);
      void Promise.resolve(onReorderPages(pageIds)).catch(() =>
        // The write failed and the cache went back; stop overriding it.
        setCommittedOrder(undefined),
      );
    },
  });
  const orderedPages = committedOrder
    ? sortPagesBy(committedOrder, pages)
    : pages;
  // Once the server's list agrees, the local order has nothing left to say.
  if (
    committedOrder &&
    pages.length === committedOrder.length &&
    pages.every((page, index) => page.id === committedOrder[index])
  ) {
    setCommittedOrder(undefined);
  }
  /**
   * How far each row is displaced from where the DOM puts it.
   *
   * The DOM order never changes during a drag — rows are translated to their
   * preview slot instead, so they glide there and the held row can follow the
   * pointer exactly rather than being re-rendered under it.
   */
  function rowShift(index: number): number {
    if (!reorderDrag) return 0;
    if (index === reorderDrag.from) return reorderDrag.dy;

    const boxes = reorderDrag.boxes;
    const target = previewIndex(index, reorderDrag.from, reorderDrag.to);
    const from = boxes[index];
    const to = boxes[target];
    return from && to ? to.top - from.top : 0;
  }

  /** Keyboard equivalent of the drag (R10), on the row that has focus. */
  function movePageBy(index: number, offset: number) {
    const to = index + offset;
    if (to < 0 || to >= orderedPages.length) return;
    const page = orderedPages[index];
    if (!page) return;
    const pageIds = moveItem(orderedPages, index, to).map((item) => item.id);
    setCommittedOrder(pageIds);
    void Promise.resolve(onReorderPages(pageIds)).catch(() =>
      setCommittedOrder(undefined),
    );
    setReorderMessage(
      `${page.name} moved to ${to + 1} of ${orderedPages.length}.`,
    );
  }
  const [overlay, setOverlay] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnCloseRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const modal = overlay && isOpen;

  useEffect(() => {
    function syncOverlayState() {
      const value = sidebarRef.current
        ? window
            .getComputedStyle(sidebarRef.current)
            .getPropertyValue("--sidebar-overlay")
            .trim()
        : "0";
      setOverlay(value === "1");
    }

    syncOverlayState();
    window.addEventListener("resize", syncOverlayState);
    return () => window.removeEventListener("resize", syncOverlayState);
  }, []);

  useEffect(() => {
    onModalStateChange?.(modal);
    if (!modal) {
      return;
    }

    const focusFrame = requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      restoreFocusOnCloseRef.current = true;
      onModalStateChange?.(false);
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modal, onClose, onModalStateChange, returnFocusRef]);

  useEffect(() => {
    if (isOpen || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    const focusFrame = requestAnimationFrame(() =>
      returnFocusRef?.current?.focus(),
    );
    return () => cancelAnimationFrame(focusFrame);
  }, [isOpen, returnFocusRef]);

  function closeAndRestoreFocus() {
    restoreFocusOnCloseRef.current = true;
    onModalStateChange?.(false);
    onClose();
  }

  return (
    <>
      {isOpen ? (
        <button
          className={`${styles.sidebarBackdrop} ${styles.sidebarBackdropVisible}`}
          type="button"
          aria-label="Close navigation"
          onClick={closeAndRestoreFocus}
        />
      ) : null}
      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ""}`}
        aria-label="Workspace navigation"
        aria-hidden={overlay && !isOpen}
        inert={overlay && !isOpen}
        ref={sidebarRef}
      >
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <BrandMark className={styles.brandMark} />
            <span>MUSUBI</span>
          </div>
          <IconButton
            className={styles.mobileClose}
            label="Close navigation"
            ref={closeButtonRef}
            size="compact"
            onClick={closeAndRestoreFocus}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.7} />
          </IconButton>
        </div>

        <div className={styles.sidebarScroll}>
          <MiniCalendar
            anchor={anchor}
            onDateChange={onDateChange}
            weekStartsOn={weekStartsOn}
          />
          <nav className={styles.sidebarSection} aria-labelledby="pages-label">
            <SectionLabel className={styles.sidebarSectionLabel} id="pages-label">
              Pages
            </SectionLabel>
            <div
              className={styles.pageList}
              data-settling={reorderSettling ? "" : undefined}
            >
              {orderedPages.map((page, index) => (
                <PageRow
                  key={page.id}
                  active={page.id === activePageId}
                  held={reorderDrag?.from === index}
                  shift={rowShift(index)}
                  icon={pageIconComponent(
                    resolvePageIcon(page.config.icon, page.isDefault),
                  )}
                  name={page.name}
                  onEdit={() => onEditPage(page)}
                  onMoveBy={(offset) => movePageBy(index, offset)}
                  onPress={(event) =>
                    beginReorder({
                      boxes: pageRowRefs.current
                        .filter((node): node is HTMLDivElement => Boolean(node))
                        .map((node) => {
                          const box = node.getBoundingClientRect();
                          return { height: box.height, top: box.top };
                        }),
                      index,
                      pointerId: event.pointerId,
                      pointerType: event.pointerType,
                      time: event.timeStamp,
                      y: event.clientY,
                    })
                  }
                  onSelect={() => {
                    // A drag ended on this row; that release was not a choice.
                    if (consumeReorderClick()) return;
                    onPageChange(page.id);
                    onClose();
                  }}
                  ref={(node) => {
                    pageRowRefs.current[index] = node;
                  }}
                />
              ))}
              <RowAction
                className={styles.sidebarRow}
                icon={<Plus size={18} strokeWidth={1.5} />}
                label="New page"
                showChevron={false}
                size="compact"
                onClick={() => {
                  onCreatePage();
                  onClose();
                }}
              />
            </div>
            {/* Announces a keyboard move. A live region rather than role="status":
                the toast already owns that role, and two of them would make
                "the status message" ambiguous for both readers and tests. */}
            <span aria-live="polite" className={styles.srOnly}>
              {reorderMessage}
            </span>
          </nav>

          <nav className={styles.sidebarUtilities} aria-label="Manage Musubi">
            <RowAction
              className={styles.sidebarRow}
              icon={<Layers3 size={18} strokeWidth={1.6} />}
              label="Calendars"
              showChevron={false}
              size="compact"
              onClick={onManageCalendars}
            />
            <RowAction
              className={styles.sidebarRow}
              icon={<Link2 size={18} strokeWidth={1.6} />}
              label="Connections"
              showChevron={false}
              size="compact"
              onClick={onManageConnections}
            />
            <RowAction
              className={styles.sidebarRow}
              icon={<Settings size={18} strokeWidth={1.6} />}
              label="Settings"
              showChevron={false}
              size="compact"
              onClick={onOpenSettings}
            />
          </nav>
        </div>

        <footer className={styles.sidebarFooter}>
          <p className={styles.syncStatus}>
            <CircleCheck aria-hidden="true" size={15} strokeWidth={1.6} />
            {syncLabel}
          </p>
          <div className={styles.profile}>
            <RowAction
              className={styles.profileMain}
              aria-label="Manage account"
              detail={user.email}
              icon={<Avatar image={user.image} name={user.name} size={32} />}
              label={user.name}
              showChevron={false}
              onClick={onManageAccount}
            />
            <IconButton
              className={styles.profileSignOut}
              disabled={signingOut}
              label={`Sign out ${user.name}`}
              size="compact"
              onClick={() => {
                setSigningOut(true);
                onSignOut();
              }}
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.6} />
            </IconButton>
          </div>
        </footer>
      </aside>
    </>
  );
}

/**
 * A page row is two controls, not one: selecting the page, and opening its
 * settings. The settings button is quiet until the row is hovered or holds
 * focus — but it is a real, tabbable button, so the keyboard never depends on a
 * pointer state, and on touch (no hover) it stays visible.
 */
const PageRow = forwardRef<
  HTMLDivElement,
  {
    active: boolean;
    held: boolean;
    icon: LucideIcon;
    name: string;
    onEdit: () => void;
    onMoveBy: (offset: number) => void;
    onPress: (event: ReactPointerEvent<HTMLElement>) => void;
    onSelect: () => void;
    /** Vertical displacement from the row's DOM slot, in pixels. */
    shift: number;
  }
>(function PageRow(
  {
    active,
    held,
    icon: Icon,
    name,
    onEdit,
    onMoveBy,
    onPress,
    onSelect,
    shift,
  },
  ref,
) {
  return (
    <div
      className={styles.pageRow}
      data-held={held ? "" : undefined}
      ref={ref}
      style={{ "--row-shift": `${shift}px` } as CSSProperties}
    >
      <RowAction
        className={`${styles.sidebarRow} ${styles.pageRowMain}`}
        aria-current={active ? "page" : undefined}
        data-selected={active ? "" : undefined}
        icon={<Icon size={18} strokeWidth={1.6} />}
        label={name}
        showChevron={false}
        size="compact"
        onClick={onSelect}
        onKeyDown={(event) => {
          // Alt+arrows move the row, the same shape as Alt+arrows on an event.
          if (!event.altKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          onMoveBy(event.key === "ArrowDown" ? 1 : -1);
        }}
        onPointerDown={onPress}
      />
      <IconButton
        className={styles.pageRowEdit}
        label={`Edit ${name}`}
        size="compact"
        title="Page settings"
        onClick={onEdit}
      >
        <MoreHorizontal aria-hidden="true" size={16} strokeWidth={1.8} />
      </IconButton>
    </div>
  );
});
```

## apps/client/app/_layout.tsx

```tsx
import { ServerProvider, useServer } from '@/contexts/ServerContext';
import { useEffect, useRef, useState } from 'react';
import { View, useColorScheme } from 'react-native';
import { useSettingsStore } from '@/store/useSettingsStore';
import { activeScheme, applyTheme, colors, styles } from '@/constants/theme';
import { Stack, SplashScreen, useRouter, usePathname } from 'expo-router';
import { useFonts } from 'expo-font';
import { InterTight_400Regular, InterTight_500Medium } from '@expo-google-fonts/inter-tight';
import { NotoSerif_400Regular } from '@expo-google-fonts/noto-serif';
import { ShipporiMinchoB1_400Regular } from '@expo-google-fonts/shippori-mincho-b1';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PortalProvider } from '@/components/ui/Portal';
import { ToastHost } from '@/components/ui/Toast';
import { NetworkStatusBanner } from '@/components/ui/NetworkStatusBanner';
import * as SystemUI from 'expo-system-ui';
import semver from "semver";
import Constants from "expo-constants";
import UpdateRequiredModal from "@/components/UpdateRequiredModal";
import { apiVersion } from '@/constants/url';
import * as Linking from 'expo-linking';
import { File } from 'expo-file-system';
import { parseICS } from '@/lib/ics';
import { useImportStore } from '@/store/useImportStore';
import { fetchWithTimeout } from '@/lib/network';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { db } from '@/services/db';
import migrations from '@/drizzle/migrations';

SplashScreen.preventAutoHideAsync();

// An .ics opened via the OS ("Open in Musubi") arrives as a file/content/http
// URL. Read it, parse the first event, and stash it for the calendar screen.
async function readIcs(url: string): Promise<string | null> {
  try {
    if (url.startsWith('http')) return await (await fetchWithTimeout(url)).text();
    return await new File(url).text(); // file:// (iOS inbox, Android file) + content:// (SAF)
  } catch {
    // ponytail: some Android OEMs reject File.text() on content://; fetch as fallback.
    try { return await (await fetchWithTimeout(url)).text(); } catch { return null; }
  }
}

async function handleIncomingUrl(url: string | null) {
  if (!url) return;
  // Only .ics imports here — app-links (/invite) stay with expo-router.
  const isIcs = /\.ics(\?|$)/i.test(url) || url.startsWith('content:') || url.startsWith('file:');
  if (!isIcs) return;
  const text = await readIcs(url);
  const draft = text ? parseICS(text) : null;
  if (draft) useImportStore.getState().setPending(draft);
}

function AppContent() {
  const { success: migrated, error: migError } = useMigrations(db, migrations);
  useEffect(() => {
    if (migError) console.error("Migration failed:", migError);
  }, [migError]);

  const { isLoading, authClient, apiUrl } = useServer();
  const router = useRouter();

  const [loaded, error] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    NotoSerif_400Regular,
    ShipporiMinchoB1_400Regular,
  });

  const { data: session, isPending } = authClient.useSession();

  const [versionChecked, setVersionChecked] = useState(false);
  const [updateRequired, setUpdateRequired] = useState(false);
  const [requiredVersion, setRequiredVersion] = useState("");

  useEffect(() => {
    if (!apiUrl) {
      setVersionChecked(true);
      return;
    }
    fetchWithTimeout(`${apiUrl}/api/${apiVersion}/server`)
      .then(r => r.json())
      .then(({ minClientVersion }: { minClientVersion: string }) => {
        const clientVersion = Constants.expoConfig?.version ?? "0.0.0";
        if (semver.lt(clientVersion, minClientVersion)) {
          setRequiredVersion(minClientVersion);
          setUpdateRequired(true);
        }
      })
      .catch(() => { })
      .finally(() => setVersionChecked(true));
  }, [apiUrl]);

  const ready = (loaded || !!error) && !isPending && !isLoading && versionChecked && migrated;

  const everReady = useRef(false);
  if (ready) everReady.current = true;

  // The cold-start URL, resolved explicitly. `pathname` alone can't be trusted
  // here: expo-router processes the initial URL asynchronously, so at nav time
  // it may still read "/" even though the app was opened via an invite link —
  // the replace below would then close the invite screen right after it
  // flashed in. undefined = still resolving, null = no deep link.
  const [initialUrl, setInitialUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { Linking.getInitialURL().then(u => setInitialUrl(u ?? null)); }, []);

  const navigated = useRef(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!ready || navigated.current || updateRequired || initialUrl === undefined) return;
    navigated.current = true;
    // Cold start via a deep link (invite/[token], Android agenda widget, …)
    // lands on its own route — replacing it with the tabs would close the
    // screen under the user.
    const inviteStart = pathname.startsWith('/invite') || initialUrl?.includes('/invite/');
    const agendaStart = pathname === '/agenda' || initialUrl?.startsWith('musubi://agenda');
    const calendarStart = !!initialUrl?.startsWith('musubi:///?time=')
      || !!initialUrl?.startsWith('musubi:///?calendarWidgetId=');
    // Invite routes handle signed-out users themselves: they persist the token,
    // open auth, then restore the invite after a successful sign-in/sign-up.
    // Keeping the route alive here also covers expo-router resolving the deep
    // link a moment after `pathname` initially reported "/".
    if (inviteStart || (session && (agendaStart || calendarStart))) return;
    router.replace(session ? '/(tabs)' : '/(auth)/welcome');
  }, [ready, updateRequired, initialUrl, pathname, router, session]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Handle .ics files opened via the OS (cold start + while running).
  useEffect(() => {
    Linking.getInitialURL().then(handleIncomingUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleIncomingUrl(url));
    return () => sub.remove();
  }, []);

  if (!everReady.current) return null;

  if (updateRequired) {
    return (
      <UpdateRequiredModal
        currentVersion={Constants.expoConfig?.version ?? "0.0.0"}
        requiredVersion={requiredVersion}
      />
    );
  }

  return (
    <Stack screenOptions={{ statusBarStyle: activeScheme === 'dark' ? 'light' : 'dark', navigationBarHidden: true, headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}

function AppLoader() {
  const { apiUrl } = useServer();

  // Theme comes straight from the settings store, which seeds itself
  // SYNCHRONOUSLY from the local SQLite snapshot (see useSettingsStore) — the
  // very first frame is already in the last-known theme, no flash of the
  // system theme (or a blank window) while anything loads.

  // Resolve the theme: user preference wins, "system" follows the device.
  const deviceScheme = useColorScheme();
  const themePref = useSettingsStore(s => s.theme);
  const scheme = themePref === 'system' ? (deviceScheme === 'light' ? 'light' : 'dark') : themePref;

  // Swap the palette BEFORE children render. Plain call, NOT useMemo — the
  // React Compiler assumes memo callbacks are pure and eliminates unused ones,
  // which silently dropped this side effect. Idempotent, so calling every
  // render is fine; key={scheme} below remounts the tree to repaint.
  applyTheme(scheme);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg);
  }, [scheme]);

  return (
    // Status bar style is driven by the root Stack's `statusBarStyle` (VC-based,
    // needs UIViewControllerBasedStatusBarAppearance=YES). We deliberately do NOT
    // also mount expo-status-bar's <StatusBar> — that's the imperative
    // RCTStatusBarManager path, which requires the key be NO and conflicts.
    <SafeAreaView key={scheme} style={styles.screen} edges={['top', 'left', 'right']}>
      <NetworkStatusBanner />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppContent key={apiUrl ?? 'loading'} />
      </View>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ServerProvider>
        {/* Portal host lives here — under ServerProvider (portaled modals keep
            useServer) and SafeAreaProvider (expo-router root, above), and its
            overlay host renders above AppLoader = above every screen. */}
        <PortalProvider>
          <AppLoader />
        </PortalProvider>
      </ServerProvider>
      <ToastHost />
    </GestureHandlerRootView>
  );
}
```

## apps/client/app/(tabs)/_layout.tsx

```tsx
import { colors, fonts } from '@/constants/theme';
import { TAB_BAR_ITEM_HEIGHT, TAB_BAR_LABEL_FONT_SIZE, TAB_BAR_TOP_INSET, tabBarBottomInset, tabBarHeight } from '@/constants/layout';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useServer } from '@/contexts/ServerContext';
import { useConnectToEventStream } from '@/hooks/useEventsStream';
import { Feather } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { getOnboardingRoute } from '@/lib/onboardingState';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useRefreshData } from '@/hooks/useRefreshData';
import { useEventsStore } from '@/store/useEventsStore';
import { useCalendarsStore } from '@/store/useCalendarsStore';
import { cacheGetAllEvents, cacheGetCalendars } from '@/services/eventsCache';
import { select } from '@/lib/haptics';
import { onSessionExpired, signOutAndReset } from '@/lib/signOut';
import { GlobalEventModals } from '@/components/calendar/GlobalEventModals';
import { startAgendaWidgetSync } from '@/services/agendaWidget';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


export default function TabLayout() {
  const { apiUrl, isLoading, authClient } = useServer();
  const insets = useSafeAreaInsets();
  const tabBarLabels = useSettingsStore(s => s.tabBarLabels);
  const bottomInset = tabBarBottomInset(insets.bottom, tabBarLabels);

  // Expired session → any API call 401s → run the full sign-out flow once and
  // land on welcome, instead of every screen failing silently.
  useEffect(() => onSessionExpired(() => {
    signOutAndReset(authClient).catch(e => console.warn("Session expiry recovery failed:", e));
  }), [authClient]);
  const refresh = useRefreshData();
  const { loadEvents } = useEventsStore();
  const { loadCalendars } = useCalendarsStore();
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    // Server context is still hydrating — keep overlay visible
    if (isLoading) return;

    // No server URL configured — show the app empty rather than loading forever
    if (!apiUrl) {
      setDataReady(true);
      return;
    }

    const load = async () => {
      try {
        // instant render from the local cache (calendars too, so activeCals is
        // populated and events aren't filtered out), then sync over the network
        const [cachedCals, cachedEvents] = await Promise.all([cacheGetCalendars(), cacheGetAllEvents()]);
        loadCalendars(cachedCals);
        loadEvents(cachedEvents);
        setDataReady(true);
        await refresh();
      } catch (e: any) {
        console.error("Could not fetch initial data:", e?.message, e?.status, e);
      } finally {
        setDataReady(true);
      }
    };
    load();
  }, [apiUrl, isLoading]);

  useConnectToEventStream();

  // The native Android widget reads a compact persistent snapshot rather than
  // depending on a live React process. Start only after the cache hydrate so a
  // cold launch never replaces the last useful widget data with an empty store.
  useEffect(() => {
    if (!dataReady) return;
    return startAgendaWidgetSync();
  }, [dataReady]);

  // First sign-in (any method incl. Google): settings arrive with
  // onboarded=false → hand over to onboarding, resuming at the last step the
  // user reached (an OAuth connect round-trip lands back here mid-flow).
  const onboarded = useSettingsStore(s => s.onboarded);
  useEffect(() => {
    // `as any`: expo-router's typed routes regenerate on the next dev run
    if (dataReady && !onboarded) router.replace(getOnboardingRoute() as any);
  }, [dataReady, onboarded]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Tabs
        // Android back from any tab returns to Home first, then backgrounds —
        // instead of hiding the app immediately.
        backBehavior="initialRoute"
        screenListeners={{ tabPress: () => select() }}
        screenOptions={{
          tabBarStyle: {
            backgroundColor: colors.bg1,
            borderTopColor: colors.line,
            borderTopWidth: 1,
            height: tabBarHeight(insets.bottom, tabBarLabels),
            paddingTop: TAB_BAR_TOP_INSET,
            paddingBottom: bottomInset,
          },
          tabBarItemStyle: {
            height: TAB_BAR_ITEM_HEIGHT,
            paddingVertical: 0,
          },
          tabBarShowLabel: tabBarLabels,
          tabBarLabelStyle: { fontFamily: fonts.sans, fontSize: TAB_BAR_LABEL_FONT_SIZE },
          tabBarActiveTintColor: colors.fg,
          tabBarInactiveTintColor: colors.fg3,
          headerShown: false,
        }}
      >
        <Tabs.Screen name="index" options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color }) => <Feather size={20} name='calendar' color={color} />,
        }} />
        <Tabs.Screen name="calendars" options={{
          title: "Calendars",
          headerShown: false,
          tabBarIcon: ({ color }) => <Feather size={20} name='layers' color={color} />,
        }} />
        <Tabs.Screen name="agenda" options={{
          title: "Agenda",
          headerShown: false,
          tabBarIcon: ({ color }) => <Feather size={20} name='list' color={color} />,
        }} />
        <Tabs.Screen name="settings" options={{
          title: "Settings",
          headerShown: false,
          tabBarIcon: ({ color }) => <Feather size={20} name='settings' color={color} />,
        }} />
      </Tabs>

      <GlobalEventModals />
      <LoadingOverlay ready={dataReady} />
    </GestureHandlerRootView>
  );
}
```

## apps/client/app/(auth)/_layout.tsx

```tsx
import { colors } from '@/constants/theme';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function AuthLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </GestureHandlerRootView>
  );
}
```

## apps/client/app/onboarding/_layout.tsx

```tsx
import { Stack } from "expo-router";
import { colors } from "@/constants/theme";

// Each onboarding step is its own route: hardware back pops a step natively,
// and an OAuth round-trip can't reset local step state.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
```

## apps/client/components/OnboardingScaffold.tsx

```tsx
import { ReactNode, useEffect } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { colors, fonts, styles } from "@/constants/theme";
import { setOnboardingRoute } from "@/lib/onboardingState";

// Shared frame for the onboarding steps: progress dots, kanji header,
// keyboard handling, bottom action row. Also records the current route so a
// re-entry (e.g. after an OAuth round-trip) resumes at the same step.
export function OnboardingScaffold({ step, kanji, title, subtitle, actions, children }: {
  step: 1 | 2 | 3 | 4;
  kanji: string;
  title: string;
  subtitle: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  useEffect(() => { setOnboardingRoute(pathname); }, [pathname]);

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", paddingTop: 16 }}>
            {[1, 2, 3, 4].map((s) => (
              <View key={s} style={{
                width: s === step ? 18 : 6, height: 6, borderRadius: 3,
                backgroundColor: s === step ? colors.fg2 : colors.line3,
              }} />
            ))}
          </View>

          <View style={{ alignItems: "center", paddingTop: 32, paddingBottom: 28, gap: 12 }}>
            <Text style={{ fontFamily: fonts.kanji, fontSize: 52, color: colors.fg3 }}>{kanji}</Text>
            <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: colors.fg }}>{title}</Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3, textAlign: "center", paddingHorizontal: 32 }}>
              {subtitle}
            </Text>
          </View>

          {children}
        </ScrollView>

        <View style={styles.screenActions}>
          {actions}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
```


