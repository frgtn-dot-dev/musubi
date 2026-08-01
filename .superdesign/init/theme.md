# Theme inventory

Generated from the real codebase on 2026-08-01.

## Semantic mapping

| Role | Web | Native |
|---|---|---|
| canvas | `--surface-canvas` | `colors.bg` |
| panel | `--surface-panel` | `colors.bg1` |
| raised | `--surface-raised` | `colors.bg2` |
| primary text | `--text-primary` | `colors.fg` |
| secondary text | `--text-secondary` | `colors.fg2` |
| control fill | `--control-fill` | `colors.fill` |
| on control | `--control-on-fill` | `colors.onFill` |
| accent | `--accent-primary` | `colors.accent` |

The values are intentionally close but manually duplicated today. The future
canonical token package must generate platform representations; it must not
force CSS behavior into React Native or vice versa.

## apps/web/src/design/tokens.css

```css
@font-face {
  font-display: swap;
  font-family: "Inter Tight";
  font-style: normal;
  font-weight: 400;
  src: url("@expo-google-fonts/inter-tight/400Regular/InterTight_400Regular.ttf")
    format("truetype");
}

@font-face {
  font-display: swap;
  font-family: "Inter Tight";
  font-style: normal;
  font-weight: 500;
  src: url("@expo-google-fonts/inter-tight/500Medium/InterTight_500Medium.ttf")
    format("truetype");
}

@font-face {
  font-display: swap;
  font-family: "Noto Serif";
  font-style: normal;
  font-weight: 400;
  src: url("@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf")
    format("truetype");
}

:root {
  color-scheme: light;
  --surface-canvas: #f4f1e8;
  --surface-panel: #efebe0;
  --surface-raised: #e8e3d5;
  --surface-overlay: rgba(244, 241, 232, 0.94);
  --border-subtle: rgba(28, 27, 24, 0.08);
  --border-medium: rgba(28, 27, 24, 0.13);
  --border-strong: rgba(28, 27, 24, 0.24);
  --text-primary: #1c1b18;
  --text-secondary: rgba(28, 27, 24, 0.74);
  --text-muted: rgba(28, 27, 24, 0.5);
  --text-faint: rgba(28, 27, 24, 0.32);
  --accent-primary: #b3492f;
  /* Pure white keeps destructive controls above 4.5:1 on the shu accent. */
  --accent-on-primary: #fff;
  --control-fill: #4a4741;
  --control-on-fill: #f4f1e8;
  --shadow-overlay: 0 24px 64px rgba(47, 41, 31, 0.16);
  --font-sans: "Inter Tight", system-ui, -apple-system, sans-serif;
  --font-serif: "Noto Serif", Georgia, serif;
  --font-kanji: "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif", serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Shared type ramp. Nominal pixel names keep the design handoff readable;
     rem values still respect the user's browser font-size preference. */
  --text-10: 0.625rem;
  --text-11: 0.6875rem;
  --text-12: 0.75rem;
  --text-13: 0.8125rem;
  --text-14: 0.875rem;
  --text-15: 0.9375rem;
  --text-19: 1.1875rem;
  --text-22: 1.375rem;
  --text-26: 1.625rem;

  /* A block that is not (yet) real: the create draft, and the trace a dragged
     event leaves behind. A veil of the canvas itself — light on the light theme,
     dark on the dark one — so it mutes the grid under it without introducing a
     colour of its own. Translucent, because both blocks sit *on* the grid rather
     than replacing it. */
  --draft-fill: color-mix(in srgb, var(--surface-canvas) 72%, transparent);

  --radius-sm: 5px;
  --radius-md: 9px;
  --radius-lg: 14px;
  --event-radius: 6px;
  --radius-pill: 999px;
  --radius-sheet: 20px;
  --radius-card: 15px;
  --radius-control: 10px;
  --radius-chip: 8px;

  /* Spacing scale — no ad-hoc gaps. */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 32px;

  --sidebar-width: 244px;
  --toolbar-height: 132px;
  --date-header-height: 48px;
  --popover-width: 360px;
  --row-min-height: 62px;
  --control-height: 48px;
  /* One hour of the time grid. TimeGridView overrides it per density; the CSS
     grid and the JS geometry must derive from the same number or the cursor
     drifts against the time it points at. */
  --hour-height: 64px;

  --focus-ring: 2px solid var(--accent-primary);

  --motion-fast: 140ms;
  --motion-standard: 220ms;
  --motion-slow: 300ms;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-canvas: #0c0c0e;
  --surface-panel: #131316;
  --surface-raised: #1a1a1e;
  --surface-overlay: rgba(19, 19, 22, 0.96);
  --border-subtle: rgba(232, 228, 217, 0.06);
  --border-medium: rgba(232, 228, 217, 0.1);
  --border-strong: rgba(232, 228, 217, 0.18);
  --text-primary: #e8e4d9;
  --text-secondary: rgba(232, 228, 217, 0.72);
  --text-muted: rgba(232, 228, 217, 0.48);
  --text-faint: rgba(232, 228, 217, 0.28);
  --accent-primary: #c8553d;
  --accent-on-primary: #000;
  --control-fill: #e8e4d9;
  --control-on-fill: #0c0c0e;
  --shadow-overlay: 0 28px 72px rgba(0, 0, 0, 0.48);
}
```

## apps/web/src/design/global.css

```css
* {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  background: var(--surface-canvas);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--surface-canvas);
}

button,
input,
select,
textarea {
  color: inherit;
  font: inherit;
}

button,
a {
  -webkit-tap-highlight-color: transparent;
}

button {
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}

/* Focus rings belong to keyboard use. Until a key arms them (see focus-mode.ts)
   every ring is transparent, so programmatic focus — a dialog opening, focus
   returning to a trigger — can't flash an outline at someone using a mouse.
   Outlines don't affect layout, so nothing moves when they light up. */
:root:not([data-focus-mode="keyboard"]) :focus-visible {
  outline-color: transparent;
}

::selection {
  background: color-mix(in srgb, var(--accent-primary) 24%, transparent);
}

.skip-link {
  position: fixed;
  z-index: 1000;
  top: 12px;
  left: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--control-fill);
  color: var(--control-on-fill);
  text-decoration: none;
  transform: translateY(-160%);
}

.skip-link:focus {
  transform: translateY(0);
}

.foundation {
  display: grid;
  min-height: 100vh;
  place-content: center;
  padding: 32px;
  text-align: center;
}

.foundation h1 {
  max-width: 720px;
  margin: 0;
  font-family: var(--font-serif);
  font-size: clamp(2rem, 5vw, 4rem);
  font-weight: 400;
  line-height: 1.08;
}

.foundation p {
  max-width: 580px;
  margin: 0 auto;
  color: var(--text-secondary);
  line-height: 1.6;
}

.foundation > p:first-of-type {
  color: var(--accent-primary);
  font-size: 0.72rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.foundation {
  position: relative;
  gap: 18px;
  overflow: hidden;
}

.foundation__mark {
  position: absolute;
  right: -0.05em;
  bottom: -0.36em;
  color: var(--text-primary);
  font-family: var(--font-kanji);
  font-size: min(42vw, 36rem);
  line-height: 1;
  opacity: 0.035;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

## apps/web/src/design/theme.ts

```ts
export type AppliedTheme = "dark" | "light";
export type ThemePreference = AppliedTheme | "system";

export const THEME_CHANGE_EVENT = "musubi-theme-change";
export const THEME_STORAGE_KEY = "musubi-theme";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const THEME_COLORS: Record<AppliedTheme, string> = {
  dark: "#0c0c0e",
  light: "#f4f1e8",
};

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

function prefersDarkTheme() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DARK_MEDIA_QUERY).matches
  );
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark = prefersDarkTheme(),
): AppliedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function getAppliedTheme(): AppliedTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function setDocumentTheme(theme: AppliedTheme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

export function applyTheme(
  preference: ThemePreference,
  { persist = true }: { persist?: boolean } = {},
) {
  if (typeof document === "undefined") return;

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Storage can be unavailable in private or embedded contexts. Applying
      // the preference to this document still gives the user immediate feedback.
    }
  }

  setDocumentTheme(resolveTheme(preference));
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function toggleTheme() {
  applyTheme(getAppliedTheme() === "dark" ? "light" : "dark");
}

export function subscribeToTheme(callback: () => void) {
  const media = window.matchMedia(DARK_MEDIA_QUERY);

  function synchronize() {
    setDocumentTheme(resolveTheme(readThemePreference(), media.matches));
    callback();
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === null || event.key === THEME_STORAGE_KEY) synchronize();
  }

  function handleMediaChange() {
    if (readThemePreference() === "system") synchronize();
  }

  window.addEventListener(THEME_CHANGE_EVENT, synchronize);
  window.addEventListener("storage", handleStorage);
  media.addEventListener("change", handleMediaChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, synchronize);
    window.removeEventListener("storage", handleStorage);
    media.removeEventListener("change", handleMediaChange);
  };
}

/**
 * Runs in the document head before first paint. Keep it tiny, but source it
 * from this module so the storage key, resolution rule and chrome colours
 * cannot drift away from the interactive implementation.
 */
export const THEME_BOOTSTRAP_SCRIPT =
  `try{const t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
  `const d=t==='dark'||(t!=='light'&&matchMedia('${DARK_MEDIA_QUERY}').matches);` +
  `const v=d?'dark':'light';document.documentElement.dataset.theme=v;` +
  `document.querySelector('meta[name="theme-color"]')?.setAttribute('content',d?'${THEME_COLORS.dark}':'${THEME_COLORS.light}')` +
  `}catch{document.documentElement.dataset.theme='light'}`;
```

## apps/client/constants/theme.ts

```ts
import { StyleSheet } from "react-native";
import { SCREEN_HEADER_HEIGHT } from "@/constants/layout";


export const fonts = {
  sans: 'InterTight_400Regular',
  sansMedium: 'InterTight_500Medium',
  serif: 'NotoSerif_400Regular',
  kanji: 'ShipporiMinchoB1_400Regular',
};

// Two zen palettes: sumi ink on night (dark) and ink on washi paper (light).
const dark = {
  bg: '#0c0c0e',
  bg1: '#131316',
  bg2: '#1a1a1e',
  bg3: '#222226',
  line: 'rgba(232,228,217,0.06)',
  line2: 'rgba(232,228,217,0.10)',
  line3: 'rgba(232,228,217,0.18)',
  fg: '#e8e4d9',
  fg2: 'rgba(232,228,217,0.72)',
  fg3: 'rgba(232,228,217,0.48)',
  fg4: 'rgba(232,228,217,0.28)',
  accent: '#c8553d',
  fill: '#e8e4d9',      // solid background of active pills / primary buttons
  onFill: '#0c0c0e',    // text/icon sitting on `fill`
};

const light: typeof dark = {
  bg: '#f4f1e8',
  bg1: '#efebe0',
  bg2: '#e8e3d5',
  bg3: '#dfd9c9',
  line: 'rgba(28,27,24,0.08)',
  line2: 'rgba(28,27,24,0.13)',
  line3: 'rgba(28,27,24,0.24)',
  fg: '#1c1b18',
  fg2: 'rgba(28,27,24,0.74)',
  fg3: 'rgba(28,27,24,0.50)',
  fg4: 'rgba(28,27,24,0.32)',
  accent: '#b3492f', // deeper vermilion — keeps contrast on paper
  fill: '#4a4741',      // dark warm grey, not full ink — softer active fills
  onFill: '#f4f1e8',
};

export type ThemeScheme = 'dark' | 'light';

// `colors`, `styles` and `calendarTheme` are MUTABLE singletons: every
// component reads them at render time, so applyTheme() swaps their contents
// in place and the root remount (key={scheme}) repaints the whole app.
// No context/provider plumbing through 30 files.
export const colors = { ...dark };

export let activeScheme: ThemeScheme = 'dark';

export function applyTheme(scheme: ThemeScheme) {
  // No same-scheme early return: cheap to reapply, and a guard can wedge
  // after a hot reload leaves activeScheme out of sync with the palette.
  activeScheme = scheme;
  Object.assign(colors, scheme === 'dark' ? dark : light);
  Object.assign(styles, makeStyles());
  Object.assign(calendarTheme, makeCalendarTheme());
}

const makeStyles = () => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    height: SCREEN_HEADER_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 6,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.bg1,
  },
  screenTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.fg,
  },
  pillActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line3,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.bg2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  horizontalPillView: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    height: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    borderRadius: 26,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabRemove: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 26,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderCurve: 'continuous',
    // FIXED dp, not a percentage: with statusBarTranslucent the Modal window's
    // height settles a beat after open — a %-minHeight recomputed against the
    // taller window made short sheets visibly hop upward.
    minHeight: 290,
    maxHeight: '88%',
  },
  modalHandle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.line3,
    alignSelf: 'center',
    marginVertical: 10,
  },
  modalTitleRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  modalDetailRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  fieldContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  fieldLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.fg4,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.fg4,
    textTransform: 'uppercase',
  },
  fieldValueText: {
    color: colors.fg,
    fontSize: 14,
  },
  fieldValueBig: {
    color: colors.fg,
    fontSize: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
  },
  modalButtonsColumn: {
    flexDirection: 'column',
    alignSelf: "stretch",
    alignItems: "stretch",
    justifyContent: "flex-end",
    flex: 1,
    gap: 10,
    padding: 16,
  },
  btnPrimary: {
    flex: 1,
    maxHeight: 48,
    minHeight: 48,
    gap: 6,
    backgroundColor: colors.fill,
    borderRadius: 10,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnSecondary: {
    flex: 1,
    maxHeight: 48,
    minHeight: 48,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: 10,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: 'center',
  },
  btnRemove: {
    flex: 1,
    maxHeight: 48,
    minHeight: 48,
    gap: 6,
    backgroundColor: "#C8553D",
    borderRadius: 10,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnDisabled: {
    flex: 1,
    maxHeight: 48,
    minHeight: 48,
    gap: 6,
    backgroundColor: colors.fg3,
    borderRadius: 10,
    padding: 13,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnPrimaryText: {
    color: colors.onFill,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  btnSecondaryText: {
    color: colors.fg2,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  modalTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.fg,
  },
  errorText: {
    color: colors.accent,
    fontFamily: fonts.sans,
    fontSize: 12,
  },
  textInput: {
    fontFamily: fonts.sans,
    fontSize: 20,
    color: colors.fg2,
  },
  colorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  calendarCircle: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line3,
    position: 'relative',
    marginVertical: 16,
  },
  calendarCircleInner: {
    position: 'absolute',
    inset: 4,
    borderRadius: 14,
    opacity: 0.9,
  },
  modalActionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 15,
    paddingBottom: 15,
  },
  modalActionDivider: {
    backgroundColor: colors.line,
    width: 1,
    alignSelf: 'stretch',
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 28,
    gap: 12,
  },
  screenActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  timelineRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  timelineDay: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.fg,
  },
  timelineMonth: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.fg3,
  },
  timelineTitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.fg,
  },
  timelineMeta: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.fg3,
  },
});

export const styles = makeStyles();

const makeCalendarTheme = () => ({
  palette: {
    primary: {
      main: colors.accent,
      contrastText: colors.bg,
    },
    gray: {
      '100': colors.bg1,
      '200': colors.line,
      '300': colors.line2,
      '500': colors.fg3,
      '800': colors.fg2,
    },
    nowIndicator: colors.accent,
  },
  typography: {
    fontFamily: fonts.sans,
    xs: { fontSize: 10 },
    sm: { fontSize: 12 },
  },
  eventCellOverlappingStyle: {
    borderRadius: 4,
  },
});

export const calendarTheme = makeCalendarTheme();
```


