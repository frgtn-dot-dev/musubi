import type { ProviderEventStateResponse } from "@musubi/types";
import { providerEventDetails } from "@musubi/calendar";
import { useEffect, useId, useRef, useState } from "react";
import { getProviderEventState } from "~/api/resources";
import { getServerOrigin } from "~/api/query-keys";
import { InlineError } from "~/ui/InlineError";
import { Button } from "~/ui/Button";
import { ProviderReminderEditor } from "./ProviderReminderEditor";
import { SectionLabel } from "~/ui/SectionLabel";
import styles from "./styles/event-details.module.css";

type Props = { eventId: string; userId: string; connectionId?: string; series?: boolean; onEditReminders?: (observation: ProviderEventStateResponse) => void };
export function ProviderEventDetails(props: Props) {
  return <ProviderEventDetailsBody key={JSON.stringify([getServerOrigin(), props.eventId, props.userId, props.connectionId])} {...props} />;
}
function ProviderEventDetailsBody({ eventId, userId, connectionId, series = false, onEditReminders }: Props) {
  const titleId = useId();
  const key = JSON.stringify([eventId, userId, connectionId]);
  const [result, setResult] = useState<({ key: string; failed?: boolean } & Partial<ProviderEventStateResponse>)>();
  const [editorTrigger, setEditorTrigger] = useState<HTMLElement>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const active = useRef(true);
  const refreshing = useRef(false);
  const editorRead = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; editorRead.current?.abort(); }; }, []);
  async function openEditor(trigger: HTMLElement) {
    if (refreshing.current) return;
    refreshing.current = true; setOpening(true); setOpenError("");
    editorRead.current = new AbortController();
    try {
      const observation = await getProviderEventState(eventId, editorRead.current.signal, connectionId);
      if (!active.current) return;
      setResult({ key, ...observation });
      if (observation.reminderEdit && observation.state && observation.version) {
        if (onEditReminders) onEditReminders(observation); else setEditorTrigger(trigger);
      } else setOpenError("Google reminders are not editable in the refreshed state.");
    } catch { if (active.current) setOpenError("Could not refresh Google reminders. Retry to load current settings."); }
    finally { refreshing.current = false; if (active.current) setOpening(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getProviderEventState(eventId, controller.signal, connectionId).then(observation => {
      if (active) setResult({ key, ...observation });
    }).catch(() => { if (active) setResult({ key, failed: true }); });
    return () => { active = false; controller.abort(); };
  }, [eventId, connectionId, key]);
  const current = result?.key === key ? result : undefined;
  if (current?.state === null) return null;
  const details = current?.state ? providerEventDetails(current.state) : undefined;
  return <section aria-labelledby={titleId} className={styles.notes}>
    <div className={styles.sectionHeading}><SectionLabel id={titleId} level={3}>{details ? `${details.provider} details` : "Provider details"}</SectionLabel></div>
    {details ? <p>{series ? "These settings describe the series, not an individual occurrence. " : ""}Imported provider settings. {current?.reminderEdit ? "Personal Google reminders can be edited here." : `Change these in ${details.provider}.`}{"\n\n"}
      {details.rows.map(row => <span key={row.label}><strong>{row.label}: </strong>{row.value}{"\n"}</span>)}
      {"\n"}Provider notifications and Musubi reminders are separate. Both apps may notify you.
    </p> : <p role="status">{current?.failed ? "Provider details could not be loaded. Reopen this event to retry." : "Loading provider details…"}</p>}
    {openError ? <InlineError>{openError}</InlineError> : null}
    {current?.reminderEdit && current.state && current.version && !series ? <>
      <Button variant="secondary" loading={opening} onClick={event => void openEditor(event.currentTarget)}>Edit Google reminders</Button>
      {editorTrigger ? <ProviderReminderEditor eventId={eventId} connectionId={connectionId} observation={{ state: current.state, version: current.version, reminderEdit: current.reminderEdit }} returnFocus={editorTrigger} onClose={() => setEditorTrigger(undefined)} /> : null}
    </> : null}
  </section>;
}
