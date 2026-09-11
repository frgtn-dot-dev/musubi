import { CaldavAlarmEditSchema, GoogleReminderWriteSchema, ProviderReminderEditSchema, type ProviderEventStateResponse } from "@musubi/types";

export type ProviderReminderDraft = {
  mode: "defaults" | "off" | "custom";
  overrides: { method: "email" | "popup"; minutes: string }[];
};

export function providerReminderDraft(observation: ProviderEventStateResponse): ProviderReminderDraft {
  if (observation.reminderEdit?.provider === "caldav" && observation.version) {
    const minutes = observation.reminderEdit.minutesBeforeStart;
    return { mode: minutes === null ? "off" : "custom", overrides: minutes === null ? [] : [{ method: "popup", minutes: String(minutes) }] };
  }
  const native = observation.state?.reminders;
  if (!observation.reminderEdit || !observation.version || native?.provider !== "google") throw new Error("Refresh the event before editing Google reminders.");
  const parsed = GoogleReminderWriteSchema.parse(native.useDefault === true ? { useDefault: true } : { useDefault: native.useDefault, overrides: native.overrides });
  return { mode: parsed.useDefault ? "defaults" : parsed.overrides.length ? "custom" : "off", overrides: parsed.useDefault ? [] : parsed.overrides.map(item => ({ method: item.method, minutes: String(item.minutes) })) };
}

export function providerReminderRequest(observation: ProviderEventStateResponse, draft: ProviderReminderDraft, operationID: string, occurrence = false) {
  if (!observation.reminderEdit || !observation.version) throw new Error("Refresh the event before editing Google reminders.");
  if (draft.mode === "custom" && (!draft.overrides.length || draft.overrides.some(item => !/^\d+$/.test(item.minutes) || Number(item.minutes) > 40320))) throw new Error("Use whole minutes from 0 to 40320 for each reminder.");
  if (observation.reminderEdit.provider === "caldav") {
    if (draft.mode === "defaults" || draft.mode === "custom" && (draft.overrides.length !== 1 || draft.overrides[0].method !== "popup")) throw new Error("Use one display alarm or turn the event alarm off.");
    return CaldavAlarmEditSchema.parse({ operationID, expectedRevision: observation.reminderEdit.expectedRevision, expectedStateVersion: observation.version, provider: "caldav", ...(observation.reminderEdit.scope ? { scope: observation.reminderEdit.scope } : {}), alarms: { minutesBeforeStart: draft.mode === "off" ? null : Number(draft.overrides[0].minutes) } });
  }
  if (occurrence && draft.mode === "defaults") throw new Error("Calendar defaults cannot be saved for a Google occurrence. Choose Custom or Off.");
  return ProviderReminderEditSchema.parse({ operationID, expectedRevision: observation.reminderEdit.expectedRevision, expectedStateVersion: observation.version, provider: "google", reminders: draft.mode === "defaults" ? { useDefault: true } : { useDefault: false, overrides: draft.mode === "off" ? [] : draft.overrides.map(item => ({ method: item.method, minutes: Number(item.minutes) })) } });
}


export function providerReminderReceiptMessage(status: string, provider: "google" | "caldav" = "google"): string {
  if (provider === "caldav" && status === "not-needed") return "No further alarm write is pending. Open Delivery details to check the saved request; this does not confirm the CalDAV alarm.";
  if (provider === "caldav") return providerReminderReceiptMessage(status).replace(/Google reminder/g, "CalDAV event alarm").replace(/Google/g, "CalDAV");
  if (["completed", "not-needed"].includes(status)) return "Google reminder change confirmed.";
  if (["conflict", "blocked", "cancelled", "not-written"].includes(status)) return "Request saved, but Google delivery needs attention. Open Delivery details to review it.";
  if (status === "unconfirmed") return "Google may have saved the change. Open Delivery details to verify the result.";
  if (["pending", "attempting", "retry"].includes(status)) return "Request saved. Google confirmation is still pending; check Delivery details for the result.";
  return "Request saved. Open Delivery details to check the result.";
}

export function caldavAlarmDescription(alarms: { minutesBeforeStart: number | null }): string {
  return alarms.minutesBeforeStart === null ? "Off" : alarms.minutesBeforeStart === 0 ? "Display at event start" : `Display ${alarms.minutesBeforeStart} minutes before start`;
}
