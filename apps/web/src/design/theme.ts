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
