import { contrastRatio } from "./contrast";
import type { ThemeTokens } from "./theme-tokens";

/**
 * What a Musubi palette has to prove about itself.
 *
 * Lives apart from the test because two things ask the question: the suite, for
 * the palette in the repository, and `scripts/check-tokens.ts`, for a palette
 * edited in a design tool before it is allowed in. One set of rules, so a colour
 * cannot pass on the way in and fail on the way out.
 */

/** Every surface a piece of text can land on. */
const surfaceRoles = [
  "surfaceCanvas",
  "surfacePanel",
  "surfaceRaised",
  "surfaceSunken",
] as const;

/** Tokens that carry words. Small text has no large-text exemption: 4.5:1 flat. */
const textRoles = ["textPrimary", "textSecondary", "textMuted"] as const;

/** Text that sits on a filled control rather than on a surface. */
const onFillPairs = [
  ["accentOnPrimary", "accentPrimary"],
  ["controlOnFill", "controlFill"],
] as const;

/**
 * Every way the palette breaks, said in full rather than at the first failure —
 * somebody adjusting colours wants the list, not one line at a time.
 */
export function paletteFailures(
  scheme: string,
  tokens: ThemeTokens,
): string[] {
  const failures: string[] = [];
  const ratio = (foreground: string, background: string) =>
    contrastRatio(foreground, background);

  for (const text of textRoles) {
    for (const surface of surfaceRoles) {
      const measured = ratio(tokens[text], tokens[surface]);
      if (measured < 4.5) {
        failures.push(
          `${scheme}.${text} on ${surface} is ${measured.toFixed(2)}:1 — text needs 4.5:1`,
        );
      }
    }
  }

  // Asserting this stays *below* the bar is what keeps it from quietly becoming a
  // text colour: raise it to pass and this fails, so the change has to be argued.
  for (const surface of surfaceRoles) {
    const measured = ratio(tokens.textFaint, tokens[surface]);
    if (measured >= 4.5) {
      failures.push(
        `${scheme}.textFaint on ${surface} is ${measured.toFixed(2)}:1 — it is a text colour now, so fold it into textMuted instead of keeping a second one`,
      );
    }
  }

  for (const [label, fill] of onFillPairs) {
    const measured = ratio(tokens[label], tokens[fill]);
    if (measured < 4.5) {
      failures.push(
        `${scheme}.${label} on ${fill} is ${measured.toFixed(2)}:1 — a label on its own fill needs 4.5:1`,
      );
    }
  }

  return failures;
}
