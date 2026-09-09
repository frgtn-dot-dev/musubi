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
  organizerNotificationNotice,
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
  const [available, setAvailable] = useState<"google" | "caldav" | "microsoft" | null>(null),
    [trigger, setTrigger] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getOrganizerCalendar(calendarID, controller.signal, connectionId)
      .then((result) => {
        if (!controller.signal.aborted) setAvailable(result.provider);
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
        Create {available === "caldav" ? "CalDAV" : available === "microsoft" ? "Outlook" : "Google"} meeting
      </Button>
      {trigger ? (
        <ProviderOrganizerEditor
          provider={available}
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
  provider = observation?.organizerEdit?.provider ?? "google",
  connectionId,
  returnFocus,
  onClose,
}: {
  calendarID: string;
  color: string;
  event?: Event;
  observation?: ProviderEventStateResponse;
  provider?: "google" | "caldav" | "microsoft";
  connectionId?: string;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => organizerDraft(event, provider));
  const changed = useRef<(keyof OrganizerDraft)[]>([]),
    identity = useRef({
      eventID: event?.id ?? crypto.randomUUID(),
      calendarID,
      color,
      operationID: crypto.randomUUID(),
      provider,
    });
  const frozen = useRef<ProviderOrganizerRequest | null>(null),
    pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [frozenAction, setFrozenAction] = useState<
      ProviderOrganizerRequest["action"] | null
    >(null);
  function patch<K extends keyof OrganizerDraft>(
    key: K,
    value: OrganizerDraft[K],
  ) {
    if (frozen.current) return;
    changed.current = [...new Set([...changed.current, key])];
    setDraft((old) => ({ ...old, [key]: value }));
  }
  const canEditTime =
    !event ||
    provider !== "caldav" ||
    observation?.organizerEdit?.timeEdit === true;
  const canUpdate =
    !event ||
    (provider !== "microsoft" && (provider !== "caldav" ||
    observation?.organizerEdit?.actions?.includes("update") === true));
  const canDelete =
    !!event &&
    (provider !== "microsoft" && (provider !== "caldav" ||
      observation?.organizerEdit?.actions?.includes("delete") === true));
  const canSubmit = frozenAction === "delete" ? canDelete : canUpdate;
  async function send(action: ProviderOrganizerRequest["action"]) {
    if (
      (action === "update" && !canUpdate) ||
      (action === "delete" && !canDelete)
    )
      return;
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
      setFrozenAction(frozen.current.action);
      setSubmitted(true);
      await editProviderOrganizer(frozen.current, connectionId);
      setConfirm(false);
      setNotice(
        `Meeting change saved. Check Delivery details for ${provider === "caldav" ? "the CalDAV server’s" : provider === "microsoft" ? "Outlook's" : "Google's"} result. Guest notification delivery remains unknown.`,
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        "organizerAdmissionRejected" in cause &&
        cause.organizerAdmissionRejected === true
      ) {
        frozen.current = null;
        setFrozenAction(null);
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
  const occurrence = provider === "google" && observation?.organizerEdit?.scope === "occurrence";
  const locked = busy || submitted || !canUpdate;
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
        title={occurrence ? "Manage this occurrence" : `${event ? "Manage" : "Create"} ${provider === "caldav" ? "CalDAV" : provider === "microsoft" ? "Outlook" : "Google"} meeting`}
        description={organizerNotificationNotice(provider)}
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
            {!notice && canSubmit && (
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
            {(provider === "caldav" && event && !canEditTime) || occurrence ? (
              <p>{occurrence ? "Only this occurrence will change. Series timing and guests stay unchanged." : "Meeting time and guests are preserved."}</p>
            ) : (
              <>
                {provider === "caldav" && event ? (
                  <p>
                    Changing time asks guests to respond again. Their existing
                    responses will reset.
                  </p>
                ) : null}
                {provider !== "google" && !event && !draft.allDay ? (
                  <p>New timed meetings use UTC.</p>
                ) : null}
                <Checkbox
                  label="All day"
                  checked={draft.allDay}
                  disabled={locked || (provider === "caldav" && !!event)}
                  onChange={(event) => patch("allDay", event.target.checked)}
                />
                <Field label="Start">
                  <input
                    type={draft.allDay ? "date" : "datetime-local"}
                    value={
                      draft.allDay ? draft.start.slice(0, 10) : draft.start
                    }
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
                      disabled={locked || provider !== "google"}
                      onChange={(event) =>
                        patch("timeZone", event.target.value)
                      }
                    />
                  </Field>
                )}
              </>
            )}
            {canDelete && !submitted && (
              <Button variant="secondary" onClick={() => setConfirm(true)}>
                {occurrence ? "Cancel this occurrence and notify guests" : "Cancel meeting and notify guests"}
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
          title={occurrence ? "Cancel this occurrence" : `Cancel ${provider === "caldav" ? "CalDAV" : provider === "microsoft" ? "Outlook" : "Google"} meeting`}
          description={`${provider === "caldav" ? "The CalDAV server" : "Google"} will be asked to cancel ${occurrence ? "only this occurrence" : "this meeting"} and notify every guest. Guest notification delivery cannot be verified.`}
          confirmLabel={occurrence ? "Cancel this occurrence and notify guests" : "Cancel meeting and notify guests"}
          closeLabel="Keep meeting"
          loading={busy}
          onOpenChange={setConfirm}
          onConfirm={() => void send("delete")}
        />
      )}
    </div>
  );
}
