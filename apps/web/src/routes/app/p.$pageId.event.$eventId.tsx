import { createFileRoute } from "@tanstack/react-router";
import { useSessionUser } from "~/auth/use-session-user";
import { EventEditorForm } from "~/calendar/components/EventEditorForm";
import { EventEditorPage } from "~/calendar/components/EventEditorPage";
import { toDateKey } from "~/calendar/date-key";
import {
  applyEventEditorSearch,
  eventEditorSearchSchema,
} from "~/calendar/event-editor-search";
import {
  eventFormValues,
  updateEventFromForm,
  type EventFormValues,
} from "~/calendar/event-form";
import { useEventMutations } from "~/calendar/event-mutations";
import {
  canEditEvent,
  getEventHomeCalendar,
  getEventMutationError,
} from "~/calendar/event-permissions";
import { useWorkspaceQueries } from "~/calendar/workspace-queries";
import { WorkspaceDataState } from "~/components/WorkspaceDataState";

export const Route = createFileRoute("/app/p/$pageId/event/$eventId")({
  validateSearch: eventEditorSearchSchema,
  component: EditEventRoute,
});

function EditEventRoute() {
  const { eventId, pageId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Same account resolution as the workspace: a snapshot read offline has to
  // look under the right namespace.
  const { user } = useSessionUser();
  const userId = user?.id ?? "anonymous";
  const queryDate =
    search.date ?? search.returnDate ?? toDateKey(new Date());
  const workspace = useWorkspaceQueries(queryDate, userId, search.view);
  const eventMutations = useEventMutations(userId);
  const calendars = workspace.mergedCalendars;
  const event = workspace.mergedEvents?.baseEvents.find(
    (item) => item.id === eventId,
  );
  const back = () =>
    void navigate({
      params: { pageId, view: search.view },
      search: { date: search.returnDate ?? search.date ?? queryDate },
      to: "/app/p/$pageId/$view",
    });

  if (
    workspace.calendars.isPending ||
    workspace.events.isPending ||
    workspace.federated.isPending ||
    workspace.settings.isPending
  ) {
    return (
      <WorkspaceDataState
        detail="Loading the event and its calendars."
        kind="loading"
        title="Preparing the editor…"
      />
    );
  }

  if (!event || !canEditEvent(event, calendars)) {
    return (
      <EventEditorPage
        description={
          event
            ? "Your access changed, so Musubi cannot save edits to this event."
            : "The event may have been deleted or moved out of this calendar."
        }
        onBack={back}
        title={event ? "This event is read-only" : "Event not found"}
      />
    );
  }

  const editableEvent = event;
  const homeCalendar = getEventHomeCalendar(editableEvent, calendars);
  const initialValues = applyEventEditorSearch(
    eventFormValues(editableEvent),
    search,
  );

  async function handleSubmit(values: EventFormValues) {
    await eventMutations.updateEvent(
      updateEventFromForm(editableEvent, values),
    );
    back();
  }

  return (
    <EventEditorPage
      description={
        editableEvent.recurrence
          ? "Changes here apply to the recurring series."
          : "Review every event detail in one place."
      }
      onBack={back}
      title={editableEvent.recurrence ? "Edit series" : "Edit event"}
    >
      <EventEditorForm
        calendarLocked
        calendars={calendars}
        initialValues={initialValues}
        layout="page"
        onCancel={back}
        onError={(error) =>
          getEventMutationError(error, "update", homeCalendar)
        }
        onSubmit={handleSubmit}
        submitLabel="Save"
        timeFormat={workspace.settings.data?.timeFormat ?? "24h"}
        weekStartsOn={workspace.settings.data?.weekStartsOn ?? "monday"}
      />
    </EventEditorPage>
  );
}
