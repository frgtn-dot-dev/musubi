import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { IconButton } from "./Button";
import { classNames } from "./class-names";
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
  description: ReactNode;
  /**
   * Paint above anchored surfaces. For a dialog opened *from* a popover, which
   * otherwise sits above it and hides the question it just asked.
   */
  elevated?: boolean;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus?: HTMLElement | RefObject<HTMLElement | null> | null;
  size?: DialogSize;
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
  bodyClassName,
  bodyLayout = "padded",
  bodyScroll = "auto",
  children,
  className,
  closeLabel,
  description,
  elevated = false,
  footer,
  initialFocus,
  onOpenChange,
  open,
  returnFocus,
  size = "default",
  title,
  trigger,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={classNames(
            styles.dialogOverlay,
            elevated && styles.dialogOverlay_elevated,
          )}
        />
        <DialogPrimitive.Content
          className={classNames(
            styles.dialog,
            styles[`dialog_${size}`],
            elevated && styles.dialog_elevated,
            className,
          )}
          data-body-layout={bodyLayout}
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
          <header className={styles.dialogHeader}>
            <div className={styles.dialogHeading}>
              <DialogPrimitive.Title className={styles.dialogTitle}>
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                className={styles.dialogDescription}
              >
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton
                className={styles.dialogClose}
                label={closeLabel}
                size="compact"
              >
                <span className={styles.dialogCloseGlyph}>×</span>
              </IconButton>
            </DialogPrimitive.Close>
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogClose({ children }: { children: ReactElement }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}
