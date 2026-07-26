import type { Event } from "@musubi/types";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  Attendee,
  EventsResponse,
  RemoveEventResponse,
} from "~/api/contracts";
import {
  createEvent,
  forkEvent,
  linkEvent,
  removeEvent,
  setAttendance,
  updateEvent,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

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
  const link = useMutation({
    mutationFn: ({
      calendarId,
      eventId,
    }: {
      calendarId: string;
      eventId: string;
    }) => linkEvent(eventId, calendarId),
    onSuccess: (event) => {
      upsertEvent(queryClient, userId, event);
      void refreshEvents();
    },
  });
  const fork = useMutation({
    mutationFn: ({
      calendarId,
      eventId,
    }: {
      calendarId: string;
      eventId: string;
    }) => forkEvent(eventId, calendarId),
    onSuccess: (event) => {
      upsertEvent(queryClient, userId, event);
      void refreshEvents();
    },
  });
  const attendance = useMutation({
    mutationFn: ({
      attending,
      eventId,
    }: {
      attending: boolean;
      eventId: string;
    }) => setAttendance(eventId, attending),
    onSuccess: (attendees, { eventId }) => {
      queryClient.setQueryData<Attendee[]>(
        queryKeys.attendees(getServerOrigin(), userId, eventId),
        attendees,
      );
    },
  });

  return {
    createEvent: create.mutateAsync,
    forkEvent: fork.mutateAsync,
    linkEvent: link.mutateAsync,
    removeEvent: remove.mutateAsync,
    setAttendance: attendance.mutateAsync,
    updateEvent: update.mutateAsync,
  };
}
