import type { ReactNode } from "react";
import { Button } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type ToastTone = "neutral" | "error";

export type ToastProps = {
  actionLabel?: string;
  className?: string;
  message: ReactNode;
  onAction?: () => void;
  tone?: ToastTone;
};

/**
 * A non-modal, non-focusing notice. The parent owns timing so an undo action
 * can remain available for as long as the underlying operation requires.
 */
export function Toast({
  actionLabel,
  className,
  message,
  onAction,
  tone = "neutral",
}: ToastProps) {
  const hasAction = Boolean(actionLabel && onAction);
  const isError = tone === "error";

  return (
    <div
      aria-atomic="true"
      aria-live={isError ? "assertive" : "polite"}
      className={classNames(styles.toastRegion, className)}
      role={isError ? "alert" : "status"}
    >
      <div className={styles.toast} data-tone={tone}>
        <p>{message}</p>
        {hasAction ? (
          <Button
            className={styles.toastAction}
            size="compact"
            variant="text"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
