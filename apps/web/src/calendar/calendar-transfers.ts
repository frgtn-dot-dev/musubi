import type { Calendar } from "@musubi/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createCalendar,
  disconnectExternalCalendar,
  exportCalendar,
  importCalendar,
  removeCalendar,
  updateCalendar,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { connectionOfCalendar } from "./federation-routing";

type ImportInput = {
  color: string;
  ics: string;
  name: string;
};

export function useCalendarTransfers(userId: string) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();
  const calendarsKey = queryKeys.calendars(origin, userId);

  const setCalendars = (
    update: (current: Calendar[]) => Calendar[],
  ) => {
    queryClient.setQueryData<Calendar[]>(calendarsKey, (current = []) =>
      update(current),
    );
  };

  const importMutation = useMutation({
    mutationFn: ({ color, ics, name }: ImportInput) =>
      importCalendar(ics, name, color),
    onSuccess: (calendar) => {
      setCalendars((current) => [
        ...current.filter((item) => item.id !== calendar.id),
        calendar,
      ]);
      void queryClient.invalidateQueries({
        queryKey: ["events", origin, userId],
      });
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      /** A connected account to make it in, or nothing for this server. */
      accountId?: string;
      color: string;
      name: string;
      provider?: string;
    }) =>
      createCalendar({
        accountId: input.accountId ?? null,
        color: input.color,
        // id/creatorID are server-assigned; members must satisfy the schema.
        creatorID: userId,
        id: "new",
        members: [],
        name: input.name,
        // With both of these the server creates it on the provider first and
        // imports the mirror, exactly as the sync engine would.
        provider: input.provider ?? null,
      }),
    onSuccess: (calendar) => {
      setCalendars((current) => [
        ...current.filter((item) => item.id !== calendar.id),
        calendar,
      ]);
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
    },
  });

  // A federated calendar is edited on the server that owns it, via the gateway;
  // its rows live in the federation snapshot rather than the home calendar list.
  const invalidateFederated = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.federated(origin, userId),
    });

  const updateMutation = useMutation({
    mutationFn: (calendar: Calendar) =>
      updateCalendar(calendar, connectionOfCalendar(calendar)),
    onSuccess: (calendar, input) => {
      if (connectionOfCalendar(input)) {
        void invalidateFederated();
        return;
      }
      // Keep the role/members the list already holds if the response omits them.
      setCalendars((current) =>
        current.map((item) =>
          item.id === calendar.id ? { ...item, ...calendar } : item,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (calendar: Calendar) =>
      removeCalendar(calendar, connectionOfCalendar(calendar)),
    onSuccess: (calendar, input) => {
      if (connectionOfCalendar(input)) {
        void invalidateFederated();
        return;
      }
      setCalendars((current) =>
        current.filter((item) => item.id !== calendar.id),
      );
      void queryClient.invalidateQueries({
        queryKey: ["events", origin, userId],
      });
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (calendar: Calendar) =>
      disconnectExternalCalendar(calendar.id),
    onMutate: async (calendar) => {
      await queryClient.cancelQueries({ queryKey: calendarsKey });
      const previous = queryClient.getQueryData<Calendar[]>(calendarsKey);
      setCalendars((current) =>
        current.filter((item) => item.id !== calendar.id),
      );
      return { previous };
    },
    onError: (_error, _calendar, context) => {
      if (context?.previous) {
        queryClient.setQueryData(calendarsKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
      void queryClient.invalidateQueries({
        queryKey: ["events", origin, userId],
      });
    },
  });

  return {
    createCalendar: createMutation.mutateAsync,
    disconnectExternalCalendar: disconnectMutation.mutateAsync,
    exportCalendar,
    importCalendar: importMutation.mutateAsync,
    removeCalendar: removeMutation.mutateAsync,
    updateCalendar: updateMutation.mutateAsync,
  };
}
