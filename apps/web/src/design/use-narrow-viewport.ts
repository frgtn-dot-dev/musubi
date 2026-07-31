import { useSyncExternalStore } from "react";

/**
 * The width at which the app stops being desktop chrome and becomes phone
 * chrome. Same value as the CSS breakpoint — two of them would drift, and the
 * layout and the markup have to agree about which one is on screen.
 */
const NARROW_QUERY = "(max-width: 599px)";

/**
 * The width at which the toolbar drops search and the Filters toggle for want of
 * room. Below it the calendar filters have to be shown some other way, or there
 * is no way to reach them at all.
 */
const COMPACT_QUERY = "(max-width: 1023px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
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
  return useMediaQuery(NARROW_QUERY);
}

/** Whether the toolbar is too tight to carry search and the Filters toggle. */
export function useCompactViewport(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}
