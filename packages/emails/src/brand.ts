import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, logger } from "@musubi/config";

/**
 * The mark at the top of every email, and where its footer points.
 *
 * One module so the five templates cannot drift apart — the whole reason this
 * exists is that the wordmark in the footer had been `href="#"` in all of them
 * at once, and nobody was going to notice it five times.
 */

/** Referenced as `cid:musubi-logo` in the markup; `sendEmail` attaches it. */
export const LOGO_CID = "musubi-logo";

// Rendered from apps/web/public/favicon.svg at 128px, shown at 44 so it stays
// sharp on a retina screen. PNG, not SVG: Gmail drops SVG entirely and Outlook
// never supported it, so the whole header would silently vanish.
const LOGO_PATH = join(__dirname, "..", "assets", "logo.png");

let logo: Buffer | null | undefined;

/**
 * The inline attachment, or null when the file is not where it should be.
 *
 * Travelling with the message rather than being fetched from a URL is what
 * makes this work for a self-hosted server with no public domain — and it
 * means no client has to be told to "display images" first.
 */
export function logoAttachment() {
  if (logo === undefined) {
    try {
      logo = readFileSync(LOGO_PATH);
    } catch (error) {
      // Not fatal: the `alt` text still says Musubi and the mail still sends.
      // Logged because a missing asset in a container is otherwise invisible.
      logo = null;
      logger.warn("email.logo_missing", { error, path: LOGO_PATH });
    }
  }

  return logo
    ? [{ cid: LOGO_CID, content: logo, filename: "musubi.png" }]
    : [];
}

/**
 * Where the footer wordmark goes: this server's own origin.
 *
 * Not a hard-coded musubi.pro — somebody running their own instance should be
 * sent to their own instance, not to somebody else's marketing site.
 */
export function brandUrl() {
  return config.api.url;
}

/** The header mark. `display:block` and real width/height are for Outlook. */
export function logoMarkup() {
  return `<img
                        src="cid:${LOGO_CID}"
                        alt="Musubi"
                        width="44"
                        height="44"
                        style="display:block;border:0;outline:none;text-decoration:none;margin-bottom:24px" />`;
}
