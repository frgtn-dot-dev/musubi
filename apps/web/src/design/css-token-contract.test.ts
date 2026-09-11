import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Check known semantic categories, not specific selectors or literal colors.
// Mixed-value properties (border, shadow, gradients) intentionally stay outside
// this check: dimensions and colors are both valid in those declarations.
function wrongTokenKinds(css: string): string[] {
  const failures: string[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const colorProperties = /^(?:color|background-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color|outline-color|fill|stroke)$/;
  const dimensionProperties = /^(?:padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|(?:row-|column-)?gap|(?:min-|max-)?(?:width|height|inline-size|block-size)|border(?:-[\w-]+)?-radius|font-size|letter-spacing)$/;
  const dimensionToken = /^--(?:space-|radius-|text-\d|control-height|compact-control-height|layer-(?:inline|body-block|viewport-gutter))/;
  const colorToken = /^--(?:surface-|text-(?:primary|secondary|muted)$|border-(?:subtle|medium|strong)$|accent-(?:primary|on-primary)$|control-(?:fill|on-fill)$|status-(?:pass|warn|fail)$)/;
  for (const [, property, value] of source.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    // A single-token background is unambiguously a color slot. Other background
    // shorthands may legitimately use dimensions for position or image size.
    const colorSlot = colorProperties.test(property) || (property === "background" && /^\s*var\(--[\w-]+\)\s*$/.test(value));
    for (const [, token] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if ((colorSlot && dimensionToken.test(token)) || (dimensionProperties.test(property) && colorToken.test(token))) {
        failures.push(`${property}: ${value.trim()} (${token})`);
      }
    }
  }
  return failures;
}

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? cssFiles(path) : path.endsWith(".css") ? [path] : [];
  });
}

describe("CSS semantic token types", () => {
  it("rejects dimensions in color slots and colors in dimension slots", () => {
    expect(wrongTokenKinds(".nav { background: var(--layer-body-block); color: var(--space-2); padding: var(--surface-panel); }")).toHaveLength(3);
  });

  it("allows dimensions, colors, fallbacks and mixed border declarations in their roles", () => {
    expect(wrongTokenKinds("/* color: var(--space-2); */ .row { gap: var(--space-2); color: var(--text-secondary); background: var(--surface-panel); padding: var(--layer-inline, var(--space-4)); border: 1px solid var(--border-subtle); }")).toEqual([]);
  });

  it("keeps every web stylesheet within known semantic token categories", () => {
    const root = resolve(process.cwd(), "src");
    const failures = cssFiles(root).flatMap(path => wrongTokenKinds(readFileSync(path, "utf8")).map(issue => `${path.slice(root.length)}: ${issue}`));
    expect(failures).toEqual([]);
  });
});
