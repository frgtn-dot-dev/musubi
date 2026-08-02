import { offeredViews, type CalendarViewId } from "./view-registry";

export type ShortcutCommand =
  | { kind: "create" }
  | { kind: "help" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "save" }
  | { kind: "search" }
  | { kind: "today" }
  | { kind: "view"; view: CalendarViewId };

type KeyEvent = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
};

const VIEW_KEYS: Record<string, CalendarViewId> = {
  a: "agenda",
  d: "day",
  m: "month",
  w: "week",
};

const PLAIN_KEYS: Record<string, ShortcutCommand> = {
  "?": { kind: "help" },
  "/": { kind: "search" },
  c: { kind: "create" },
  j: { kind: "next" },
  k: { kind: "previous" },
  n: { kind: "next" },
  p: { kind: "previous" },
  t: { kind: "today" },
};

/**
 * The shortcut a keypress means, or nothing.
 *
 * `typing` is what the key landed on: while text is being entered, letters are
 * text and nothing else. Kept separate from the handler so the map is one thing
 * to read, and so the overlay below documents the same source it dispatches.
 */
export function shortcutFor(
  event: KeyEvent,
  { typing = false }: { typing?: boolean } = {},
): ShortcutCommand | undefined {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
    return { kind: "save" };
  }

  // Alt is the modifier the time grid uses to nudge an event, and a bare
  // Ctrl/Meta chord belongs to the browser.
  if (typing || event.altKey || event.ctrlKey || event.metaKey) {
    return undefined;
  }

  const key = event.key.toLocaleLowerCase();
  const view = VIEW_KEYS[key];
  if (view) {
    return { kind: "view", view };
  }
  // "?" needs Shift on most layouts, so it is matched on the character rather
  // than being rejected for having a modifier.
  return PLAIN_KEYS[event.key] ?? PLAIN_KEYS[key];
}

/** What the `?` overlay lists — grouped, in the order it reads best. */
export const SHORTCUT_GROUPS: Array<{
  items: Array<{ action: string; keys: string }>;
  title: string;
}> = [
  {
    items: [
      { action: "Previous period", keys: "P or K" },
      { action: "Next period", keys: "N or J" },
      { action: "Today", keys: "T" },
      { action: "Move day focus", keys: "Arrows" },
    ],
    title: "Navigate",
  },
  {
    items: offeredViews().map((view) => ({
      action: view.label,
      keys: view.id.slice(0, 1).toLocaleUpperCase(),
    })),
    title: "Switch view",
  },
  {
    items: [
      { action: "New event", keys: "C" },
      { action: "Move event", keys: "Alt + arrows" },
      { action: "Resize event", keys: "Alt + Shift + arrows" },
      { action: "Save page changes", keys: "Ctrl/⌘ + S" },
    ],
    title: "Edit",
  },
  {
    items: [
      { action: "Search events", keys: "/" },
      { action: "Shortcuts", keys: "?" },
      { action: "Close layer or cancel drag", keys: "Esc" },
    ],
    title: "Elsewhere",
  },
];
