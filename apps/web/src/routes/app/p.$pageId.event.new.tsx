import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_CALENDAR_COLOR } from "@musubi/types";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { authClient } from "~/auth/auth-client";
import { toDateKey } from "~/calendar/date-key";
import { EventEditorForm } from "~/calendar/components/EventEditorForm";
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
import { isCalendarView } from "~/calendar/view-registry";
import styles from "~/calendar/components/workspace.module.css";

/**
 * The draft travels in the URL rather than in memory: this page is reachable by
 * reload and by link, and a half-filled event is not worth losing to a refresh.
 * A field the URL cannot carry simply falls back to its default.
 */
const optional = z.string().optional().catch(undefined);

const searchSchema = z.object({
  allDay: z.boolean().optional().catch(undefined),
  attendees: z.boolean().optional().catch(undefined),
  calendarId: optional,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => toDateKey(new Date())),
  description: optional,
  endDate: optional,
  endTime: optional,
  location: optional,
  recurrence: optional,
  /**
   * Where the calendar was standing. Separate from the draft's own date: leaving
   * this page must not silently move the user to a different week (R2).
   */
  returnDate: optional,
  startTime: optional,
  title: optional,
  url: optional,
  /** Where to go back to, so leaving lands where the user started. */
  view: z
    .string()
    .catch("month")
    .transform((value) => (isCalendarView(value) ? value : "month")),
});

export const Route = createFileRoute("/app/p/$pageId/event/new")({
  validateSearch: searchSchema,
  component: NewEventRoute,
});

function NewEventRoute() {
  const { pageId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? "anonymous";
  const workspace = useWorkspaceQueries(search.date, userId, search.view);
  const eventMutations = useEventMutations(userId);

  const calendars = getEditableCalendars(workspace.mergedCalendars);
  const back = () =>
    void navigate({
      params: { pageId, view: search.view },
      search: { date: search.returnDate ?? search.date },
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
  const base = defaultEventFormValues(home.id, search.date, search.startTime, {
    endDate: search.endDate,
    endTime: search.endTime,
    isAllDay: search.allDay,
  });
  const initialValues: EventFormValues = {
    ...base,
    description: search.description ?? "",
    hasAttendees: search.attendees ?? false,
    location: search.location ?? "",
    recurrence: search.recurrence ?? "",
    title: search.title ?? "",
    url: search.url ?? "",
  };

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
    <main className={styles.editorPage}>
      <header>
        <button className={styles.textButton} type="button" onClick={back}>
          <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.6} />
          Back to calendar
        </button>
        <h1>New event</h1>
      </header>
      <div className={styles.editorPageForm}>
        <EventEditorForm
          calendars={calendars}
          initialValues={initialValues}
          onCancel={back}
          onError={(error, values) =>
            getEventMutationError(
              error,
              "create",
              calendars.find((calendar) => calendar.id === values.calendarId),
            )
          }
          onSubmit={handleSubmit}
          submitLabel="Create event"
          timeFormat={
            workspace.settings.data?.timeFormat ?? "24h"
          }
          weekStartsOn={
            workspace.settings.data?.weekStartsOn ?? "monday"
          }
        />
      </div>
    </main>
  );
}
