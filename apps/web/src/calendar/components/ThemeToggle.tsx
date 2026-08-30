import { Moon, Sun } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getAppliedTheme,
  subscribeToTheme,
  toggleTheme,
  type AppliedTheme,
} from "~/design/theme";
import { IconButton } from "~/ui/Button";

export function ThemeToggleButton({
  theme,
  onToggle,
}: {
  theme: AppliedTheme;
  onToggle: () => void;
}) {
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <IconButton
      label={`Use ${nextTheme} theme`}
      title={`Use ${nextTheme} theme`}
      onClick={onToggle}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={17} strokeWidth={1.6} />
      ) : (
        <Moon aria-hidden="true" size={17} strokeWidth={1.6} />
      )}
    </IconButton>
  );
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getAppliedTheme,
    (): AppliedTheme => "light",
  );

  return <ThemeToggleButton theme={theme} onToggle={toggleTheme} />;
}

/**
 * A theme switch that dresses this page and nothing else.
 *
 * The app's switch is a setting: it writes the preference to storage, and every
 * Musubi tab and the signed-in account's own theme follow it. On a page someone
 * opened from a link that is the wrong contract — reading a poll in the dark
 * should not repaint the calendar they left in another tab, and should not
 * outlive the visit.
 *
 * It starts from whatever theme is already applied, so a signed-in visitor
 * still arrives in the mode they chose; only their toggle here is local, and
 * the document goes back to that theme when the page unmounts.
 */
export function PageThemeToggle() {
  const applied = useSyncExternalStore(
    subscribeToTheme,
    getAppliedTheme,
    (): AppliedTheme => "light",
  );
  const [override, setOverride] = useState<AppliedTheme>();
  const theme = override ?? applied;

  useEffect(() => {
    if (!override) return;
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = override;

    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, [override]);

  return (
    <ThemeToggleButton
      theme={theme}
      onToggle={() => setOverride(theme === "dark" ? "light" : "dark")}
    />
  );
}
