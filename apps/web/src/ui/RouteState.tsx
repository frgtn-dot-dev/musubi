import { useId, type HTMLAttributes, type ReactNode } from "react";
import { BrandMark } from "~/components/BrandMark";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type RouteStateProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> & {
  actions?: ReactNode;
  busy?: boolean;
  description?: ReactNode;
  eyebrow: ReactNode;
  requestId?: string;
  title: ReactNode;
};

/**
 * Full-page feedback for loading, unavailable and terminal route states.
 * Copy and actions stay with the caller; layout and accessibility do not.
 */
export function RouteState({
  actions,
  "aria-labelledby": labelledBy,
  busy = false,
  className,
  description,
  eyebrow,
  id = "main-content",
  requestId,
  title,
  ...mainProps
}: RouteStateProps) {
  const generatedTitleId = useId();
  const titleId = labelledBy ?? generatedTitleId;

  return (
    <main
      {...mainProps}
      aria-busy={busy || undefined}
      aria-labelledby={titleId}
      className={classNames(styles.routeState, className)}
      id={id}
      tabIndex={-1}
    >
      <span className={styles.pageAmbient} aria-hidden="true">
        結
      </span>
      <section className={styles.routeStateContent}>
        <BrandMark
          className={styles.routeStateMark}
          aria-hidden="true"
          focusable="false"
        />
        <p className={styles.pageEyebrow}>{eyebrow}</p>
        <h1 id={titleId}>{title}</h1>
        {description ? (
          <p className={styles.routeStateDescription}>{description}</p>
        ) : null}
        {requestId ? (
          <p className={styles.routeStateRequest}>Request ID: {requestId}</p>
        ) : null}
        {actions ? (
          <div className={styles.routeStateActions}>{actions}</div>
        ) : null}
      </section>
    </main>
  );
}
