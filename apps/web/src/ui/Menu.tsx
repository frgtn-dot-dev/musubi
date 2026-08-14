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
