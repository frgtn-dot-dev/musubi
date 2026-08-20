import { recordServerDiagnostic } from "@/lib/serverDiagnostics";
import type { z } from "zod";

/**
 * Check a response against the shape this build was compiled against.
 *
 * The web has done this since it was written; the phone cast and hoped. That
 * is backwards — the web is a redeploy away from any fix, and a phone build
 * carries whatever it shipped with until its owner updates from the store.
 * The client that cannot be corrected is the one that most needs to notice.
 *
 * Two things come out of it. A response that matches is *converted*, so
 * `event.start` is the `Date` its type has always claimed rather than the
 * string that was actually there. A response that does not match is recorded
 * where someone can read it.
 *
 * ## Why production does not throw
 *
 * Musubi is self-hostable, so "the server is older than the app" is ordinary,
 * not exceptional: someone installs today's build from the store and points it
 * at the server they set up last spring. `minClientVersion` keeps an old app
 * away from a new server; nothing keeps a new app away from an old server, and
 * nothing can.
 *
 * Refusing to render would turn a partly-working app into a dead one for
 * exactly those people. So a mismatch degrades the way it always has, and the
 * gain is that it is now *visible* — in the diagnostics the settings screen
 * copies, which is how a self-hoster's report reaches us at all.
 *
 * In development it throws, because there it can be fixed before it ships.
 */
export function readWire<T>(
  schema: z.ZodType<T>,
  data: unknown,
  endpoint: string,
): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;

  // The first few are enough to name the problem; a shape that is wholly wrong
  // produces one issue per field and none of them adds anything.
  const detail = parsed.error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
    .join("; ");
  const summary = `${endpoint} does not match this build: ${detail}`;

  recordServerDiagnostic(`✗ ${summary}`);
  console.error("Wire mismatch", endpoint, parsed.error.issues);

  if (typeof __DEV__ !== "undefined" && __DEV__) throw new Error(summary);

  // Exactly what this call returned before there was any checking at all.
  return data as T;
}
