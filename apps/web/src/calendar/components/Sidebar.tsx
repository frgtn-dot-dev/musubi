import {
  CalendarClock,
  CircleCheck,
  CloudOff,
  Layers3,
  Link2,
  LogOut,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
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
  /** Whether this signed-in account may write announcements on this server. */
  isAdmin: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCreatePage: () => void;
  onDateChange: (date: string) => void;
  onEditPage: (page: PageDocument) => void;
  onManageAccount: () => void;
  onManageCalendars: () => void;
  onManageConnections: () => void;
  onOpenAdmin: () => void;
  onOpenScheduling: () => void;
  onModalStateChange?: (modal: boolean) => void;
  onOpenSettings: () => void;
  onPageChange: (pageId: string) => void;
  /** The full page order after a move, which is what the endpoint takes. */
  onReorderPages: (pageIds: string[]) => Promise<unknown> | void;
  onSignOut: () => void;
  pages: PageDocument[];
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  syncLabel: string;
  /** What the label is about, which decides the glyph and whether it warns. */
  syncTone: "connected" | "offline" | "refreshing";
  user: Pick<User, "email" | "image" | "name">;
  weekStartsOn: UserSettings["weekStartsOn"];
};

export function Sidebar({
  activePageId,
  anchor,
  isAdmin,
  isOpen,
  onClose,
  onCreatePage,
  onEditPage,
  onManageAccount,
  onManageCalendars,
  onManageConnections,
  onOpenAdmin,
  onOpenScheduling,
  onModalStateChange,
  onOpenSettings,
  onDateChange,
  onPageChange,
  onReorderPages,
  onSignOut,
  pages,
  returnFocusRef,
  syncLabel,
  syncTone,
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
            {/* Said once, quietly, where the product names itself. */}
            <span className={styles.brandStage}>Alpha</span>
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
            <span aria-live="polite" className={styles.visuallyHidden}>
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
              icon={<CalendarClock size={18} strokeWidth={1.6} />}
              label="Find a time"
              showChevron={false}
              size="compact"
              onClick={onOpenScheduling}
            />
            {isAdmin ? (
              <RowAction
                className={styles.sidebarRow}
                icon={<ShieldCheck size={18} strokeWidth={1.6} />}
                label="Server admin"
                showChevron={false}
                size="compact"
                onClick={onOpenAdmin}
              />
            ) : null}
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
          {/* The one place that says how current the calendar is. It used to be a
              full-width bar above the grid, which popped in and out on every
              refresh for a fact that belongs next to the account.

              A slot of a fixed height with one line of text: the three states are
              different lengths, and letting the row grow moved the profile below
              it every time a refresh started.

              `aria-live`, not `role="status"`: this is a standing label rather
              than the app's announcement channel — the toast owns that role, and
              two of them make "the status" ambiguous for readers and tests
              alike. Changes still get announced. */}
          <p
            aria-live="polite"
            className={styles.syncStatus}
            data-tone={syncTone}
            title={syncLabel}
          >
            {syncTone === "offline" ? (
              <CloudOff aria-hidden="true" size={15} strokeWidth={1.6} />
            ) : syncTone === "refreshing" ? (
              <RefreshCw aria-hidden="true" size={15} strokeWidth={1.6} />
            ) : (
              <CircleCheck aria-hidden="true" size={15} strokeWidth={1.6} />
            )}
            <span>{syncLabel}</span>
          </p>
          <div className={styles.profile}>
            <RowAction
              className={styles.profileMain}
              aria-label="Manage account"
              detail={<span className={styles.profileEmail}>{user.email}</span>}
              icon={<Avatar image={user.image} name={user.name} size="default" />}
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
        icon={<Icon size={18} strokeWidth={1.6} />}
        label={name}
        selected={active}
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
