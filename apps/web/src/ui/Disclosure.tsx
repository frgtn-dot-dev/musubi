import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";
import { Row } from "./Row";

export type DisclosureProps = {
  children: ReactNode;
  className?: string;
  /** The row's second line, for what is folded away. */
  detail?: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  value?: ReactNode;
  density?: "default" | "compact";
  /** Leave both out to let the browser own the state. */
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

/**
 * A row in a settings group that unfolds.
 *
 * Native `<details>`, so keyboard and screen-reader behaviour come for free and
 * the bulky content stays out of the way until it is wanted. `Row` draws the
 * summary, so the label lands in the same column as every other row's and the
 * chevron stands where a status icon would.
 */
export function Disclosure({
  children,
  className,
  detail,
  label,
  icon,
  value,
  density = "default",
  onOpenChange,
  open,
}: DisclosureProps) {
  return (
    <details
      className={classNames(styles.disclosure, density === "compact" && styles.disclosure_compact, className)}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
      open={open}
    >
      <summary className={styles.disclosureSummary}>
        <Row
          className={styles.disclosureRow}
          detail={detail}
          size={density === "compact" ? "compact" : "default"}
          icon={icon ?? <ChevronRight className={styles.disclosureChevron} size={16} strokeWidth={1.6} />}
          value={value}
          trailing={icon ? <ChevronRight className={styles.disclosureChevron} size={16} strokeWidth={1.6} aria-hidden="true" /> : undefined}
          label={label}
        />
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}
