import { useEffect } from "react";

const FOCUS_MODE = "focusMode";

/**
 * Arm focus rings on keyboard use, disarm them on pointer use.
 *
 * `:focus-visible` alone isn't enough: when focus moves *programmatically* — a
 * dialog opening on its first field, focus returning to the trigger it came
 * from — the browser guesses, and Chrome guesses "show the ring". Someone
 * working with a mouse then gets an outline flashing at them on every dialog
 * close, which reads as a glitch rather than as guidance.
 *
 * So the ring follows the modality the person is actually using. Any key that
 * isn't typing arms it (Tab, arrows, the app's letter shortcuts); the next
 * pointer press disarms it. Keyboard users therefore always see focus, which is
 * the part that is not negotiable.
 */
export function useFocusMode() {
  useEffect(() => {
    const root = document.documentElement;

    const arm = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      // Typing is not focus navigation — but leaving a field is.
      if (typing && event.key !== "Tab" && event.key !== "Escape") return;
      root.dataset[FOCUS_MODE] = "keyboard";
    };

    const disarm = () => {
      delete root.dataset[FOCUS_MODE];
    };

    window.addEventListener("keydown", arm);
    // Capture: a handler that stops propagation must not leave the ring armed.
    window.addEventListener("pointerdown", disarm, true);

    return () => {
      window.removeEventListener("keydown", arm);
      window.removeEventListener("pointerdown", disarm, true);
    };
  }, []);
}
