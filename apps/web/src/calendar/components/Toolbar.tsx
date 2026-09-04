import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Menu as MenuIcon,
  Plus,
  Search,
} from "lucide-react";
import { useRef, type RefObject } from "react";
import { Button, IconButton } from "~/ui/Button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/ui/Menu";
import { Segmented } from "~/ui/Segmented";
import { Select } from "~/ui/Select";
import { useNarrowViewport } from "~/design/use-narrow-viewport";
import { offeredViews, type CalendarViewId } from "../view-registry";
import styles from "./workspace.module.css";

type ToolbarProps = {
  activeView: CalendarViewId;
  canCreateEvents: boolean;
  canCreateTasks: boolean;
  navigationTriggerRef?: RefObject<HTMLButtonElement | null>;
  onCreateEvent: (target: HTMLElement) => void;
  onCreateTask: () => void;
  onOpenSearch: () => void;
  onOpenSidebar: () => void;
  onPeriodChange: (offset: number) => void;
  onToday: () => void;
  onViewChange: (view: CalendarViewId) => void;
  pageTitle: string;
  periodLabel: string;
  periodNavigation?: boolean;
  periodName: string;
  searchTriggerRef?: RefObject<HTMLButtonElement | null>;
};

export function Toolbar({
  activeView,
  canCreateEvents,
  canCreateTasks,
  navigationTriggerRef,
  onCreateEvent,
  onCreateTask,
  onOpenSearch,
  onOpenSidebar,
  onPeriodChange,
  onToday,
  onViewChange,
  pageTitle,
  periodLabel,
  periodNavigation = true,
  periodName,
  searchTriggerRef,
}: ToolbarProps) {
  // A flick moves the period on touch, so the arrows are desktop furniture.
  const narrow = useNarrowViewport();
  const createTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <header className={styles.toolbar}>
      {/* The page name lives in the sidebar, its settings in the page dialog and
          the theme in Settings, so the toolbar carries no page strip at all. */}
      <h1 className={styles.visuallyHidden}>{pageTitle}</h1>

      <div className={styles.toolbarControls}>
        <div className={styles.dateControls}>
          <IconButton
            className={styles.sidebarMenuButton}
            label="Open navigation"
            ref={navigationTriggerRef}
            size="compact"
            onClick={onOpenSidebar}
          >
            <MenuIcon aria-hidden="true" size={18} strokeWidth={1.6} />
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
          <p className={styles.monthTitle} data-view={activeView}>
            {periodLabel}
          </p>
        </div>

        {/* Four chips need a row of their own on a phone, and that row was the
            difference between a calendar and a control panel. Same choice, one
            control, on the line it already shares with the date. */}
        {narrow ? (
          <Select
            className={styles.viewSelect}
            label="Calendar view"
            options={offeredViews().map((view) => ({
              label: view.label,
              value: view.id as CalendarViewId,
            }))}
            size="compact"
            value={activeView}
            onChange={(value) => onViewChange(value as CalendarViewId)}
          />
        ) : null}

        <div className={styles.toolbarActions}>
          <IconButton
            className={styles.searchButton}
            label="Search events and actions"
            ref={searchTriggerRef}
            size="compact"
            onClick={onOpenSearch}
          >
            <Search aria-hidden="true" size={17} strokeWidth={1.6} />
          </IconButton>
          {narrow ? null : (
            <Segmented<CalendarViewId>
              className={styles.viewSwitcher}
              label="Calendar view"
              options={offeredViews().map((view) => ({
                label: view.label,
                value: view.id as CalendarViewId,
              }))}
              value={activeView}
              onChange={onViewChange}
            />
          )}
          {canCreateEvents || canCreateTasks ? (
            <Menu>
              <MenuTrigger asChild>
                <IconButton
                  className={styles.eventButton}
                  label="Create"
                  ref={createTriggerRef}
                  size="compact"
                  variant="primary"
                >
                  <Plus aria-hidden="true" size={18} strokeWidth={1.7} />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end" label="Create">
                <MenuItem
                  disabled={!canCreateEvents}
                  icon={<CalendarPlus size={16} strokeWidth={1.7} />}
                  onSelect={() => {
                    const target = createTriggerRef.current;
                    if (target) onCreateEvent(target);
                  }}
                >
                  Event
                </MenuItem>
                <MenuItem
                  disabled={!canCreateTasks}
                  icon={<ListTodo size={16} strokeWidth={1.7} />}
                  onSelect={onCreateTask}
                >
                  Task
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </div>
      </div>
    </header>
  );
}
