import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getServerOrigin } from "~/api/query-keys";
import { authClient } from "~/auth/auth-client";
import { createSnapshotPersister } from "./persister";
import { readSessionMarker, writeSessionMarker } from "./session-marker";

type SnapshotState = {
  /** When the restored data was written, so the UI can say how old it is. */
  savedAt: number | undefined;
  /** The restore has settled — the first paint can be the snapshot, not a spinner. */
  ready: boolean;
  restored: boolean;
};

const SnapshotContext = createContext<SnapshotState>({
  ready: true,
  restored: false,
  savedAt: undefined,
});

export function useSnapshot() {
  return useContext(SnapshotContext);
}

/**
 * Restores the last snapshot for whoever was signed in, then keeps it written.
 *
 * The account comes from the live session when there is one and from the local
 * marker when there is not — that is what lets a start with no network read a
 * snapshot at all, since the session itself cannot be confirmed offline.
 */
export function SnapshotProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const origin = getServerOrigin();
  const marker = useMemo(() => readSessionMarker(), []);
  const userId = session.data?.user.id ?? marker?.id;
  const [state, setState] = useState<SnapshotState>({
    // With nobody to restore for there is nothing to wait for.
    ready: !userId,
    restored: false,
    savedAt: undefined,
  });

  // Remember the account, so the next start can find its snapshot before the
  // server has answered — or without it answering at all.
  useEffect(() => {
    const user = session.data?.user;
    // Three fields, named one by one: spreading the session user would quietly
    // park whatever else Better Auth carries in local storage.
    if (user) {
      writeSessionMarker({
        email: user.email,
        id: user.id,
        name: user.name,
      });
    }
  }, [session.data?.user]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;

    let active = true;
    const persister = createSnapshotPersister({ origin, queryClient, userId });

    void persister.restore().then((result) => {
      // A restore that lands after the account changed would pour one user's
      // calendar into another's client.
      if (!active) return;
      setState({
        ready: true,
        restored: result.restored,
        savedAt: result.savedAt,
      });
      persister.subscribe();
    });

    return () => {
      active = false;
      persister.stop();
    };
  }, [origin, queryClient, userId]);

  return (
    <SnapshotContext.Provider value={state}>{children}</SnapshotContext.Provider>
  );
}
