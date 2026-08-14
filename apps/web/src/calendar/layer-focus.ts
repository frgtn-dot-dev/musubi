import { useEffect, useMemo, useRef } from "react";

/**
 * Whether focus leaving a popover landed in another layer — a dialog, a menu, or
 * a second popover.
 *
 * Radix dismisses a layer when focus moves out of it, which conflates two very
 * different things: a modal taking over (the layer really should go) and focus
 * simply leaving some text, which is what starting a text selection does and what
 * a popover being replaced does as it restores focus on the way out. Only the
 * first is a dismissal.
 */
export function focusMovedToAnotherLayer(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
      ),
    )
  );
}

/**
 * Whether a layer is on screen right now.
 *
 * `data-state` matters: a dismissed layer stays in the document while it animates
 * out, and by then the press it is closing for has already been handled.
 *
 * Dialogs count. A modal overlay swallows the press that closes it, but React
 * has removed the overlay by the time the *click* is dispatched, so the click
 * lands on whatever the overlay was covering — the grid, which creates from it.
 */
function layerOpen(): boolean {
  if (typeof document === "undefined") return false;

  return Boolean(
    document.querySelector(
      '[data-ui="popover-content"][data-state="open"], [data-ui="menu-content"][data-state="open"], [role="dialog"][data-state="open"]',
    ),
  );
}

/**
 * Lets a grid tell "the user dismissed a layer" apart from "the user pressed the
 * grid".
 *
 * A press outside a popover both dismisses it and reaches whatever is underneath,
 * so the press that closed a preview also created a draft behind it — the flash
 * of an event nobody asked for. Radix dismisses on `pointerdown`, which is *before*
 * the `click` that the grid creates from, so by then there is no layer left to ask
 * about: the press has to be remembered.
 *
 * The press is remembered on `document` in the capture phase rather than by the
 * grid's own handler: a modal dialog's overlay takes the press for itself, so
 * the grid sees nothing until the click that follows the overlay's removal.
 *
 * Call `pressDismissedLayer` from `onPointerDown` and `consumeDismiss` from
 * `onClick`, in the same spirit as the existing drag/click guard.
 */
export function useLayerDismissGuard() {
  const dismissed = useRef(false);

  useEffect(() => {
    const remember = () => {
      dismissed.current = layerOpen();
    };
    // Bubbling, so a grid's own onClick has already read it: a press that never
    // reached a grid must not leave the flag set for the next one.
    const forget = () => {
      dismissed.current = false;
    };

    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("click", forget);

    return () => {
      document.removeEventListener("pointerdown", remember, true);
      document.removeEventListener("click", forget);
    };
  }, []);

  return useMemo(
    () => ({
      /** True if this press is closing a layer, which is all it should do. */
      pressDismissedLayer() {
        return dismissed.current;
      },
      /** True once per remembered dismissal — the click it belongs to. */
      consumeDismiss() {
        const was = dismissed.current;
        dismissed.current = false;

        return was;
      },
    }),
    [],
  );
}
