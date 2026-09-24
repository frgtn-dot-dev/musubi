import { ProviderRsvpEditSchema, type ProviderEventStateResponse } from "@musubi/types";

export const providerRsvpOptions = [
  { value: "accepted", label: "Accept" },
  { value: "tentative", label: "Tentative" },
  { value: "declined", label: "Decline" },
] as const;
export const providerRsvpNotice = "Google may notify the organizer and other participants. Email delivery cannot be verified.";
export const microsoftRsvpNotice = "Outlook will be asked to send your response to the organizer. Organizer delivery cannot be verified. An uncertain action is checked without resending it.";
export const caldavRsvpNotice = "Your calendar server will send a response to the organizer. Organizer delivery cannot be verified.";
export const microsoftRsvpScopeOptions = [{ value: "occurrence", label: "This occurrence" }, { value: "series", label: "Entire series" }] as const;
export function microsoftSeriesRsvpNotice(response: string) {
  return response === "declined" ? "Outlook may remove the entire series, including exceptions, from your calendar." : "Changes the series response. Existing exceptions keep their own response.";
}
export function providerRsvpRequest(observation: ProviderEventStateResponse, response: string, operationID: string, scope = observation.rsvpEdit?.scope) {
  if (!observation.rsvpEdit || !observation.version || observation.state?.provider !== observation.rsvpEdit.provider) throw new Error("Refresh the event before responding.");
  if (observation.rsvpEdit.provider === "microsoft") {
    if (scope === "series" ? !observation.rsvpEdit.series : scope !== observation.rsvpEdit.scope) throw new Error("Refresh the event before changing response scope.");
    return ProviderRsvpEditSchema.parse({ operationID, expectedRevision: observation.rsvpEdit.expectedRevision, expectedStateVersion: observation.version, provider: "microsoft", response, notificationPolicy: "send-response", ...(scope ? { scope } : {}), ...(scope === "series" ? { expectedSeriesVersion: observation.rsvpEdit.series!.version } : {}) });
  }
  if (observation.rsvpEdit.provider === "caldav") return ProviderRsvpEditSchema.parse({ operationID, expectedRevision: observation.rsvpEdit.expectedRevision, expectedStateVersion: observation.version, provider: "caldav", response, notificationPolicy: "server-reply" });
  return ProviderRsvpEditSchema.parse({ operationID, expectedRevision: observation.rsvpEdit.expectedRevision, expectedStateVersion: observation.version, provider: "google", response, sendUpdates: "all" });
}
export function providerRsvpReceiptMessage(status: string, provider: "google" | "caldav" | "microsoft" = "google") {
  if (provider === "microsoft") return ["completed", "not-needed"].includes(status) ? "Your response is observed in Outlook. Organizer delivery cannot be verified." : "Response request saved. Check Delivery details for Outlook acceptance and the observed response. An uncertain action will not be resent.";
  if (provider === "caldav") {
    if (["completed", "not-needed"].includes(status)) return "Your response is saved on the calendar server. Organizer delivery cannot be verified.";
    if (["conflict", "blocked", "cancelled", "not-written"].includes(status)) return "Response request saved, but calendar delivery needs attention. Open Delivery details to review it.";
    if (status === "unconfirmed") return "The calendar server may have saved your response. Open Delivery details to verify the result.";
    return "Response request saved. Calendar confirmation is still pending; check Delivery details for the result.";
  }
  if (status === "completed") return "Your response is confirmed in Google. Email delivery cannot be verified.";
  if (["conflict", "blocked", "cancelled", "not-written"].includes(status)) return "Response request saved, but Google delivery needs attention. Open Delivery details to review it.";
  if (status === "unconfirmed") return "Google may have saved your response. Open Delivery details to verify the result.";
  return "Response request saved. Google confirmation is still pending; check Delivery details for the result.";
}

export function providerRsvpResponseLabel(response: string | null) {
  return providerRsvpOptions.find(option => option.value === response)?.label ?? (response === "needsAction" ? "Awaiting response" : response ?? "Unknown");
}
