import { useMemo } from "react";
import { isUnreachableError, useOnlineStatus } from "~/api/online-status";
import { readSessionMarker } from "~/offline/session-marker";
import { authClient } from "./auth-client";

export type SessionUser = {
  email: string;
  id: string;
  /** The profile photo. Absent from the offline marker, which holds no URLs. */
  image?: null | string;
  name: string;
};

/**
 * Who the app is for right now.
 *
 * A confirmed session always wins. With no network there is nothing to confirm,
 * so the locally remembered account stands in — which is what keeps the query
 * namespace, and therefore the snapshot, pointed at the right person instead of
 * falling back to `"anonymous"` and finding nothing.
 *
 * `fromSnapshot` is the honest half: it says the identity has not been checked
 * against the server, so anything shown alongside it is cached, not live.
 */
export function useSessionUser(): {
  fromSnapshot: boolean;
  user: SessionUser | undefined;
} {
  const session = authClient.useSession();
  const online = useOnlineStatus();
  const marker = useMemo(() => readSessionMarker(), []);
  // Either the browser says there is no network, or the session request came
  // back with nothing that looks like an answer from a server.
  const unreachable = !online || isUnreachableError(session.error);

  if (session.data?.user) {
    const { email, id, image, name } = session.data.user;
    return { fromSnapshot: false, user: { email, id, image, name } };
  }

  return unreachable && marker
    ? {
        fromSnapshot: true,
        user: { email: marker.email, id: marker.id, name: marker.name },
      }
    : { fromSnapshot: false, user: undefined };
}
