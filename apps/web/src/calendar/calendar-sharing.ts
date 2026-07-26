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

// Members and invites for one calendar. Self-contained: reads and writes hit the
// canonical calendar endpoints and keep their own query caches, so the dialog
// needs no props threaded through the route.
export function useCalendarSharing(userId: string, calendar: Calendar | null) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();
  const calendarId = calendar?.id ?? "";
  const enabled = Boolean(calendar);
  const canInvite = can(calendar?.role, "invite");

  const membersKey = queryKeys.members(origin, userId, calendarId);
  const invitesKey = queryKeys.invites(origin, userId, calendarId);
  const calendarsKey = queryKeys.calendars(origin, userId);

  const members = useQuery({
    enabled,
    queryFn: ({ signal }) => getCalendarMembers(calendarId, signal),
    queryKey: membersKey,
  });
  const invites = useQuery({
    // Only inviters may list invites; a viewer would get a 403.
    enabled: enabled && canInvite,
    queryFn: ({ signal }) => getCalendarInvites(calendarId, signal),
    queryKey: invitesKey,
  });

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: membersKey });
  const invalidateInvites = () =>
    queryClient.invalidateQueries({ queryKey: invitesKey });

  const setRole = useMutation({
    mutationFn: (input: { role: string; userId: string }) =>
      setMemberRole(calendarId, input.userId, input.role),
    onSuccess: () => {
      void invalidateMembers();
      // Ownership transfer demotes the current user, so the calendars list
      // (which carries our role) must refresh too.
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
    },
  });
  const remove = useMutation({
    mutationFn: (memberId: string) => kickMember(calendarId, memberId),
    onSuccess: () => void invalidateMembers(),
  });
  const leave = useMutation({
    mutationFn: () => leaveCalendar(calendarId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
      void queryClient.invalidateQueries({
        queryKey: ["events", origin, userId],
      });
    },
  });
  const invite = useMutation({
    mutationFn: (input: { expiresAt: Date | null; maxUses: number | null }) =>
      createInvite({ calendarID: calendarId, ...input }),
    onSuccess: () => void invalidateInvites(),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(inviteId),
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
