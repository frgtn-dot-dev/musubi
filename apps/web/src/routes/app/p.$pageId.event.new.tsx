import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_CALENDAR_COLOR } from "@musubi/types";
import { authClient } from "~/auth/auth-client";
import { EventEditorForm } from "~/calendar/components/EventEditorForm";
import { EventEditorPage } from "~/calendar/components/EventEditorPage";
import { toDateKey } from "~/calendar/date-key";
import {
  applyEventEditorSearch,
  eventEditorSearchSchema,
} from "~/calendar/event-editor-search";
import {
  createEventFromForm,
  defaultEventFormValues,
  type EventFormValues,
} from "~/calendar/event-form";
import { useEventMutations } from "~/calendar/event-mutations";
import {
  getEditableCalendars,
  getEventMutationError,
} from "~/calendar/event-permissions";
import { useWorkspaceQueries } from "~/calendar/workspace-queries";
import { WorkspaceDataState } from "~/components/WorkspaceDataState";

export const Route = createFileRoute("/app/p/$pageId/event/new")({
  validateSearch: eventEditorSearchSchema,
  component: NewEventRoute,
});

function NewEventRoute() {
  const { pageId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? "anonymous";
  const date = search.date ?? toDateKey(new Date());
  const workspace = useWorkspaceQueries(date, userId, search.view);
  const eventMutations = useEventMutations(userId);

  const calendars = getEditableCalendars(workspace.mergedCalendars);
  const back = () =>
    void navigate({
      params: { pageId, view: search.view },
      search: { date: search.returnDate ?? date },
      to: "/app/p/$pageId/$view",
    });

  if (workspace.calendars.isPending || workspace.settings.isPending) {
    return (
      <WorkspaceDataState
        detail="Loading your calendars."
        kind="loading"
        title="Preparing the editor…"
      />
    );
  }

  if (calendars.length === 0) {
    return (
      <WorkspaceDataState
        detail="You need edit access to a calendar before you can create events."
        kind="error"
        onRetry={back}
        title="No calendar you can write to."
      />
    );
  }

  const fallback =
    calendars.find((calendar) => calendar.isDefault) ?? calendars[0]!;
  const home =
    calendars.find((calendar) => calendar.id === search.calendarId) ?? fallback;
  const base = defaultEventFormValues(home.id, date, search.startTime, {
    endDate: search.endDate,
    endTime: search.endTime,
    isAllDay: search.allDay,
  });
  const initialValues = applyEventEditorSearch(base, search);

  async function handleSubmit(values: EventFormValues) {
    const calendar = calendars.find((item) => item.id === values.calendarId);
    await eventMutations.createEvent(
      createEventFromForm(
        values,
        { email: session.data?.user.email ?? "", userId },
        calendar?.color ?? DEFAULT_CALENDAR_COLOR,
      ),
    );
    back();
  }

  return (
    <EventEditorPage onBack={back} title="New event">
      <EventEditorForm
        calendars={calendars}
        initialValues={initialValues}
        layout="page"
        onCancel={back}
        onError={(error, values) =>
          getEventMutationError(
            error,
            "create",
            calendars.find((calendar) => calendar.id === values.calendarId),
          )
        }
        onSubmit={handleSubmit}
        submitLabel="Create"
        timeFormat={workspace.settings.data?.timeFormat ?? "24h"}
        weekStartsOn={
          workspace.settings.data?.weekStartsOn ?? "monday"
        }
      />
    </EventEditorPage>
  );
}
