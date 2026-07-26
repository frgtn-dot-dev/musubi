import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, ApiResponseError } from "~/api/http";
import { useOnlineStatus } from "~/api/online-status";
import { authClient } from "~/auth/auth-client";
import { toDateKey } from "~/calendar/date-key";
import { Workspace } from "~/calendar/components/Workspace";
import { useEventMutations } from "~/calendar/event-mutations";
import { useWorkspaceQueries } from "~/calendar/workspace-queries";
import { WorkspaceDataState } from "~/components/WorkspaceDataState";
import {
  isCalendarView,
  type CalendarViewId,
} from "~/calendar/view-registry";

const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => toDateKey(new Date())),
});

export const Route = createFileRoute("/app/p/$pageId/$view")({
  validateSearch: searchSchema,
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { pageId, view } = Route.useParams();
  const { date } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const session = authClient.useSession();
  const activeView: CalendarViewId =
    isCalendarView(view) ? view : "month";
  const workspace = useWorkspaceQueries(
    date,
    session.data?.user.id ?? "anonymous",
    activeView,
  );
  const eventMutations = useEventMutations(
    session.data?.user.id ?? "anonymous",
  );
  const queries = [
    workspace.calendars,
    workspace.events,
    workspace.settings,
  ];
  const pending = queries.some((query) => query.isPending);
  const errorQuery = queries.find((query) => query.error);
  const error = errorQuery?.error;

  if (pending) {
    return (
      <WorkspaceDataState
        detail="Loading calendars, events and your display preferences."
        kind="loading"
        title="Preparing your calendar…"
      />
    );
  }

  if (
    error ||
    !workspace.calendars.data ||
    !workspace.events.data ||
    !workspace.settings.data
  ) {
    const requestId =
      error instanceof ApiError || error instanceof ApiResponseError
        ? error.requestId
        : undefined;

    return (
      <WorkspaceDataState
        detail={
          online
            ? error instanceof Error
              ? error.message
              : "The server did not return the complete calendar data."
            : "Reconnect to the network, then retry this calendar."
        }
        kind={online ? "error" : "offline"}
        onRetry={() => {
          void Promise.all(queries.map((query) => query.refetch()));
        }}
        requestId={requestId}
        title={online ? "We could not open this calendar." : "You are offline."}
      />
    );
  }

  return (
    <Workspace
      activeView={activeView}
      calendars={workspace.calendars.data}
      date={date}
      events={workspace.events.data.events}
      isRefreshing={queries.some((query) => query.isFetching)}
      onCreateEvent={eventMutations.createEvent}
      pageId={pageId}
      onRemoveEvent={eventMutations.removeEvent}
      settings={workspace.settings.data}
      user={session.data!.user}
      onDateChange={(nextDate) =>
        void navigate({
          search: { date: nextDate },
        })
      }
      onPageChange={(nextPageId) =>
        void navigate({
          params: { pageId: nextPageId, view: activeView },
          search: { date },
          to: "/app/p/$pageId/$view",
        })
      }
      onViewChange={(nextView) =>
        void navigate({
          params: { pageId, view: nextView },
          search: { date },
          to: "/app/p/$pageId/$view",
        })
      }
      onSignOut={() => {
        void authClient.signOut().finally(() => queryClient.clear());
      }}
      onUpdateEvent={eventMutations.updateEvent}
    />
  );
}
