import type { Calendar } from "@musubi/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  exportCalendar,
  importCalendar,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

type ImportInput = {
  color: string;
  ics: string;
  name: string;
};

export function useCalendarTransfers(userId: string) {
  const queryClient = useQueryClient();
  const calendarsKey = queryKeys.calendars(
    getServerOrigin(),
    userId,
  );
  const importMutation = useMutation({
    mutationFn: ({ color, ics, name }: ImportInput) =>
      importCalendar(ics, name, color),
    onSuccess: (calendar) => {
      queryClient.setQueryData<Calendar[]>(
        calendarsKey,
        (current = []) => [
          ...current.filter((item) => item.id !== calendar.id),
          calendar,
        ],
      );
      void queryClient.invalidateQueries({
        queryKey: ["events", getServerOrigin(), userId],
      });
      void queryClient.invalidateQueries({ queryKey: calendarsKey });
    },
  });

  return {
    exportCalendar,
    importCalendar: importMutation.mutateAsync,
  };
}
