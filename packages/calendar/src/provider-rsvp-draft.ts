import { ProviderRsvpEditSchema, type ProviderEventStateResponse } from "@musubi/types";

export const providerRsvpOptions = [
  { value: "accepted", label: "Accept" },
  { value: "tentative", label: "Tentative" },
  { value: "declined", label: "Decline" },
] as const;
export const providerRsvpNotice = "Google may notify the organizer and other participants. Email delivery cannot be verified.";
export function providerRsvpRequest(observation: ProviderEventStateResponse, response: string, operationID: string) {
  if (!observation.rsvpEdit || !observation.version || observation.state?.provider !== "google") throw new Error("Refresh the event before responding to Google.");
  return ProviderRsvpEditSchema.parse({ operationID, expectedRevision: observation.rsvpEdit.expectedRevision, expectedStateVersion: observation.version, provider: "google", response, sendUpdates: "all" });
}
export function providerRsvpReceiptMessage(status: string) {
  if (status === "completed") return "Your response is confirmed in Google. Email delivery cannot be verified.";
  if (["conflict", "blocked", "cancelled", "not-written"].includes(status)) return "Response request saved, but Google delivery needs attention. Open Delivery details to review it.";
  if (status === "unconfirmed") return "Google may have saved your response. Open Delivery details to verify the result.";
  return "Response request saved. Google confirmation is still pending; check Delivery details for the result.";
}
