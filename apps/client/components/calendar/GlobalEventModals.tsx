import { Event } from "@musubi/types";
import { AddEventModal } from "@/components/calendar/AddEventModal";
import EventDetailModal from "@/components/calendar/EventDetailModal";
import { applySeriesEdit } from "@/lib/seriesEdit";
import { useApi } from "@/services/api";
import { liveEventDetail } from "@/lib/liveEvent";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useEventsStore } from "@/store/useEventsStore";
import { useEditComposerStore, useEventDetailStore } from "@/store/useEventDetailStore";

// THE event-detail modal and THE classic edit composer — mounted once in the
// tabs layout, driven by their stores. Screens open them via store writes
// (presentEventDetail / useEditComposerStore.getState().open), so opening a
// modal re-renders only this host, never the calendar/list underneath. RN
// modals stack by visibility order, so these float above CalendarDetailModal too.
export function GlobalEventModals() {
  const api = useApi();
  const { calendars } = useCalendarsStore();
  const { events, addEvent, updateEvent } = useEventsStore();
  const detail = useEventDetailStore();
  const composer = useEditComposerStore();

  const handleEdit = (event: Event) => {
    detail.close();
    useEditComposerStore.getState().open(event);
  };

  return (
    <>
      <AddEventModal
        visible={composer.visible}
        onClose={composer.close}
        onSave={async (e) => { await addEvent(e, api); }}
        onEdit={async (edited) => {
          // The composer was opened on one occurrence; which occurrences the
          // edit belongs to is the composer's last question, not its first.
          await applySeriesEdit({
            addEvent: (event) => addEvent(event, api),
            edited,
            master: events.find((event) => event.id === edited.id),
            occurrence: composer.prefilled ?? edited,
            updateEvent: (event) => updateEvent(event, api),
          });
        }}
        calendars={calendars}
        event={composer.prefilled}
      />
      <EventDetailModal
        visible={detail.visible}
        onClose={detail.close}
        onEdit={handleEdit}
        event={liveEventDetail(events, detail.event)}
      />
    </>
  );
}
