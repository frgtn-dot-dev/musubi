import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import styles from "./workspace.module.css";

type Theme = "dark" | "light";

function getDocumentTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener("musubi-theme-change", callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener("musubi-theme-change", callback);
    window.removeEventListener("storage", callback);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getDocumentTheme,
    () => "light",
  );

  function toggleTheme() {
    const next = getDocumentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("musubi-theme", next);
    window.dispatchEvent(new Event("musubi-theme-change"));
  }

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
