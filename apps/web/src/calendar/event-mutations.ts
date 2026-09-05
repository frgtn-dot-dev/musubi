import {
  EventMutationError,
  requireEventRevision,
  type Event,
} from "@musubi/types";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type Query,
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

type ReceiptGuard = (query: Query) => boolean;

function upsertEvent(
  queryClient: QueryClient,
  userId: string,
  event: Event,
  guard: ReceiptGuard,
) {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: eventQueryPrefix(userId), predicate: guard },
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
  guard: ReceiptGuard,
) {
  queryClient.setQueriesData<EventsResponse>(
    { queryKey: eventQueryPrefix(userId), predicate: guard },
    (current) => {
      if (!current) return current;
      const cached = current.events.find((item) => item.id === result.id);
      if ((cached?.revision ?? 0) > (result.revision ?? event.revision ?? 0))
        return current;

      if (result.removed) {
        return {
          ...current,
          deletedIds: Array.from(new Set([...current.deletedIds, result.id])),
          events: current.events.filter(
            (currentEvent) => currentEvent.id !== result.id,
          ),
        };
      }

      return {
        ...current,
        events: current.events.map((currentEvent) =>
          currentEvent.id === result.id
            ? (result.event ?? {
                ...event,
                revision: result.revision,
                calendars: result.calendars,
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
  const applyWrite = (
    event: Event,
    guard: ReceiptGuard,
    connectionId?: string,
  ) => {
    if (connectionId) {
      void refreshFederated();
      return;
    }
    upsertEvent(queryClient, userId, event, guard);
    void refreshEvents();
  };

  const reconcileMutationFailure = (
    error: unknown,
    guard: ReceiptGuard,
    connectionId?: string,
  ) => {
    if (error instanceof EventMutationError && error.current && !connectionId) {
      const current = error.current;
      if (current.deletedAt)
        applyRemoval(
          queryClient,
          userId,
          current,
          {
            id: current.id,
            removed: true,
            calendars: [],
            revision: current.revision,
          },
          guard,
        );
      else upsertEvent(queryClient, userId, current, guard);
    }
    void refreshEvents();
    void refreshFederated();
  };

  // Apply only to the exact query instances/data observed at request start.
  // Navigation may populate another range while this request is pending; that
  // newer snapshot (including absence) must never receive the old receipt.
  const captureReceiptGuard = (): ReceiptGuard => {
    const snapshots = new Map(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: prefix })
        .map((query) => [query, query.state.data]),
    );
    return (query) =>
      snapshots.has(query) && snapshots.get(query) === query.state.data;
  };
  const rejectReceipt: ReceiptGuard = () => false;

  const create = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: (event: Event) =>
      createEvent(event, connectionForEvent(connections, event)),
    onError: (error, input, guard) =>
      reconcileMutationFailure(
        error,
        guard ?? rejectReceipt,
        connectionForEvent(connections, input),
      ),
    onSuccess: (event, input, guard) => {
      applyWrite(
        event,
        guard ?? rejectReceipt,
        connectionForEvent(connections, input),
      );
    },
  });
  const update = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: (event: Event) =>
      updateEvent(event, connectionForEvent(connections, event)),
    onError: (error, input, guard) =>
      reconcileMutationFailure(
        error,
        guard ?? rejectReceipt,
        connectionForEvent(connections, input),
      ),
    onSuccess: (event, input, guard) => {
      applyWrite(
        event,
        guard ?? rejectReceipt,
        connectionForEvent(connections, input),
      );
    },
  });
  const remove = useMutation({
    onMutate: captureReceiptGuard,
    mutationFn: (event: Event) =>
      removeEvent(event, connectionForEvent(connections, event)),
    onError: (error, input, guard) =>
      reconcileMutationFailure(
        error,
        guard ?? rejectReceipt,
        connectionForEvent(connections, input),
      ),
    onSuccess: (result, event, guard) => {
      const connectionId = connectionForEvent(connections, event);
      if (connectionId) {
        void refreshFederated();
        return;
      }
      applyRemoval(queryClient, userId, event, result, guard ?? rejectReceipt);
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
    onError: (error, input, guard) =>
      reconcileMutationFailure(
        error,
        guard ?? rejectReceipt,
        connectionForCalendar(connections, input.calendarId),
      ),
    onSuccess: (event, { calendarId }, guard) => {
      applyWrite(
        event,
        guard ?? rejectReceipt,
        connectionForCalendar(connections, calendarId),
      );
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
    onError: (error, input, guard) =>
      reconcileMutationFailure(
        error,
        guard ?? rejectReceipt,
        connectionForCalendar(connections, input.calendarId),
      ),
    onSuccess: (event, { calendarId }, guard) => {
      applyWrite(
        event,
        guard ?? rejectReceipt,
        connectionForCalendar(connections, calendarId),
      );
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
