import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "destructive"
  | "ghost";

export type ButtonSize = "control" | "compact";

type ButtonClassNameOptions = {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

/**
 * Gives semantic links the same visual treatment as actions without turning
 * navigation into a button.
 */
export function buttonClassName({
  className,
  size = "control",
  variant = "primary",
}: ButtonClassNameOptions = {}) {
  return classNames(
    styles.button,
    styles[`button_${variant}`],
    styles[`button_${size}`],
    className,
  );
}

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

/**
 * The shared text button. It owns visual variants, busy semantics and the
 * minimum pointer target; callers still own the action-specific label.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled = false,
      icon,
      loading = false,
      size = "control",
      type = "button",
      variant = "primary",
      ...buttonProps
    },
    ref,
  ) {
    const blocked = disabled || loading;

    return (
      <button
        {...buttonProps}
        aria-busy={loading || undefined}
        className={buttonClassName({ className, size, variant })}
        data-loading={loading ? "" : undefined}
        disabled={blocked}
        ref={ref}
        type={type}
      >
        <span className={styles.buttonContent}>
          {icon ? (
            <span className={styles.buttonIcon} aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className={styles.buttonLabel}>{children}</span>
        </span>
        {loading ? (
          <span className={styles.buttonSpinner} aria-hidden="true">
            <span className={styles.spinner} />
          </span>
        ) : null}
      </button>
    );
  },
);

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  children: ReactNode;
  label: string;
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

/**
 * Icon-only actions require a stable accessible name. The label is mandatory
 * in the type so a bare, silent icon cannot reach the UI.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      children,
      className,
      disabled = false,
      label,
      loading = false,
      size = "control",
      title,
      type = "button",
      variant = "ghost",
      ...buttonProps
    },
    ref,
  ) {
    const blocked = disabled || loading;

    return (
      <button
        {...buttonProps}
        aria-busy={loading || undefined}
        aria-label={label}
        className={classNames(
          styles.iconButton,
          styles[`button_${variant}`],
          styles[`button_${size}`],
          className,
        )}
        data-loading={loading ? "" : undefined}
        disabled={blocked}
        ref={ref}
        title={title ?? label}
        type={type}
      >
        <span className={styles.iconButtonContent} aria-hidden="true">
          {children}
        </span>
        {loading ? (
          <span className={styles.buttonSpinner} aria-hidden="true">
            <span className={styles.spinner} />
          </span>
        ) : null}
      </button>
    );
  },
);
