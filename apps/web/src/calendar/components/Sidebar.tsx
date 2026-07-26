import {
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleCheck,
  Grid2X2,
  House,
  Layers3,
  LogOut,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type { Calendar } from "@musubi/types";
import type { User } from "@musubi/types";
import { useState, useSyncExternalStore } from "react";
import { BrandMark } from "~/components/BrandMark";
import { pageStubs } from "~/pages/page-stubs";
import styles from "./workspace.module.css";

type SidebarProps = {
  activePageId: string;
  calendars: Calendar[];
  isOpen: boolean;
  onClose: () => void;
  onManageCalendars: () => void;
  onOpenSettings: () => void;
  onNotice: (message: string) => void;
  onPageChange: (pageId: string) => void;
  onSignOut: () => void;
  onToggleCalendar: (calendarId: string) => void;
  syncLabel: string;
  user: Pick<User, "email" | "name">;
  visibleCalendarIds: string[];
};

const pageIcons = {
  briefcase: BriefcaseBusiness,
  calendar: CalendarDays,
  grid: Grid2X2,
  home: House,
};

const mobileQuery = "(max-width: 820px)";

function subscribeToMobileViewport(callback: () => void) {
  const mediaQuery = window.matchMedia(mobileQuery);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getMobileViewport() {
  return window.matchMedia(mobileQuery).matches;
}

export function Sidebar({
  activePageId,
  calendars,
  isOpen,
  onClose,
  onManageCalendars,
  onOpenSettings,
  onNotice,
  onPageChange,
  onSignOut,
  onToggleCalendar,
  syncLabel,
  user,
  visibleCalendarIds,
}: SidebarProps) {
  const [signingOut, setSigningOut] = useState(false);
  const isMobile = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewport,
    () => false,
  );
  const sidebarHidden = isMobile && !isOpen;

  return (
    <>
      {isOpen ? (
        <button
          className={`${styles.sidebarBackdrop} ${styles.sidebarBackdropVisible}`}
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ""}`}
        aria-label="Workspace navigation"
        aria-hidden={sidebarHidden}
        inert={sidebarHidden}
      >
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <BrandMark className={styles.brandMark} />
            <span>MUSUBI</span>
          </div>
          <button
            className={`${styles.iconButton} ${styles.mobileClose}`}
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.7} />
          </button>
        </div>

        <div className={styles.sidebarScroll}>
          <nav className={styles.sidebarSection} aria-labelledby="pages-label">
            <h2 className={styles.sectionLabel} id="pages-label">
              Pages
            </h2>
            <div className={styles.pageList}>
              {pageStubs.map((page) => (
                <PageButton
                  key={page.id}
                  active={page.id === activePageId}
                  icon={page.icon}
                  name={page.name}
                  onSelect={() => {
                    onPageChange(page.id);
                    onClose();
                  }}
                />
              ))}
              <button
                className={styles.newPageButton}
                type="button"
                onClick={() =>
                  onNotice("Page templates will connect with the Pages API next.")
                }
              >
                <Plus aria-hidden="true" size={18} strokeWidth={1.5} />
                <span>New page</span>
              </button>
            </div>
          </nav>

          <section
            className={`${styles.sidebarSection} ${styles.calendarSection}`}
            aria-labelledby="calendars-label"
          >
            <h2 className={styles.sectionLabel} id="calendars-label">
              Calendars
            </h2>
            <div className={styles.calendarList}>
              {calendars.map((calendar) => {
                const checked = visibleCalendarIds.includes(calendar.id);

                return (
                  <label className={styles.calendarToggle} key={calendar.id}>
                    <span
                      className={styles.calendarDot}
                      style={{ backgroundColor: calendar.color }}
                    />
                    <input
                      checked={checked}
                      type="checkbox"
                      onChange={() => onToggleCalendar(calendar.id)}
                    />
                    <span
                      className={`${styles.checkbox} ${
                        checked ? styles.checkboxChecked : ""
                      }`}
                      aria-hidden="true"
                    >
                      {checked ? <Check size={12} strokeWidth={2} /> : null}
                    </span>
                    <span>{calendar.name}</span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <nav className={styles.sidebarFooter} aria-label="Manage Musubi">
          <button
            type="button"
            onClick={onManageCalendars}
          >
            <Layers3 aria-hidden="true" size={18} strokeWidth={1.6} />
            <span>Calendars</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" size={18} strokeWidth={1.6} />
            <span>Settings</span>
          </button>
          <p className={styles.syncStatus}>
            <CircleCheck aria-hidden="true" size={15} strokeWidth={1.6} />
            {syncLabel}
          </p>
          <div className={styles.profile}>
            <span className={styles.profileAvatar} aria-hidden="true">
              {user.name.trim().charAt(0).toLocaleUpperCase() || "M"}
            </span>
            <span className={styles.profileCopy}>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </span>
            <button
              className={styles.profileSignOut}
              disabled={signingOut}
              type="button"
              aria-label={`Sign out ${user.name}`}
              onClick={() => {
                setSigningOut(true);
                onSignOut();
              }}
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.6} />
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}

function PageButton({
  active,
  icon,
  name,
  onSelect,
}: {
  active: boolean;
  icon: keyof typeof pageIcons;
  name: string;
  onSelect: () => void;
}) {
  const Icon = pageIcons[icon];

  return (
    <button
      className={`${styles.pageButton} ${active ? styles.pageButtonActive : ""}`}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.6} />
      <span>{name}</span>
    </button>
  );
}
