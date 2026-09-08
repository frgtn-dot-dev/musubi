import { useRef, useState } from "react";
import type { ProviderEventStateResponse, ProviderRsvpEdit } from "@musubi/types";
import { providerRsvpOptions, providerRsvpNotice, providerRsvpRequest, providerRsvpReceiptMessage } from "@musubi/calendar";
import { editProviderRsvp } from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Select } from "~/ui/Select";
import { InlineError } from "~/ui/InlineError";
import styles from "./styles/event-delivery.module.css";

export function ProviderRsvpEditor({ eventId, connectionId, observation, onClose, returnFocus }: {
  eventId: string; connectionId?: string; observation: ProviderEventStateResponse; onClose: () => void; returnFocus?: HTMLElement | null;
}) {
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastRequest = useRef<ProviderRsvpEdit | null>(null);
  async function send() {
    if (pending.current || notice || !response) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const request = lastRequest.current?.response === response ? lastRequest.current : providerRsvpRequest(observation, response, crypto.randomUUID());
      lastRequest.current = request;
      const receipt = await editProviderRsvp(eventId, request, connectionId);
      setNotice(providerRsvpReceiptMessage(receipt.status));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit your Google response. Your choice is still here."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={styles.layerBoundary} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Dialog open title="Respond in Google" description={providerRsvpNotice} closeLabel="Close Google response" returnFocus={returnFocus} onOpenChange={open => { if (!open && !pending.current) onClose(); }} size="compact" footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>{notice ? "Close" : "Cancel"}</Button>
      {!notice ? <Button disabled={!response} loading={busy} onClick={() => void send()}>Send response</Button> : null}
    </>}>
      {notice ? <p role="status">{notice}</p> : <>
        <Select label="Your Google response" placeholder="Choose a response" value={response} disabled={busy} options={[...providerRsvpOptions]} onChange={setResponse} />
        {error ? <InlineError>{error}</InlineError> : null}
      </>}
    </Dialog>
  </div>;
}
