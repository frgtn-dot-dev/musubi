import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  getAppliedTheme,
  subscribeToTheme,
  toggleTheme,
} from "~/design/theme";
import styles from "./workspace.module.css";

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getAppliedTheme,
    () => "light",
  );

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      className={styles.iconButton}
      type="button"
      aria-label={`Use ${nextTheme} theme`}
      title={`Use ${nextTheme} theme`}
      onClick={toggleTheme}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={17} strokeWidth={1.6} />
      ) : (
        <Moon aria-hidden="true" size={17} strokeWidth={1.6} />
      )}
    </button>
  );
}
