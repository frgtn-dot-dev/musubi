import type { Event } from "@musubi/types";
import {
    eventEditorBaseline,
    clearEventEditorBaseline,
} from "~/calendar/event-editor-draft";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useSessionUser } from "~/auth/use-session-user";
import { EventEditorForm } from "~/calendar/components/EventEditorForm";
// The class that fits the page layout into a dialog body lives with the form.
import editorStyles from "~/calendar/components/styles/event-editor.module.css";
import { toDateKey } from "~/calendar/date-key";
import {
    applyEventEditorSearch,
    hasEventEditorContent,
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
import { Dialog } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";

export const Route = createFileRoute("/app/p/$pageId/$view/event/$eventId")({
    validateSearch: eventEditorSearchSchema,
    component: EditEventRoute,
});

function EditEventRoute() {
    const { eventId, pageId, view } = Route.useParams();
    const titleRef = useRef<HTMLInputElement>(null);
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    // Same account resolution as the workspace: a snapshot read offline has to
    // look under the right namespace.
    const { user } = useSessionUser();
    const userId = user?.id ?? "anonymous";
    const queryDate = search.date ?? search.returnDate ?? toDateKey(new Date());
    const workspace = useWorkspaceQueries(queryDate, userId, search.view);
    const eventMutations = useEventMutations(userId);
    const calendars = workspace.mergedCalendars;
    const currentEvent = workspace.mergedEvents?.baseEvents.find(
        (item) => item.id === eventId,
    );
    const [event, setEvent] = useState<Event | undefined>(undefined);
    if (event && event.id !== eventId) setEvent(undefined);
    if (!event && currentEvent) {
        const handedOff = eventEditorBaseline(eventId);
        const urlDraft = hasEventEditorContent(search);
        setEvent(
            structuredClone(
                handedOff ?? {
                    ...currentEvent,
                    revision: urlDraft ? undefined : currentEvent.revision,
                },
            ),
        );
    }
    const back = () => {
        clearEventEditorBaseline(eventId);
        void navigate({
            params: { pageId, view },
            search: { date: search.returnDate ?? search.date ?? queryDate },
            to: "/app/p/$pageId/$view",
        });
    };

    const loading =
        workspace.calendars.isPending ||
        workspace.events.isPending ||
        workspace.federated.isPending ||
        workspace.settings.isPending;
    const editable = event ? canEditEvent(event, calendars) : false;
    const title = loading
        ? "Edit event"
        : !event
          ? "Event not found"
          : !editable
            ? "This event is read-only"
            : event.recurrence
              ? "Edit series"
              : "Edit event";

    return (
        <Dialog
            bodyClassName={editorStyles.dialogFit}
            bodyLayout="flush"
            closeLabel="Close event editor"
            initialFocus={titleRef}
            description={
                event?.recurrence && editable
                    ? "Changes here apply to the recurring series."
                    : "Every detail of the event, on one surface."
            }
            onOpenChange={(open) => {
                if (!open) back();
            }}
            open
            size="workspace"
            title={title}
        >
            {loading && !event ? (
                <Empty
                    description="Loading the event and its calendars."
                    title="Preparing the editor…"
                />
            ) : !event ? (
                <Empty
                    description="The event may have been deleted or moved out of this calendar."
                    title="Event not found"
                />
            ) : !editable ? (
                <Empty
                    description="Your access changed, so Musubi cannot save edits to this event."
                    title="This event is read-only"
                />
            ) : (
                <EventEditorForm
                    calendarLocked
                    calendars={calendars}
                    initialValues={applyEventEditorSearch(
                        eventFormValues(event),
                        search,
                    )}
                    layout="page"
                    onCancel={back}
                    onError={(error) =>
                        getEventMutationError(
                            error,
                            "update",
                            getEventHomeCalendar(event, calendars),
                        )
                    }
                    onSubmit={async (values: EventFormValues) => {
                        await eventMutations.updateEvent(
                            updateEventFromForm(event, values),
                        );
                        back();
                    }}
                    submitLabel="Save"
                    timeFormat={workspace.settings.data?.timeFormat ?? "24h"}
                    titleRef={titleRef}
                    weekStartsOn={
                        workspace.settings.data?.weekStartsOn ?? "monday"
                    }
                />
            )}
        </Dialog>
    );
}
