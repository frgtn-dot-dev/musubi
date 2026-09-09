import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AVAILABILITY_SOURCE_LIMIT } from "@musubi/types";
import { spacing, typeSizes } from "@musubi/design-system";
import { useServer } from "@/contexts/ServerContext";
import { useApi } from "@/services/api";
import { useDeliveryRefreshStore } from "@/store/useDeliveryRefreshStore";
import { AvailabilitySession } from "@/lib/availabilitySession";
import { colors, fonts, styles } from "@/constants/theme";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { Btn } from "@/components/ui/Btn";
import { SettingRowToggle } from "@/components/SettingRow";

type Props = { visible: boolean; onClose: () => void; onReconnect: () => void };
export default function AvailabilityModal(props: Props) {
  const { apiUrl, authClient } = useServer();
  const { data: session } = authClient.useSession();
  if (!props.visible || !apiUrl || !session?.user.id) return null;
  return <AvailabilityBody key={`${apiUrl}:${session.user.id}`} {...props} />;
}
export function AvailabilityBody({ onClose, onReconnect }: Props) {
  const api = useApi();
  const [session] = useState(() => new AvailabilitySession(api));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  useEffect(() => {
    void session.start();
    const timer = setInterval(() => { if (AppState.currentState === "active" && session.state.phase !== "reading") void session.refresh(); }, 30000);
    const unsubscribe = useDeliveryRefreshStore.subscribe(() => { if (AppState.currentState === "active") void session.refresh(); else session.invalidate(); });
    const subscription = AppState.addEventListener("change", next => { if (next === "active") void session.refresh(); else session.invalidate(); });
    return () => { clearInterval(timer); unsubscribe(); subscription.remove(); session.dispose(); };
  }, [session]);
  const close = () => { session.dispose(); onClose(); };
  const busy = state.phase === "selecting" || state.phase === "reading";
  const selected = state.sources.filter(source => source.enabled);
  const overLimit = selected.length > AVAILABILITY_SOURCE_LIMIT;
  const copy = { fontFamily: fonts.sans, fontSize: typeSizes[12], color: colors.fg2 };
  return <ModalPortal visible onRequestClose={close}>
    <View style={styles.modalOverlay}><Pressable style={{ flex: 1 }} onPress={close} accessible={false} /></View>
    <View style={styles.modalSheet}>
      <View style={styles.modalHandle} />
      <View style={styles.modalTitleRow}><Text accessibilityRole="header" style={styles.modalTitle}>Check availability</Text></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[4] + insets.bottom, gap: spacing[3] }}>
        <Text style={copy}>Choose free/busy-only Google sources. These are private to your connection and are not imported as events. Times below are UTC; unavailable does not mean free.</Text>
        {state.sources.map(source => <View key={source.id}>
          <SettingRowToggle label={`Use ${source.label} for availability`} toggle={source.enabled} disabled={busy || (!source.enabled && (selected.length >= AVAILABILITY_SOURCE_LIMIT || source.reconnectRequired))} onToggle={() => void session.select(source.id, !source.enabled)} />
          <Text style={copy}>{source.accountLabel}{source.reconnectRequired ? " · Reconnect Google to grant availability access" : " · Busy intervals only"}</Text>
        </View>)}
        {state.phase === "ready" && !state.sources.length ? <Text style={copy}>No free/busy-only sources found. Refresh connected calendars after Google grants access.</Text> : null}
        {state.sources.some(source => source.reconnectRequired) ? <Btn label="Reconnect Google for availability" variant="secondary" onPress={() => { close(); onReconnect(); }} /> : null}
        {selected.length >= AVAILABILITY_SOURCE_LIMIT ? <Text accessibilityRole="alert" style={copy}>Select up to {AVAILABILITY_SOURCE_LIMIT} sources. {selected.length} selected; turn a source off before adding another.</Text> : null}
        <Btn label="Refresh availability sources" variant="secondary" disabled={busy} loading={state.phase === "loading"} onPress={() => void session.refresh()} />
        <Text style={styles.fieldLabel}>From (UTC, YYYY-MM-DD)</Text>
        <TextInput accessibilityLabel="From (UTC, YYYY-MM-DD)" style={styles.textInput} value={start} autoCapitalize="none" onChangeText={value => { setStart(value); session.clearResult(); }} />
        <Text style={styles.fieldLabel}>Until (UTC, exclusive, YYYY-MM-DD)</Text>
        <TextInput accessibilityLabel="Until (UTC, exclusive, YYYY-MM-DD)" style={styles.textInput} value={end} autoCapitalize="none" onChangeText={value => { setEnd(value); session.clearResult(); }} />
        <Btn label="Read busy intervals" disabled={state.phase !== "ready" || !selected.length || overLimit} loading={state.phase === "reading"} onPress={() => void session.read(start, end)} />
        {state.error ? <Text accessibilityRole="alert" style={copy}>{state.error}</Text> : null}
        {state.result ? <View style={{ gap: spacing[3] }}>
          <Text accessibilityRole="header" style={copy}>Busy intervals · observed {state.result.observedAt}</Text>
          {state.result.sources.map(source => <View key={source.sourceId} style={{ gap: spacing[2] }}>
            <Text style={copy}>{selected.find(item => item.id === source.sourceId)?.label ?? "Availability source"}</Text>
            <Text style={copy}>{source.status === "available" ? source.intervals.length ? "Busy during these intervals (UTC)" : "No busy intervals in the requested range" : source.status === "reconnect-required" ? "Reconnect Google — free time is unknown" : "Unavailable — free time is unknown"}</Text>
            {source.status === "available" ? source.intervals.map(interval => <Text key={`${interval.start}/${interval.end}`} style={copy}>Busy · {interval.start} – {interval.end}</Text>) : null}
          </View>)}
        </View> : null}
        <Btn label="Close availability" variant="secondary" onPress={close} />
      </ScrollView>
    </View>
  </ModalPortal>;
}
