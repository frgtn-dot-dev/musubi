import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type InlineErrorProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  requestId?: string;
};

/* Anatomy — the box, the message, and the request ID line — belongs here.
   Consumers pass placement through className and nothing else. */
export function InlineError({
  children,
  className,
  requestId,
  ...alertProps
}: InlineErrorProps) {
  return (
    <div
      {...alertProps}
      className={classNames(styles.inlineError, className)}
      role="alert"
    >
      <p>{children}</p>
      {requestId ? <span>Request ID: {requestId}</span> : null}
    </div>
  );
}
