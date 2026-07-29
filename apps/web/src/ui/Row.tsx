import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { classNames } from "./class-names";
import { Segmented, type SegmentedOption } from "./Segmented";
import { SwitchIndicator } from "./Switch";
import styles from "./primitives.module.css";

type RowContentProps = {
  detail?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  value?: ReactNode;
};

export type RowSize = "compact" | "default";

function RowContent({
  detail,
  icon,
  label,
  trailing,
  value,
}: RowContentProps) {
  return (
    <>
      {icon ? (
        <span className={styles.rowIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.rowCopy}>
        <span className={styles.rowLabel}>{label}</span>
        {detail ? <span className={styles.rowDetail}>{detail}</span> : null}
      </span>
      {value ? <span className={styles.rowValue}>{value}</span> : null}
      {trailing ? <span className={styles.rowTrailing}>{trailing}</span> : null}
    </>
  );
}

export type RowProps = HTMLAttributes<HTMLDivElement> &
  RowContentProps & {
    size?: RowSize;
  };

export function Row({
  className,
  detail,
  icon,
  label,
  size = "default",
  trailing,
  value,
  ...rowProps
}: RowProps) {
  return (
    <div
      {...rowProps}
      className={classNames(
        styles.row,
        size === "compact" && styles.row_compact,
        className,
      )}
    >
      <RowContent
        detail={detail}
        icon={icon}
        label={label}
        trailing={trailing}
        value={value}
      />
    </div>
  );
}

export type RowActionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> &
  Omit<RowContentProps, "trailing"> & {
    showChevron?: boolean;
    size?: RowSize;
    trailing?: ReactNode;
  };

export const RowAction = forwardRef<HTMLButtonElement, RowActionProps>(
  function RowAction(
    {
      className,
      detail,
      icon,
      label,
      showChevron = true,
      size = "default",
      trailing,
      type = "button",
      value,
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        className={classNames(
          styles.row,
          styles.rowAction,
          size === "compact" && styles.row_compact,
          className,
        )}
        ref={ref}
        type={type}
      >
        <RowContent
          detail={detail}
          icon={icon}
          label={label}
          trailing={
            trailing ??
            (showChevron ? (
              <span className={styles.rowChevron} aria-hidden="true" />
            ) : null)
          }
          value={value}
        />
      </button>
    );
  },
);

export type RowToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "children" | "onChange" | "role"
> &
  Omit<RowContentProps, "trailing" | "value"> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    size?: RowSize;
  };

export function RowToggle({
  checked,
  className,
  detail,
  disabled = false,
  icon,
  label,
  onCheckedChange,
  size = "default",
  type = "button",
  ...buttonProps
}: RowToggleProps) {
  return (
    <button
      {...buttonProps}
      aria-checked={checked}
      className={classNames(
        styles.row,
        styles.rowAction,
        size === "compact" && styles.row_compact,
        className,
      )}
      disabled={disabled}
      role="switch"
      type={type}
      onClick={() => onCheckedChange(!checked)}
    >
      <RowContent
        detail={detail}
        icon={icon}
        label={label}
        trailing={<SwitchIndicator checked={checked} />}
      />
    </button>
  );
}

export type RowOptionsProps<Value extends string> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> &
  Omit<RowContentProps, "trailing" | "value"> & {
    disabled?: boolean;
    onChange: (value: Value) => void;
    options: ReadonlyArray<SegmentedOption<Value>>;
    size?: RowSize;
    value: Value;
  };

export function RowOptions<Value extends string>({
  className,
  detail,
  disabled = false,
  icon,
  label,
  onChange,
  options,
  size = "default",
  value,
  ...rowProps
}: RowOptionsProps<Value>) {
  const accessibleLabel = typeof label === "string" ? label : "Options";

  return (
    <div
      {...rowProps}
      className={classNames(
        styles.row,
        size === "compact" && styles.row_compact,
        className,
      )}
    >
      <RowContent detail={detail} icon={icon} label={label} />
      <Segmented
        className={styles.rowOptions}
        disabled={disabled}
        label={accessibleLabel}
        options={options}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
