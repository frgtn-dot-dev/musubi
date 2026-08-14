import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type EmptyProps = HTMLAttributes<HTMLElement> & {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function Empty({
  action,
  className,
  description,
  icon,
  title,
  ...sectionProps
}: EmptyProps) {
  return (
    <section
      {...sectionProps}
      className={classNames(styles.empty, className)}
    >
      {icon ? (
        <span className={styles.emptyIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </section>
  );
}
