import { createFileRoute } from "@tanstack/react-router";
import { type RefObject, useRef } from "react";
import { DEFAULT_CALENDAR_COLOR } from "@musubi/types";
import { useSessionUser } from "~/auth/use-session-user";
import { EventEditorForm } from "~/calendar/components/EventEditorForm";
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
import { Dialog } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";

export const Route = createFileRoute("/app/p/$pageId/$view/event/new")({
  validateSearch: eventEditorSearchSchema,
  component: NewEventRoute,
});

function NewEventRoute() {
  const { pageId, view } = Route.useParams();
  // The caret belongs in the title: whoever pressed "More options" was already
  // typing there.
  const titleRef = useRef<HTMLInputElement>(null);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Same account resolution as the workspace: a snapshot read offline has to
  // look under the right namespace.
  const { user } = useSessionUser();
  const userId = user?.id ?? "anonymous";
  const date = search.date ?? toDateKey(new Date());
  const workspace = useWorkspaceQueries(date, userId, search.view);
  const eventMutations = useEventMutations(userId);

  const calendars = getEditableCalendars(workspace.mergedCalendars);
  // The calendar this sits on top of is the calendar to go back to, so leaving
  // is a navigation to the parent rather than a history step of unknown depth.
  const back = () =>
    void navigate({
      params: { pageId, view },
      search: { date: search.returnDate ?? date },
      to: "/app/p/$pageId/$view",
    });

  const loading =
    workspace.calendars.isPending || workspace.settings.isPending;

  return (
    <Dialog
      bodyLayout="flush"
      bodyScroll="panels"
      closeLabel="Close event editor"
      description="Every detail of the event, on one surface."
      initialFocus={titleRef}
      onOpenChange={(open) => {
        if (!open) back();
      }}
      open
      size="workspace"
      title="New event"
    >
      {loading ? (
        <Empty
          description="Loading your calendars."
          title="Preparing the editor…"
        />
      ) : calendars.length === 0 ? (
        <Empty
          description="You need edit access to a calendar before you can create events."
          title="No calendar you can write to."
        />
      ) : (
        <NewEventForm
          back={back}
          calendars={calendars}
          date={date}
          eventMutations={eventMutations}
          search={search}
          settings={workspace.settings.data}
          titleRef={titleRef}
          user={user}
        />
      )}
    </Dialog>
  );
}

type NewEventFormProps = {
  back: () => void;
  calendars: ReturnType<typeof getEditableCalendars>;
  date: string;
  eventMutations: ReturnType<typeof useEventMutations>;
  search: ReturnType<typeof Route.useSearch>;
  settings: ReturnType<typeof useWorkspaceQueries>["settings"]["data"];
  titleRef: RefObject<HTMLInputElement | null>;
  user: ReturnType<typeof useSessionUser>["user"];
};

function NewEventForm({
  back,
  calendars,
  date,
  eventMutations,
  search,
  settings,
  titleRef,
  user,
}: NewEventFormProps) {
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
        { email: user?.email ?? "", userId: user?.id ?? "anonymous" },
        calendar?.color ?? DEFAULT_CALENDAR_COLOR,
      ),
    );
    back();
  }

  return (
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
      timeFormat={settings?.timeFormat ?? "24h"}
      titleRef={titleRef}
      weekStartsOn={settings?.weekStartsOn ?? "monday"}
    />
  );
}
