import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  connectCaldav,
  disconnectAccount,
  getServerCapabilities,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

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

  return {
    capabilities,
    connectCaldav: connect.mutateAsync,
    disconnectAccount: disconnect.mutateAsync,
  };
}
