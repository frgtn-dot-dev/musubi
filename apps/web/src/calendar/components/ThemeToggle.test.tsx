import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PageThemeToggle } from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "~/design/theme";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("PageThemeToggle", () => {
  /**
   * The bug this exists for: the public poll page used the app's own switch, so
   * a visitor reading a poll in the dark rewrote the preference every signed-in
   * Musubi tab reads.
   */
  it("does not write the stored preference", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.dataset.theme = "light";

    render(<PageThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /dark theme/i }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("still dresses the page it is on", async () => {
    document.documentElement.dataset.theme = "light";

    render(<PageThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /dark theme/i }));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("hands the document back when the page goes away", async () => {
    document.documentElement.dataset.theme = "light";

    const view = render(<PageThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /dark theme/i }));
    view.unmount();

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
