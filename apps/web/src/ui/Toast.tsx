import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";
import { Button } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

function subscribeToPortalTarget() {
  return () => undefined;
}

function getPortalTarget() {
  return document.body;
}

export type ToastTone = "neutral" | "error";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastProps = {
  action?: ToastAction;
  className?: string;
  message: ReactNode;
  tone?: ToastTone;
};

/**
 * A non-modal, non-focusing notice. The parent owns timing so an undo action
 * can remain available for as long as the underlying operation requires.
 */
export function Toast({
  action,
  className,
  message,
  tone = "neutral",
}: ToastProps) {
  const portalTarget = useSyncExternalStore(
    subscribeToPortalTarget,
    getPortalTarget,
    () => null,
  );
  const isError = tone === "error";

  const content = (
    <div className={classNames(styles.toastRegion, className)}>
      <div
        className={styles.toast}
        data-has-action={action ? "" : undefined}
        data-tone={tone}
      >
        {isError ? (
          <CircleAlert
            aria-hidden="true"
            className={styles.toastIcon}
            size={17}
            strokeWidth={1.7}
          />
        ) : null}
        <p
          aria-atomic="true"
          className={styles.toastMessage}
          role={isError ? "alert" : "status"}
        >
          {message}
        </p>
        {action ? (
          <Button
            className={styles.toastAction}
            size="compact"
            variant="ghost"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );

  return portalTarget ? createPortal(content, portalTarget) : content;
}
