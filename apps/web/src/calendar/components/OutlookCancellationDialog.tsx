import { useRef, useState } from "react";
import type { Event, MicrosoftSeriesCancellationRequest, ProviderEventStateResponse } from "@musubi/types";
import { outlookCancellationNotice, outlookCancellationQueued, outlookCancellationRequest } from "@musubi/calendar";
import { editProviderOrganizer } from "~/api/resources";
import { Dialog } from "~/ui/Dialog";
import { Button } from "~/ui/Button";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";

export function OutlookCancellationDialog({ event, observation, returnFocus, onClose }: { event: Event; observation: ProviderEventStateResponse; returnFocus: HTMLElement; onClose: () => void }) {
  const frozen = useRef<MicrosoftSeriesCancellationRequest | null>(null);
  const pending = useRef(false);
  const [selected, setSelected] = useState<"occurrence" | "series">();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [queued, setQueued] = useState(false);
  async function send(scope: "occurrence" | "series") {
    if (pending.current || queued) return;
    pending.current = true; setBusy(true); setError("");
    try {
      frozen.current ??= outlookCancellationRequest(event, observation, scope, crypto.randomUUID());
      setSelected(frozen.current.scope);
      await editProviderOrganizer(frozen.current);
      setQueued(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not queue cancellation. Retry keeps the same request."); }
    finally { pending.current = false; setBusy(false); }
  }
  return queued ? <Dialog open elevated size="compact" title="Cancellation queued" closeLabel="Close cancellation" returnFocus={returnFocus} onOpenChange={open => { if (!open) onClose(); }} footer={<Button onClick={onClose}>Done</Button>}><p>{outlookCancellationQueued}</p></Dialog> :
    <RecurrenceScopeDialog action="cancel" title={event.title} consequence={outlookCancellationNotice} allowedScopes={selected ? [selected] : observation.outlookCancellation?.scopes ?? []} busyScope={busy ? selected : undefined} error={error ? { message: error } : undefined} returnFocus={returnFocus} onResolve={scope => { if (!pending.current) { if (!scope) onClose(); else if (scope !== "following") void send(scope); } }} />;
}
