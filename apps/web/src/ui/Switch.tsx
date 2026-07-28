import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "aria-label" | "children" | "onChange" | "role"
> & {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function SwitchIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      className={styles.switchTrack}
      data-checked={checked ? "" : undefined}
      aria-hidden="true"
    >
      <span className={styles.switchThumb} />
    </span>
  );
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    {
      checked,
      className,
      disabled = false,
      label,
      onCheckedChange,
      type = "button",
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        aria-checked={checked}
        aria-label={label}
        className={classNames(styles.switch, className)}
        disabled={disabled}
        ref={ref}
        role="switch"
        type={type}
        onClick={() => onCheckedChange(!checked)}
      >
        <SwitchIndicator checked={checked} />
      </button>
    );
  },
);
