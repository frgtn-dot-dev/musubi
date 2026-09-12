import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { AVAILABILITY_SOURCE_LIMIT, AvailabilityRequestSchema, type AvailabilityRequest } from "@musubi/types";
import { getServerOrigin } from "~/api/query-keys";
import { getAvailability, getAvailabilitySources, selectAvailabilitySource } from "../availability";
import { Button, buttonClassName } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { InlineError } from "~/ui/InlineError";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import { Switch } from "~/ui/Switch";
import { useAsyncAction } from "~/ui/useAsyncAction";
import styles from "./styles/availability.module.css";
export function AvailabilitySection({ userId, onReconnect, onRefresh, connectionBusy = false }: {
  userId: string;
  onReconnect: () => void;
  onRefresh: () => Promise<void>;
  connectionBusy?: boolean;
}) {
  const client = useQueryClient();
  const attempt = useRef(0);
  const prefix = ["availability", getServerOrigin(), userId];
  const sourcesKey = [...prefix, "sources"];
  const mutationKey = ["availability-selection", getServerOrigin(), userId];
  const selecting = useIsMutating({ mutationKey }) > 0;
  const refreshing = useIsMutating({ mutationKey: ["connections-sync", getServerOrigin(), userId] }) > 0;
  const refreshAction = useAsyncAction();
  const busy = selecting || refreshing || connectionBusy || refreshAction.busy;
  const sources = useQuery({ queryKey: sourcesKey, queryFn: ({ signal }) => getAvailabilitySources(signal), retry: false, gcTime: 0, staleTime: 0, enabled: !busy, refetchInterval: busy ? false : 30000 });
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [setupTrigger, setSetupTrigger] = useState<HTMLElement | null>(null);
  const formId = useId();
  const [error, setError] = useState("");
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [requested, setRequested] = useState<{ range: AvailabilityRequest; signature: string; attempt: number }>();
  const enabled = sources.data?.sources.filter(source => source.enabled) ?? [];
  const overLimit = enabled.length > AVAILABILITY_SOURCE_LIMIT;
  const limitMessage = `Select up to ${AVAILABILITY_SOURCE_LIMIT} sources. ${enabled.length} selected; turn a source off before adding another.`;
  const signature = JSON.stringify(enabled.map(source => [source.id, source.generation]));
  const result = useQuery({ queryKey: [...prefix, "intervals", requested, signature], queryFn: ({ signal }) => getAvailability(requested!.range, signal), enabled: !busy && !!trigger && !!requested && requested.signature === signature && !sources.isError && !sources.isFetching, retry: false, gcTime: 0, staleTime: 0 });
  const current = !busy && requested?.signature === signature && !sources.isFetching && !sources.isError && !result.isFetching && !result.isError ? result.data : undefined;
  function close() { setTrigger(null); setRequested(undefined); setError(""); }
  const selection = useMutation({
    mutationKey,
    mutationFn: async ({ id, value, generation }: { id: string; value: boolean; generation: number }) => {
      await client.cancelQueries({ queryKey: prefix });
      client.removeQueries({ queryKey: [...prefix, "intervals"] });
      return selectAvailabilitySource(id, value, generation);
    },
    onSuccess: async value => {
      // The mutation outlives this dialog. Retire any observer read before
      // publishing its confirmed response, including after close/reopen.
      await client.cancelQueries({ queryKey: sourcesKey });
      client.setQueryData(sourcesKey, value);
    },
    onError: () => { setError("The source could not be changed. Refresh its current status and try again."); },
    onSettled: () => { void client.invalidateQueries({ queryKey: sourcesKey }); },
  });
  function toggle(id: string, value: boolean, generation: number) {
    if (busy) return;
    if (value && enabled.length >= AVAILABILITY_SOURCE_LIMIT) { setError(limitMessage); return; }
    setError(""); setRequested(undefined);
    selection.mutate({ id, value, generation });
  }
  const hasSources = !!sources.data?.sources.length;
  const setupButton = <Button variant="secondary" size="compact" onClick={event => {
    refreshAction.setError(""); setSetupTrigger(event.currentTarget);
  }}>How to set up</Button>;
  return <>
    <SettingsSection title="Google availability" description="Busy times from calendars shared without event details.">
      {sources.isPending ? <Row label="Loading shared calendars…" role="status" /> : sources.isError ? (
        <Row role="alert" label="Shared calendars could not be loaded" layout="responsive-actions" trailing={
          <Button variant="secondary" size="compact" disabled={busy} loading={sources.isFetching} onClick={() => void sources.refetch()}>Refresh availability sources</Button>
        } />
      ) : sources.data?.sources.map(source => (
        <Row key={source.id} label={source.label}
          detail={`${source.accountLabel}${source.reconnectRequired ? " · Reconnect Google to grant availability access" : ""}`}
          trailing={<Switch label={`Use ${source.label} for availability`} checked={source.enabled}
            disabled={busy || (!source.enabled && (enabled.length >= AVAILABILITY_SOURCE_LIMIT || source.reconnectRequired))}
            onCheckedChange={value => toggle(source.id, value, source.generation)} />}
        />
      ))}
      {!sources.isPending && !sources.isError && !hasSources ? (
        <Row label="No shared busy-time calendars yet" layout="responsive-actions" trailing={setupButton} />
      ) : <Row label="Add a shared calendar" layout="responsive-actions" trailing={setupButton} />}
      {sources.data?.sources.some(source => source.reconnectRequired) ? (
        <Row label="Google permission needed" layout="responsive-actions" trailing={
          <Button variant="secondary" size="compact" disabled={busy} onClick={onReconnect}>Reconnect Google for availability</Button>
        } />
      ) : null}
      {hasSources ? <Row label={enabled.length ? `${enabled.length} selected` : "Select a calendar to check"} layout="responsive-actions" trailing={
        <Button variant="secondary" size="compact" disabled={busy || sources.isError || !enabled.length || overLimit} onClick={event => {
          setRequested(undefined); setError(""); setTrigger(event.currentTarget);
        }}>Check availability</Button>
      } /> : null}
      {enabled.length >= AVAILABILITY_SOURCE_LIMIT && !trigger ? <InlineError className={styles.error}>{limitMessage}</InlineError> : null}
      {error && !trigger ? <InlineError className={styles.error}>{error}</InlineError> : null}
    </SettingsSection>
    {setupTrigger ? <Dialog open title="Set up Google availability" closeLabel="Close availability setup" returnFocus={setupTrigger}
      onOpenChange={open => { if (!open) setSetupTrigger(null); }}
      footer={<>
        <a className={buttonClassName({ variant: "secondary" })} href="https://support.google.com/calendar/answer/37082?hl=en" target="_blank" rel="noreferrer">Google sharing guide</a>
        <Button disabled={busy} loading={refreshAction.busy} onClick={() => void refreshAction.run(async () => {
          await onRefresh(); setSetupTrigger(null);
        }, "Could not refresh connected calendars.")}>Refresh connected calendars</Button>
      </>}
    >
      <SettingsSection inset={false} title="Add a calendar" description="Calendars with event details already appear in your regular calendar list.">
        <Row label="1. Ask the owner to share" detail={<>In Google Calendar, share with the Google account you connected to Musubi. Choose <strong>See only free/busy (hide details)</strong>.</>} />
        <Row label="2. Add it in Google Calendar" detail="Open the sharing email and follow its link using that same Google account." />
        <Row label="3. Refresh here, then switch it on" detail="Refresh connected calendars below. Turn on the new calendar in this list, then choose Check availability. If asked, reconnect Google to allow access." />
      </SettingsSection>
      {refreshAction.error ? <InlineError>{refreshAction.error}</InlineError> : null}
    </Dialog> : null}
    {trigger ? <Dialog open title="Check availability" description="Busy intervals only, for the sources you selected. Times below are UTC. An unavailable source does not mean free." closeLabel="Close availability" returnFocus={trigger} onOpenChange={open => { if (!open) close(); }}
      footer={<Button type="submit" form={formId} loading={result.isFetching} disabled={busy || sources.isFetching || sources.isError || overLimit}>Read busy intervals</Button>}>
      <form id={formId} className={styles.rangeForm} onSubmit={event => {
        event.preventDefault(); setError(""); setRequested(undefined);
        if (busy || sources.isFetching || sources.isError) return;
        if (overLimit) { setError(limitMessage); return; }
        const parsed = AvailabilityRequestSchema.safeParse({ start: `${start}T00:00:00Z`, end: `${end}T00:00:00Z`, sourceIds: enabled.map(source => source.id) });
        if (!parsed.success) { setError("Choose an end after the start, up to 42 days, and at least one source."); return; }
        setRequested({ range: parsed.data, signature, attempt: ++attempt.current });
      }}>
        <Field label="From (UTC)"><input type="date" value={start} onChange={event => { setStart(event.target.value); setRequested(undefined); }} /></Field>
        <Field label="Until (UTC, exclusive)"><input type="date" value={end} onChange={event => { setEnd(event.target.value); setRequested(undefined); }} /></Field>
      </form>
      {overLimit ? <InlineError>{limitMessage}</InlineError> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {result.isError || sources.isError ? <InlineError>Availability could not be verified. Try reading again; no free time is confirmed.</InlineError> : null}
      {current ? <SettingsSection inset={false} title="Busy intervals" description={`Observed ${current.observedAt}`}>
        {current.sources.map(source => <div key={source.sourceId}>
          <Row label={enabled.find(item => item.id === source.sourceId)?.label ?? "Availability source"} detail={source.status === "available" ? (source.intervals.length ? "Busy during these intervals (UTC)" : "No busy intervals in the requested range") : source.status === "reconnect-required" ? "Reconnect Google — free time is unknown" : "Unavailable — free time is unknown"} />
          {source.status === "available" ? source.intervals.map(interval => <Row key={`${interval.start}/${interval.end}`} label="Busy" detail={`${interval.start} – ${interval.end}`} />) : null}
        </div>)}
      </SettingsSection> : null}
    </Dialog> : null}
  </>;
}
