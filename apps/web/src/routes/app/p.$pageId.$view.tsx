import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import { ApiError, ApiResponseError } from "~/api/http";
import { useServerStream } from "~/api/realtime";
import { useSessionUser } from "~/auth/use-session-user";
import { useSnapshot } from "~/offline/SnapshotProvider";
import { signOutAndReset } from "~/offline/sign-out";
import { toDateKey } from "~/calendar/date-key";
import { Workspace } from "~/calendar/components/Workspace";
import { useEventMutations } from "~/calendar/event-mutations";
import { usePageMutations } from "~/calendar/page-editor";
import { useCalendarTransfers } from "~/calendar/calendar-transfers";
import { useSettingsMutations } from "~/calendar/settings-mutations";
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
  // Offline the session cannot be confirmed, so the last known account stands in
  // — otherwise every query key would say "anonymous" and the snapshot for the
  // real user would sit there unread.
  const { user } = useSessionUser();
  const userId = user?.id ?? "anonymous";
  const snapshot = useSnapshot();
  useServerStream(userId);
  const activeView: CalendarViewId =
    isCalendarView(view) ? view : "month";
  const workspace = useWorkspaceQueries(date, userId, activeView);
  const eventMutations = useEventMutations(userId);
  const calendarTransfers = useCalendarTransfers(userId);
  const settingsMutations = useSettingsMutations(userId);
  const pageMutations = usePageMutations(userId);
  const queries = [
    workspace.calendars,
    workspace.events,
    workspace.pages,
    workspace.settings,
  ];
  // One source for "the server did not answer", shared with every form that has
  // to refuse a write (`SnapshotProvider`).
  const offline = snapshot.offline;
  // Restored data that this session has not re-fetched yet. `isFetchedAfterMount`
  // is the honest test: `snapshot.restored` stays true all session, long after
  // the first refresh made it moot.
  const stale =
    !offline &&
    queries.some(
      (query) => query.data !== undefined && !query.isFetchedAfterMount,
    );
  // Waiting on the restore counts as loading: painting an empty calendar first
  // and filling it a frame later is worse than a moment of the loading state.
  const pending = queries.some((query) => query.isPending) || !snapshot.ready;
  const errorQuery = queries.find((query) => query.error);
  const error = errorQuery?.error;

  // Resolve the URL page id against the loaded pages. Unknown ids (a stale
  // bookmark or the "default" sentinel from the initial redirect) fall back to
  // the canonical default Page — real ids are server UUIDs.
  const pages = workspace.pages.data;
  const activePage = pages?.find((page) => page.id === pageId);
  const fallbackPageId =
    pages && !activePage
      ? (pages.find((page) => page.isDefault) ?? pages[0])?.id
      : undefined;

  useEffect(() => {
    if (!fallbackPageId) return;
    void navigate({
      params: { pageId: fallbackPageId, view: activeView },
      replace: true,
      search: { date },
      to: "/app/p/$pageId/$view",
    });
  }, [activeView, date, fallbackPageId, navigate]);

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
    !workspace.pages.data ||
    !workspace.settings.data
  ) {
    const requestId =
      error instanceof ApiError || error instanceof ApiResponseError
        ? error.requestId
        : undefined;

    return (
      <WorkspaceDataState
        detail={
          offline
            ? "There is no saved copy of this calendar on this device yet. Reconnect and try again."
            : error instanceof Error
              ? error.message
              : "The server did not return the complete calendar data."
        }
        kind={offline ? "offline" : "error"}
        onRetry={() => {
          void Promise.all(queries.map((query) => query.refetch()));
        }}
        requestId={requestId}
        title={
          offline
            ? "The server cannot be reached."
            : "We could not open this calendar."
        }
      />
    );
  }

  if (!activePage) {
    // Either redirecting to the default Page (fallbackPageId set) or the account
    // genuinely has no pages (backfill failed) — offer a retry in that case.
    return fallbackPageId ? (
      <WorkspaceDataState
        detail="Opening your default calendar page."
        kind="loading"
        title="Preparing your calendar…"
      />
    ) : (
      <WorkspaceDataState
        detail="Your account has no calendar pages yet. Retry to create the default page."
        kind="error"
        onRetry={() => void workspace.pages.refetch()}
        title="No calendar pages available."
      />
    );
  }

  return (
    <Workspace
      key={pageId}
      activeView={activeView}
      baseEvents={workspace.mergedEvents?.baseEvents}
      calendars={workspace.mergedCalendars}
      pages={workspace.pages.data}
      date={date}
      events={workspace.mergedEvents?.events ?? []}
      isRefreshing={queries.some((query) => query.isFetching)}
      offline={offline}
      snapshotAt={snapshot.savedAt}
      stale={stale}
      onCreateEvent={eventMutations.createEvent}
      onAdoptSettings={settingsMutations.adoptSettings}
      onForkEvent={eventMutations.forkEvent}
      onExportCalendar={calendarTransfers.exportCalendar}
      onImportCalendar={calendarTransfers.importCalendar}
      onCreateCalendar={calendarTransfers.createCalendar}
      onDisconnectExternalCalendar={
        calendarTransfers.disconnectExternalCalendar
      }
      onUpdateCalendar={calendarTransfers.updateCalendar}
      onRemoveCalendar={calendarTransfers.removeCalendar}
      onGetSettingsDocument={settingsMutations.getSettingsDocument}
      onLinkEvent={eventMutations.linkEvent}
      onCreatePage={pageMutations.createPage}
      onDeletePage={pageMutations.deletePage}
      onReorderPages={pageMutations.reorderPages}
      onSavePage={pageMutations.savePage}
      onSetDefaultPage={pageMutations.setDefaultPage}
      pageId={pageId}
      onRemoveEvent={eventMutations.removeEvent}
      onPatchSettings={settingsMutations.patchSettings}
      onSetAttendance={eventMutations.setAttendance}
      settings={workspace.settings.data}
      user={user!}
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
      onOpenFullEditor={(values, event) => {
        // The draft goes in the URL so the page survives a reload.
        const search = {
          allDay: values.isAllDay || undefined,
          attendees: values.hasAttendees || undefined,
          calendarId: values.calendarId,
          calendarIds:
            values.calendarIds.length > 1
              ? values.calendarIds
              : undefined,
          date: values.date,
          description: values.description || undefined,
          endDate: values.endDate || undefined,
          endTime: values.endTime || undefined,
          location: values.location || undefined,
          recurrence: values.recurrence || undefined,
          returnDate: date,
          startTime: values.startTime || undefined,
          title: values.title || undefined,
          url: values.url || undefined,
          view: activeView,
        };

        if (event) {
          void navigate({
            params: { eventId: event.id, pageId },
            search,
            to: "/app/p/$pageId/event/$eventId",
          });
        } else {
          void navigate({
            params: { pageId },
            search,
            to: "/app/p/$pageId/event/new",
          });
        }
      }}
      onViewChange={(nextView) =>
        void navigate({
          params: { pageId, view: nextView },
          search: { date },
          to: "/app/p/$pageId/$view",
        })
      }
      onSignOut={() => {
        void signOutAndReset({
          onDone: () => void navigate({ replace: true, to: "/login" }),
          queryClient,
        });
      }}
      onUpdateEvent={eventMutations.updateEvent}
    />
  );
}
