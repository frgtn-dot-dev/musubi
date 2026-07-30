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
