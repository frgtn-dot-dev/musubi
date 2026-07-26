import type { Calendar, Event } from "@musubi/types";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { calendarViews, type CalendarViewId } from "../view-registry";
import { QuickCreate } from "./QuickCreate";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./workspace.module.css";

type ToolbarProps = {
  activeView: CalendarViewId;
  calendars: Calendar[];
  createDate: string;
  createOpen: boolean;
  dirty: boolean;
  filtersOpen: boolean;
  monthLabel: string;
  onCreate: (event: Event) => void;
  onCreateOpenChange: (open: boolean) => void;
  onMonthChange: (offset: number) => void;
  onNotice: (message: string) => void;
  onOpenSidebar: () => void;
  onSearch: (query: string) => void;
  onToday: () => void;
  onToggleFilters: () => void;
  onViewChange: (view: CalendarViewId) => void;
  pageTitle: string;
  searchQuery: string;
};

export function Toolbar({
  activeView,
  calendars,
  createDate,
  createOpen,
  dirty,
  filtersOpen,
  monthLabel,
  onCreate,
  onCreateOpenChange,
  onMonthChange,
  onNotice,
  onOpenSidebar,
  onSearch,
  onToday,
  onToggleFilters,
  onViewChange,
  pageTitle,
  searchQuery,
}: ToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.toolbarTop}>
        <div className={styles.pageTitleGroup}>
          <button
            className={`${styles.iconButton} ${styles.sidebarMenuButton}`}
            type="button"
            aria-label="Open navigation"
            onClick={onOpenSidebar}
          >
            <Menu aria-hidden="true" size={18} strokeWidth={1.6} />
          </button>
          <h1>{pageTitle}</h1>
          {dirty ? (
            <span className={styles.dirtyStatus}>
              <span aria-hidden="true" />
              Page changed
            </span>
          ) : null}
        </div>
        <ThemeToggle />
      </div>

      <div className={styles.toolbarControls}>
        <div className={styles.dateControls}>
          <button className={styles.secondaryButton} type="button" onClick={onToday}>
            Today
          </button>
          <div className={styles.navPair}>
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => onMonthChange(-1)}
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onMonthChange(1)}
            >
              <ChevronRight aria-hidden="true" size={18} strokeWidth={1.6} />
            </button>
          </div>
          <p className={styles.monthTitle}>{monthLabel}</p>
        </div>

        <div className={styles.viewSwitcher} aria-label="Calendar view">
          {calendarViews.map((view) => (
            <button
              className={`${styles.viewButton} ${
                view.id === activeView ? styles.viewButtonActive : ""
              } ${view.enabled ? "" : styles.viewButtonPlanned}`}
              type="button"
              aria-pressed={view.id === activeView}
              key={view.id}
              onClick={() => {
                if (view.enabled) {
                  onViewChange(view.id);
                } else {
                  onNotice(`${view.label} view follows the Month vertical slice.`);
                }
              }}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className={styles.toolbarActions}>
          <label className={styles.searchField}>
            <Search aria-hidden="true" size={17} strokeWidth={1.6} />
            <span className={styles.srOnly}>Search events</span>
            <input
              placeholder="Search"
              type="search"
              value={searchQuery}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <button
            className={`${styles.secondaryButton} ${
              filtersOpen ? styles.buttonSelected : ""
            }`}
            type="button"
            aria-expanded={filtersOpen}
            onClick={onToggleFilters}
          >
            <SlidersHorizontal aria-hidden="true" size={17} strokeWidth={1.6} />
            <span>Filters</span>
          </button>
          <QuickCreate
            calendars={calendars}
            date={createDate}
            onCreate={onCreate}
            onOpenChange={onCreateOpenChange}
            open={createOpen}
          />
        </div>
      </div>
    </header>
  );
}
