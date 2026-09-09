import { useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "uuidv7";
import { spacing } from "@musubi/design-system";
import { providerReminderDraft, providerReminderRequest, providerReminderReceiptMessage } from "@musubi/calendar";
import type { Event, ProviderEventStateResponse, AnyProviderReminderEdit } from "@musubi/types";
import { colors, fonts, styles } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { useApi } from "@/services/api";

export function ProviderReminderEditor({ event, observation, onClose }: { event: Event; observation: ProviderEventStateResponse; onClose: () => void }) {
  const caldav = observation.reminderEdit?.provider === "caldav";
  const label = caldav ? "CalDAV event alarms" : "Google reminders";
  const api = useApi(); const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => providerReminderDraft(observation));
  const [picker, setPicker] = useState<"mode" | number | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const lastRequest = useRef<{ key: string; request: AnyProviderReminderEdit } | null>(null);
  function close() { if (!pending.current) { Keyboard.dismiss(); onClose(); } }
  async function save() {
    if (pending.current || notice) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const key = JSON.stringify(draft);
      const request = lastRequest.current?.key === key ? lastRequest.current.request : providerReminderRequest(observation, draft, uuidv7());
      lastRequest.current = { key, request };
      const receipt = await api.editProviderReminders(event, request);
      setNotice(providerReminderReceiptMessage(receipt.status, caldav ? "caldav" : "google"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not save ${label}. Your draft is still here.`); }
    finally { pending.current = false; setBusy(false); }
  }
  const copy = { fontFamily: fonts.sans, color: colors.fg2 };
  const modeLabels = { defaults: "Calendar defaults", off: "Off", custom: "Custom" };
  return <ModalPortal visible onRequestClose={close}>
    <View style={styles.modalOverlay}><Pressable style={{ flex: 1 }} onPress={close} accessible={false} /></View>
    <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, paddingTop: insets.top, justifyContent: "flex-end" }}>
    <View style={[styles.modalSheet, { position: "relative", minHeight: 0, maxHeight: "100%" }]}>
      <View style={styles.modalHandle} />
      <View style={styles.modalTitleRow}><Text accessibilityRole="header" style={styles.modalTitle}>{caldav ? label : event.seriesID ? "Google reminders for this occurrence" : "Google reminders"}</Text></View>
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[4] + insets.bottom, gap: spacing[3] }}>
        <Text style={copy}>{caldav ? "This alarm is stored on the CalDAV event and may be shared with other calendar users. Calendar apps deliver it. Musubi reminders are separate; both may notify you." : <>{event.seriesID ? "These Google reminders apply only to this occurrence. " : ""}Personal notifications from Google Calendar. Musubi reminders are separate; both apps may notify you.</>}</Text>
        {notice ? <Text accessibilityLiveRegion="polite" style={copy}>{notice}</Text> : <>
          <Btn variant="secondary" label={`Reminder mode: ${modeLabels[draft.mode]}`} disabled={busy} onPress={() => setPicker("mode")} />
          {draft.mode === "custom" ? <>
            {draft.overrides.map((item, index) => <View key={index} style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Reminder {index + 1}</Text>
              {!caldav ? <Btn variant="secondary" label={`Reminder ${index + 1} method: ${item.method === "popup" ? "Notification" : "Email"}`} disabled={busy} onPress={() => setPicker(index)} /> : null}
              <Text style={styles.fieldLabel}>Minutes before start (0–40320)</Text>
              <TextInput accessibilityLabel={`Reminder ${index + 1} minutes before start`} style={styles.textInput} keyboardType="number-pad" value={item.minutes} editable={!busy} onChangeText={minutes => setDraft(current => ({ ...current, overrides: current.overrides.map((entry, position) => position === index ? { ...entry, minutes } : entry) }))} />
              <Btn variant="secondary" label={`Remove reminder ${index + 1}`} disabled={busy} onPress={() => setDraft(current => ({ ...current, overrides: current.overrides.filter((_, position) => position !== index) }))} />
            </View>)}
            <Btn variant="secondary" label="Add reminder" disabled={busy || draft.overrides.length >= (caldav ? 1 : 5)} onPress={() => setDraft(current => ({ ...current, overrides: [...current.overrides, { method: "popup", minutes: "15" }] }))} />
          </> : null}
          {error ? <Text accessibilityRole="alert" style={copy}>{error}</Text> : null}
          <Btn label={`Save ${label}`} loading={busy} onPress={() => void save()} />
        </>}
        <Btn label={notice ? `Close ${label}` : `Cancel ${label}`} variant="secondary" disabled={busy} onPress={close} />
      </ScrollView>
    </View>
    </KeyboardAvoidingView>
    <OptionPicker visible={picker !== null} title={picker === "mode" ? "Reminder mode" : "Reminder method"} value={picker === "mode" ? draft.mode : typeof picker === "number" ? draft.overrides[picker]?.method : undefined} options={picker === "mode" ? [...(!caldav ? [{ value: "defaults", label: "Calendar defaults" }] : []), { value: "off", label: "Off" }, { value: "custom", label: "Custom" }] : [{ value: "popup", label: "Notification" }, { value: "email", label: "Email" }]} onClose={() => setPicker(null)} onSelect={value => {
      setDraft(current => picker === "mode" ? { mode: value as typeof current.mode, overrides: value === "custom" && !current.overrides.length ? [{ method: "popup", minutes: "15" }] : current.overrides } : { ...current, overrides: current.overrides.map((entry, index) => index === picker ? { ...entry, method: value as "popup" | "email" } : entry) });
      setPicker(null);
    }} />
  </ModalPortal>;
}
