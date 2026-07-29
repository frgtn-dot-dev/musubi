import {
  Children,
  cloneElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

type FieldControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  id?: string;
};

export type FieldProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactElement<FieldControlProps>;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
  labelHidden?: boolean;
  layout?: "stack" | "inline";
  variant?: "plain" | "section";
};

/**
 * One labelled control with local help and validation. Field wires the
 * accessible relationships itself so screen-reader feedback cannot drift away
 * from the visible message during later form migrations.
 */
export function Field({
  children,
  className,
  description,
  error,
  label,
  labelHidden = false,
  layout = "stack",
  variant = "section",
  ...containerProps
}: FieldProps) {
  const generatedId = useId();
  const child = Children.only(children);
  const controlId = child.props.id ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [
    child.props["aria-describedby"],
    descriptionId,
    errorId,
  ]
    .filter(Boolean)
    .join(" ");

  const control = cloneElement(child, {
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : child.props["aria-invalid"],
    id: controlId,
  });

  return (
    <div
      {...containerProps}
      className={classNames(
        styles.field,
        layout === "inline" && styles.field_inline,
        styles[`field_${variant}`],
        className,
      )}
      data-invalid={error ? "" : undefined}
    >
      <label
        className={classNames(
          styles.fieldLabel,
          labelHidden && styles.visuallyHidden,
        )}
        htmlFor={controlId}
      >
        {label}
      </label>
      <div className={styles.fieldControl}>{control}</div>
      {description ? (
        <p className={styles.fieldDescription} id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
