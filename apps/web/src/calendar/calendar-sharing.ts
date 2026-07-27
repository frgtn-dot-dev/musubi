import { can, type Calendar } from "@musubi/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createInvite,
  getCalendarInvites,
  getCalendarMembers,
  kickMember,
  leaveCalendar,
  revokeInvite,
  setMemberRole,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { connectionOfCalendar } from "./federation-routing";

// Members and invites for one calendar. Self-contained: reads and writes hit the
// canonical calendar endpoints and keep their own query caches, so the dialog
// needs no props threaded through the route.
export function useCalendarSharing(userId: string, calendar: Calendar | null) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();
  const calendarId = calendar?.id ?? "";
  const enabled = Boolean(calendar);
  const canInvite = can(calendar?.role, "invite");
  // A calendar shared from another Musubi server is managed on that server,
  // through the gateway.
  const connectionId = connectionOfCalendar(calendar);
  // Scope the caches per server: the same calendar id could exist on two of them.
  const cacheId = `${connectionId ?? "home"}:${calendarId}`;

  const membersKey = queryKeys.members(origin, userId, cacheId);
  const invitesKey = queryKeys.invites(origin, userId, cacheId);
  const calendarsKey = queryKeys.calendars(origin, userId);

  const members = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      getCalendarMembers(calendarId, signal, connectionId),
    queryKey: membersKey,
  });
  const invites = useQuery({
    // Only inviters may list invites; a viewer would get a 403.
    enabled: enabled && canInvite,
    queryFn: ({ signal }) =>
      getCalendarInvites(calendarId, signal, connectionId),
    queryKey: invitesKey,
  });

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: membersKey });
  const invalidateInvites = () =>
    queryClient.invalidateQueries({ queryKey: invitesKey });
  // Leaving or being demoted on a remote calendar changes what that server
  // returns, so the federated snapshot has to refetch too.
  const invalidateFederated = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.federated(origin, userId),
    });

  const setRole = useMutation({
    mutationFn: (input: { role: string; userId: string }) =>
      setMemberRole(calendarId, input.userId, input.role, connectionId),
    onSuccess: () => {
      void invalidateMembers();
      // Ownership transfer demotes the current user, so the calendars list
      // (which carries our role) must refresh too.
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
      void invalidateFederated();
    },
  });
  const remove = useMutation({
    mutationFn: (memberId: string) =>
      kickMember(calendarId, memberId, connectionId),
    onSuccess: () => void invalidateMembers(),
  });
  const leave = useMutation({
    mutationFn: () => leaveCalendar(calendarId, connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
      void queryClient.invalidateQueries({
        queryKey: ["events", origin, userId],
      });
      void invalidateFederated();
    },
  });
  const invite = useMutation({
    mutationFn: (input: { expiresAt: Date | null; maxUses: number | null }) =>
      createInvite({ calendarID: calendarId, ...input }, connectionId),
    onSuccess: () => void invalidateInvites(),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(inviteId, connectionId),
    onSuccess: () => void invalidateInvites(),
  });

  return {
    canInvite,
    createInvite: invite.mutateAsync,
    invites,
    leaveCalendar: leave.mutateAsync,
    members,
    removeMember: remove.mutateAsync,
    revokeInvite: revoke.mutateAsync,
    setMemberRole: setRole.mutateAsync,
  };
}
