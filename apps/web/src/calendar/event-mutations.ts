import type { Event } from "@musubi/types";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  EventsResponse,
  RemoveEventResponse,
} from "~/api/contracts";
import {
  createEvent,
  removeEvent,
  updateEvent,
} from "~/api/resources";
import { getServerOrigin } from "~/api/query-keys";

function eventQueryPrefix(userId: string) {
  return ["events", getServerOrigin(), userId] as const;
}

function upsertEvent(
  queryClient: QueryClient,
  userId: string,
  event: Event,
) {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: eventQueryPrefix(userId) },
    (current) =>
      current
        ? {
            ...current,
            deletedIds: current.deletedIds.filter(
              (eventId) => eventId !== event.id,
            ),
            events: [
              ...current.events.filter(
                (currentEvent) => currentEvent.id !== event.id,
              ),
              event,
            ],
          }
        : current,
  );
}

function applyRemoval(
  queryClient: QueryClient,
  userId: string,
  event: Event,
  result: RemoveEventResponse,
) {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: eventQueryPrefix(userId) },
    (current) => {
      if (!current) {
        return current;
      }

      if (result.removed) {
        return {
          ...current,
          deletedIds: Array.from(
            new Set([...current.deletedIds, result.id]),
          ),
          events: current.events.filter(
            (currentEvent) => currentEvent.id !== result.id,
          ),
        };
      }

      return {
        ...current,
        events: current.events.map((currentEvent) =>
          currentEvent.id === result.id
            ? { ...event, calendars: result.calendars }
            : currentEvent,
        ),
      };
    },
  );
}

export function useEventMutations(userId: string) {
  const queryClient = useQueryClient();
  const prefix = eventQueryPrefix(userId);
  const refreshEvents = () =>
    queryClient.invalidateQueries({ queryKey: prefix });

  const create = useMutation({
    mutationFn: createEvent,
    onSuccess: (event) => {
      upsertEvent(queryClient, userId, event);
      void refreshEvents();
    },
  });
  const update = useMutation({
    mutationFn: updateEvent,
    onSuccess: (event) => {
      upsertEvent(queryClient, userId, event);
      void refreshEvents();
    },
  });
  const remove = useMutation({
    mutationFn: removeEvent,
    onSuccess: (result, event) => {
      applyRemoval(queryClient, userId, event, result);
      void refreshEvents();
    },
  });

  return {
    createEvent: create.mutateAsync,
    removeEvent: remove.mutateAsync,
    updateEvent: update.mutateAsync,
  };
}
