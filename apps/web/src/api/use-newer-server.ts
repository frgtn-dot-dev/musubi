import { useQuery } from "@tanstack/react-query";
import musubiPackage from "../../../../package.json";
import { getServerCapabilities } from "./resources";
import { getServerOrigin } from "./query-keys";

/** What this bundle was built from. Vite inlines it; there is no fetch. */
const BUILD_VERSION = musubiPackage.version;

/**
 * Which reload the reader has already taken, kept for this tab only.
 *
 * Releases land API first and web second, so between the two deploys the tab
 * can see a newer server while the assets it would reload into are still the
 * old ones. Without this the bar comes back the moment the tab reloads, and
 * asking twice for something that cannot work yet reads as a broken app.
 */
const RELOADED_FOR = "musubi-reloaded-for";

/** Fifteen minutes. Paused while the tab is in the background, by default. */
const CHECK_EVERY_MS = 15 * 60_000;

const rank = (version: string) => version.split(".").map(Number);

/** Numeric, because "0.1.10" sorts before "0.1.9" as a string. */
function isAhead(candidate: string, reference: string) {
  const [a = 0, b = 0, c = 0] = rank(candidate);
  const [x = 0, y = 0, z = 0] = rank(reference);
  return a > x || (a === x && (b > y || (b === y && c > z)));
}

function alreadyReloadedFor(version: string) {
  try {
    return sessionStorage.getItem(RELOADED_FOR) === version;
  } catch {
    // Private mode, or storage the browser will not hand over. Losing the note
    // means one extra bar, never a wrong one.
    return false;
  }
}

/**
 * Whether the server has moved on since this tab was loaded.
 *
 * A browser tab outlives a deploy — the service worker caches nothing, but the
 * JavaScript already running is whatever was current when the tab opened, and
 * people leave Musubi open for days. This is the tab noticing, so it can offer
 * a reload rather than quietly running last week's code against this week's
 * API.
 *
 * Only when the server is genuinely AHEAD. A self-hosted server running behind
 * the app it serves is an ordinary state, and reloading would change nothing —
 * there is no newer bundle to fetch.
 */
export function useNewerServer(enabled = true) {
  const origin = getServerOrigin();
  const { data } = useQuery({
    enabled,
    queryFn: ({ signal }) => getServerCapabilities(signal),
    // Shared with every other reader of this document, so the check costs no
    // extra request — only the interval below is ours.
    queryKey: ["server-capabilities", origin],
    refetchInterval: CHECK_EVERY_MS,
    staleTime: 5 * 60_000,
  });

  const served = data?.version;
  if (!served || !isAhead(served, BUILD_VERSION)) return null;
  if (alreadyReloadedFor(served)) return null;

  return {
    reload: () => {
      try {
        sessionStorage.setItem(RELOADED_FOR, served);
      } catch {
        // Reload anyway; the note is a courtesy, not a precondition.
      }
      window.location.reload();
    },
    version: served,
  };
}
