import { remoteForCalendar } from "@/services/federation";
import type { Event, ProviderEventState } from "@musubi/types";
import { providerEventDetails } from "@musubi/calendar";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { colors, fonts, styles } from "@/constants/theme";
import { useApi } from "@/services/api";
import { useServer } from "@/contexts/ServerContext";

export function ProviderEventDetails({ event, userId }: { event: Event; userId: string }) {
  const api = useApi();
  const { apiUrl } = useServer();
  const targetID = event.id.replace(/_-?\d+$/, "");
  const remoteID = remoteForCalendar(event.originCalendarID ?? event.calendars[0])?.id;
  const key = JSON.stringify([targetID, event.originCalendarID, event.calendars, userId, apiUrl, remoteID]);
  const [result, setResult] = useState<{ key: string; state?: ProviderEventState | null; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    api.getProviderEventState({ ...event, id: targetID }).then(({ state }) => {
      if (active) setResult({ key, state });
    }).catch(() => { if (active) setResult({ key, failed: true }); });
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
      <Text style={textStyle}>{event.recurrence && !event.seriesID ? "These settings describe the series, not an individual occurrence. " : ""}Imported provider settings. Change these in {details.provider}.</Text>
      {details.rows.map(row => <Text key={row.label} style={textStyle}>{row.label}: {row.value}</Text>)}
      <Text style={textStyle}>Provider notifications and Musubi reminders are separate. Both apps may notify you.</Text>
    </> : <Text accessibilityLiveRegion="polite" style={textStyle}>{current?.failed ? "Provider details could not be loaded. Reopen this event to retry." : "Loading provider details…"}</Text>}
  </View>;
}
