import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);

  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function browserSnapshot() {
  return navigator.onLine;
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, browserSnapshot, () => true);
}

/**
 * Whether a failure means "nobody answered" rather than "the server said no".
 *
 * `navigator.onLine` is the wrong question on its own: it is true on a captive
 * portal, true with a dropped VPN, and true when the self-hosted server is
 * simply down. A fetch that rejects without an HTTP status never reached anyone,
 * which is the case a cached snapshot is for. A 401 or 403 did reach someone and
 * must still send the user to sign in.
 */
export function isUnreachableError(error: unknown) {
  if (!error) return false;
  if (error instanceof TypeError || error instanceof DOMException) return true;

  const status = (error as { status?: unknown }).status;
  return status === undefined || status === 0;
}
