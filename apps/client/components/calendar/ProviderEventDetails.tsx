import { ProviderRsvpEditor } from "./ProviderRsvpEditor";
import { ProviderReminderEditor } from "./ProviderReminderEditor";
import { Btn } from "@/components/ui/Btn";
import { remoteForCalendar } from "@/services/federation";
import type { Event, ProviderEventStateResponse } from "@musubi/types";
import { providerEventDetails } from "@musubi/calendar";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { colors, fonts, styles } from "@/constants/theme";
import { useApi } from "@/services/api";
import { useServer } from "@/contexts/ServerContext";

export function ProviderEventDetails({ event, userId }: { event: Event; userId: string }) {
  const { apiUrl } = useServer();
  const targetID = event.id.replace(/_-?\d+$/, "");
  const remoteID = remoteForCalendar(event.originCalendarID ?? event.calendars[0])?.id;
  const key = JSON.stringify([targetID, event.originCalendarID, event.calendars, userId, apiUrl, remoteID, event.seriesID, event.originalStart]);
  return <ProviderEventDetailsBody key={key} event={event} userId={userId} />;
}
export function ProviderEventDetailsBody({ event, userId }: { event: Event; userId: string }) {
  const api = useApi();
  const targetID = event.id.replace(/_-?\d+$/, "");
  const key = JSON.stringify([targetID, userId, event.seriesID, event.originalStart]);
  const [result, setResult] = useState<({ key: string; failed?: boolean } & Partial<ProviderEventStateResponse>)>();
  const [editor, setEditor] = useState<{ kind: "reminders" | "rsvp"; observation: ProviderEventStateResponse }>();
  const readSequence = useRef(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const active = useRef(true);
  const refreshing = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function openEditor(kind: "reminders" | "rsvp" = "reminders") {
    if (refreshing.current) return;
    ++readSequence.current;
    refreshing.current = true; setOpening(true); setOpenError("");
    try {
      const observation = await api.getProviderEventState({ ...event, id: targetID });
      if (!active.current) return;
      setResult({ key, ...observation });
      if ((kind === "reminders" ? observation.reminderEdit : observation.rsvpEdit) && observation.state && observation.version) setEditor({ kind, observation });
      else setOpenError("This Google action is unavailable in the refreshed state.");
    } catch { if (active.current) setOpenError("Could not refresh Google details. Retry to load the current state."); }
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
  const textStyle = { fontFamily: fonts.sans, color: colors.fg2 };
  return <View style={styles.fieldContainer}>
    <Text accessibilityRole="header" style={styles.fieldLabel}>{details ? `${details.provider} details` : "Provider details"}</Text>
    {details ? <>
      <Text style={textStyle}>{event.seriesID ? "These settings describe this occurrence. " : event.recurrence ? "These settings describe the series, not an individual occurrence. " : ""}Imported provider settings. {current?.reminderEdit || current?.rsvpEdit ? "Available actions are shown below." : `Change these in ${details.provider}.`}</Text>
      {details.rows.map(row => <Text key={row.label} style={textStyle}>{row.label}: {row.value}</Text>)}
      <Text style={textStyle}>Provider notifications and Musubi reminders are separate. Both apps may notify you.</Text>
    </> : <Text accessibilityLiveRegion="polite" style={textStyle}>{current?.failed ? "Provider details could not be loaded. Reopen this event to retry." : "Loading provider details…"}</Text>}
    {openError ? <Text accessibilityRole="alert" style={textStyle}>{openError}</Text> : null}
    {current?.reminderEdit && current.state && current.version && !event.recurrence ? <>
      <Btn label={event.seriesID ? "Edit reminders for this occurrence" : "Edit Google reminders"} variant="secondary" loading={opening} onPress={() => void openEditor()} />
    </> : null}
    {current?.rsvpEdit && current.state && current.version && !event.recurrence ? <Btn label={event.seriesID ? "Respond to this occurrence" : "Respond in Google"} variant="secondary" loading={opening} onPress={() => void openEditor("rsvp")} /> : null}
    {editor?.kind === "reminders" ? <ProviderReminderEditor event={{ ...event, id: targetID }} observation={editor.observation} onClose={() => setEditor(undefined)} /> : null}
    {editor?.kind === "rsvp" ? <ProviderRsvpEditor event={{ ...event, id: targetID }} observation={editor.observation} onClose={() => setEditor(undefined)} /> : null}
  </View>;
}
