import { useSyncExternalStore } from "react";

/**
 * The width at which the app stops being desktop chrome and becomes phone
 * chrome. Same value as the CSS breakpoint — two of them would drift, and the
 * layout and the markup have to agree about which one is on screen.
 */
const NARROW_QUERY = "(max-width: 599px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the app is showing phone chrome.
 *
 * For the few decisions CSS cannot make on its own: which control to render, and
 * how much of a date label there is room to spell out. Rendering both and hiding
 * one with CSS would leave two controls for one job in the accessibility tree.
 * The server renders the desktop answer, as the sidebar's own overlay detection
 * already does.
 */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}
