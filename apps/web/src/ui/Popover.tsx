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
        /* Before the spread: a surface with a name of its own is what lets a
           test or a style scope to *this* popover instead of any open one. */
        data-ui="popover-content"
        {...contentProps}
        className={classNames(anchoredStyles.surface, className)}
        collisionPadding={collisionPadding}
        data-mobile-surface={mobileSurface}
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
