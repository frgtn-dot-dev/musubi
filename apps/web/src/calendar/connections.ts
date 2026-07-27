import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  connectCaldav,
  connectFederatedServer,
  disconnectAccount,
  disconnectFederatedServer,
  getInvitePreview,
  getServerCapabilities,
  joinCalendar,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import type { ParsedInvite } from "./invite-link";

// Calendar scopes are requested at connect time — distinct from sign-in, which
// only needs identity. Better Auth links the extra account server-side.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist",
  "https://www.googleapis.com/auth/calendar.calendars",
];
export const MICROSOFT_CALENDAR_SCOPES = ["Calendars.ReadWrite"];

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
