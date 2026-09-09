import { getServerOrigin } from "~/api/query-keys";
import { useEffect, useRef, useState } from "react";
import type {
  Event,
  ProviderEventStateResponse,
  ProviderOrganizerRequest,
} from "@musubi/types";
import {
  organizerDraft,
  organizerRequest,
  organizerNotice,
  type OrganizerDraft,
} from "@musubi/calendar";
import { editProviderOrganizer, getOrganizerCalendar } from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { ConfirmationDialog } from "~/ui/ConfirmationDialog";
import { Field } from "~/ui/Field";
import { Checkbox } from "~/ui/Checkbox";
import { InlineError } from "~/ui/InlineError";
import styles from "./styles/event-delivery.module.css";
export function ProviderOrganizerCreateAction(props: {
  calendarID: string;
  color: string;
  connectionId?: string;
}) {
  return (
    <OrganizerCreateActionBody
      key={JSON.stringify([
        props.calendarID,
        props.connectionId,
        getServerOrigin(),
      ])}
      {...props}
    />
  );
}
function OrganizerCreateActionBody({
  calendarID,
  color,
  connectionId,
}: {
  calendarID: string;
  color: string;
  connectionId?: string;
}) {
  const [available, setAvailable] = useState(false),
    [trigger, setTrigger] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getOrganizerCalendar(calendarID, controller.signal, connectionId)
      .then(() => {
        if (!controller.signal.aborted) setAvailable(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [calendarID, connectionId]);
  return available ? (
    <>
      <Button
        variant="secondary"
        size="compact"
        onClick={(event) => setTrigger(event.currentTarget)}
      >
        Create Google meeting
      </Button>
      {trigger ? (
        <ProviderOrganizerEditor
          calendarID={calendarID}
          color={color}
          connectionId={connectionId}
          returnFocus={trigger}
          onClose={() => setTrigger(null)}
        />
      ) : null}
    </>
  ) : null;
}
export function ProviderOrganizerEditor({
  calendarID,
  color,
  event,
  observation,
  connectionId,
  returnFocus,
  onClose,
}: {
  calendarID: string;
  color: string;
  event?: Event;
  observation?: ProviderEventStateResponse;
  connectionId?: string;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => organizerDraft(event));
  const changed = useRef<(keyof OrganizerDraft)[]>([]),
    identity = useRef({
      eventID: event?.id ?? crypto.randomUUID(),
      calendarID,
      color,
      operationID: crypto.randomUUID(),
    });
  const frozen = useRef<ProviderOrganizerRequest | null>(null),
    pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false),
    [submitted, setSubmitted] = useState(false);
  function patch<K extends keyof OrganizerDraft>(
    key: K,
    value: OrganizerDraft[K],
  ) {
    if (frozen.current) return;
    changed.current = [...new Set([...changed.current, key])];
    setDraft((old) => ({ ...old, [key]: value }));
  }
  async function send(action: ProviderOrganizerRequest["action"]) {
    if (pending.current || notice) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      frozen.current ??= organizerRequest(
        action,
        draft,
        changed.current,
        identity.current,
        observation,
      );
      setSubmitted(true);
      await editProviderOrganizer(frozen.current, connectionId);
      setConfirm(false);
      setNotice(
        "Meeting change saved. Check Delivery details for Google's result. Guest notification delivery remains unknown.",
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        "organizerAdmissionRejected" in cause &&
        cause.organizerAdmissionRejected === true
      ) {
        frozen.current = null;
        identity.current.operationID = crypto.randomUUID();
        setSubmitted(false);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this meeting action. Retry keeps the same request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const locked = busy || submitted;
  return (
    <div
      className={styles.layerBoundary}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Dialog
        open
        closeLabel="Close meeting editor"
        title={event ? "Manage Google meeting" : "Create Google meeting"}
        description={organizerNotice}
        returnFocus={returnFocus}
        onOpenChange={(open) => {
          if (!open && !pending.current) onClose();
        }}
        footer={
          <>
            <Button
              ref={closeButton}
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              {notice ? "Close" : "Cancel"}
            </Button>
            {!notice && (
              <Button
                loading={busy}
                onClick={() =>
                  void send(
                    frozen.current?.action ?? (event ? "update" : "create"),
                  )
                }
              >
                {submitted
                  ? "Retry saved meeting action"
                  : event
                    ? "Save and notify guests"
                    : "Create and send invitations"}
              </Button>
            )}
          </>
        }
      >
        {notice ? (
          <p role="status">{notice}</p>
        ) : (
          <>
            {(
              [
                ["title", "Title"],
                ["description", "Notes"],
                ["location", "Location"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  value={draft[key]}
                  disabled={locked}
                  onChange={(event) => patch(key, event.target.value)}
                />
              </Field>
            ))}
            {!event && (
              <Field
                label="Guest email addresses"
                description="Separate required guests with commas. Guest-list changes after creation are not supported here."
              >
                <textarea
                  value={draft.guests}
                  disabled={locked}
                  onChange={(event) => patch("guests", event.target.value)}
                />
              </Field>
            )}
            <Checkbox
              label="All day"
              checked={draft.allDay}
              disabled={locked}
              onChange={(event) => patch("allDay", event.target.checked)}
            />
            <Field label="Start">
              <input
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.allDay ? draft.start.slice(0, 10) : draft.start}
                disabled={locked}
                onChange={(event) => patch("start", event.target.value)}
              />
            </Field>
            <Field label="End">
              <input
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.allDay ? draft.end.slice(0, 10) : draft.end}
                disabled={locked}
                onChange={(event) => patch("end", event.target.value)}
              />
            </Field>
            {!draft.allDay && (
              <Field label="Event time zone">
                <input
                  value={draft.timeZone}
                  disabled={locked}
                  onChange={(event) => patch("timeZone", event.target.value)}
                />
              </Field>
            )}
            {event && !submitted && (
              <Button variant="secondary" onClick={() => setConfirm(true)}>
                Cancel meeting and notify guests
              </Button>
            )}
          </>
        )}
        {error && !confirm && <InlineError>{error}</InlineError>}
      </Dialog>
      {confirm && (
        <ConfirmationDialog
          open
          returnFocus={closeButton}
          children={error ? <InlineError>{error}</InlineError> : null}
          title="Cancel Google meeting"
          description="Google will be asked to cancel this meeting and notify every guest. Guest notification delivery cannot be verified."
          confirmLabel="Cancel meeting and notify guests"
          closeLabel="Keep meeting"
          loading={busy}
          onOpenChange={setConfirm}
          onConfirm={() => void send("delete")}
        />
      )}
    </div>
  );
}
