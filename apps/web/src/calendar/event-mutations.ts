import {
  EventMutationError,
  requireEventRevision,
  type Event,
} from "@musubi/types";
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
import { useMemo } from "react";
import type { AttendanceChoice } from "./attendance";
import { useFederatedWorkspace } from "./federated-workspace";
import {
  connectionForCalendar,
  connectionForEvent,
  federatedConnectionMap,
} from "./federation-routing";

function eventQueryPrefix(userId: string) {
  return ["events", getServerOrigin(), userId] as const;
}

function upsertEvent(
  queryClient: QueryClient,
  userId: string,
  event: Event) {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: eventQueryPrefix(userId) },
    (current) =>
      current
        ? current.events.some(
            (saved) =>
              saved.id === event.id &&
              (saved.revision ?? 0) > (event.revision ?? 0),
          )
          ? current
          : {
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
      if (!current) return current;
      const cached = current.events.find((item) => item.id === result.id);
      if ((cached?.revision ?? 0) > (result.revision ?? event.revision ?? 0)) return current;

      if (result.removed) {
        return {
          ...current,
          deletedIds: Array.from(
            new Set([...current.deletedIds, result.id])),
          events: current.events.filter(
            (currentEvent) => currentEvent.id !== result.id,
          ),
        };
      }

      return {
        ...current,
        events: current.events.map((currentEvent) =>
          currentEvent.id === result.id
            ? (result.event ?? { ...event,
                revision: result.revision, calendars: result.calendars,
              })
            : currentEvent,
        ),
      };
    },
  );
}

export function useEventMutations(userId: string) {
  const queryClient = useQueryClient();
  const prefix = eventQueryPrefix(userId);
  // Cached by useWorkspaceQueries — reading it here keeps the routing decision
  // out of every call site.
  const federated = useFederatedWorkspace(userId);
  const connections = useMemo(
    () => federatedConnectionMap(federated.data?.calendars ?? []),
    [federated.data],
  );
  const federatedKey = queryKeys.federated(getServerOrigin(), userId);

  const refreshEvents = () =>
    queryClient.invalidateQueries({ queryKey: prefix });
  const refreshFederated = () =>
    queryClient.invalidateQueries({ queryKey: federatedKey });

  // Federated events live in the federation query, not the home event cache, so
  // a remote write refetches that server instead of patching local rows.
  const applyWrite = (event: Event, connectionId?: string) => {
    if (connectionId) {
      void refreshFederated();
      return;
    }
    upsertEvent(queryClient, userId, event);
    void refreshEvents();
  };

  const reconcileMutationFailure = (error: unknown, connectionId?: string) => {
    if (error instanceof EventMutationError && error.current && !connectionId) {
      const current = error.current;
      if (current.deletedAt) applyRemoval(queryClient, userId, current, {
        id: current.id, removed: true, calendars: [], revision: current.revision,
      });
      else upsertEvent(queryClient, userId, current);
    }
    void refreshEvents();
    void refreshFederated();
  };

  // A receipt cannot undo a refetch/access-loss reconciliation that arrived
  // while it was in flight, even when no row remains to compare revisions.
  const captureReceiptGuard = () => {
    const snapshots = queryClient.getQueriesData({ queryKey: prefix });
    return () => snapshots.every(([key, data]) => queryClient.getQueryData(key) === data);
  };

  const create = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: (event: Event) =>
      createEvent(event, connectionForEvent(connections, event)),
    onError: (error, input, guard) => reconcileMutationFailure(guard?.() ? error : undefined, connectionForEvent(connections, input)),
    onSuccess: (event, input, guard) => {
      if (guard?.()) applyWrite(event, connectionForEvent(connections, input));
      else { void refreshEvents(); void refreshFederated(); }
    },
  });
  const update = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: (event: Event) =>
      updateEvent(event, connectionForEvent(connections, event)),
    onError: (error, input, guard) => reconcileMutationFailure(guard?.() ? error : undefined, connectionForEvent(connections, input)),
    onSuccess: (event, input, guard) => {
      if (guard?.()) applyWrite(event, connectionForEvent(connections, input));
      else { void refreshEvents(); void refreshFederated(); }
    },
  });
  const remove = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: (event: Event) =>
      removeEvent(event, connectionForEvent(connections, event)),
    onError: (error, input, guard) => reconcileMutationFailure(guard?.() ? error : undefined, connectionForEvent(connections, input)),
    onSuccess: (result, event, guard) => {
      if (!guard?.()) { void refreshEvents(); void refreshFederated(); return; }
      const connectionId = connectionForEvent(connections, event);
      if (connectionId) {
        void refreshFederated();
        return;
      }
      applyRemoval(queryClient, userId, event, result);
      void refreshEvents();
    },
  });
  const link = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: ({
      calendarId,
      eventId,
      expectedRevision,
    }: {
      calendarId: string;
      eventId: string;
      expectedRevision?: number;
    }) =>
      linkEvent(
        eventId,
        requireEventRevision({ revision: expectedRevision }),
        calendarId,
        connectionForCalendar(connections, calendarId),
      ),
    onError: (error, input, guard) => reconcileMutationFailure(
        guard?.() ? error : undefined, connectionForCalendar(connections, input.calendarId)),
    onSuccess: (event, { calendarId }, guard) => {
      if (guard?.()) applyWrite(event, connectionForCalendar(connections, calendarId));
      else { void refreshEvents(); void refreshFederated(); }
    },
  });
  const fork = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: ({
      calendarId,
      eventId,
      expectedRevision,
    }: {
      calendarId: string;
      eventId: string;
      expectedRevision?: number;
    }) =>
      forkEvent(
        eventId,
        requireEventRevision({ revision: expectedRevision }),
        calendarId,
        connectionForCalendar(connections, calendarId),
      ),
    onError: (error, input, guard) => reconcileMutationFailure(
        guard?.() ? error : undefined, connectionForCalendar(connections, input.calendarId)),
    onSuccess: (event, { calendarId }, guard) => {
      if (guard?.()) applyWrite(event, connectionForCalendar(connections, calendarId));
      else { void refreshEvents(); void refreshFederated(); }
    },
  });
  const attendance = useMutation({
    mutationFn: ({
      calendarId,
      eventId,
      status,
    }: {
      calendarId?: string;
      eventId: string;
      status: AttendanceChoice;
    }) =>
      setAttendance(
        eventId,
        status,
        connectionForCalendar(connections, calendarId),
      ),
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
