import {
  DEFAULT_CALENDAR_COLOR,
  type Calendar,
  type Event,
  type Settings,
} from "@musubi/types";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "~/ui/Button";
import { Inspector, InspectorContent } from "~/ui/Inspector";
import { ConfirmationDialog } from "~/ui/ConfirmationDialog";
import {
  createEventFromForm,
  defaultEventFormValues,
  type EventFormValues,
  type ExactEventRange,
} from "../event-form";
import { toDateKey } from "../date-key";
import { getEventMutationError } from "../event-permissions";
import { type EventWhen, EventEditorForm } from "./EventEditorForm";
import styles from "./styles/event-details.module.css";

export type QuickCreateAnchor = {
  returnFocus?: HTMLElement | null;
  x: number;
  y: number;
};

type QuickCreateProps = {
  anchor: QuickCreateAnchor;
  calendars: Calendar[];
  date: string;
  email: string;
  onCreate: (event: Event) => Promise<Event>;
  /** Keeps the block on the grid in step with the fields describing it. */
  onDraftChange?: (draft: EventWhen & { color?: string }) => void;
  onCreated: (event: Event) => void;
  onSavingChange?: (saving: boolean) => void;
  onOpenChange: (open: boolean) => void;
  /** Optional handoff to the full editor page; the panel already shows all fields. */
  onMoreOptions?: (values: EventFormValues) => void;
  exactRange?: ExactEventRange;
  endDate?: string;
  endTime?: string;
  isAllDay?: boolean;
  open: boolean;
  startTime?: string;
  timeFormat: Settings["timeFormat"];
  userId: string;
  weekStartsOn: Settings["weekStartsOn"];
};

export function QuickCreate({
  anchor,
  calendars,
  date,
  email,
  onCreate,
  onDraftChange,
  onCreated,
  onSavingChange,
  onMoreOptions,
  onOpenChange,
  endDate,
  exactRange,
  endTime,
  isAllDay,
  open,
  startTime,
  timeFormat,
  userId,
  weekStartsOn,
}: QuickCreateProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const handoff = useRef(false);
  const confirmationReturnFocus = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<EventFormValues>();
  const [submissionState, setSubmissionState] = useState<{ saving: boolean; error?: ReturnType<typeof getEventMutationError> }>({ saving: false });
  const [discardAction, setDiscardAction] = useState<(() => void)>();
  const defaultCalendar =
    calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const whenValues = defaultEventFormValues(
    defaultCalendar?.id ?? "",
    date,
    startTime,
    { endDate: exactRange ? toDateKey(exactRange.end) : endDate, endTime, isAllDay, exactRange },
  );

  const [initialValues] = useState(whenValues);
  const when = {
    date,
    exactRange,
    endDate: whenValues.endDate,
    endTime: whenValues.endTime,
    isAllDay: whenValues.isAllDay,
    startTime: whenValues.startTime,
  };
  const [initialWhen] = useState(when);
  const whenSignature = JSON.stringify(when);
  const [syncedWhen, setSyncedWhen] = useState(whenSignature);
  if (syncedWhen !== whenSignature) {
    setSyncedWhen(whenSignature);
    // Radix remounts the form when switching between modal and nonmodal.
    // Keep the current grid time together with the user's fields for that mount.
    setDraft(current => ({ ...(current ?? initialValues), ...when, invalidatedExactEndpoints: undefined }));
  }
  const dirty = JSON.stringify(when) !== JSON.stringify(initialWhen) || (draft &&
    [...new Set([...Object.keys(initialValues), ...Object.keys(draft)])].some(key => {
      if (key === "createID" || key === "invalidatedExactEndpoints") return false;
      const field = key as keyof EventFormValues;
      return JSON.stringify(draft[field]) !== JSON.stringify(initialValues[field]);
    }));

  function requestClose(after: () => void) {
    if (saving.current) return;
    const finish = () => { onOpenChange(false); after(); };
    if (dirty) { confirmationReturnFocus.current = titleRef.current; setDiscardAction(() => finish); }
    else finish();
  }

  async function handleSubmit(values: EventFormValues) {
    if (saving.current) return;
    const calendar = calendars.find(item => item.id === values.calendarId);
    saving.current = true;
    onSavingChange?.(true);
    setSubmissionState({ saving: true });
    try {
      const event = createEventFromForm(values, { email, userId }, calendar?.color ?? DEFAULT_CALENDAR_COLOR);
      const created = await onCreate(event);
      onCreated(created);
      onOpenChange(false);
      setSubmissionState({ saving: false });
    } catch (error) {
      setSubmissionState({ saving: false, error: getEventMutationError(error, "create", calendar) });
    } finally {
      saving.current = false;
      onSavingChange?.(false);
    }
  }

  return (
    <>
      <Inspector open={open} onOpenChange={onOpenChange} onRequestClose={requestClose}>
        <InspectorContent
          accessibleTitle="Create event"
          persistent
          className={styles.detailPopover}
          onClick={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
          onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}
          // The grid remains interactive: moving this draft changes its time,
          // and opening another object goes through the shared draft guard.
          onFocusOutside={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (!handoff.current && anchor.returnFocus?.isConnected) anchor.returnFocus.focus();
          }}
        >
          <header className={styles.editorHeader}>
            <h2>New event</h2>
            <IconButton label="Close new event" size="compact" onClick={() => requestClose(() => {})}>
              <X aria-hidden="true" size={17} strokeWidth={1.6} />
            </IconButton>
          </header>
          <EventEditorForm
            calendars={calendars}
            layout="panel"
            titleRef={titleRef}
            onExpand={onMoreOptions ? values => { handoff.current = true; onMoreOptions(values); } : undefined}
            initialValues={draft ?? initialValues}
            onValuesChange={values => { setDraft(values); setSubmissionState({ saving: false }); }}
            submissionState={submissionState}
            when={when}
            onCancel={() => requestClose(() => {})}
            onDraftChange={onDraftChange}
            onError={(error, values) =>
              getEventMutationError(error, "create", calendars.find(calendar => calendar.id === values.calendarId))
            }
            onSubmit={handleSubmit}
            submitLabel="Create"
            timeFormat={timeFormat}
            weekStartsOn={weekStartsOn}
          />
        </InspectorContent>
      </Inspector>
      <ConfirmationDialog
        elevated
        open={!!discardAction}
        onOpenChange={next => { if (!next) setDiscardAction(undefined); }}
        returnFocus={confirmationReturnFocus}
        title="Discard new event?"
        description="This event has not been created."
        closeLabel="Keep editing"
        cancelLabel="Keep editing"
        confirmLabel="Discard event"
        onConfirm={() => {
          confirmationReturnFocus.current = null;
          const finish = discardAction;
          setDiscardAction(undefined);
          finish?.();
        }}
      >
        <p>Your draft will be lost.</p>
      </ConfirmationDialog>
    </>
  );
}
