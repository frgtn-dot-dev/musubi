import { useEffect } from "react";
import { Event } from "@musubi/types";
import { AddEventModal } from "@/components/calendar/AddEventModal";
import EventDetailModal from "@/components/calendar/EventDetailModal";
import { applySeriesEdit } from "@/lib/seriesEdit";
import { useApi } from "@/services/api";
import { privateEditorRefresh } from "@/lib/eventEditorPrivacy";
import { liveEventDetail, isRetiredGoogleSnapshot } from "@/lib/liveEvent";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useEventsStore } from "@/store/useEventsStore";
import {
  useEditComposerStore,
  useEventDetailStore,
} from "@/store/useEventDetailStore";

// THE event-detail modal and THE classic edit composer — mounted once in the
// tabs layout, driven by their stores. Screens open them via store writes
// (presentEventDetail / useEditComposerStore.getState().open), so opening a
// modal re-renders only this host, never the calendar/list underneath. RN
// modals stack by visibility order, so these float above CalendarDetailModal too.
export function GlobalEventModals() {
  const api = useApi();
  const { calendars } = useCalendarsStore();
  const { events, retiredGoogleEventIDs, retiredGoogleEventRevisions, addEvent, updateEvent, applyEventScope } = useEventsStore();
  const detail = useEventDetailStore();
  const composer = useEditComposerStore();

  const privacyRefresh = (snapshot: Event | undefined) => privateEditorRefresh(snapshot,
    events.find(event => event.id === snapshot?.id), calendars,
    !!snapshot && isRetiredGoogleSnapshot(snapshot, retiredGoogleEventIDs, retiredGoogleEventRevisions));
  const { refreshPrivateSnapshots } = composer;
  const privatePrefilled = privacyRefresh(composer.prefilled);
  const privateMaster = privacyRefresh(composer.master);
  useEffect(() => {
    if (privatePrefilled || privateMaster) refreshPrivateSnapshots(privatePrefilled, privateMaster);
  }, [privatePrefilled, privateMaster, refreshPrivateSnapshots]);
  const liveDetail = liveEventDetail(events, detail.event, retiredGoogleEventIDs, retiredGoogleEventRevisions);
  const detailObservationRevision = events.find(event => event.id === detail.event?.id)?.revision;

  const handleEdit = (event: Event) => {
    detail.close();
    useEditComposerStore.getState().open(event);
  };

  return (
    <>
      <AddEventModal
        visible={composer.visible}
        onClose={composer.close}
        onSave={async (e) => {
          await addEvent(e, api);
        }}
        onEdit={async (edited) => {
          // The composer was opened on one occurrence; which occurrences the
          // edit belongs to is the composer's last question, not its first.
          return await applySeriesEdit({
            applyEventScope: (event, request) => applyEventScope(event, request, api),
            addEvent: (event) => addEvent(event, api),
            edited,
            master: privacyRefresh(composer.master) ?? composer.master,
            occurrence: privacyRefresh(composer.prefilled) ?? composer.prefilled ?? edited,
            updateEvent: (event) => updateEvent(event, api),
          });
        }}
        calendars={calendars}
        event={composer.prefilled}
        privacyEvent={privatePrefilled ?? composer.prefilled}
        sourceRemoved={!!composer.prefilled && isRetiredGoogleSnapshot(composer.prefilled, retiredGoogleEventIDs, retiredGoogleEventRevisions)}
      />
      <EventDetailModal
        visible={detail.visible && !!liveDetail}
        onClose={detail.close}
        onEdit={handleEdit}
        event={liveDetail}
        observationRevision={detailObservationRevision}
      />
    </>
  );
}
