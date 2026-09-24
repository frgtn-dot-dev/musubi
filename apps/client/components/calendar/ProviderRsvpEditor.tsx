import { BottomSheetFrame } from "@/components/ui/BottomSheetFrame";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "uuidv7";
import { spacing } from "@musubi/design-system";
import { providerRsvpOptions, providerRsvpNotice, caldavRsvpNotice, microsoftRsvpNotice, microsoftRsvpScopeOptions, microsoftSeriesRsvpNotice, providerRsvpRequest, providerRsvpReceiptMessage } from "@musubi/calendar";
import type { Event, ProviderEventStateResponse, ProviderRsvpEdit } from "@musubi/types";
import { colors, fonts, styles } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { useApi } from "@/services/api";

export function ProviderRsvpEditor({ event, observation, onClose }: { event: Event; observation: ProviderEventStateResponse; onClose: () => void }) {
  const api = useApi(); const insets = useSafeAreaInsets();
  const graph = observation.rsvpEdit?.provider === "microsoft";
  const caldav = observation.rsvpEdit?.provider === "caldav";
  const [scope, setScope] = useState(observation.rsvpEdit?.scope);
  const [scopePicker, setScopePicker] = useState(false);
  const hasSeries = graph && !!observation.rsvpEdit?.series;
  const occurrence = !!event.seriesID || scope === "occurrence";
  const [response, setResponse] = useState(""); const [picker, setPicker] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const lastRequest = useRef<ProviderRsvpEdit | null>(null);
  const motion = useModalAnimation(true, onClose);
  function close() { if (!pending.current) void motion.handleClose(); }
  async function send() {
    if (pending.current || notice || !response) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const request = lastRequest.current?.response === response && (!graph || lastRequest.current.provider === "microsoft" && lastRequest.current.scope === scope) ? lastRequest.current : providerRsvpRequest(observation, response, uuidv7(), scope);
      lastRequest.current = request;
      const receipt = await api.editProviderRsvp(event, request);
      setNotice(providerRsvpReceiptMessage(receipt.status, graph ? "microsoft" : caldav ? "caldav" : "google"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit your response. Your choice is still here."); }
    finally { pending.current = false; setBusy(false); }
  }
  const copy = { fontFamily: fonts.sans, color: colors.fg2 };
  return <ModalPortal visible onRequestClose={close}>
      <BottomSheetFrame motion={motion} onClose={close} dismissible={!busy} header={<View style={styles.modalTitleRow}><Text accessibilityRole="header" style={styles.modalTitle}>{hasSeries ? "Respond in Outlook" : occurrence ? "Respond to this occurrence" : graph ? "Respond in Outlook" : caldav ? "Respond in calendar" : "Respond in Google"}</Text></View>}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[4] + insets.bottom, gap: spacing[3] }}>
        <Text style={copy}>{occurrence && !hasSeries ? `This ${graph ? "Outlook" : "Google"} response applies only to this occurrence. ` : ""}{graph ? microsoftRsvpNotice : caldav ? caldavRsvpNotice : providerRsvpNotice}</Text>
        {notice ? <Text accessibilityLiveRegion="polite" style={copy}>{notice}</Text> : <>
          {hasSeries && observation.rsvpEdit?.scope === "series" ? <Text style={copy}>Response applies to: Entire series</Text> : hasSeries ? <Btn variant="secondary" label={`Response applies to: ${scope === "series" ? "Entire series" : "This occurrence"}`} disabled={busy} onPress={() => setScopePicker(true)} /> : null}
          <Btn variant="secondary" label={`${(caldav || graph) ? "Your response" : "Your Google response"}: ${providerRsvpOptions.find(item => item.value === response)?.label ?? "Choose a response"}`} disabled={busy} onPress={() => setPicker(true)} />
          {hasSeries ? <Text accessibilityLiveRegion="polite" style={copy}>{scope === "series" ? microsoftSeriesRsvpNotice(response) : "Only this occurrence will receive your response."}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={copy}>{error}</Text> : null}
          <Btn label={(caldav || graph) ? "Send response to organizer" : "Send response"} disabled={!response} loading={busy} onPress={() => void send()} />
        </>}
        <Btn label={notice ? (graph ? "Close Outlook response" : caldav ? "Close calendar response" : "Close Google response") : (graph ? "Cancel Outlook response" : caldav ? "Cancel calendar response" : "Cancel Google response")} variant="secondary" disabled={busy} onPress={close} />
      </ScrollView>


    <OptionPicker visible={picker} title={(caldav || graph) ? "Your response" : "Your Google response"} value={response} options={[...providerRsvpOptions]} onClose={() => setPicker(false)} onSelect={value => { setResponse(value); setPicker(false); }} />
    <OptionPicker visible={scopePicker} title="Response applies to" value={scope ?? "series"} options={[...microsoftRsvpScopeOptions]} onClose={() => setScopePicker(false)} onSelect={value => { setScope(value as "occurrence" | "series"); setScopePicker(false); }} />
   </BottomSheetFrame>
    </ModalPortal>;
}
