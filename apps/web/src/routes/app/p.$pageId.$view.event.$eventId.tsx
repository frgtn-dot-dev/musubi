import { eventScopeRequest } from "@musubi/calendar";
import type { Event } from "@musubi/types";
import {
    eventEditorBaseline,
    eventEditorBaselineRedacted,
    clearEventEditorBaseline,
    handoffEventEditor,
} from "~/calendar/event-editor-draft";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { isGoogleEditorPrivacyRefresh, isGoogleEditorRestricted, privateEditorFields, refreshPrivateEditorBaseline, refreshPrivateEditorValues, rememberPrivateEditorChanges, type PrivateEditorField } from "~/calendar/event-editor-privacy";
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
    const [draftValues, setDraftValues] = useState<EventFormValues>();
    const [ownedFields, setOwnedFields] = useState<PrivateEditorField[]>([]);
    const [googleSource, setGoogleSource] = useState(false);
    const [privacyRevision, setPrivacyRevision] = useState<number>();
    const [privacySearch, setPrivacySearch] = useState<typeof search>();
    if (event && event.id !== eventId) {
        setEvent(undefined);
        setDraftValues(undefined);
        setOwnedFields([]);
        setPrivacyRevision(undefined);
        setGoogleSource(false);
        setPrivacySearch(undefined);
    }
    // Cached identity remains usable when a background refetch fails offline.
    // An event alone cannot classify copied provider fields safely.
    const currentHomeCalendar = currentEvent ? getEventHomeCalendar(currentEvent, calendars) : undefined;
    if (!event && currentEvent && currentHomeCalendar) {
        const handedOff = eventEditorBaseline(eventId);
        const urlDraft = hasEventEditorContent(search);
        const baseline = structuredClone(handedOff ?? {
            ...currentEvent,
            revision: urlDraft ? undefined : currentEvent.revision,
        });
        setEvent(baseline);
        setGoogleSource(getEventHomeCalendar(currentEvent, calendars)?.provider === "google");
        const safeSearch = { ...search };
        if ((!handedOff || eventEditorBaselineRedacted(eventId)) && isGoogleEditorRestricted(currentEvent, calendars)) {
            for (const field of privateEditorFields) {
                if (!search.draftFields?.includes(field)) safeSearch[field] = undefined;
            }
            setPrivacySearch(safeSearch);
        }
        const initialValues = applyEventEditorSearch(eventFormValues(baseline), safeSearch);
        setDraftValues(initialValues);
        setOwnedFields(rememberPrivateEditorChanges(eventFormValues(baseline), initialValues, safeSearch.draftFields));
    }
    if (event && currentEvent && privacyRevision !== currentEvent.revision && isGoogleEditorPrivacyRefresh(event, currentEvent, calendars)) {
        const refreshed = refreshPrivateEditorValues(draftValues ?? eventFormValues(event), event, currentEvent, ownedFields);
        const nextSearch = { ...search };
        // Keep explicit URL draft deltas, never copied provider fields.
        const oldValues = eventFormValues(event);
        for (const field of privateEditorFields) {
            if (ownedFields.includes(field)) nextSearch[field] = (draftValues ?? oldValues)[field];
            else if (nextSearch[field] === oldValues[field]) nextSearch[field] = undefined;
        }
        nextSearch.draftFields = ownedFields;
        setEvent(refreshPrivateEditorBaseline(event, currentEvent));
        setDraftValues(refreshed);
        setPrivacyRevision(currentEvent.revision);
        setPrivacySearch(nextSearch);
    }
    if (event && !googleSource && getEventHomeCalendar(event, calendars)?.provider === "google") setGoogleSource(true);
    // A pending range is not evidence of deletion. A settled response is.
    const eventMissing = !currentEvent && !workspace.events.isPending && !workspace.events.isFetching && !workspace.events.isPlaceholderData && !workspace.events.isError;
    if (event && eventMissing && privacyRevision !== -1 && googleSource) {
        const cleared = { ...event, title: "Busy", description: undefined, location: undefined, url: undefined, organizer: "" };
        const nextSearch = { ...search };
        const before = eventFormValues(event);
        for (const field of privateEditorFields) {
            if (ownedFields.includes(field)) nextSearch[field] = (draftValues ?? before)[field];
            else if (nextSearch[field] === before[field]) nextSearch[field] = undefined;
        }
        nextSearch.draftFields = ownedFields;
        setDraftValues(refreshPrivateEditorValues(draftValues ?? before, event, cleared, ownedFields));
        setEvent(refreshPrivateEditorBaseline(event, cleared));
        setPrivacyRevision(-1);
        setPrivacySearch(nextSearch);
    }
    if (!event && eventMissing && privacyRevision !== -1) {
        const nextSearch = { ...search };
        for (const field of privateEditorFields) {
            if (!search.draftFields?.includes(field)) nextSearch[field] = undefined;
        }
        setPrivacyRevision(-1);
        setPrivacySearch(nextSearch);
    }
    useEffect(() => {
        if (eventMissing) clearEventEditorBaseline(eventId);
        else if (privacySearch && event) handoffEventEditor(event, true);
        if (privacySearch) void navigate({ search: privacySearch, replace: true });
    }, [privacySearch, event, eventMissing, eventId, navigate]);

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
        (!event && !currentHomeCalendar && workspace.calendars.isFetching) ||
        workspace.events.isPending ||
        workspace.federated.isPending ||
        workspace.settings.isPending;
    const editable = event ? canEditEvent(event, calendars) : false;
    const title = loading
        ? "Edit event"
        : !event || eventMissing
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
            ) : !event || eventMissing ? (
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
                    key={`${event.id}:${privacyRevision ?? "initial"}`}
                    onValuesChange={values => {
                        setOwnedFields(rememberPrivateEditorChanges(draftValues ?? eventFormValues(event), values, ownedFields));
                        setDraftValues(values);
                    }}
                    calendarLocked
                    calendars={calendars}
                    initialValues={draftValues ?? eventFormValues(event)}
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
                        const edited = updateEventFromForm(event, values);
                        if ((event.recurrence && event.timeModel?.kind === "zoned" && edited.timeEdit?.kind === "zoned" && event.timeModel.timeZone !== edited.timeEdit.timeZone) ||
                            (event.timeModel?.kind === "all-day" && /(?:^|\n)EXDATE/.test(event.recurrence ?? "") && edited.recurrence !== event.recurrence)) {
                            await eventMutations.applyEventScope(event, eventScopeRequest(event, event, "series", edited));
                        } else await eventMutations.updateEvent(edited);
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
