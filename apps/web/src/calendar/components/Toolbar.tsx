import {
  Check,
  ChevronLeft,
  ChevronRight,
  Menu,
  PencilLine,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { RefObject } from "react";
import { calendarViews, type CalendarViewId } from "../view-registry";
import type { Density } from "../time-geometry";
import styles from "./workspace.module.css";

type ToolbarProps = {
  activeView: CalendarViewId;
  canCreateEvents: boolean;
  draftName: string;
  /** Present only while editing a page whose view supports the option. */
  draftDensity?: Density;
  draftShowAdjacentDays?: boolean;
  draftShowWeekend?: boolean;
  editing: boolean;
  onDraftDensityChange?: (density: Density) => void;
  onDraftShowAdjacentDaysChange?: (show: boolean) => void;
  onDraftShowWeekendChange?: (show: boolean) => void;
  filtersOpen: boolean;
  onCreateEvent: (target: HTMLElement) => void;
  onDraftNameChange: (name: string) => void;
  onNotice: (message: string) => void;
  onOpenSidebar: () => void;
  onPeriodChange: (offset: number) => void;
  onSearch: (query: string) => void;
  onToday: () => void;
  onToggleEdit: () => void;
  onToggleFilters: () => void;
  onViewChange: (view: CalendarViewId) => void;
  pageTitle: string;
  periodLabel: string;
  periodName: string;
  searchQuery: string;
  /** So the "/" shortcut can put the caret in the field. */
  searchRef?: RefObject<HTMLInputElement | null>;
};

export function Toolbar({
  activeView,
  canCreateEvents,
  draftDensity,
  draftName,
  draftShowAdjacentDays,
  draftShowWeekend,
  editing,
  filtersOpen,
  onCreateEvent,
  onDraftDensityChange,
  onDraftNameChange,
  onDraftShowAdjacentDaysChange,
  onDraftShowWeekendChange,
  onNotice,
  onOpenSidebar,
  onPeriodChange,
  onSearch,
  onToday,
  onToggleEdit,
  onToggleFilters,
  onViewChange,
  pageTitle,
  periodLabel,
  periodName,
  searchQuery,
  searchRef,
}: ToolbarProps) {
  return (
    <header className={styles.toolbar}>
      {/* The page name lives in the sidebar and the theme in Settings, so read
          mode has no strip here at all. Edit mode still needs a field to rename
          the page, and it is the only thing that row carries. */}
      <h1 className={styles.srOnly}>{pageTitle}</h1>
      {editing ? (
        <div className={styles.toolbarTop}>
          <input
            aria-label="Page name"
            className={styles.pageNameInput}
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
          />
        </div>
      ) : null}

      <div className={styles.toolbarControls}>
        <div className={styles.dateControls}>
          <button
            className={`${styles.iconButton} ${styles.sidebarMenuButton}`}
            type="button"
            aria-label="Open navigation"
            onClick={onOpenSidebar}
          >
            <Menu aria-hidden="true" size={18} strokeWidth={1.6} />
          </button>
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
          {editing && draftDensity && onDraftDensityChange ? (
            <label className={styles.densityField}>
              <span className={styles.srOnly}>Row height</span>
              <select
                value={draftDensity}
                onChange={(event) =>
                  onDraftDensityChange(event.target.value as Density)
                }
              >
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
                <option value="spacious">Spacious</option>
              </select>
            </label>
          ) : null}
          {editing &&
          draftShowWeekend !== undefined &&
          onDraftShowWeekendChange ? (
            <label className={styles.presentationToggle}>
              <input
                checked={draftShowWeekend}
                type="checkbox"
                onChange={(event) =>
                  onDraftShowWeekendChange(event.target.checked)
                }
              />
              <span>Weekend</span>
            </label>
          ) : null}
          {editing &&
          draftShowAdjacentDays !== undefined &&
          onDraftShowAdjacentDaysChange ? (
            <label className={styles.presentationToggle}>
              <input
                checked={draftShowAdjacentDays}
                type="checkbox"
                onChange={(event) =>
                  onDraftShowAdjacentDaysChange(event.target.checked)
                }
              />
              <span>Nearby months</span>
            </label>
          ) : null}
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
          <button
            className={`${styles.iconButton} ${
              editing ? styles.buttonSelected : ""
            }`}
            type="button"
            aria-pressed={editing}
            aria-label={editing ? "Finish editing page" : "Edit page"}
            onClick={onToggleEdit}
          >
            {editing ? (
              <Check aria-hidden="true" size={17} strokeWidth={1.7} />
            ) : (
              <PencilLine aria-hidden="true" size={17} strokeWidth={1.6} />
            )}
          </button>
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
