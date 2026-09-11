import styles from "./styles/event-delivery.module.css";
import { useRef, useState } from "react";
import type { ProviderEventStateResponse, AnyProviderReminderEdit } from "@musubi/types";
import { providerReminderDraft, providerReminderRequest, providerReminderReceiptMessage } from "@musubi/calendar";
import { editProviderReminders } from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { Select } from "~/ui/Select";
import { InlineError } from "~/ui/InlineError";

export function ProviderReminderEditor({ eventId, connectionId, observation, onClose, returnFocus, occurrence = false }: {
  eventId: string; connectionId?: string; occurrence?: boolean; observation: ProviderEventStateResponse; onClose: () => void; returnFocus?: HTMLElement | null;
}) {
  const caldav = observation.reminderEdit?.provider === "caldav";
  const series = observation.reminderEdit?.provider === "caldav" && observation.reminderEdit.scope === "series";
  const label = caldav ? series ? "CalDAV series alarm" : "CalDAV event alarms" : "Google reminders";
  const [draft, setDraft] = useState(() => providerReminderDraft(observation));
  const instanceDefaults = !caldav && occurrence && draft.mode === "defaults";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastRequest = useRef<{ key: string; request: AnyProviderReminderEdit } | null>(null);
  async function save() {
    if (pending.current || notice) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const key = JSON.stringify(draft);
      const request = lastRequest.current?.key === key ? lastRequest.current.request : providerReminderRequest(observation, draft, crypto.randomUUID(), occurrence);
      lastRequest.current = { key, request };
      const receipt = await editProviderReminders(eventId, request, connectionId);
      setNotice(providerReminderReceiptMessage(receipt.status, caldav ? "caldav" : "google"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not save ${label}. Your draft is still here.`); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={styles.layerBoundary} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><Dialog open title={caldav ? label : occurrence ? "Google reminders for this occurrence" : "Google reminders"} description={caldav ? `${series ? "This alarm applies to every occurrence in this series. " : ""}This alarm is stored on the CalDAV event and may be shared with other calendar users. Calendar apps deliver it. Musubi reminders are separate; both may notify you.` : `${occurrence ? "These Google reminders apply only to this occurrence. " : ""}Personal notifications from Google Calendar. Musubi reminders are separate; both apps may notify you.`} closeLabel={`Close ${label}`} returnFocus={returnFocus} onOpenChange={open => { if (!open && !pending.current) onClose(); }} size="compact" footer={<>
    <Button variant="secondary" disabled={busy} onClick={onClose}>{notice ? "Close" : "Cancel"}</Button>
    {!notice ? <Button loading={busy} disabled={instanceDefaults} onClick={() => void save()}>Save {label}</Button> : null}
  </>}>
    {notice ? <p role="status">{notice}</p> : <div className={styles.reminderForm}>
      <Select label="Reminder mode" value={draft.mode} disabled={busy} options={[...(!caldav && (!occurrence || instanceDefaults) ? [{ value: "defaults", label: "Calendar defaults", disabled: occurrence }] : []), { value: "off", label: "Off" }, { value: "custom", label: "Custom" }]} onChange={value => setDraft(current => ({ mode: value as typeof current.mode, overrides: value === "custom" && !current.overrides.length ? [{ method: "popup", minutes: "15" }] : current.overrides }))} />
      {!caldav && occurrence ? <p>Calendar defaults cannot be saved for a Google occurrence. Choose Custom or Off to change its reminders.</p> : null}
      {draft.mode === "custom" ? <>
        {draft.overrides.map((item, index) => <div key={index} className={styles.reminderFields}>
          {!caldav ? <Select label={`Reminder ${index + 1} method`} value={item.method} disabled={busy} options={[{ value: "popup", label: "Notification" }, { value: "email", label: "Email" }]} onChange={value => setDraft(current => ({ ...current, overrides: current.overrides.map((entry, position) => position === index ? { ...entry, method: value as "popup" | "email" } : entry) }))} /> : null}
          <Field label={`Reminder ${index + 1} minutes before start`} description="Whole minutes, from 0 to 40320."><input inputMode="numeric" value={item.minutes} disabled={busy} onChange={event => setDraft(current => ({ ...current, overrides: current.overrides.map((entry, position) => position === index ? { ...entry, minutes: event.target.value } : entry) }))} /></Field>
          <Button variant="secondary" disabled={busy} onClick={() => setDraft(current => ({ ...current, overrides: current.overrides.filter((_, position) => position !== index) }))}>Remove reminder {index + 1}</Button>
        </div>)}
        <Button variant="secondary" disabled={busy || draft.overrides.length >= (caldav ? 1 : 5)} onClick={() => setDraft(current => ({ ...current, overrides: [...current.overrides, { method: "popup", minutes: "15" }] }))}>Add reminder</Button>
      </> : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>}
  </Dialog></div>;
}
