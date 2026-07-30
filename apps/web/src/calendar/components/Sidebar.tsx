import {
  CalendarDays,
  CircleCheck,
  House,
  Layers3,
  Link2,
  LogOut,
  type LucideIcon,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type {
  Calendar,
  PageDocument,
  Settings as UserSettings,
  User,
} from "@musubi/types";
import {
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
import { CalendarVisibilityRow } from "./CalendarVisibilityRow";
import { MiniCalendar } from "./MiniCalendar";
import styles from "./workspace.module.css";

type SidebarProps = {
  activePageId: string;
  /** The date the main view is on, so the mini calendar can mark it. */
  anchor: Date;
  calendars: Calendar[];
  isOpen: boolean;
  onClose: () => void;
  onCreatePage: () => void;
  onDateChange: (date: string) => void;
  onManageAccount: () => void;
  onManageCalendars: () => void;
  onManageConnections: () => void;
  onModalStateChange?: (modal: boolean) => void;
  onOpenSettings: () => void;
  onPageChange: (pageId: string) => void;
  onSignOut: () => void;
  onToggleCalendar: (calendarId: string) => void;
  pages: PageDocument[];
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  syncLabel: string;
  user: Pick<User, "email" | "image" | "name">;
  visibleCalendarIds: string[];
  weekStartsOn: UserSettings["weekStartsOn"];
};

export function Sidebar({
  activePageId,
  anchor,
  calendars,
  isOpen,
  onClose,
  onCreatePage,
  onManageAccount,
  onManageCalendars,
  onManageConnections,
  onModalStateChange,
  onOpenSettings,
  onDateChange,
  onPageChange,
  onSignOut,
  onToggleCalendar,
  pages,
  returnFocusRef,
  syncLabel,
  user,
  visibleCalendarIds,
  weekStartsOn,
}: SidebarProps) {
  const [signingOut, setSigningOut] = useState(false);
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
            <div className={styles.pageList}>
              {pages.map((page) => (
                <PageButton
                  key={page.id}
                  active={page.id === activePageId}
                  icon={page.isDefault ? House : CalendarDays}
                  name={page.name}
                  onSelect={() => {
                    onPageChange(page.id);
                    onClose();
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
          </nav>

          <section
            className={`${styles.sidebarSection} ${styles.calendarSection}`}
            aria-labelledby="calendars-label"
          >
            <SectionLabel
              className={styles.sidebarSectionLabel}
              id="calendars-label"
            >
              Calendars
            </SectionLabel>
            <div className={styles.calendarList}>
              {calendars.map((calendar) => {
                const checked = visibleCalendarIds.includes(calendar.id);

                return (
                  <CalendarVisibilityRow
                    calendar={calendar}
                    key={calendar.id}
                    visible={checked}
                    onVisibleChange={() => onToggleCalendar(calendar.id)}
                  />
                );
              })}
            </div>
          </section>

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

function PageButton({
  active,
  icon: Icon,
  name,
  onSelect,
}: {
  active: boolean;
  icon: LucideIcon;
  name: string;
  onSelect: () => void;
}) {
  return (
    <RowAction
      className={styles.sidebarRow}
      aria-current={active ? "page" : undefined}
      data-selected={active ? "" : undefined}
      icon={<Icon size={18} strokeWidth={1.6} />}
      label={name}
      showChevron={false}
      size="compact"
      onClick={onSelect}
    />
  );
}
