import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { authClient } from "~/auth/auth-client";
import { EventEditorForm } from "~/calendar/components/EventEditorForm";
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
import styles from "~/calendar/components/workspace.module.css";

export const Route = createFileRoute("/app/p/$pageId/event/$eventId")({
  validateSearch: eventEditorSearchSchema,
  component: EditEventRoute,
});

function EditEventRoute() {
  const { eventId, pageId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? "anonymous";
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
      <main className={styles.editorPage} id="main-content">
        <header>
          <button className={styles.textButton} type="button" onClick={back}>
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.6} />
            Back to calendar
          </button>
          <h1>{event ? "This event is read-only" : "Event not found"}</h1>
          <p>
            {event
              ? "Your access changed, so Musubi cannot save edits to this event."
              : "The event may have been deleted or moved out of this calendar."}
          </p>
        </header>
      </main>
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
    <main className={styles.editorPage} id="main-content">
      <header>
        <button className={styles.textButton} type="button" onClick={back}>
          <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.6} />
          Back to calendar
        </button>
        <h1>{editableEvent.recurrence ? "Edit series" : "Edit event"}</h1>
        <p>
          {editableEvent.recurrence
            ? "Changes here apply to the recurring series."
            : "Review every event detail in one place."}
        </p>
      </header>
      <div className={styles.editorPageForm}>
        <EventEditorForm
          calendarLocked
          calendars={calendars}
          initialValues={initialValues}
          onCancel={back}
          onError={(error) =>
            getEventMutationError(error, "update", homeCalendar)
          }
          onSubmit={handleSubmit}
          submitLabel="Save event"
          timeFormat={workspace.settings.data?.timeFormat ?? "24h"}
          weekStartsOn={workspace.settings.data?.weekStartsOn ?? "monday"}
        />
      </div>
    </main>
  );
}
