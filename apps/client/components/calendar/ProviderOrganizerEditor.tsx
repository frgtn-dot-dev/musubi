import { OptionPicker } from "@/components/ui/OptionPicker";
import { TimeZonePicker } from "./TimeZonePicker";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import { useSettingsStore } from "@/store/useSettingsStore";
import { formatDateMedium, formatTime } from "@/lib/datetimeFormat";
import { BottomSheetFrame } from "@/components/ui/BottomSheetFrame";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useServer } from "@/contexts/ServerContext";
import { useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Tap } from "@/components/ui/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "uuidv7";
import { spacing } from "@musubi/design-system";
import {
  organizerDraft,
  organizerRequest,
  organizerNotificationNotice,
  type OrganizerDraft,
} from "@musubi/calendar";
import type {
  Event,
  ProviderEventStateResponse,
  ProviderOrganizerRequest,
} from "@musubi/types";
import { colors, fonts, styles } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { useApi } from "@/services/api";
import { confirm } from "@/lib/confirm";
export function ProviderOrganizerCreateAction(props: {
  calendarID: string;
  color: string;
}) {
  const { apiUrl, authClient } = useServer();
  const actorID = authClient.useSession().data?.user.id;
  return (
    <OrganizerCreateActionBody
      key={JSON.stringify([props.calendarID, apiUrl, actorID])}
      {...props}
    />
  );
}
function OrganizerCreateActionBody({
  calendarID,
  color,
}: {
  calendarID: string;
  color: string;
}) {
  const api = useApi(),
    apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [organizerAddresses, setOrganizerAddresses] = useState<string[] | undefined>();
  const [available, setAvailable] = useState<"google" | "caldav" | "microsoft" | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    apiRef.current
      .getOrganizerCalendar(calendarID)
      .then((result) => {
        if (active) {
          setAvailable(result.provider);
          setOrganizerAddresses(result.provider === "caldav" ? result.organizerAddresses : undefined);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [calendarID]);
  return available ? (
    <>
      <Tap
        accessibilityLabel="New meeting"
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        onPress={() => setOpen(true)}
      ><Feather name="users" size={24} color={colors.fg2} /></Tap>
      {open && (
        <ProviderOrganizerEditor
          organizerAddresses={organizerAddresses}
          provider={available}
          calendarID={calendarID}
          color={color}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  ) : null;
}
export function ProviderOrganizerEditor({
  organizerAddresses,
  calendarID,
  color,
  event,
  observation,
  provider = observation?.organizerEdit?.provider ?? "google",
  onClose,
}: {
  organizerAddresses?: string[];
  calendarID: string;
  color: string;
  event?: Event;
  observation?: ProviderEventStateResponse;
  provider?: "google" | "caldav" | "microsoft";
  onClose: () => void;
}) {
  const api = useApi(),
    insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => organizerDraft(event, provider)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [frozenAction, setFrozenAction] = useState<
      ProviderOrganizerRequest["action"] | null
    >(null);
  const pending = useRef(false),
    frozen = useRef<ProviderOrganizerRequest | null>(null),
    changed = useRef<(keyof OrganizerDraft)[]>([]),
    identity = useRef({
      operationID: uuidv7(),
      provider,
      eventID: event?.id ?? uuidv7(),
      calendarID,
      color,
    });
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [picker, setPicker] = useState<{ key: "start" | "end"; mode: "date" | "time" }>();
  const [detailsOpen, setDetailsOpen] = useState(!!event);
  const dateFormat = useSettingsStore(s => s.dateFormat);
  const timeFormat = useSettingsStore(s => s.timeFormat);
  // Pick civil components, never reinterpret the meeting in the device zone.
  // A stable winter day for the clock also preserves DST-gap input for server validation.
  const clockValue = (text: string) => {
    const clock = text.split("T")[1]?.split(":") ?? ["09", "00"];
    return new Date(2000, 0, 15, Number(clock[0]), Number(clock[1]));
  };
  const dateValue = (text: string) => {
    const parts = text.slice(0, 10).split("-").map(Number);
    return parts.length === 3 && parts.every(Number.isFinite) ? new Date(parts[0], parts[1] - 1, parts[2], 12) : new Date();
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  function selectTime(value: Date) {
    if (!picker || frozen.current) return;
    const current = draft[picker.key];
    const date = picker.mode === "date" ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : current.slice(0, 10);
    const clock = picker.mode === "time" ? `${pad(value.getHours())}:${pad(value.getMinutes())}:00` : current.split("T")[1] ?? "09:00:00";
    patch(picker.key, draft.allDay ? date : `${date}T${clock}`);
    setPicker(undefined);
  }
  const motion = useModalAnimation(true, onClose);
  function close() {
    if (!pending.current) void motion.handleClose();
  }
  function patch<K extends keyof OrganizerDraft>(
    key: K,
    value: OrganizerDraft[K],
  ) {
    if (frozen.current) return;
    changed.current = [...new Set([...changed.current, key])];
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  const canEditTime =
    !event ||
    provider === "google" ||
    observation?.organizerEdit?.timeEdit === true;
  const canUpdate =
    !event ||
    provider === "google" ||
    observation?.organizerEdit?.actions?.includes("update") === true;
  const canDelete =
    !!event &&
    (provider === "google" || observation?.organizerEdit?.actions?.includes("delete") === true);
  const canSubmit = frozenAction === "delete" ? canDelete : canUpdate;
  async function send(action: ProviderOrganizerRequest["action"]) {
    if (
      (action === "update" && !canUpdate) ||
      (action === "delete" && !canDelete)
    )
      return;
    if (pending.current || notice) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!frozen.current && !event && organizerAddresses?.length && !organizerAddresses.includes(draft.organizerAddress ?? "")) throw new Error("Choose the organizer address for this meeting.");
      frozen.current ??= organizerRequest(
        action,
        draft,
        changed.current,
        identity.current,
        observation,
      );
      setFrozenAction(frozen.current.action);
      setSubmitted(true);
      await api.editProviderOrganizer(frozen.current);
      setNotice(
        `${personalOccurrence ? "Event" : "Meeting"} change saved. Check Settings → Delivery status for ${provider === "caldav" ? "the CalDAV server’s" : provider === "microsoft" ? "Outlook's" : "Google's"} result.${personalOccurrence ? "" : " Guest notification delivery remains unknown."}`,
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        "organizerAdmissionRejected" in cause &&
        cause.organizerAdmissionRejected === true
      ) {
        frozen.current = null;
        setFrozenAction(null);
        identity.current.operationID = uuidv7();
        setSubmitted(false);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this meeting action. Retry keeps the same request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const occurrence = observation?.organizerEdit?.scope === "occurrence";
  const personalOccurrence = provider === "microsoft" && occurrence && observation?.state?.attendeesComplete && observation.state.attendees.length === 0;
  const locked = busy || submitted || !canUpdate,
    copy = { fontFamily: fonts.sans, color: colors.fg2 };
  const fields: [keyof OrganizerDraft, string][] = [
    ["title", "Title"],
    ["description", "Notes"],
    ["location", "Location"],
    ...(!event
      ? [["guests", "Guest email addresses"] as [keyof OrganizerDraft, string]]
      : []),

  ];
  const info = (title: string, message: string) => (
    <Tap accessibilityLabel={title} accessibilityHint="Shows more information"
      onPress={() => Alert.alert(title, message)}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Feather name="info" size={18} color={colors.fg3} />
    </Tap>
  );
  const icons = {
    title: "type", description: "file-text", location: "map-pin",
    guests: "users", start: "calendar", end: "calendar", timeZone: "globe",
  } as const;
  const renderField = ([key, label]: [keyof OrganizerDraft, string]) => (
                  <View key={key} style={styles.fieldContainer}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
                      <Feather name={icons[key as keyof typeof icons]} size={16} color={colors.fg3} />
                      <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
                        {key === "start" ? "Starts" : key === "end" ? "Ends" : label}
                      </Text>
                    </View>
                    <TextInput
                      accessibilityLabel={label}
                      style={[key === "title" ? styles.fieldValueBig : styles.fieldValueText,
                        { fontFamily: fonts.sans, paddingVertical: spacing[2],
                          minHeight: key === "description" ? 80 : 40, textAlignVertical: "top" }]}
                      placeholder={key === "title" ? "Meeting title" : key === "guests" ? "name@example.com, …" : key === "description" ? "Add notes" : key === "location" ? "Add location" : label}
                      placeholderTextColor={colors.fg4}
                      multiline={key === "description" || key === "title"}
                      autoCapitalize={key === "guests" || key === "timeZone" ? "none" : "sentences"}
                      keyboardType={key === "guests" ? "email-address" : "default"}
                      editable={
                        !locked &&
                        !(provider !== "google" && key === "timeZone")
                      }
                      value={String(draft[key])}
                      // The refs are read only by the text-change handler, never during rendering.
                      // eslint-disable-next-line react-hooks/refs
                      onChangeText={(value) => patch(key, value)}
                    />
                  </View>
  );
  return (
    <ModalPortal visible onRequestClose={close}>
      <BottomSheetFrame motion={motion} onClose={close} dismissible={!busy} header={<View style={styles.modalTitleRow}>
            <Text accessibilityRole="header" style={[styles.modalTitle, { flex: 1 }]}>
              {occurrence ? "Edit occurrence" : event ? "Edit meeting" : "New meeting"}
            </Text>
            {!personalOccurrence && info("Guest invitations", organizerNotificationNotice(provider))}
            <Tap accessibilityLabel="Close meeting editor" disabled={busy} onPress={close}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Feather name="x" size={20} color={colors.fg3} />
            </Tap>
          </View>}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexShrink: 1 }}
            contentContainerStyle={{
              paddingBottom: spacing[3],
            }}
          >
            {notice ? (
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing[4] }}>
                <Text accessibilityLiveRegion="polite" style={[copy, { flex: 1 }]}>Meeting change saved.</Text>
                {info("Meeting delivery", notice)}
              </View>
            ) : (
              <>
                {!event && provider === "caldav" && organizerAddresses?.length ? <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Organizer address</Text>
                  <Tap accessibilityLabel="Organizer address" disabled={locked} onPress={() => setAddressPickerOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] }}>
                    <Feather name="mail" size={16} color={colors.fg3} /><Text style={[styles.fieldValueText, { flex: 1 }]}>{draft.organizerAddress?.slice(7) ?? "Choose an address"}</Text><Feather name="chevron-down" size={16} color={colors.fg3} />
                  </Tap>
                  {addressPickerOpen ? <OptionPicker visible title="Organizer address" options={organizerAddresses.map(value => ({value, label:value.slice(7)}))} value={draft.organizerAddress} onSelect={value => patch("organizerAddress", value)} onClose={() => setAddressPickerOpen(false)} /> : null}
                </View> : null}
                {fields.filter(([key]) => (!occurrence || key !== "guests") && !["description", "location"].includes(key)).map(renderField)}
                {(provider !== "google" && event && !canEditTime) || occurrence ? (
                  <View style={{ alignItems: "flex-end", paddingHorizontal: spacing[4] }}>
                    {info("Meeting editing", occurrence ? "Only this occurrence will change." : "Meeting time and guests are preserved.")}
                  </View>
                ) : (
                  <>
                    {provider === "caldav" && event ? (
                      info("Changing meeting time", "Changing time asks guests to respond again. Their existing responses will reset.")
                    ) : null}
                    <View style={styles.fieldContainer}>
                      {(["start", "end"] as const).map(key => <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, paddingVertical: 6 }}>
                        <Text style={[styles.fieldValueText, { color: colors.fg2 }]}>{key === "start" ? "Starts" : "Ends"}</Text>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <Tap disabled={locked} accessibilityLabel={`${key} date`} onPress={() => setPicker({ key, mode: "date" })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg3 }}><Text style={styles.fieldValueText}>{draft[key] ? formatDateMedium(dateValue(draft[key]), dateFormat) : "Add date"}</Text></Tap>
                          {!draft.allDay && draft[key] ? <Tap disabled={locked} accessibilityLabel={`${key} time`} onPress={() => setPicker({ key, mode: "time" })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg3 }}><Text style={styles.fieldValueText}>{formatTime(clockValue(draft[key]), timeFormat)}</Text></Tap> : null}
                        </View>
                      </View>)}
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, paddingVertical: 6 }}>
                        <Text style={[styles.fieldValueText, { color: colors.fg2 }]}>All-day</Text>
                        <Switch accessibilityLabel="All day" value={draft.allDay} disabled={locked || (provider === "caldav" && !!event)} thumbColor={draft.allDay ? colors.accent : colors.bg3} trackColor={{ false: colors.line, true: colors.line3 }} onValueChange={value => {
                          for (const key of ["start", "end"] as const) if (draft[key]) patch(key, value ? draft[key].slice(0, 10) : draft[key].includes("T") ? draft[key] : `${draft[key]}T${key === "start" ? "09" : "10"}:00:00`);
                          patch("allDay", value);
                        }} />
                      </View>
                      {!draft.allDay ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Feather name="globe" size={14} color={colors.fg3} />
                        <TimeZonePicker accessibilityLabel="Event time zone" value={draft.timeZone} disabled={locked || (!!event && provider !== "google")} onChange={value => patch("timeZone", value)} />
                      </View> : null}
                    </View>
                    {picker && !locked ? <DateTimePicker value={picker.mode === "date" ? dateValue(draft[picker.key]) : clockValue(draft[picker.key])} mode={picker.mode} is24Hour={timeFormat === "24h"} presentation={Platform.OS === "ios" ? "inline" : "dialog"} onDismiss={() => setPicker(undefined)} onValueChange={(_event, value) => selectTime(value)} /> : null}

                  </>
                )}
                {detailsOpen ? fields.filter(([key]) => ["description", "location"].includes(key)).map(renderField) : <Tap onPress={() => setDetailsOpen(true)} style={[styles.fieldContainer, { flexDirection: "row", alignItems: "center", gap: 8 }]}><Feather name="plus" size={14} color={colors.fg3} /><Text style={[copy, { fontSize: 13 }]}>Add note or location</Text></Tap>}
                {canDelete && !submitted && (
                  <Btn
                    variant="secondary"
                    label={occurrence ? "Cancel this occurrence and notify guests" : "Cancel meeting and notify guests"}
                    onPress={() =>
                      confirm(
                        {
                          title: occurrence ? "Cancel this occurrence" : `Cancel ${provider === "caldav" ? "CalDAV" : provider === "microsoft" ? "Outlook" : "Google"} meeting`,
                          message: `${provider === "caldav" ? "The CalDAV server" : provider === "microsoft" ? "Outlook" : "Google"} will be asked to cancel ${occurrence ? "only this occurrence" : "this meeting"} and notify all guests. Guest notification delivery cannot be verified.`,
                          confirmLabel: occurrence ? "Cancel this occurrence and notify guests" : "Cancel meeting and notify guests",
                        },
                        () => {
                          void send("delete");
                        },
                      )
                    }
                  />
                )}
              </>
            )}
            {error && (
              <Text accessibilityRole="alert" style={copy}>
                {error}
              </Text>
            )}
          </ScrollView>
          <View style={[styles.modalButtons, { paddingBottom: spacing[4] + insets.bottom, borderTopWidth: 1, borderTopColor: colors.line }]}>
            <Btn variant="secondary" label="Close" disabled={busy} onPress={close} />
            {!notice && (
              <>
                {canSubmit && (
                  <Btn
                    label={
                      submitted
                        ? "Retry"
                        : event
                          ? (personalOccurrence ? "Save" : "Save & notify")
                          : "Send invitations"
                    }
                    loading={busy}
                    onPress={() =>
                      void send(
                        frozen.current?.action ?? (event ? "update" : "create"),
                      )
                    }
                  />
                )}
              </>
            )}
          </View>


     </BottomSheetFrame>
    </ModalPortal>
  );
}
