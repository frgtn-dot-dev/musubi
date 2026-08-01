# Component inventory

Generated from the real codebase on 2026-08-01. This is Superdesign context,
not a second source of truth. The full selected source is embedded so canvas work
uses the actual public APIs and accessibility behavior.

## Current boundary

- Web primitives live in `apps/web/src/ui` and use CSS Modules plus Radix for
  dialog and anchored-layer behavior.
- Native primitives live in `apps/client/components/ui`; setting row variants
  currently live one directory higher.
- Feature components compose these. They must not create another general shell.

## apps/web/src/ui/Button.tsx

```tsx
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
  | "text";

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
        <span className={styles.buttonIcon} aria-hidden="true">
          {loading ? <span className={styles.spinner} /> : icon}
        </span>
        <span className={styles.buttonLabel}>{children}</span>
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
  variant?: Exclude<ButtonVariant, "text"> | "ghost";
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
        title={title}
        type={type}
      >
        <span aria-hidden="true">
          {loading ? <span className={styles.spinner} /> : children}
        </span>
      </button>
    );
  },
);
```
## apps/web/src/ui/Dialog.tsx

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { IconButton } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type DialogSize = "compact" | "default" | "wide";
export type DialogBodyLayout = "flush" | "padded";

export type DialogProps = {
  bodyClassName?: string;
  bodyLayout?: DialogBodyLayout;
  children: ReactNode;
  className?: string;
  closeLabel: string;
  description: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus?: HTMLElement | RefObject<HTMLElement | null> | null;
  size?: DialogSize;
  title: ReactNode;
  trigger?: ReactElement;
};

/**
 * Shared modal shell with one heading structure and one focus policy.
 *
 * Radix owns focus trapping, Escape dismissal and trigger focus restoration.
 * A return target can be supplied for dialogs opened by gestures rather than a
 * trigger, such as moving a recurring event with the keyboard.
 */
export function Dialog({
  bodyClassName,
  bodyLayout = "padded",
  children,
  className,
  closeLabel,
  description,
  footer,
  initialFocus,
  onOpenChange,
  open,
  returnFocus,
  size = "default",
  title,
  trigger,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.dialogOverlay} />
        <DialogPrimitive.Content
          className={classNames(
            styles.dialog,
            styles[`dialog_${size}`],
            className,
          )}
          data-body-layout={bodyLayout}
          onOpenAutoFocus={(event) => {
            if (!initialFocus?.current) return;
            event.preventDefault();
            initialFocus.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            const returnTarget =
              returnFocus && "current" in returnFocus
                ? returnFocus.current
                : returnFocus;
            if (!returnTarget?.isConnected) return;
            event.preventDefault();
            returnTarget.focus();
          }}
        >
          <header className={styles.dialogHeader}>
            <div className={styles.dialogHeading}>
              <DialogPrimitive.Title className={styles.dialogTitle}>
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                className={styles.dialogDescription}
              >
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton
                className={styles.dialogClose}
                label={closeLabel}
                size="compact"
              >
                <span className={styles.dialogCloseGlyph}>×</span>
              </IconButton>
            </DialogPrimitive.Close>
          </header>
          <div
            className={classNames(
              styles.dialogBody,
              styles[`dialogBody_${bodyLayout}`],
              bodyClassName,
            )}
          >
            {children}
          </div>
          {footer ? (
            <footer className={styles.dialogFooter}>{footer}</footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogClose({ children }: { children: ReactElement }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}
```

## apps/web/src/ui/ConfirmationDialog.tsx

`ConfirmationDialog` composes the shared compact dialog for a single
consequential choice. It owns action order, pending behavior, and safe default
focus. `ConfirmationNotice` and `DialogError` keep consequence and failure
regions out of feature CSS. Current production consumers cover account,
calendar, event, and ownership removal/transfer flows.

Public API: `ConfirmationDialog` accepts controlled open state, title,
description, close/confirm/cancel labels, loading and disabled state, either an
`onConfirm` callback or associated form ID, optional initial/return focus, and
children. `ConfirmationNotice` accepts an icon and consequence copy;
`DialogError` accepts alert copy and an optional request ID. Pass the real
source file as context for canvas work rather than reconstructing this pattern.

## apps/web/src/ui/Field.tsx

```tsx
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
```

## apps/web/src/ui/Row.tsx

```tsx
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
      data-row-options=""
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
```

## apps/web/src/ui/Segmented.tsx

```tsx
import {
  type KeyboardEvent,
  type ReactNode,
  useRef,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type SegmentedOption<Value extends string> = {
  disabled?: boolean;
  label: ReactNode;
  value: Value;
};

export type SegmentedProps<Value extends string> = {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: Value) => void;
  options: ReadonlyArray<SegmentedOption<Value>>;
  value: Value;
};

function enabledIndex<Value extends string>(
  options: ReadonlyArray<SegmentedOption<Value>>,
  from: number,
  direction: 1 | -1,
) {
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (from + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return from;
}

/**
 * A short, visible choice set. Selection follows focus for arrow navigation,
 * matching native radio groups and avoiding a second confirmation step.
 */
export function Segmented<Value extends string>({
  className,
  disabled = false,
  label,
  onChange,
  options,
  value,
}: SegmentedProps<Value>) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const fallbackIndex = options.findIndex((option) => !option.disabled);
  const selectedOption = options[selectedIndex];
  const tabbableIndex =
    selectedIndex >= 0 && !selectedOption?.disabled
      ? selectedIndex
      : fallbackIndex;

  function choose(index: number) {
    const option = options[index];
    if (!option || disabled || option.disabled) return;
    onChange(option.value);
    optionRefs.current[index]?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = enabledIndex(options, index, -1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = enabledIndex(options, index, 1);
    } else if (event.key === "Home") {
      nextIndex = options.findIndex((option) => !option.disabled);
    } else if (event.key === "End") {
      nextIndex = options.findLastIndex((option) => !option.disabled);
    }

    if (nextIndex === undefined || nextIndex < 0) return;
    event.preventDefault();
    choose(nextIndex);
  }

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={classNames(styles.segmented, className)}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;

        return (
          <button
            aria-checked={selected}
            className={styles.segmentedOption}
            disabled={disabled || option.disabled}
            key={option.value}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            role="radio"
            tabIndex={index === tabbableIndex ? 0 : -1}
            type="button"
            onClick={() => choose(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

## apps/web/src/ui/Switch.tsx

```tsx
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
```

## apps/web/src/ui/Checkbox.tsx

```tsx
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
```

## apps/web/src/ui/Popover.tsx

```tsx
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import anchoredStyles from "./AnchoredSurface.module.css";
import { classNames } from "./class-names";

const DEFAULT_COLLISION_PADDING = 12;
const DEFAULT_SIDE_OFFSET = 8;

export const Popover = PopoverPrimitive.Root;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export type PopoverContentProps = ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> & {
  /** Keep the anchored behavior on narrow viewports instead of using a sheet. */
  mobileSurface?: "anchored" | "sheet";
  /** Decorative pointer back to the trigger on anchored viewports. */
  showArrow?: boolean;
};

/**
 * Shared physical shell for lightweight anchored layers.
 *
 * Radix owns positioning, dismissal and focus hand-off. Consumers continue to
 * own semantics, keyboard behavior, dimensions and content anatomy; this shell
 * owns the portal, collision gutter, surface, motion and narrow sheet geometry.
 */
export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(function PopoverContent(
  {
    children,
    className,
    collisionPadding = DEFAULT_COLLISION_PADDING,
    mobileSurface = "sheet",
    showArrow = true,
    sideOffset = DEFAULT_SIDE_OFFSET,
    ...contentProps
  },
  forwardedRef,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        {...contentProps}
        className={classNames(anchoredStyles.surface, className)}
        collisionPadding={collisionPadding}
        data-mobile-surface={mobileSurface}
        data-ui="popover-content"
        ref={forwardedRef}
        sideOffset={sideOffset}
      >
        {children}
        {showArrow ? (
          <PopoverPrimitive.Arrow
            aria-hidden="true"
            className={anchoredStyles.arrow}
          />
        ) : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
});
```

`PopoverContent` is the shared physical layer, not a shared interaction model.
It owns the portal, surface, collision gutter, arrow, motion and narrow sheet
geometry. Consumers retain their roles, focus behavior, keyboard navigation,
widths and content anatomy.

## apps/web/src/ui/Menu.tsx

```tsx
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
  useId,
} from "react";
import anchoredStyles from "./AnchoredSurface.module.css";
import { classNames } from "./class-names";
import styles from "./Menu.module.css";

const DEFAULT_COLLISION_PADDING = 12;
const DEFAULT_SIDE_OFFSET = 6;

export const MenuGroup = MenuPrimitive.Group;
export const MenuTrigger = MenuPrimitive.Trigger;

export function Menu({
  modal = false,
  ...rootProps
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root {...rootProps} modal={modal} />;
}

export type MenuContentProps = Omit<
  ComponentPropsWithoutRef<typeof MenuPrimitive.Content>,
  "aria-label" | "aria-labelledby"
> & {
  /** Accessible name and narrow-sheet title for this command set. */
  label: string;
  /** Keep the menu anchored on narrow viewports instead of using a sheet. */
  mobileSurface?: "anchored" | "sheet";
  /** Decorative pointer back to the trigger on anchored viewports. */
  showArrow?: boolean;
};

/**
 * A short command list with Radix-owned focus, typeahead and dismissal.
 *
 * Unlike Popover, Menu owns the menu-button interaction contract. Consumers
 * provide commands and copy, not roving focus or custom keyboard handlers.
 */
export const MenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  MenuContentProps
>(function MenuContent(
  {
    align = "start",
    children,
    className,
    collisionPadding = DEFAULT_COLLISION_PADDING,
    label,
    loop = true,
    mobileSurface = "sheet",
    showArrow = true,
    sideOffset = DEFAULT_SIDE_OFFSET,
    ...contentProps
  },
  forwardedRef,
) {
  const titleId = useId();

  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        {...contentProps}
        align={align}
        aria-labelledby={titleId}
        className={classNames(
          anchoredStyles.surface,
          styles.content,
          className,
        )}
        collisionPadding={collisionPadding}
        data-mobile-surface={mobileSurface}
        data-ui="menu-content"
        loop={loop}
        ref={forwardedRef}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Label className={styles.sheetTitle} id={titleId}>
          {label}
        </MenuPrimitive.Label>
        <div className={styles.items}>{children}</div>
        {showArrow ? (
          <MenuPrimitive.Arrow
            aria-hidden="true"
            className={anchoredStyles.arrow}
          />
        ) : null}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
});

export type MenuItemProps = Omit<
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item>,
  "asChild" | "children"
> & {
  children: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  tone?: "default" | "destructive";
};

export const MenuItem = forwardRef<
  ElementRef<typeof MenuPrimitive.Item>,
  MenuItemProps
>(function MenuItem(
  { children, className, icon, shortcut, tone = "default", ...itemProps },
  forwardedRef,
) {
  return (
    <MenuPrimitive.Item
      {...itemProps}
      className={classNames(styles.item, className)}
      data-tone={tone}
      ref={forwardedRef}
    >
      <span aria-hidden="true" className={styles.itemIcon}>
        {icon}
      </span>
      <span className={styles.itemLabel}>{children}</span>
      {shortcut ? (
        <span aria-hidden="true" className={styles.shortcut}>
          {shortcut}
        </span>
      ) : null}
    </MenuPrimitive.Item>
  );
});

export const MenuSeparator = forwardRef<
  ElementRef<typeof MenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(function MenuSeparator({ className, ...separatorProps }, forwardedRef) {
  return (
    <MenuPrimitive.Separator
      {...separatorProps}
      className={classNames(styles.separator, className)}
      ref={forwardedRef}
    />
  );
});
```

`MenuContent` is the separate command-list contract. Radix owns menu-button
semantics, roving focus, arrows, typeahead, Escape dismissal and focus return.
The component owns its accessible label, shared anchored surface, narrow sheet,
item anatomy, disabled state and destructive tone. There is no production
consumer yet; do not turn the Page settings button into a one-item menu.

## apps/web/src/ui/Select.tsx

```tsx
import { Check, ChevronDown } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { classNames } from "./class-names";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import styles from "./primitives.module.css";

export type SelectOption = {
  description?: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  /** Plain text used for keyboard typeahead and the closed trigger. */
  textValue?: string;
  value: string;
};

export type SelectProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "defaultValue" | "onChange" | "value"
> & {
  label: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: "compact" | "default";
  value: string;
};

function optionText(option: SelectOption) {
  if (option.textValue) return option.textValue;
  return typeof option.label === "string" ? option.label : option.value;
}

/**
 * A select-only combobox with one consistent Musubi surface on every platform.
 * Focus moves into the list while it is open, which keeps arrow navigation and
 * typeahead predictable for keyboard and screen-reader users.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      className,
      disabled = false,
      label,
      onChange,
      options,
      placeholder = "Choose an option",
      size = "default",
      value,
      ...triggerProps
    },
    forwardedRef,
  ) {
    const generatedId = useId();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const optionRefs = useRef(new Map<string, HTMLButtonElement>());
    const typeahead = useRef({ at: 0, query: "" });
    const [open, setOpen] = useState(false);
    const [activeValue, setActiveValue] = useState(value);
    const enabledOptions = options.filter((option) => !option.disabled);
    const selectedOption = options.find((option) => option.value === value);
    const initialValue =
      (selectedOption && !selectedOption.disabled
        ? selectedOption.value
        : enabledOptions[0]?.value) ?? "";
    const listboxId = `${generatedId}-listbox`;
    const titleId = `${generatedId}-title`;

    function setTriggerRef(node: HTMLButtonElement | null) {
      triggerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }

    function focusOption(nextValue: string) {
      setActiveValue(nextValue);
      requestAnimationFrame(() => {
        const option = optionRefs.current.get(nextValue);
        option?.focus();
        option?.scrollIntoView?.({ block: "nearest" });
      });
    }

    function beginOpen(nextValue = initialValue) {
      setActiveValue(nextValue);
      setOpen(true);
    }

    function choose(nextValue: string) {
      const option = options.find((item) => item.value === nextValue);
      if (!option || option.disabled) return;
      onChange(nextValue);
      setActiveValue(nextValue);
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function moveActive(key: "ArrowDown" | "ArrowUp" | "End" | "Home") {
      if (enabledOptions.length === 0) return;
      const currentIndex = enabledOptions.findIndex(
        (option) => option.value === activeValue,
      );
      const lastIndex = enabledOptions.length - 1;
      let nextIndex: number;

      if (key === "Home") nextIndex = 0;
      else if (key === "End") nextIndex = lastIndex;
      else if (key === "ArrowDown") {
        nextIndex = currentIndex < 0 ? 0 : Math.min(lastIndex, currentIndex + 1);
      } else {
        nextIndex = currentIndex < 0 ? lastIndex : Math.max(0, currentIndex - 1);
      }

      focusOption(enabledOptions[nextIndex]!.value);
    }

    function matchTypeahead(character: string) {
      const now = Date.now();
      const previous = typeahead.current;
      const query =
        now - previous.at < 700
          ? `${previous.query}${character}`
          : character;
      typeahead.current = { at: now, query };

      const startIndex = Math.max(
        0,
        enabledOptions.findIndex((option) => option.value === activeValue) + 1,
      );
      const ordered = [
        ...enabledOptions.slice(startIndex),
        ...enabledOptions.slice(0, startIndex),
      ];
      const normalized = query.toLocaleLowerCase();
      const match =
        ordered.find((option) =>
          optionText(option).toLocaleLowerCase().startsWith(normalized),
        ) ??
        (query.length > 1 && new Set(query).size === 1
          ? ordered.find((option) =>
              optionText(option)
                .toLocaleLowerCase()
                .startsWith(character.toLocaleLowerCase()),
            )
          : undefined);

      if (match) {
        if (!open) beginOpen(match.value);
        else focusOption(match.value);
      }
    }

    function handleTypeahead(event: KeyboardEvent) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key.length !== 1 ||
        event.key === " "
      ) {
        return false;
      }
      event.preventDefault();
      matchTypeahead(event.key);
      return true;
    }

    return (
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) beginOpen();
          else setOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            {...triggerProps}
            aria-controls={listboxId}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={triggerProps["aria-label"] ?? label}
            className={classNames(
              styles.select,
              size === "compact" && styles.select_compact,
              className,
            )}
            disabled={disabled}
            ref={setTriggerRef}
            role="combobox"
            type="button"
            onKeyDown={(event) => {
              triggerProps.onKeyDown?.(event);
              if (event.defaultPrevented) return;

              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                beginOpen();
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                beginOpen(
                  event.key === "Home"
                    ? (enabledOptions[0]?.value ?? "")
                    : (enabledOptions.at(-1)?.value ?? ""),
                );
              } else {
                handleTypeahead(event);
              }
            }}
          >
            <span className={styles.selectValue}>
              {selectedOption?.icon ? (
                <span aria-hidden="true" className={styles.selectValueIcon}>
                  {selectedOption.icon}
                </span>
              ) : null}
              <span>{selectedOption ? optionText(selectedOption) : placeholder}</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={styles.selectChevron}
              size={16}
              strokeWidth={1.5}
            />
          </button>
        </PopoverTrigger>
        {open ? (
          <PopoverContent
            align="start"
            aria-labelledby={titleId}
            className={styles.selectPopover}
            side="bottom"
            sideOffset={6}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() =>
                optionRefs.current.get(activeValue || initialValue)?.focus(),
              );
            }}
          >
            <h2 className={styles.selectSheetTitle} id={titleId}>
              {label}
            </h2>
            <div
              aria-label={`${label} options`}
              className={styles.selectList}
              id={listboxId}
              role="listbox"
            >
              {options.map((option) => {
                const selected = option.value === value;
                const active = option.value === activeValue;

                return (
                  <button
                    aria-selected={selected}
                    className={styles.selectOption}
                    data-active={active ? "" : undefined}
                    disabled={option.disabled}
                    key={option.value}
                    ref={(node) => {
                      if (node) optionRefs.current.set(option.value, node);
                      else optionRefs.current.delete(option.value);
                    }}
                    role="option"
                    tabIndex={active ? 0 : -1}
                    type="button"
                    onClick={() => choose(option.value)}
                    onFocus={() => setActiveValue(option.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp" ||
                        event.key === "Home" ||
                        event.key === "End"
                      ) {
                        event.preventDefault();
                        moveActive(event.key);
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        choose(option.value);
                      } else {
                        handleTypeahead(event);
                      }
                    }}
                  >
                    <span
                      aria-hidden={!option.icon || undefined}
                      className={styles.selectOptionIcon}
                    >
                      {option.icon}
                    </span>
                    <span className={styles.selectOptionCopy}>
                      <span>{option.label}</span>
                      {option.description ? (
                        <small>{option.description}</small>
                      ) : null}
                    </span>
                    <Check
                      aria-hidden="true"
                      className={styles.selectOptionCheck}
                      size={16}
                      strokeWidth={1.8}
                    />
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        ) : null}
      </Popover>
    );
  },
);
```

## apps/web/src/ui/Empty.tsx

```tsx
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
```

## apps/web/src/ui/SectionLabel.tsx

```tsx
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type SectionLabelProps = HTMLAttributes<HTMLHeadingElement> & {
  children: ReactNode;
  level?: 2 | 3;
};

export function SectionLabel({
  children,
  className,
  level = 2,
  ...headingProps
}: SectionLabelProps) {
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <Heading
      {...headingProps}
      className={classNames(styles.sectionLabel, className)}
    >
      {children}
    </Heading>
  );
}
```

## apps/web/src/ui/Toast.tsx

```tsx
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

function subscribeToPortalTarget() {
  return () => undefined;
}

function getPortalTarget() {
  return document.body;
}

export type ToastTone = "neutral" | "error";

export type ToastProps = {
  actionLabel?: string;
  className?: string;
  message: ReactNode;
  onAction?: () => void;
  tone?: ToastTone;
};

/**
 * A non-modal, non-focusing notice. The parent owns timing so an undo action
 * can remain available for as long as the underlying operation requires.
 */
export function Toast({
  actionLabel,
  className,
  message,
  onAction,
  tone = "neutral",
}: ToastProps) {
  const portalTarget = useSyncExternalStore(
    subscribeToPortalTarget,
    getPortalTarget,
    () => null,
  );
  const hasAction = Boolean(actionLabel && onAction);
  const isError = tone === "error";

  const content = (
    <div
      aria-atomic="true"
      aria-live={isError ? "assertive" : "polite"}
      className={classNames(styles.toastRegion, className)}
      role={isError ? "alert" : "status"}
    >
      <div
        className={styles.toast}
        data-has-action={hasAction ? "" : undefined}
        data-tone={tone}
      >
        <p>{message}</p>
        {hasAction ? (
          <Button
            className={styles.toastAction}
            size="compact"
            variant="text"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );

  return portalTarget ? createPortal(content, portalTarget) : content;
}
```

## apps/web/src/ui/class-names.ts

```tsx
export function classNames(
  ...values: Array<string | false | null | undefined>
) {
  return values.filter(Boolean).join(" ");
}
```

## apps/client/components/ui/Btn.tsx

```tsx
import { ReactNode } from "react";
import { ActivityIndicator, Text, ViewStyle } from "react-native";
import { colors, styles } from "@/constants/theme";
import { Tap } from "./Tap";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "destructive";
  icon?: ReactNode;
  disabled?: boolean;
  /** Shows a spinner and blocks presses — wire to your in-flight state. */
  loading?: boolean;
  style?: ViewStyle;
};

// The app button: theme variant + press feel + haptic + busy state in one place.
export function Btn({ label, onPress, variant = "primary", icon, disabled, loading, style }: Props) {
  // Resolved at render, not module scope — styles/colors mutate on theme switch.
  const v = {
    primary: { box: styles.btnPrimary, text: styles.btnPrimaryText, spinner: colors.onFill },
    secondary: { box: styles.btnSecondary, text: styles.btnSecondaryText, spinner: colors.fg2 },
    destructive: { box: styles.btnRemove, text: styles.btnPrimaryText, spinner: colors.onFill },
  }[variant];
  const blocked = disabled || loading;
  return (
    <Tap
      onPress={onPress}
      disabled={blocked}
      haptic={variant === "destructive" ? "warn" : "tap"}
      style={[blocked ? styles.btnDisabled : v.box, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked, busy: !!loading }}
    >
      {loading ? <ActivityIndicator size="small" color={v.spinner} /> : icon}
      <Text style={v.text}>{label}</Text>
    </Tap>
  );
}
```

## apps/client/components/ui/Tap.tsx

```tsx
import { forwardRef } from "react";
import { Pressable, PressableProps, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { select, success, tap, thump, warn } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const haptics = { select, success, tap, thump, warn };

type Props = PressableProps & {
  /** Play a haptic on press-in. Default OFF — haptics are reserved for
   *  important actions (primary/destructive buttons, FABs), not every row. */
  haptic?: keyof typeof haptics | false;
  /** Press-in scale. 0.97 for buttons/pills, 1 to keep only the dim. */
  scaleTo?: number;
};

// Drop-in Pressable with the app-wide press feel: quick dim + subtle spring
// scale on press-in, springs back on release. Replaces bare <Pressable> so
// every touch in the app answers the finger the same way.
export const Tap = forwardRef<View, Props>(function Tap(
  {
    haptic = false, scaleTo = 0.97, onPress, onPressIn, onPressOut, style, disabled,
    accessibilityRole, accessibilityState, ...rest
  }, ref,
) {
  const pressed = useSharedValue(0);

  const feedback = useAnimatedStyle(() => ({
    opacity: withTiming(pressed.value ? 0.65 : 1, { duration: pressed.value ? 40 : 160 }),
    transform: [{ scale: withSpring(pressed.value ? scaleTo : 1, { damping: 34, stiffness: 500 }) }],
  }));

  return (
    <AnimatedPressable
      ref={ref}
      // Press feedback waits a beat, so a scroll passing over the element
      // cancels the press before the dim/scale ever shows (native-ripple feel).
      unstable_pressDelay={90}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole={accessibilityRole ?? (onPress ? "button" : undefined)}
      accessibilityState={disabled
        ? { ...accessibilityState, disabled: true }
        : accessibilityState}
      style={[style as any, feedback]}
      onPressIn={(e) => {
        pressed.value = 1;
        if (haptic) haptics[haptic]();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = 0;
        onPressOut?.(e);
      }}
      {...rest}
    />
  );
});
```

## apps/client/components/ui/ModalPortal.tsx

```tsx
import { useEffect, type ReactNode } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { Portal } from "./Portal";

type Props = {
  visible: boolean;
  onRequestClose?: () => void;
  // Accepted for drop-in parity with RN <Modal>, but irrelevant to an in-tree
  // overlay (there's no native window to make transparent / animate / extend).
  transparent?: boolean;
  animationType?: "none" | "slide" | "fade";
  statusBarTranslucent?: boolean;
  children?: ReactNode;
};

// Drop-in for RN <Modal> that renders into the root Portal host instead of a
// native window, so a modal can be opened from inside another modal without the
// iOS modal-in-modal bug (inner one invisible + eats all touches). Convert a
// screen by swapping `import { Modal } from "react-native"` for
// `import { ModalPortal as Modal } from "@/components/ui/ModalPortal"`.
export function ModalPortal({ visible, onRequestClose, children }: Props) {
  // RN <Modal> consumes the Android hardware back for free; replicate it.
  // BackHandler fires listeners most-recent-first and stops at the first that
  // returns true, so the top-most (last-mounted) modal closes first.
  useEffect(() => {
    if (!visible || !onRequestClose) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  if (!visible) return null;
  return (
    <Portal>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        accessibilityViewIsModal
      >
        {children}
      </View>
    </Portal>
  );
}
```

## apps/client/components/ui/Portal.tsx

```tsx
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

// A minimal in-tree portal. Why not RN <Modal>? Each <Modal> is a separate
// native window, and presenting one over another (a modal opened from a modal)
// is broken on iOS — the inner one doesn't show and its transparent layer eats
// every touch. Rendering all overlays into ONE host in the ONE React tree makes
// them stack correctly (by mount order) on both platforms. The host lives under
// ServerProvider/SafeAreaProvider (see _layout) so portaled content keeps
// useServer()/insets context.

type Ctx = { mount: (id: string, node: ReactNode) => void; unmount: (id: string) => void };
const PortalContext = createContext<Ctx | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  // Insertion-ordered map (string keys preserve order) → later-opened overlays
  // render last = on top.
  const [nodes, setNodes] = useState<Record<string, ReactNode>>({});

  const ctx: Ctx = {
    mount: (id, node) => setNodes((prev) => ({ ...prev, [id]: node })),
    unmount: (id) => setNodes((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    }),
  };

  const ids = Object.keys(nodes);
  return (
    <PortalContext.Provider value={ctx}>
      {children}
      {/* Mount the host ONLY when something is portaled. An always-present
          absoluteFill host — even with pointerEvents="box-none" — swallowed all
          touches on Android (box-none pass-through to a lower-z sibling is
          unreliable there); with no overlays there must be no host at all. */}
      {ids.length > 0 && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {ids.map((id) => (
            <View key={id} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {nodes[id]}
            </View>
          ))}
        </View>
      )}
    </PortalContext.Provider>
  );
}

/** Render `children` into the root PortalProvider host instead of here in place. */
export function Portal({ children }: { children: ReactNode }) {
  const ctx = useContext(PortalContext);
  const id = useId();
  // Keep the hosted node fresh as children change; drop it on unmount.
  useEffect(() => {
    ctx?.mount(id, children);
  });
  useEffect(() => () => ctx?.unmount(id), []);
  return null;
}
```

## apps/client/components/ui/Toast.tsx

```tsx
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { colors, fonts } from "@/constants/theme";
import { Tap } from "@/components/ui/Tap";
import { usePathname } from "expo-router";
import { tabBarHeight } from "@/constants/layout";
import { useSettingsStore } from "@/store/useSettingsStore";

// A single bottom toast — transient message with an optional action (e.g. Undo).
// Imperative API so any code can raise one: `showToast({ message, actionLabel, onAction })`.
type Toast = { id: number; message: string; actionLabel?: string; onAction?: () => void };

let nextId = 0;
type ToastState = {
  toast: Toast | null;
  show: (t: Omit<Toast, "id">) => void;
  hide: () => void;
};
const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (t) => set({ toast: { ...t, id: ++nextId } }),
  hide: () => set({ toast: null }),
}));

/** Raise a toast from anywhere (outside React too). */
export const showToast = (t: Omit<Toast, "id">) => useToastStore.getState().show(t);

const VISIBLE_MS = 4200;  // auto-dismiss after this
const REVEAL_MS = 260;    // ease-in-out fade + small rise, both directions
const TRAVEL = 14;        // it only nudges up a little; the fade does the reveal
const SIGN_IN_ACTIONS_H = 154; // Forgot + Continue + gap/padding; toast sits above both
const TAB_PATHS = new Set(["/", "/calendars", "/agenda", "/settings"]);

// Mounted once at the app root; renders whatever toast is currently in the store.
export function ToastHost() {
  const toast = useToastStore((s) => s.toast);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const tabBarLabels = useSettingsStore((s) => s.tabBarLabels);
  const bottom = pathname === "/sign-in"
    ? insets.bottom + SIGN_IN_ACTIONS_H
    : TAB_PATHS.has(pathname)
      ? tabBarHeight(insets.bottom, tabBarLabels) + 10
      : insets.bottom + 16;
  const ty = useSharedValue(TRAVEL);
  const op = useSharedValue(0);
  const reveal = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }], opacity: op.value }));

  const dismiss = () => {
    op.value = withTiming(0, { duration: REVEAL_MS, easing: Easing.inOut(Easing.ease) });
    ty.value = withTiming(TRAVEL, { duration: REVEAL_MS, easing: Easing.inOut(Easing.ease) }, (done) => {
      if (done) runOnJS(hide)();
    });
  };

  // Fade + small rise on each new toast, then arm the auto-dismiss timer.
  useEffect(() => {
    if (!toast) return;
    op.value = withTiming(1, { duration: REVEAL_MS, easing: Easing.inOut(Easing.ease) });
    ty.value = withTiming(0, { duration: REVEAL_MS, easing: Easing.inOut(Easing.ease) });
    const t = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);

  if (!toast) return null;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom, alignItems: "center", paddingHorizontal: 16 }}>
      <Animated.View style={[{
        flexDirection: "row", alignItems: "center", gap: 14,
        maxWidth: 460, paddingLeft: 24, paddingRight: toast.actionLabel ? 8 : 24, paddingVertical: 12,
        backgroundColor: colors.fg, borderRadius: 999, borderCurve: "continuous",
        shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
      }, reveal]}>
        <Text numberOfLines={2} style={{ flexShrink: 1, fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: colors.bg }}>
          {toast.message}
        </Text>
        {toast.actionLabel && (
          <Tap
            haptic="tap"
            onPress={() => { toast.onAction?.(); dismiss(); }}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.accent }}
          >
            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: "#f4f1e8" }}>{toast.actionLabel}</Text>
          </Tap>
        )}
      </Animated.View>
    </View>
  );
}
```

## apps/client/components/ui/Empty.tsx

```tsx
import { Text, View } from "react-native";
import { colors, fonts } from "@/constants/theme";

// Zen empty state: a single kanji, breathing room, one quiet line.
export function Empty({ kanji = "空", text }: { kanji?: string; text: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, gap: 12 }}>
      <Text style={{ fontFamily: fonts.kanji, fontSize: 44, color: colors.fg4 }}>{kanji}</Text>
      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3 }}>{text}</Text>
    </View>
  );
}
```

## apps/client/components/SettingRow.tsx

```tsx
import { colors, fonts } from "@/constants/theme";
import { Switch, View, Text } from "react-native";
import { Mode } from "@musubi/calendar";
import { Tap } from "@/components/ui/Tap";
import { Feather } from "@expo/vector-icons";


type ToggleProps = {
  label: string;
  toggle: boolean;
  onToggle: () => void;
  danger?: boolean;
}

type OptionsProps = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: Mode) => void;
  /** Optional display label per option value (else the value, capitalized). */
  labels?: Record<string, string>;
}

type ActionProps = {
  label: string;
  detail?: string;
  value?: string;
  external?: boolean;
  onPress?: () => void;
}

// Border color applied inline at usage — the theme can swap at runtime.
const rowStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderBottomWidth: 1,
  minHeight: 62,
} as const;

export function SettingRowToggle({ label, toggle, onToggle }: ToggleProps) {
  return (
    <Tap
      onPress={onToggle}
      scaleTo={1}
      style={[rowStyle, { borderColor: colors.line }]}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: toggle }}
    >
      <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.fg2 }}>
        {label}
      </Text>
      <Switch
        thumbColor={toggle ? colors.accent : colors.bg3}
        trackColor={{
          false: colors.line,
          true: colors.line3,
        }}
        ios_backgroundColor={colors.line}
        onValueChange={onToggle}
        value={toggle}
        accessible={false}
      />
    </Tap>
  );
}

// Few options → pick in one tap: inline segmented pills, same visual language
// as the member-role selector.
export function SettingRowOptions({ label, value, options, onChange, labels }: OptionsProps) {
  return (
    <View style={[rowStyle, { borderColor: colors.line }]}>
      <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.fg2 }}>
        {label}
      </Text>
      <View style={{
        flexDirection: "row",
        borderWidth: 1, borderColor: colors.line2, borderRadius: 999, padding: 2, gap: 2,
      }}>
        {options.map((o) => {
          const active = o === value;
          const displayLabel = labels?.[o] ?? o[0].toUpperCase() + o.slice(1);
          return (
            <Tap
              key={o}
              haptic="select"
              onPress={() => onChange(o as Mode)}
              accessibilityRole="radio"
              accessibilityLabel={`${label}, ${displayLabel}`}
              accessibilityState={{ checked: active }}
              hitSlop={{ top: 8, bottom: 8 }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 999,
                borderCurve: "continuous",
                overflow: "hidden",
              }}
            >
              {active ? (
                <View pointerEvents="none" style={{
                  position: "absolute", inset: 0, borderRadius: 999,
                  backgroundColor: colors.fill,
                }} />
              ) : null}
              <Text style={{
                fontFamily: fonts.sans, fontSize: 11,
                color: active ? colors.onFill : colors.fg2,
              }}>
                {displayLabel}
              </Text>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

export function SettingRowAction({ label, detail, value, external, onPress }: ActionProps) {
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: colors.fg2 }}>
          {label}
        </Text>
        {detail ? (
          <Text style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.fg4 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.fg4 }}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Feather name={external ? "external-link" : "chevron-right"} size={15} color={colors.fg4} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[rowStyle, { borderColor: colors.line, gap: 12 }]}>{content}</View>;
  }

  return (
    <Tap
      onPress={onPress}
      scaleTo={1}
      style={[rowStyle, { borderColor: colors.line, gap: 12 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {content}
    </Tap>
  );
}
```
