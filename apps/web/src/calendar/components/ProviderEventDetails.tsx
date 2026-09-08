import type { ProviderEventState } from "@musubi/types";
import { providerEventDetails } from "@musubi/calendar";
import { useEffect, useId, useState } from "react";
import { getProviderEventState } from "~/api/resources";
import { SectionLabel } from "~/ui/SectionLabel";
import styles from "./styles/event-details.module.css";

export function ProviderEventDetails({ eventId, userId, connectionId, series = false }: { eventId: string; userId: string; connectionId?: string; series?: boolean }) {
  const titleId = useId();
  const key = JSON.stringify([eventId, userId, connectionId]);
  const [result, setResult] = useState<{ key: string; state?: ProviderEventState | null; failed?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getProviderEventState(eventId, controller.signal, connectionId).then(({ state }) => {
      if (active) setResult({ key, state });
    }).catch(() => { if (active) setResult({ key, failed: true }); });
    return () => { active = false; controller.abort(); };
  }, [eventId, connectionId, key]);
  const current = result?.key === key ? result : undefined;
  if (current?.state === null) return null;
  const details = current?.state ? providerEventDetails(current.state) : undefined;
  return <section aria-labelledby={titleId} className={styles.notes}>
    <div className={styles.sectionHeading}><SectionLabel id={titleId} level={3}>{details ? `${details.provider} details` : "Provider details"}</SectionLabel></div>
    {details ? <p>{series ? "These settings describe the series, not an individual occurrence. " : ""}Imported provider settings. Change these in {details.provider}.{"\n\n"}
      {details.rows.map(row => <span key={row.label}><strong>{row.label}: </strong>{row.value}{"\n"}</span>)}
      {"\n"}Provider notifications and Musubi reminders are separate. Both apps may notify you.
    </p> : <p role="status">{current?.failed ? "Provider details could not be loaded. Reopen this event to retry." : "Loading provider details…"}</p>}
  </section>;
}
