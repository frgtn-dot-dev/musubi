import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applyTheme,
  getAppliedTheme,
  readThemePreference,
  resolveTheme,
  subscribeToTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  toggleTheme,
} from "./theme";

const originalStorage = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);
const storedValues = new Map<string, string>();

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storedValues.get(key) ?? null,
      removeItem: (key: string) => storedValues.delete(key),
      setItem: (key: string, value: string) => storedValues.set(key, value),
    },
  });
});

afterEach(() => {
  storedValues.clear();
  if (originalStorage) {
    Object.defineProperty(window, "localStorage", originalStorage);
  }
  delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.remove();
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("resolves explicit and system preferences", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("applies, persists and announces a preference", () => {
    const listener = vi.fn();
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    window.addEventListener(THEME_CHANGE_EVENT, listener, { once: true });

    applyTheme("dark");

    expect(getAppliedTheme()).toBe("dark");
    expect(readThemePreference()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(meta.content).toBe("#0c0c0e");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("toggles to an explicit theme", () => {
    document.documentElement.dataset.theme = "dark";
    toggleTheme();

    expect(getAppliedTheme()).toBe("light");
    expect(readThemePreference()).toBe("light");
  });

  it("synchronizes a stored change from another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: "dark",
      }),
    );

    expect(getAppliedTheme()).toBe("dark");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("treats an invalid stored value as system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });
});
