import { GoogleReminderWriteSchema, ProviderReminderEditSchema, type ProviderEventStateResponse } from "@musubi/types";

export type ProviderReminderDraft = {
  mode: "defaults" | "off" | "custom";
  overrides: { method: "email" | "popup"; minutes: string }[];
};

export function providerReminderDraft(observation: ProviderEventStateResponse): ProviderReminderDraft {
  const native = observation.state?.reminders;
  if (!observation.reminderEdit || !observation.version || native?.provider !== "google") throw new Error("Refresh the event before editing Google reminders.");
  const parsed = GoogleReminderWriteSchema.parse(native.useDefault === true ? { useDefault: true } : { useDefault: native.useDefault, overrides: native.overrides });
  return { mode: parsed.useDefault ? "defaults" : parsed.overrides.length ? "custom" : "off", overrides: parsed.useDefault ? [] : parsed.overrides.map(item => ({ method: item.method, minutes: String(item.minutes) })) };
}

export function providerReminderRequest(observation: ProviderEventStateResponse, draft: ProviderReminderDraft, operationID: string) {
  if (!observation.reminderEdit || !observation.version) throw new Error("Refresh the event before editing Google reminders.");
  if (draft.mode === "custom" && (!draft.overrides.length || draft.overrides.some(item => !/^\d+$/.test(item.minutes) || Number(item.minutes) > 40320))) throw new Error("Use whole minutes from 0 to 40320 for each reminder.");
  return ProviderReminderEditSchema.parse({ operationID, expectedRevision: observation.reminderEdit.expectedRevision, expectedStateVersion: observation.version, provider: "google", reminders: draft.mode === "defaults" ? { useDefault: true } : { useDefault: false, overrides: draft.mode === "off" ? [] : draft.overrides.map(item => ({ method: item.method, minutes: Number(item.minutes) })) } });
}


export function providerReminderReceiptMessage(status: string): string {
  if (["completed", "not-needed"].includes(status)) return "Google reminder change confirmed.";
  if (["conflict", "blocked", "cancelled", "not-written"].includes(status)) return "Request saved, but Google delivery needs attention. Open Delivery details to review it.";
  if (status === "unconfirmed") return "Google may have saved the change. Open Delivery details to verify the result.";
  if (["pending", "attempting", "retry"].includes(status)) return "Request saved. Google confirmation is still pending; check Delivery details for the result.";
  return "Request saved. Open Delivery details to check the result.";
}
