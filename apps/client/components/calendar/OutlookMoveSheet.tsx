import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, FlatList, Keyboard, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "uuidv7";
import { OUTLOOK_MOVE_LIMIT, type OutlookMoveOptions, type OutlookMoveResult } from "@musubi/types";
import { controlHeights, spacing, typeSizes } from "@musubi/design-system";
import { colors, fonts, styles } from "@/constants/theme";
import { useApi } from "@/services/api";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useDeliveryRefreshStore } from "@/store/useDeliveryRefreshStore";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { OutlookMoveSession, type OutlookMoveState } from "@/lib/outlookMoveSession";
import { outlookMoveFormat } from "@/lib/outlookMoveFormat";
import { BottomSheetFrame } from "@/components/ui/BottomSheetFrame";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { Btn } from "@/components/ui/Btn";
import { Tap } from "@/components/ui/Tap";

type MoveItem = OutlookMoveOptions["occurrences"][number] | OutlookMoveResult["items"][number];
const statusLabels = { pending: "Waiting", queued: "Saving", completed: "Moved", failed: "Not moved", unconfirmed: "Unconfirmed", "not-started": "Not started" };

/** Parent keys this session by account, server and exact stored source event. */
export function OutlookMoveSheet({ eventID, revision, onClose }: { eventID: string; revision: string; onClose: () => void }) {
  const api = useApi();
  const [session] = useState(() => new OutlookMoveSession(api, eventID, uuidv7));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const insets = useSafeAreaInsets();
  const motion = useModalAnimation(true, onClose);
  function close() { if (!session.busy) { Keyboard.dismiss(); motion.handleClose(); } }
  useLayoutEffect(() => () => session.dispose(), [session]);
  useLayoutEffect(() => {
    if (AppState.currentState === "active") void session.start(); else session.suspend();
  }, [session, revision]);
  useEffect(() => {
    const timer = setInterval(() => { if (AppState.currentState === "active") void session.poll(); }, 2000);
    const unsubscribe = useDeliveryRefreshStore.subscribe(() => { if (AppState.currentState === "active") void session.refresh(); else session.suspend(); });
    const appState = AppState.addEventListener("change", next => { if (next === "active") void session.resume(); else session.suspend(); });
    return () => { clearInterval(timer); unsubscribe(); appState.remove(); };
  }, [session]);
  const busy = session.busy;
  return <ModalPortal visible onRequestClose={close}>
    <BottomSheetFrame motion={motion} onClose={close} dismissible={!busy} header={<View style={styles.modalTitleRow}><Text accessibilityRole="header" style={styles.modalTitle}>Move occurrences</Text></View>}>
      {state.phase === "loading" || state.phase === "error" ? <View style={{ padding: spacing[4], gap: spacing[3] }}>
        <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.sans, color: colors.fg2 }}>{state.error ?? "Loading series…"}</Text>
        {state.error ? <Btn label="Refresh status" variant="secondary" style={{ flex: 0 }} onPress={() => void session.refresh()} /> : null}
        <Btn label="Close" variant="secondary" style={{ flex: 0 }} disabled={busy} onPress={close} />
      </View> : <MoveContent key={state.result ? state.result.operationID : state.options?.version} state={state} session={session} close={close} bottomInset={insets.bottom} />}
    </BottomSheetFrame>
  </ModalPortal>;
}

export function MoveContent({ state, session, close, bottomInset }: { state: OutlookMoveState; session: OutlookMoveSession; close: () => void; bottomInset: number }) {
  const { options, result, request } = state;
  const [selected, setSelected] = useState<string[]>(() => request?.eventIDs ?? []);
  const [minutes, setMinutes] = useState(() => String(Math.abs(request?.offsetMinutes ?? 30)));
  const [direction, setDirection] = useState(request && request.offsetMinutes < 0 ? "earlier" : "later");
  const [picker, setPicker] = useState(false);
  const timeFormat = useSettingsStore(s => s.timeFormat), dateFormat = useSettingsStore(s => s.dateFormat);
  const timeZone = result?.timeZone ?? options?.timeZone ?? "UTC";
  const format = useMemo(() => outlookMoveFormat(timeZone, dateFormat, timeFormat), [timeZone, dateFormat, timeFormat]);
  const busy = state.phase === "previewing" || state.phase === "starting";
  const locked = busy || !!request;
  const previewing = result?.status === "preview";
  const count = result?.items.length ?? selected.length;
  const invalidMinutes = !/^\d+$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 720;
  const unconfirmed = result?.items.some(item => item.status === "unconfirmed");
  const copy = { fontFamily: fonts.sans, fontSize: typeSizes[13], color: colors.fg2 };
  const note = { ...copy, color: colors.fg3 };
  const buttonSize = { flex: 0, maxHeight: undefined }; // Allow large text to wrap; retain the shared touch minimum.
  const header = <View style={{ gap: spacing[3], paddingBottom: spacing[3] }}>
    <Text style={[copy, { color: colors.fg, fontSize: typeSizes[16] }]}>{result?.title ?? options?.title}</Text>
    {!result ? <>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing[3] }}>
        <View style={{ flex: 1, gap: spacing[1] }}><Text style={styles.fieldLabel}>Direction</Text><Btn label={direction === "later" ? "Later" : "Earlier"} variant="secondary" style={buttonSize} disabled={locked} onPress={() => { Keyboard.dismiss(); setPicker(true); }} /></View>
        <View style={{ flex: 1, gap: spacing[1] }}><Text style={styles.fieldLabel}>Minutes</Text><TextInput accessibilityLabel="Minutes" style={[styles.textInput, { minHeight: controlHeights.touch.control, fontSize: typeSizes[14] }]} keyboardType="number-pad" value={minutes} editable={!locked} onChangeText={setMinutes} maxLength={3} selectTextOnFocus /></View>
      </View>
      {invalidMinutes ? <Text accessibilityRole="alert" style={note}>Choose 1–720 minutes.</Text> : null}
      <Text style={note}>Times in {timeZone.replaceAll("_", " ")}. Edited and cancelled dates stay unchanged.</Text>
      <View style={{ gap: spacing[2] }}>
        <Text accessibilityLiveRegion="polite" style={copy}>{selected.length} of {OUTLOOK_MOVE_LIMIT} selected</Text>
        <Btn label={selected.length ? "Clear selection" : `Select next ${OUTLOOK_MOVE_LIMIT}`} variant="secondary" style={buttonSize} disabled={locked || !options?.occurrences.length} onPress={() => setSelected(selected.length ? [] : options!.occurrences.filter(item => Date.parse(item.start) >= Date.now()).slice(0, OUTLOOK_MOVE_LIMIT).map(item => item.eventID))} />
      </View>
      {!options?.occurrences.length ? <Text style={note}>No unchanged, synchronized occurrences are available to move.</Text> : null}
      {options?.preserved.unavailable ? <Text style={note}>{options.preserved.unavailable} other occurrences need to sync first.</Text> : null}
    </> : <>
      <Text style={note}>{Math.abs(result.offsetMinutes)} minutes {result.offsetMinutes > 0 ? "later" : "earlier"} · {timeZone.replaceAll("_", " ")}</Text>
      {previewing ? <>
        <Text style={note}>The series rule, edited occurrences and cancelled dates stay unchanged.</Text>
        {result.meeting ? <Text style={copy}>Outlook will notify guests for these occurrences. They may need to respond again.</Text> : null}
        <Text style={note}>If a change cannot be confirmed, the rest stop. Earlier changes may already be saved.</Text>
      </> : <Text accessibilityLiveRegion="polite" style={copy}>{result.status === "completed" ? `${count} ${count === 1 ? "occurrence" : "occurrences"} moved.` : result.status === "running" ? `${result.items.filter(item => item.status === "completed").length} of ${count} moved. You can close this panel; changes will continue.` : "Move stopped. Earlier changes have not been rolled back."}</Text>}
    </>}
    {state.error ? <><Text accessibilityRole="alert" style={copy}>{state.error}</Text><Btn label="Refresh status" variant="secondary" style={buttonSize} disabled={busy} onPress={() => void session.refresh()} /></> : null}
  </View>;
  return <>
    <FlatList<MoveItem>
      style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing[4] }} keyboardShouldPersistTaps="handled"
      data={result?.items ?? options?.occurrences ?? []} keyExtractor={item => item.eventID}
      extraData={[selected, locked, timeFormat, dateFormat, previewing]} ListHeaderComponent={header}
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
      renderItem={({ item }) => {
        const date = format.date(item.start), range = format.range(item.start, item.end);
        const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing[3], paddingVertical: spacing[3], minHeight: controlHeights.touch.control, borderBottomWidth: 1, borderBottomColor: colors.line };
        if ("newStart" in item) return <View style={row}>
          <View style={{ flex: 1, gap: spacing[1] }}><Text style={copy}>{date}</Text><Text style={note}>{range}</Text><Text style={copy}>→ {format.range(item.newStart, item.newEnd)}</Text></View>
          {!previewing ? <Text style={note}>{statusLabels[item.status]}</Text> : null}
        </View>;
        const checked = selected.includes(item.eventID), disabled = locked || (!checked && selected.length >= OUTLOOK_MOVE_LIMIT);
        return <Tap accessibilityRole="checkbox" accessibilityLabel={`${date}, ${range}`} accessibilityState={{ checked, disabled }} disabled={disabled} scaleTo={1} style={row} onPress={() => setSelected(old => checked ? old.filter(id => id !== item.eventID) : [...old, item.eventID])}>
          <Feather name={checked ? "check-square" : "square"} size={typeSizes[20]} color={checked ? colors.accent : colors.fg3} accessible={false} />
          <View style={{ flex: 1, gap: spacing[1] }}><Text style={copy}>{date}</Text><Text style={note}>{range}</Text></View>
        </Tap>;
      }}
      ListFooterComponent={<View style={{ gap: spacing[3], paddingTop: spacing[3] }}>
        {unconfirmed ? <Text style={copy}>An unconfirmed occurrence may already have moved. Check its Delivery details before making another change.</Text> : null}
        {((result && result.status !== "running" && !unconfirmed) || (!result && request)) ? <Btn label={previewing ? "Change selection" : result ? "New preview" : "Change selection"} variant="secondary" style={buttonSize} disabled={busy} onPress={() => void session.changeSelection()} /> : null}
        {result && !previewing ? <Btn label="Refresh result" variant="secondary" style={buttonSize} disabled={busy} onPress={() => void session.refresh()} /> : null}
      </View>}
    />
    <View style={{ padding: spacing[4], paddingBottom: spacing[4] + bottomInset, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing[2] }}>
      {!result && options ? <Btn label={`Preview ${count || "selected"} ${count === 1 ? "occurrence" : "occurrences"}`} style={buttonSize} disabled={!request && (invalidMinutes || !count)} loading={busy} onPress={() => { Keyboard.dismiss(); void session.preview(selected, Number(minutes) * (direction === "earlier" ? -1 : 1)); }} /> : null}
      {previewing ? <Btn label={`Move ${count} ${count === 1 ? "occurrence" : "occurrences"}${result.meeting ? " & notify guests" : ""}`} style={buttonSize} loading={busy} onPress={() => void session.confirm()} /> : null}
      <Btn label={result && !previewing ? "Close" : "Cancel"} variant="secondary" style={buttonSize} disabled={busy} onPress={close} />
    </View>
    <OptionPicker visible={picker} title="Direction" value={direction} options={[{ label: "Later", value: "later" }, { label: "Earlier", value: "earlier" }]} onSelect={setDirection} onClose={() => setPicker(false)} />
  </>;
}
