import styles from "./styles/event-delivery.module.css";
import { useRef, useState } from "react";
import type { ProviderEventStateResponse, ProviderReminderEdit } from "@musubi/types";
import { providerReminderDraft, providerReminderRequest, providerReminderReceiptMessage } from "@musubi/calendar";
import { editProviderReminders } from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { Select } from "~/ui/Select";
import { SettingsSection } from "~/ui/SettingsSection";
import { InlineError } from "~/ui/InlineError";

export function ProviderReminderEditor({ eventId, connectionId, observation, onClose, returnFocus, occurrence = false }: {
  eventId: string; connectionId?: string; occurrence?: boolean; observation: ProviderEventStateResponse; onClose: () => void; returnFocus?: HTMLElement | null;
}) {
  const [draft, setDraft] = useState(() => providerReminderDraft(observation));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastRequest = useRef<{ key: string; request: ProviderReminderEdit } | null>(null);
  async function save() {
    if (pending.current || notice) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const key = JSON.stringify(draft);
      const request = lastRequest.current?.key === key ? lastRequest.current.request : providerReminderRequest(observation, draft, crypto.randomUUID());
      lastRequest.current = { key, request };
      const receipt = await editProviderReminders(eventId, request, connectionId);
      setNotice(providerReminderReceiptMessage(receipt.status));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save Google reminders. Your draft is still here."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={styles.layerBoundary} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><Dialog open title={occurrence ? "Google reminders for this occurrence" : "Google reminders"} description={`${occurrence ? "These Google reminders apply only to this occurrence. " : ""}Personal notifications from Google Calendar. Musubi reminders are separate; both apps may notify you.`} closeLabel="Close Google reminders" returnFocus={returnFocus} onOpenChange={open => { if (!open && !pending.current) onClose(); }} size="compact" footer={<>
    <Button variant="secondary" disabled={busy} onClick={onClose}>{notice ? "Close" : "Cancel"}</Button>
    {!notice ? <Button loading={busy} onClick={() => void save()}>Save Google reminders</Button> : null}
  </>}>
    {notice ? <p role="status">{notice}</p> : <SettingsSection title="Preferences">
      <Select label="Reminder mode" value={draft.mode} disabled={busy} options={[{ value: "defaults", label: "Calendar defaults" }, { value: "off", label: "Off" }, { value: "custom", label: "Custom" }]} onChange={value => setDraft(current => ({ mode: value as typeof current.mode, overrides: value === "custom" && !current.overrides.length ? [{ method: "popup", minutes: "15" }] : current.overrides }))} />
      {draft.mode === "custom" ? <>
        {draft.overrides.map((item, index) => <SettingsSection key={index} title={`Reminder ${index + 1}`}>
          <Select label={`Reminder ${index + 1} method`} value={item.method} disabled={busy} options={[{ value: "popup", label: "Notification" }, { value: "email", label: "Email" }]} onChange={value => setDraft(current => ({ ...current, overrides: current.overrides.map((entry, position) => position === index ? { ...entry, method: value as "popup" | "email" } : entry) }))} />
          <Field label={`Reminder ${index + 1} minutes before start`} description="Whole minutes, from 0 to 40320."><input inputMode="numeric" value={item.minutes} disabled={busy} onChange={event => setDraft(current => ({ ...current, overrides: current.overrides.map((entry, position) => position === index ? { ...entry, minutes: event.target.value } : entry) }))} /></Field>
          <Button variant="secondary" disabled={busy} onClick={() => setDraft(current => ({ ...current, overrides: current.overrides.filter((_, position) => position !== index) }))}>Remove reminder {index + 1}</Button>
        </SettingsSection>)}
        <Button variant="secondary" disabled={busy || draft.overrides.length >= 5} onClick={() => setDraft(current => ({ ...current, overrides: [...current.overrides, { method: "popup", minutes: "15" }] }))}>Add reminder</Button>
      </> : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </SettingsSection>}
  </Dialog></div>;
}
