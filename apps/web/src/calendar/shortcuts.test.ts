import { describe, expect, it } from "vitest";
import { shortcutFor } from "./shortcuts";

function press(key: string, modifiers: Partial<Record<string, boolean>> = {}) {
  return {
    altKey: Boolean(modifiers.altKey),
    ctrlKey: Boolean(modifiers.ctrlKey),
    key,
    metaKey: Boolean(modifiers.metaKey),
    shiftKey: Boolean(modifiers.shiftKey),
  };
}

describe("shortcutFor", () => {
  it("maps views, navigation and actions", () => {
    expect(shortcutFor(press("w"))).toEqual({ kind: "view", view: "week" });
    expect(shortcutFor(press("A"))).toEqual({ kind: "view", view: "agenda" });
    expect(shortcutFor(press("t"))).toEqual({ kind: "today" });
    expect(shortcutFor(press("n"))).toEqual({ kind: "next" });
    expect(shortcutFor(press("k"))).toEqual({ kind: "previous" });
    expect(shortcutFor(press("c"))).toEqual({ kind: "create" });
    expect(shortcutFor(press("/"))).toEqual({ kind: "search" });
  });

  it("takes ? even though it needs Shift", () => {
    expect(shortcutFor(press("?", { shiftKey: true }))).toEqual({
      kind: "help",
    });
  });

  it("takes save with either platform modifier", () => {
    expect(shortcutFor(press("s", { metaKey: true }))).toEqual({
      kind: "save",
    });
    expect(shortcutFor(press("S", { ctrlKey: true }))).toEqual({
      kind: "save",
    });
  });

  it("leaves keys alone while text is being typed", () => {
    expect(shortcutFor(press("w"), { typing: true })).toBeUndefined();
    // Save still works from inside a field — that is the point of the chord.
    expect(
      shortcutFor(press("s", { ctrlKey: true }), { typing: true }),
    ).toEqual({ kind: "save" });
  });

  it("ignores modifier chords that belong elsewhere", () => {
    expect(shortcutFor(press("ArrowDown", { altKey: true }))).toBeUndefined();
    expect(shortcutFor(press("t", { metaKey: true }))).toBeUndefined();
    expect(shortcutFor(press("x"))).toBeUndefined();
  });
});
