import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "type"
> & {
  description?: ReactNode;
  label: ReactNode;
  labelHidden?: boolean;
};

/**
 * A visually consistent checkbox backed by a real input, retaining browser
 * form submission, validation and assistive-technology behaviour.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      className,
      description,
      disabled = false,
      label,
      labelHidden = false,
      ...inputProps
    },
    ref,
  ) {
    return (
      <label
        className={classNames(
          styles.checkboxRoot,
          disabled && styles.checkboxRoot_disabled,
          labelHidden && styles.checkboxRoot_iconOnly,
          className,
        )}
      >
        <input
          {...inputProps}
          className={styles.checkboxInput}
          disabled={disabled}
          ref={ref}
          type="checkbox"
        />
        <span className={styles.checkboxBox} aria-hidden="true" />
        <span
          className={classNames(
            styles.checkboxCopy,
            labelHidden && styles.visuallyHidden,
          )}
        >
          <span>{label}</span>
          {description ? <small>{description}</small> : null}
        </span>
      </label>
    );
  },
);
