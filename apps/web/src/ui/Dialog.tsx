import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Info, X } from "lucide-react";
import { type ReactElement, type ReactNode, type RefObject, useId } from "react";
import { IconButton } from "./Button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./Popover";
import { classNames } from "./class-names";
import { ElevatedDialogContext } from "./layer-context";
import styles from "./primitives.module.css";

export type DialogSize =
  | "compact"
  | "default"
  | "fullscreen"
  | "spacious"
  | "wide"
  | "workspace";
export type DialogBodyLayout = "flush" | "padded";

export type DialogProps = {
  /** Opt-in inspector anatomy; existing modal callers keep their contract. */
  placement?: "center" | "right";
  modal?: boolean;
  dismissOnOutsideInteraction?: boolean;
  bodyClassName?: string;
  bodyLayout?: DialogBodyLayout;
  /**
   * `panels` when the body's own children scroll — a list beside its controls.
   * The body then stops being the scroller on a wide screen, so the controls
   * stay put while the list moves.
   */
  bodyScroll?: "auto" | "panels";
  children: ReactNode;
  className?: string;
  closeLabel: string;
  description?: ReactNode;
  /**
   * Paint above anchored surfaces. For a dialog opened *from* a popover, which
   * otherwise sits above it and hides the question it just asked.
   */
  elevated?: boolean;
  footer?: ReactNode;
  /** Secondary controls beside Close; the shell owns their alignment. */
  headerActions?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus?: HTMLElement | RefObject<HTMLElement | null> | null;
  size?: DialogSize;
  /**
   * Hold a working height even when the content is short. For a dialog whose
   * body is a standing layout — columns, a nav beside a panel — which otherwise
   * collapses to a letterbox while it loads. A dialog that is genuinely short
   * should stay short.
   */
  tall?: boolean;
  title: ReactNode;
  trigger?: ReactElement;
};

/**
 * Shared modal shell with one heading structure and one focus policy.
 *
 * Radix owns focus trapping, Escape dismissal and trigger focus restoration.
 * A return target can be supplied for dialogs opened by gestures rather than a
 * trigger, such as moving a recurring event with the keyboard.
 */
export function Dialog({
  placement = "center",
  modal = true,
  dismissOnOutsideInteraction = true,
  bodyClassName,
  bodyLayout = "padded",
  bodyScroll = "auto",
  children,
  className,
  closeLabel,
  description,
  elevated = false,
  footer,
  headerActions,
  initialFocus,
  onOpenChange,
  open,
  returnFocus,
  size = "default",
  tall = false,
  title,
  trigger,
}: DialogProps) {
  return (
    <DialogPrimitive.Root modal={modal} open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          /* Names the backdrop for hit-tests that walk the layer stack, so a
             calendar gesture can tell it is buried rather than on the grid. */
          data-dialog-overlay=""
          className={classNames(
            styles.dialogOverlay,
            elevated && styles.dialogOverlay_elevated,
          )}
        />
        <DialogPrimitive.Content
          {...(description === null || description === undefined
            ? { "aria-describedby": undefined }
            : {})}
          className={classNames(
            styles.dialog,
            placement === "right" && styles.dialog_right,
            styles[`dialog_${size}`],
            tall && styles.dialog_tall,
            elevated && styles.dialog_elevated,
            className,
          )}
          data-body-layout={bodyLayout}
          onInteractOutside={(event) => {
            if (!dismissOnOutsideInteraction) event.preventDefault();
          }}
          data-has-footer={footer ? "" : undefined}
          onOpenAutoFocus={(event) => {
            if (!initialFocus?.current) return;
            event.preventDefault();
            initialFocus.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            const returnTarget =
              returnFocus && "current" in returnFocus
                ? returnFocus.current
                : returnFocus;
            if (!returnTarget?.isConnected) return;
            event.preventDefault();
            returnTarget.focus();
          }}
        >
          <ElevatedDialogContext.Provider value={elevated}>
            <header className={styles.dialogHeader}>
              <div className={styles.dialogHeading}>
                <DialogPrimitive.Title className={styles.dialogTitle}>
                  {title}
                </DialogPrimitive.Title>
                {description === null || description === undefined ? null : (
                  <DialogPrimitive.Description
                    className={styles.dialogDescription}
                  >
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <div className={styles.dialogHeaderActions}>
                {headerActions}
                <DialogPrimitive.Close asChild>
                  <IconButton
                    className={styles.dialogClose}
                    label={closeLabel}
                    size="compact"
                  >
                    <span className={styles.dialogCloseGlyph}>×</span>
                  </IconButton>
                </DialogPrimitive.Close>
              </div>
            </header>
            <div
              className={classNames(
                styles.dialogBody,
                styles[`dialogBody_${bodyLayout}`],
                bodyScroll === "panels" && styles.dialogBody_panels,
                bodyClassName,
              )}
            >
              {children}
            </div>
            {footer ? (
              <footer className={styles.dialogFooter}>{footer}</footer>
            ) : null}
          </ElevatedDialogContext.Provider>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogClose({ children }: { children: ReactElement }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}

/** Background help stays available without competing with the dialog's task. */
export function DialogInfo({ children, label, title }: {
  children: ReactNode;
  label: string;
  title: string;
}) {
  const id = useId();
  return <Popover>
    <PopoverTrigger asChild>
      <IconButton label={label} size="compact">
        <Info aria-hidden="true" size={17} strokeWidth={1.6} />
      </IconButton>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-title`}
      className={styles.dialogInfo}
      role="dialog"
    >
      <div className={styles.dialogHeader}>
        <h2 className={styles.dialogTitle} id={`${id}-title`}>{title}</h2>
        <PopoverClose asChild>
          <IconButton className={styles.dialogClose} label={`Close ${label.toLowerCase()}`} size="compact">
            <X aria-hidden="true" size={17} strokeWidth={1.6} />
          </IconButton>
        </PopoverClose>
      </div>
      <div className={styles.dialogBody_padded}>
        <p className={styles.dialogDescription} id={`${id}-description`}>{children}</p>
      </div>
    </PopoverContent>
  </Popover>;
}
