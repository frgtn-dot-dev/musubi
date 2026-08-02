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
              label: view.label,
              value: view.id as CalendarViewId,
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
              label: view.label,
              value: view.id as CalendarViewId,
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
            /* The label is dropped by CSS on a narrower toolbar, and a hidden
               label is a missing name — the icon alone says nothing to a screen
               reader. */
            aria-label="Filters"
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
