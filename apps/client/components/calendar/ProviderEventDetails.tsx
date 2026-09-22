import { ProviderOrganizerEditor } from "./ProviderOrganizerEditor";
import { ProviderRsvpEditor } from "./ProviderRsvpEditor";
import { ProviderReminderEditor } from "./ProviderReminderEditor";
import { Btn } from "@/components/ui/Btn";
import { remoteForCalendar } from "@/services/federation";
import type { Event, ProviderEventStateResponse } from "@musubi/types";
import { assertCaldavSeriesAlarmObservation, canManageProviderOrganizer, providerEventDetails } from "@musubi/calendar";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";
import { ProviderIcon } from "./ProviderIcon";
import { Text, View } from "react-native";
import { spacing, typeSizes } from "@musubi/design-system";
import { colors, fonts, styles } from "@/constants/theme";
import { useApi } from "@/services/api";
import { useServer } from "@/contexts/ServerContext";

const detailIcons: Record<string, ComponentProps<typeof Feather>["name"]> = {
  Organizer: "user", "Your role": "user-check", "Your provider response": "message-circle",
  "Provider participants": "users", "Participant list": "users",
  "Provider alarms": "bell", "Provider reminders": "bell", Availability: "clock",
  Privacy: "lock", "Provider status": "activity", "Provider event type": "calendar",
};

export function ProviderEventDetails({ event, userId, observationRevision, seriesMaster }: { seriesMaster?: Event; event: Event; userId: string; observationRevision?: number }) {
  const { apiUrl } = useServer();
  const targetID = event.id.replace(/_-?\d+$/, "");
  const remoteID = remoteForCalendar(event.originCalendarID ?? event.calendars[0])?.id;
  const key = JSON.stringify([targetID, event.originCalendarID, event.calendars, userId, apiUrl, remoteID, event.seriesID, event.originalStart, observationRevision ?? event.revision, seriesMaster?.id, seriesMaster?.revision]);
  return <ProviderEventDetailsBody key={key} seriesMaster={seriesMaster} event={event} userId={userId} />;
}
export function ProviderEventDetailsBody({ event, userId, seriesMaster }: { seriesMaster?: Event; event: Event; userId: string }) {
  const api = useApi();
  const targetID = event.id.replace(/_-?\d+$/, "");
  const key = JSON.stringify([targetID, userId, event.seriesID, event.originalStart]);
  const [result, setResult] = useState<({ key: string; failed?: boolean } & Partial<ProviderEventStateResponse>)>();
  const [editor, setEditor] = useState<{ kind: "reminders" | "rsvp" | "organizer"; master?: Event; observation: ProviderEventStateResponse }>();
  const readSequence = useRef(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const active = useRef(true);
  const refreshing = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function openEditor(kind: "reminders" | "rsvp" | "organizer" = "reminders", seriesAction = false) {
    if (refreshing.current) return;
    ++readSequence.current;
    refreshing.current = true; setOpening(true); setOpenError("");
    try {
      const observation = await api.getProviderEventState(seriesAction && seriesMaster ? seriesMaster : { ...event, id: targetID });
      if (!active.current) return;
      if (seriesAction) {
        if (!seriesMaster) throw new Error("Missing stored series master.");
        assertCaldavSeriesAlarmObservation(seriesMaster, observation);
      } else if (kind === "reminders" && observation.reminderEdit?.provider === "caldav" && observation.reminderEdit.scope === "series") throw new Error("Choose Series alarm settings explicitly.");
      if (kind === "organizer" && (event.id !== targetID || !canManageProviderOrganizer(event, observation))) throw new Error("The stored meeting observation changed.");
      setResult({ key, ...observation });
      if ((kind === "organizer" ? observation.organizerEdit : kind === "reminders" ? observation.reminderEdit : observation.rsvpEdit) && observation.state && observation.version) setEditor({ kind, observation, ...(seriesAction ? { master: seriesMaster } : {}) });
      else setOpenError("This provider action is unavailable in the refreshed state.");
    } catch { if (active.current) setOpenError("Could not refresh provider details. Retry to load the current state."); }
    finally { refreshing.current = false; if (active.current) setOpening(false); }
  }
  useEffect(() => {
    let active = true;
    const sequence = ++readSequence.current;
    api.getProviderEventState({ ...event, id: targetID }).then(observation => {
      if (active && sequence === readSequence.current) setResult({ key, ...observation });
    }).catch(() => { if (active && sequence === readSequence.current) setResult({ key, failed: true }); });
    return () => { active = false; };
    // API/event objects change on render; key includes the complete account route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = result?.key === key ? result : undefined;
  if (current?.state === null) return null;
  const details = current?.state ? providerEventDetails(current.state) : undefined;
  const textStyle = { fontFamily: fonts.serif, fontSize: typeSizes[13], color: colors.fg2 };
  return <View style={styles.fieldContainer}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
      <ProviderIcon provider={current?.state?.provider} />
      <Text accessibilityRole="header" style={[styles.fieldLabel, { marginBottom: 0, flex: 1 }]}>{details ? `${details.provider} details` : "Provider details"}</Text>
    </View>
    <View style={{ padding: spacing[3], gap: spacing[2], backgroundColor: colors.bg3, borderColor: colors.line, borderWidth: 1, borderRadius: 8, marginBottom: spacing[3] }}>
    {details ? <>
      <Text style={textStyle}>{event.seriesID ? "These settings describe this occurrence. " : event.recurrence ? "These settings describe the series, not an individual occurrence. " : ""}Imported provider settings. {current?.reminderEdit || current?.rsvpEdit ? "Available actions are shown below." : `Change these in ${details.provider}.`}</Text>
      {details.rows.map(row => <View key={row.label} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing[2] }}>
        <Feather name={detailIcons[row.label] ?? "info"} size={15} color={colors.fg3} accessible={false} />
        <Text style={[textStyle, { flex: 1 }]}>{row.label}: {row.value}</Text>
      </View>)}
      <Text style={textStyle}>Provider notifications and Musubi reminders are separate. Both apps may notify you.</Text>
    </> : <Text accessibilityLiveRegion="polite" style={textStyle}>{current?.failed ? "Provider details could not be loaded. Reopen this event to retry." : "Loading provider details…"}</Text>}
    {openError ? <Text accessibilityRole="alert" style={textStyle}>{openError}</Text> : null}
    </View>
    {current?.reminderEdit && current.state && current.version && !event.recurrence && !(current.reminderEdit.provider === "caldav" && current.reminderEdit.scope === "series") ? <>
      <Btn label={current?.reminderEdit?.provider === "caldav" ? "Edit CalDAV event alarms" : event.seriesID ? "Edit reminders for this occurrence" : "Edit Google reminders"} variant="secondary" loading={opening} onPress={() => void openEditor()} />
    </> : null}
    {seriesMaster && current?.reminderEdit?.provider === "caldav" && current.reminderEdit.scope === "series" && current.state && current.version ? <Btn label="Series alarm settings" variant="secondary" loading={opening} onPress={() => void openEditor("reminders", true)} /> : null}
    {current?.rsvpEdit && current.state && current.version && !event.recurrence ? <Btn label={event.seriesID ? "Respond to this occurrence" : current.rsvpEdit.provider === "microsoft" ? "Respond in Outlook" : current.rsvpEdit.provider === "caldav" ? "Respond in calendar" : "Respond in Google"} variant="secondary" loading={opening} onPress={() => void openEditor("rsvp")} /> : null}
    {editor?.kind === "reminders" ? <ProviderReminderEditor event={editor.master ?? { ...event, id: targetID }} observation={editor.observation} onClose={() => setEditor(undefined)} /> : null}
    {editor?.kind === "rsvp" ? <ProviderRsvpEditor event={editor.master ?? { ...event, id: targetID }} observation={editor.observation} onClose={() => setEditor(undefined)} /> : null}
    {canManageProviderOrganizer(event, current) && event.id === targetID && !remoteForCalendar(event.originCalendarID ?? event.calendars[0]) ? <Btn label={current?.organizerEdit?.scope === "occurrence" ? "Manage this occurrence" : `Manage ${current?.organizerEdit?.provider === "caldav" ? "CalDAV" : current?.organizerEdit?.provider === "microsoft" ? "Outlook" : "Google"} meeting`} variant="secondary" loading={opening} onPress={() => void openEditor("organizer")} /> : null}
    {editor?.kind === "organizer" && editor.observation.organizerEdit ? <ProviderOrganizerEditor event={event} calendarID={editor.observation.organizerEdit.calendarID} color={event.color} observation={editor.observation} onClose={() => setEditor(undefined)} /> : null}
  </View>;
}
