import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { uuidv7 } from "uuidv7";
import type { Event, MicrosoftSeriesCancellationRequest } from "@musubi/types";
import { outlookCancellationNotice, outlookCancellationQueued, outlookCancellationRequest } from "@musubi/calendar";
import { Btn } from "@/components/ui/Btn";
import { chooseOption } from "@/lib/confirm";
import { useApi } from "@/services/api";
import { colors, fonts } from "@/constants/theme";

export function OutlookCancellationAction({ event }: { event: Event }) {
  const api = useApi();
  const frozen = useRef<MicrosoftSeriesCancellationRequest | null>(null), pending = useRef(false), active = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [queued, setQueued] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function choose() {
    if (pending.current || queued) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (!frozen.current) {
        const observation = await api.getProviderEventState(event);
        if (!active.current) return;
        const scopes = observation.outlookCancellation?.scopes;
        if (!scopes?.length) throw new Error("The Outlook series changed. Reopen the meeting before cancelling.");
        const scope = await new Promise<"occurrence" | "series" | undefined>(resolve => chooseOption("Cancel recurring meeting", `“${event.title}”\n${outlookCancellationNotice}`, scopes.map(value => ({ label: value === "occurrence" ? "This occurrence" : "Entire series", destructive: true, onPress: () => resolve(value) })), false, () => resolve(undefined)));
        if (!scope || !active.current) return;
        frozen.current = outlookCancellationRequest(event, observation, scope, uuidv7());
      }
      await api.editProviderOrganizer(frozen.current);
      if (active.current) setQueued(true);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Could not queue cancellation. Retry keeps the same request."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <>
    {queued ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.sans, color: colors.fg2 }}>{outlookCancellationQueued}</Text> : <Btn variant="secondary" label={error ? "Retry cancellation" : "Cancel Outlook meeting"} loading={busy} onPress={() => void choose()} />}
    {error ? <Text accessibilityRole="alert" style={{ fontFamily: fonts.sans, color: colors.fg2 }}>{error}</Text> : null}
  </>;
}
