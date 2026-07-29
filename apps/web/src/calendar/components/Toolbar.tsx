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
import { Button, IconButton } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { Segmented } from "~/ui/Segmented";
import { Select } from "~/ui/Select";
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
  navigationTriggerRef?: RefObject<HTMLButtonElement | null>;
  onCreateEvent: (target: HTMLElement) => void;
  onDraftNameChange: (name: string) => void;
  onOpenSidebar: () => void;
  onPeriodChange: (offset: number) => void;
  onSearch: (query: string) => void;
  onToday: () => void;
  onToggleEdit: () => void;
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
  draftDensity,
  draftName,
  draftShowAdjacentDays,
  draftShowWeekend,
  editing,
  filtersOpen,
  navigationTriggerRef,
  onCreateEvent,
  onDraftDensityChange,
  onDraftNameChange,
  onDraftShowAdjacentDaysChange,
  onDraftShowWeekendChange,
  onOpenSidebar,
  onPeriodChange,
  onSearch,
  onToday,
  onToggleEdit,
  onToggleFilters,
  onViewChange,
  pageTitle,
  periodLabel,
  periodNavigation = true,
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
          <div className={styles.pageEditOptions}>
            {draftDensity && onDraftDensityChange ? (
              <label className={styles.densityField}>
                <span className={styles.srOnly}>Row height</span>
                <Select
                  label="Row height"
                  options={[
                    { label: "Compact", value: "compact" },
                    { label: "Comfortable", value: "comfortable" },
                    { label: "Spacious", value: "spacious" },
                  ]}
                  size="compact"
                  value={draftDensity}
                  onChange={(value) =>
                    onDraftDensityChange(value as Density)
                  }
                />
              </label>
            ) : null}
            {draftShowWeekend !== undefined &&
            onDraftShowWeekendChange ? (
              <Checkbox
                checked={draftShowWeekend}
                className={styles.presentationToggle}
                label="Weekend"
                onChange={(event) =>
                  onDraftShowWeekendChange(event.target.checked)
                }
              />
            ) : null}
            {draftShowAdjacentDays !== undefined &&
            onDraftShowAdjacentDaysChange ? (
              <Checkbox
                checked={draftShowAdjacentDays}
                className={styles.presentationToggle}
                label="Nearby months"
                onChange={(event) =>
                  onDraftShowAdjacentDaysChange(event.target.checked)
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

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
          {periodNavigation ? (
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
          <IconButton
            aria-pressed={editing}
            label={editing ? "Finish editing page" : "Edit page"}
            size="compact"
            onClick={onToggleEdit}
          >
            {editing ? (
              <Check aria-hidden="true" size={17} strokeWidth={1.7} />
            ) : (
              <PencilLine aria-hidden="true" size={17} strokeWidth={1.6} />
            )}
          </IconButton>
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
