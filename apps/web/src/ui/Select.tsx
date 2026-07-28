import {
  forwardRef,
  type SelectHTMLAttributes,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Long choice sets stay native: predictable keyboard behaviour, platform
 * accessibility and no custom listbox state machine for users to learn.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ children, className, ...selectProps }, ref) {
    return (
      <span className={styles.selectRoot}>
        <select
          {...selectProps}
          className={classNames(styles.select, className)}
          ref={ref}
        >
          {children}
        </select>
        <span className={styles.selectChevron} aria-hidden="true" />
      </span>
    );
  },
);
