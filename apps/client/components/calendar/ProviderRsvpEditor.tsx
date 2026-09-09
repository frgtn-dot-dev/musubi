import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "uuidv7";
import { spacing } from "@musubi/design-system";
import { providerRsvpOptions, providerRsvpNotice, caldavRsvpNotice, providerRsvpRequest, providerRsvpReceiptMessage } from "@musubi/calendar";
import type { Event, ProviderEventStateResponse, ProviderRsvpEdit } from "@musubi/types";
import { colors, fonts, styles } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { useApi } from "@/services/api";

export function ProviderRsvpEditor({ event, observation, onClose }: { event: Event; observation: ProviderEventStateResponse; onClose: () => void }) {
  const api = useApi(); const insets = useSafeAreaInsets();
  const caldav = observation.rsvpEdit?.provider === "caldav";
  const [response, setResponse] = useState(""); const [picker, setPicker] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const lastRequest = useRef<ProviderRsvpEdit | null>(null);
  function close() { if (!pending.current) onClose(); }
  async function send() {
    if (pending.current || notice || !response) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const request = lastRequest.current?.response === response ? lastRequest.current : providerRsvpRequest(observation, response, uuidv7());
      lastRequest.current = request;
      const receipt = await api.editProviderRsvp(event, request);
      setNotice(providerRsvpReceiptMessage(receipt.status, caldav ? "caldav" : "google"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit your response. Your choice is still here."); }
    finally { pending.current = false; setBusy(false); }
  }
  const copy = { fontFamily: fonts.sans, color: colors.fg2 };
  return <ModalPortal visible onRequestClose={close}>
    <View style={styles.modalOverlay}><Pressable style={{ flex: 1 }} onPress={close} accessible={false} /></View>
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, paddingTop: insets.top, justifyContent: "flex-end" }}>
    <View style={[styles.modalSheet, { position: "relative", minHeight: 0, maxHeight: "100%" }]}>
      <View style={styles.modalHandle} />
      <View style={styles.modalTitleRow}><Text accessibilityRole="header" style={styles.modalTitle}>{event.seriesID ? "Respond to this occurrence" : caldav ? "Respond in calendar" : "Respond in Google"}</Text></View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[4] + insets.bottom, gap: spacing[3] }}>
        <Text style={copy}>{event.seriesID ? "This Google response applies only to this occurrence. " : ""}{caldav ? caldavRsvpNotice : providerRsvpNotice}</Text>
        {notice ? <Text accessibilityLiveRegion="polite" style={copy}>{notice}</Text> : <>
          <Btn variant="secondary" label={`${caldav ? "Your response" : "Your Google response"}: ${providerRsvpOptions.find(item => item.value === response)?.label ?? "Choose a response"}`} disabled={busy} onPress={() => setPicker(true)} />
          {error ? <Text accessibilityRole="alert" style={copy}>{error}</Text> : null}
          <Btn label={caldav ? "Send response to organizer" : "Send response"} disabled={!response} loading={busy} onPress={() => void send()} />
        </>}
        <Btn label={notice ? (caldav ? "Close calendar response" : "Close Google response") : (caldav ? "Cancel calendar response" : "Cancel Google response")} variant="secondary" disabled={busy} onPress={close} />
      </ScrollView>
    </View>
    </View>
    <OptionPicker visible={picker} title={caldav ? "Your response" : "Your Google response"} value={response} options={[...providerRsvpOptions]} onClose={() => setPicker(false)} onSelect={value => { setResponse(value); setPicker(false); }} />
  </ModalPortal>;
}
