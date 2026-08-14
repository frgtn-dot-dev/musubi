import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The gateway lists the web client's routes instead of catching everything,
// because `/` belongs to an optional marketing site. That list is a second
// place to edit when a route is added, and forgetting it fails silently: the
// new page reaches the marketing site and 404s there, in production only.
const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = path.join(here, "../routes");
const CADDYFILE = path.join(here, "../../../../ops/gateway/Caddyfile");

const WEB_MATCHER = /@webclient path ([^\n]+)\n\s*handle @webclient \{\n\s*reverse_proxy \{\$WEB_UPSTREAM/;

// TanStack file routes that produce no URL of their own.
const NOT_A_ROUTE = new Set(["__root", "index"]);

/** First URL segment of a TanStack file route: `e.$token.tsx` → `e`. */
function firstSegment(entry: string) {
  const name = entry.replace(/\.(tsx|ts)$/, "");
  // `[.]` escapes a literal dot, so hide it before splitting on the separator.
  const [first] = name.replaceAll("[.]", "\0").split(".");
  return first.replaceAll("\0", ".");
}

function claimedSegments() {
  const segments = new Set<string>();
  for (const entry of readdirSync(ROUTES_DIR, { withFileTypes: true })) {
    const name = entry.name;
    // A leading `-` marks a file the router ignores; the rest are co-located
    // styles and tests.
    if (name.startsWith("-") || name.endsWith(".css")) continue;
    if (!entry.isDirectory() && !/\.(tsx|ts)$/.test(name)) continue;
    const segment = entry.isDirectory() ? name : firstSegment(name);
    if (NOT_A_ROUTE.has(segment)) continue;
    segments.add(segment);
  }
  return [...segments].sort();
}

function gatewayPaths() {
  const matched = WEB_MATCHER.exec(readFileSync(CADDYFILE, "utf8"));
  if (!matched) throw new Error("no web-client handle block in the Caddyfile");
  return matched[1].trim().split(/\s+/);
}

describe("gateway routes", () => {
  it("routes every web client route away from the marketing upstream", () => {
    const paths = gatewayPaths();
    const uncovered = claimedSegments().filter(
      (segment) =>
        !paths.includes(`/${segment}`) && !paths.includes(`/${segment}/*`),
    );

    expect(uncovered).toEqual([]);
  });

  it("keeps the apex on the marketing upstream", () => {
    expect(gatewayPaths()).not.toContain("/");
    expect(readFileSync(CADDYFILE, "utf8")).toContain(
      "reverse_proxy {$MARKETING_UPSTREAM:web:3000}",
    );
  });
});
