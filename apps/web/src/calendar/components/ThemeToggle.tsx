import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
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
