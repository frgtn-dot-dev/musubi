import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { classNames } from "./class-names";
import styles from "./Popover.module.css";

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
        className={classNames(styles.surface, className)}
        collisionPadding={collisionPadding}
        data-mobile-surface={mobileSurface}
        data-ui="popover-content"
        ref={forwardedRef}
        sideOffset={sideOffset}
      >
        {children}
        {showArrow ? (
          <PopoverPrimitive.Arrow aria-hidden="true" className={styles.arrow} />
        ) : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
});
