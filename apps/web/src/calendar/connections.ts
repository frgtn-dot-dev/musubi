import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  connectCaldav,
  connectFederatedServer,
  disconnectAccount,
  disconnectFederatedServer,
  getInvitePreview,
  getServerCapabilities,
  joinCalendar,
  syncProviderCalendars,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import type { ParsedInvite } from "@musubi/types";

// Calendar scopes are requested at connect time — distinct from sign-in, which
// only needs identity. Better Auth links the extra account server-side.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/tasks",
];
export const MICROSOFT_CALENDAR_SCOPES = ["Calendars.ReadWrite", "Tasks.ReadWrite"];

// Linking a provider is a full-page trip to Google or Microsoft and back, so no
// React state survives it. This marker does — sessionStorage is per tab and
// outlives a navigation — and it is what tells the returning page that it has an
// import to run rather than a fresh visit to ignore.
const PENDING_LINK_KEY = "musubi:linking-provider";

export function rememberProviderLink(provider: string) {
  try {
    window.sessionStorage.setItem(PENDING_LINK_KEY, provider);
  } catch {
    // Private mode: the link still works, the import just waits for the
    // scheduler like it did before.
  }
}

function peekPendingProviderLink() {
  try {
    return window.sessionStorage.getItem(PENDING_LINK_KEY) !== null;
  } catch {
    return false;
  }
}

function takePendingProviderLink() {
  try {
    const provider = window.sessionStorage.getItem(PENDING_LINK_KEY);
    // Read once. A second render, or a later reload of the same tab, must not
    // trigger another import.
    window.sessionStorage.removeItem(PENDING_LINK_KEY);
    return provider ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finishes a provider link after the browser comes back from the provider.
 *
 * Better Auth stores the account, but an account with no calendars is invisible:
 * the connections list is built from the calendars that carry a provider and an
 * account id. Without this the person sees exactly nothing until the background
 * sync happens to run, which is minutes later and looks like a failure.
 *
 * Belongs to the route, not the workspace: it has to keep running while the
 * workspace is behind its data gate and through canonical Page redirects.
 */
export function useProviderLinkReturn(userId: string) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();
  const started = useRef(false);
  // Peeked, not consumed, so the very first paint after the round trip already
  // says "importing" instead of "no connected accounts".
  const [state, setState] = useState(() => ({
    error: undefined as string | undefined,
    importing: peekPendingProviderLink(),
    linked: false,
  }));

  useEffect(() => {
    // Wait for the real account. `useSessionUser` starts out "anonymous" while
    // the session resolves, and importing under that id would invalidate query
    // keys nobody is watching — and consume the marker before the right id
    // arrives. The ref, not the effect, is what makes this run once: the effect
    // re-runs the moment the id changes.
    if (started.current || userId === "anonymous") return;
    const provider = takePendingProviderLink();
    if (!provider) return;
    started.current = true;

    const settle = (error?: string) => {
      // Refetch either way: a sync that failed on one account may still have
      // imported another.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calendars(origin, userId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["events", origin, userId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tasks(origin, userId),
      });
      setState({ error, importing: false, linked: true });
    };

    void syncProviderCalendars({ provider }).then(
      () => settle(),
      (reason: unknown) =>
        settle(
          reason instanceof Error ? reason.message : "The import did not finish.",
        ),
    );
  }, [origin, queryClient, userId]);

  return state;
}

export function useConnections(userId: string) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();
  const calendarsKey = queryKeys.calendars(origin, userId);

  const capabilities = useQuery({
    queryFn: ({ signal }) => getServerCapabilities(signal),
    // Server capabilities rarely change within a session.
    queryKey: ["server-capabilities", origin],
    staleTime: 5 * 60_000,
  });

  const refreshCalendars = () => {
    void queryClient.invalidateQueries({ queryKey: calendarsKey });
    void queryClient.invalidateQueries({
      queryKey: ["events", origin, userId],
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.tasks(origin, userId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.federated(origin, userId),
    });
  };

  const connect = useMutation({
    mutationFn: (input: {
      password: string;
      serverUrl: string;
      username: string;
    }) => connectCaldav(input),
    onSuccess: refreshCalendars,
  });

  const disconnect = useMutation({
    mutationFn: (input: { accountId: string; provider: string }) =>
      disconnectAccount(input),
    onSuccess: refreshCalendars,
  });

  const disconnectFederated = useMutation({
    mutationFn: (server: string) => disconnectFederatedServer(server),
    onSuccess: refreshCalendars,
  });

  // Accepting an invite: a link for this server is a plain join, one for another
  // server runs the federation handshake on the home server.
  const acceptInvite = useMutation({
    mutationFn: async (invite: ParsedInvite) => {
      if (invite.server) {
        await connectFederatedServer(invite.server, invite.token);
        return;
      }
      const preview = await getInvitePreview(invite.token);
      await joinCalendar(preview.id, invite.token);
    },
    onSuccess: refreshCalendars,
  });

  return {
    acceptInvite: acceptInvite.mutateAsync,
    capabilities,
    connectCaldav: connect.mutateAsync,
    disconnectAccount: disconnect.mutateAsync,
    disconnectFederatedServer: disconnectFederated.mutateAsync,
  };
}
