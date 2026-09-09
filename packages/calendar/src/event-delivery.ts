import type { EventDeliveryTarget } from "@musubi/types";

/** Shared language for the web and native clients; never aggregate receipts. */
export function eventDeliveryLabel(target: EventDeliveryTarget): string {
  if (target.graphRsvpPhase) return ({ queued: "Response request saved", dispatched: "Outlook response outcome unknown", accepted: "Outlook accepted the response action", observed: "Response observed in Outlook", absent: "Outlook meeting copy unavailable" })[target.graphRsvpPhase];
  if (target.graphCreateAdopted) return "Provider version accepted in Musubi";
  if (target.alarmDiscarded) return "Saved alarm change discarded";
  const labels: Record<EventDeliveryTarget["status"], string> = {
    unknown: "No delivery receipt",
    pending: "Waiting to send",
    attempting: "Sending",
    completed:
      target.action === "delete" ? "Deletion confirmed" : "Delivery confirmed",
    "not-needed": "No write needed",
    conflict: "Remote changes need review",
    "not-written": "Not delivered",
    unconfirmed: "Delivery unconfirmed",
    retry: "Retry scheduled",
    blocked: "Delivery blocked",
    cancelled: "Delivery cancelled",
  };
  return labels[target.status];
}

export function eventDeliveryExplanation(target: EventDeliveryTarget): string {
  if (target.graphRsvpPhase) return target.graphRsvpPhase === "queued" ? "Outlook will be asked to send your response to the organizer. Organizer delivery cannot be verified." : target.graphRsvpPhase === "observed" ? "The current Outlook response matches your choice. Organizer delivery cannot be verified." : "The response action will not be resent. Musubi can check the current copy, but a missing copy or accepted action does not prove organizer delivery. Check Outlook if this remains unresolved.";
  if (target.graphCreateAdopted) return "The observed provider family was accepted locally. The original request remains in history; this choice sent no provider write.";
  if (target.alarmDiscarded) return "This saved request was stopped. The current CalDAV event is read on the next sync; a change already accepted by the server is not undone.";
  if (!target.connected)
    return "This connection is no longer available. The saved delivery record remains.";
  switch (target.issue) {
    case "reconnect-required":
      return "Reconnect the account in Connections, then retry this saved change.";
    case "write-denied":
      return "The provider denied writing. Restore write access, then retry.";
    case "write-unsupported":
      return "This operation is not supported for this destination.";
    case "permission-unknown":
      return "Write access could not be verified. Check the account's permissions.";
    case "conflict":
      return "The remote copy changed. Review both versions before applying your saved changes.";
    case "recovery-unavailable":
      return "The remote outcome cannot be safely established. Another copy will not be created blindly.";
    case "unconfirmed":
      return "The provider may have saved the change. Musubi must verify it before trying again.";
    case "delivery-failed":
      return "The saved change has not been confirmed at this destination.";
  }
  if (target.status === "unknown")
    return "Imported content does not prove that a later change was delivered.";
  if (target.status === "completed" || target.status === "not-needed")
    return "This receipt covers the recorded change at this destination only.";
  if (target.status === "cancelled")
    return "This saved operation stopped. Review the current state before replacing it.";
  return "The saved change is queued. Confirmation will appear after the provider responds.";
}

export function eventDeliveryActions(target: EventDeliveryTarget) {
  const available = target.owned && target.connected && !!target.operationId;
  return {
    retry:
      available &&
      (["retry", "unconfirmed", "not-written", "blocked"].includes(target.status) || target.status === "conflict" && !!target.graphRsvpPhase && target.graphRsvpPhase !== "queued"),
    review:
      !target.graphRsvpPhase && available &&
      ["conflict", "blocked", "cancelled", "unconfirmed"].includes(
        target.status,
      ),
  };
}
