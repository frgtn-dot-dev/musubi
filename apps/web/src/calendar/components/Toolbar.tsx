import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { calendarViews, type CalendarViewId } from "../view-registry";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./workspace.module.css";

type ToolbarProps = {
  activeView: CalendarViewId;
  canCreateEvents: boolean;
  filtersOpen: boolean;
  onCreateEvent: (target: HTMLElement) => void;
  onNotice: (message: string) => void;
  onOpenSidebar: () => void;
  onPeriodChange: (offset: number) => void;
  onSearch: (query: string) => void;
  onToday: () => void;
  onToggleFilters: () => void;
  onViewChange: (view: CalendarViewId) => void;
  pageTitle: string;
  periodLabel: string;
  periodName: string;
  searchQuery: string;
};

export function Toolbar({
  activeView,
  canCreateEvents,
  filtersOpen,
  onCreateEvent,
  onNotice,
  onOpenSidebar,
  onPeriodChange,
  onSearch,
  onToday,
  onToggleFilters,
  onViewChange,
  pageTitle,
  periodLabel,
  periodName,
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
              aria-label={`Previous ${periodName}`}
              onClick={() => onPeriodChange(-1)}
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              aria-label={`Next ${periodName}`}
              onClick={() => onPeriodChange(1)}
            >
              <ChevronRight aria-hidden="true" size={18} strokeWidth={1.6} />
            </button>
          </div>
          <p className={styles.monthTitle}>{periodLabel}</p>
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
          {canCreateEvents ? (
            <button
              aria-label="Event"
              className={styles.eventButton}
              type="button"
              onClick={(event) => onCreateEvent(event.currentTarget)}
            >
              <Plus aria-hidden="true" size={18} strokeWidth={1.7} />
              <span>Event</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
