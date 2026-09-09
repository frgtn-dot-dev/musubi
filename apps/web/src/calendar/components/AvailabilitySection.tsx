import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AVAILABILITY_SOURCE_LIMIT, AvailabilityRequestSchema, type AvailabilityRequest } from "@musubi/types";
import { getServerOrigin } from "~/api/query-keys";
import { getAvailability, getAvailabilitySources, selectAvailabilitySource } from "../availability";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { InlineError } from "~/ui/InlineError";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import { Switch } from "~/ui/Switch";
export function AvailabilitySection({ userId, onReconnect }: { userId: string; onReconnect: () => void }) {
  const client = useQueryClient();
  const attempt = useRef(0);
  const prefix = ["availability", getServerOrigin(), userId];
  const sourcesKey = [...prefix, "sources"];
  const [busy, setBusy] = useState(false);
  const sources = useQuery({ queryKey: sourcesKey, queryFn: ({ signal }) => getAvailabilitySources(signal), retry: false, gcTime: 0, staleTime: 0, enabled: !busy, refetchInterval: busy ? false : 30000 });
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [requested, setRequested] = useState<{ range: AvailabilityRequest; signature: string; attempt: number }>();
  const enabled = sources.data?.sources.filter(source => source.enabled) ?? [];
  const overLimit = enabled.length > AVAILABILITY_SOURCE_LIMIT;
  const limitMessage = `Select up to ${AVAILABILITY_SOURCE_LIMIT} sources. ${enabled.length} selected; turn a source off before adding another.`;
  const signature = JSON.stringify(enabled.map(source => [source.id, source.generation]));
  const result = useQuery({ queryKey: [...prefix, "intervals", requested, signature], queryFn: ({ signal }) => getAvailability(requested!.range, signal), enabled: !!trigger && !!requested && requested.signature === signature && !sources.isError && !sources.isFetching, retry: false, gcTime: 0, staleTime: 0 });
  const current = requested?.signature === signature && !sources.isFetching && !sources.isError && !result.isFetching && !result.isError ? result.data : undefined;
  function close() { setTrigger(null); setRequested(undefined); setError(""); }
  async function toggle(id: string, value: boolean, generation: number) {
    if (value && enabled.length >= AVAILABILITY_SOURCE_LIMIT) { setError(limitMessage); return; }
    setBusy(true); setError(""); setRequested(undefined);
    await client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: [...prefix, "intervals"] });
    try { client.setQueryData(sourcesKey, await selectAvailabilitySource(id, value, generation)); }
    catch { setError("The source could not be changed. Refresh its current status and try again."); await sources.refetch(); }
    finally { setBusy(false); }
  }
  return <SettingsSection title="Google availability" description="Choose free/busy-only sources for availability checks. These are private to your connection and are not imported as events.">
    {sources.isError ? <InlineError>Availability sources could not be verified. <Button variant="secondary" onClick={() => void sources.refetch()}>Refresh availability sources</Button></InlineError> : sources.data?.sources.map(source => <Row key={source.id} label={source.label} detail={`${source.accountLabel}${source.reconnectRequired ? " · Reconnect Google to grant availability access" : " · Busy intervals only"}`} trailing={<Switch label={`Use ${source.label} for availability`} checked={source.enabled} disabled={busy || (!source.enabled && (enabled.length >= AVAILABILITY_SOURCE_LIMIT || source.reconnectRequired))} onCheckedChange={value => void toggle(source.id, value, source.generation)} />} />)}
    {!sources.isPending && !sources.isError && !sources.data?.sources.length ? <Row label="No free/busy-only sources found" detail="Refresh connected calendars after Google grants free/busy access." /> : null}
    {sources.data?.sources.some(source => source.reconnectRequired) ? <Button variant="secondary" onClick={onReconnect}>Reconnect Google for availability</Button> : null}
    {enabled.length >= AVAILABILITY_SOURCE_LIMIT && !trigger ? <InlineError>{limitMessage}</InlineError> : null}
    {error && !trigger ? <InlineError>{error}</InlineError> : null}
    <Button variant="secondary" disabled={busy || sources.isError || !enabled.length || overLimit} onClick={event => { setRequested(undefined); setError(""); setTrigger(event.currentTarget); }}>Check availability</Button>
    {trigger ? <Dialog open title="Check availability" description="Busy intervals only, for the sources you selected. Times below are UTC. An unavailable source does not mean free." closeLabel="Close availability" returnFocus={trigger} onOpenChange={open => { if (!open) close(); }}>
      <form onSubmit={event => {
        event.preventDefault(); setError(""); setRequested(undefined);
        if (overLimit) { setError(limitMessage); return; }
        const parsed = AvailabilityRequestSchema.safeParse({ start: `${start}T00:00:00Z`, end: `${end}T00:00:00Z`, sourceIds: enabled.map(source => source.id) });
        if (!parsed.success) { setError("Choose an end after the start, up to 42 days, and at least one source."); return; }
        setRequested({ range: parsed.data, signature, attempt: ++attempt.current });
      }}>
        <Field label="From (UTC)"><input type="date" value={start} onChange={event => { setStart(event.target.value); setRequested(undefined); }} /></Field>
        <Field label="Until (UTC, exclusive)"><input type="date" value={end} onChange={event => { setEnd(event.target.value); setRequested(undefined); }} /></Field>
        <Button type="submit" loading={result.isFetching} disabled={sources.isFetching || sources.isError || overLimit}>Read busy intervals</Button>
      </form>
      {overLimit ? <InlineError>{limitMessage}</InlineError> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {result.isError || sources.isError ? <InlineError>Availability could not be verified. Try reading again; no free time is confirmed.</InlineError> : null}
      {current ? <SettingsSection title="Busy intervals" description={`Observed ${current.observedAt}`}>
        {current.sources.map(source => <div key={source.sourceId}>
          <Row label={enabled.find(item => item.id === source.sourceId)?.label ?? "Availability source"} detail={source.status === "available" ? (source.intervals.length ? "Busy during these intervals (UTC)" : "No busy intervals in the requested range") : source.status === "reconnect-required" ? "Reconnect Google — free time is unknown" : "Unavailable — free time is unknown"} />
          {source.status === "available" ? source.intervals.map(interval => <Row key={`${interval.start}/${interval.end}`} label="Busy" detail={`${interval.start} – ${interval.end}`} />) : null}
        </div>)}
      </SettingsSection> : null}
    </Dialog> : null}
  </SettingsSection>;
}
