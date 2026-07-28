import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { IconButton } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type DialogSize = "compact" | "default" | "wide";

export type DialogProps = {
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  closeLabel: string;
  description: ReactNode;
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
  children,
  className,
  closeLabel,
  description,
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
        <DialogPrimitive.Overlay className={styles.dialogOverlay} />
        <DialogPrimitive.Content
          className={classNames(
            styles.dialog,
            styles[`dialog_${size}`],
            className,
          )}
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
          <div className={classNames(styles.dialogBody, bodyClassName)}>
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
