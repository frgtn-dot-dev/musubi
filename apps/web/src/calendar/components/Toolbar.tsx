import { Popover, PopoverContent, PopoverTrigger } from "~/ui/Popover";
import { Row } from "~/ui/Row";
import { Switch } from "~/ui/Switch";
import { SettingsSection } from "~/ui/SettingsSection";
import {
  CalendarPlus,
  Clock,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Users,
  Menu as MenuIcon,
  Plus,
  Search,
} from "lucide-react";
import { useState, useRef, type RefObject } from "react";
import { Button, IconButton } from "~/ui/Button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/ui/Menu";
import { Segmented } from "~/ui/Segmented";
import { Select } from "~/ui/Select";
import { useNarrowViewport } from "~/design/use-narrow-viewport";
import { offeredViews, type CalendarViewId } from "../view-registry";
import { CalendarCoverageInfo } from "./CalendarCoverageInfo";
import styles from "./workspace.module.css";

type ToolbarProps = {
  availability?: { shown: boolean; onToggle: () => void; onOpenList: (target: HTMLElement | null) => void };
  activeView: CalendarViewId;
  canCreateEvents: boolean;
  canCreateMeetings: boolean;
  canCreateTasks: boolean;
  coverageNotice?: string | null;
  navigationTriggerRef?: RefObject<HTMLButtonElement | null>;
  onCreateEvent: (target: HTMLElement) => void;
  onCreateMeeting: (target: HTMLElement) => void;
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
  availability,
  activeView,
  canCreateEvents,
  canCreateMeetings,
  canCreateTasks,
  coverageNotice,
  navigationTriggerRef,
  onCreateEvent,
  onCreateMeeting,
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
  const createAfterClose = useRef<"event" | "meeting" | null>(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const availabilityTriggerRef = useRef<HTMLButtonElement>(null);
  const availabilityListAfterClose = useRef(false);

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

        {/* Container queries expose exactly one view choice. The calendar can
            be compact beside an inspector even on a wide desktop window. */}
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

        <div className={styles.toolbarActions}>
          {coverageNotice ? <CalendarCoverageInfo message={coverageNotice} /> : null}
          {availability ? <Popover open={availabilityOpen} onOpenChange={setAvailabilityOpen}>
            <PopoverTrigger asChild><IconButton label="Availability" ref={availabilityTriggerRef} size="compact"><Clock aria-hidden="true" size={17} strokeWidth={1.6} /></IconButton></PopoverTrigger>
            <PopoverContent aria-label="Grid availability" align="end" onCloseAutoFocus={event => { if (availabilityListAfterClose.current) { event.preventDefault(); availabilityListAfterClose.current = false; availabilityTriggerRef.current?.focus(); availability.onOpenList(availabilityTriggerRef.current); } }}>
              <SettingsSection title="Availability">
                <Row label="Show selected availability" detail="Only on this page in this session" trailing={<Switch label="Show selected availability" checked={availability.shown} onCheckedChange={availability.onToggle} />} />
                <Button variant="secondary" onClick={() => { availabilityListAfterClose.current = true; setAvailabilityOpen(false); }}>Sources and interval list</Button>
              </SettingsSection>
            </PopoverContent>
          </Popover> : null}
          <IconButton
            className={styles.searchButton}
            label="Search events and actions"
            ref={searchTriggerRef}
            size="compact"
            onClick={onOpenSearch}
          >
            <Search aria-hidden="true" size={17} strokeWidth={1.6} />
          </IconButton>
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
          {canCreateEvents || canCreateMeetings || canCreateTasks ? (
            <Menu>
              <MenuTrigger asChild>
                <IconButton
                  className={styles.eventButton}
                  label="Create event, meeting or task"
                  ref={createTriggerRef}
                  size="compact"
                  variant="primary"
                >
                  <Plus aria-hidden="true" size={18} strokeWidth={1.7} />
                </IconButton>
              </MenuTrigger>
              <MenuContent
                align="end"
                label="Create"
                mobileSurface="anchored"
                onCloseAutoFocus={(event) => {
                  const action = createAfterClose.current;
                  if (!action) return;
                  createAfterClose.current = null;
                  const target = createTriggerRef.current;
                  if (!target) return;
                  // Finish the outgoing menu's focus lifecycle before mounting
                  // the form, so it cannot dismiss the newly opened popover.
                  event.preventDefault();
                  if (action === "meeting") onCreateMeeting(target);
                  else onCreateEvent(target);
                }}
              >
                <MenuItem
                  disabled={!canCreateEvents}
                  icon={<CalendarPlus size={16} strokeWidth={1.7} />}
                  onSelect={() => {
                    createAfterClose.current = "event";
                  }}
                >
                  Event
                </MenuItem>
                <MenuItem
                  disabled={!canCreateMeetings}
                  icon={<Users size={16} strokeWidth={1.7} />}
                  onSelect={() => {
                    createAfterClose.current = "meeting";
                  }}
                >
                  Meeting
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
