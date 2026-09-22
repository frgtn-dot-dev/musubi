import { MicrosoftSeriesCancellationRequestSchema, type Event, type ProviderEventStateResponse } from "@musubi/types";
export const outlookCancellationNotice = "Outlook will cancel the selected meetings and notify their guests.";
export const outlookCancellationQueued = "Cancellation queued. Check Delivery details for Outlook’s result.";
export function outlookCancellationRequest(event: Event, observation: ProviderEventStateResponse, scope: "occurrence" | "series", operationID: string) {
  const capability = observation.outlookCancellation;
  if (!capability || observation.state?.provider !== "microsoft" || observation.state.isOrganizer !== true || !observation.version || event.isCanceled || event.originCalendarID !== capability.calendarID || event.revision !== capability.expectedRevision || !capability.scopes.includes(scope))
    throw new Error("The Outlook series changed. Reopen the meeting before cancelling.");
  return MicrosoftSeriesCancellationRequestSchema.parse({ provider: "microsoft", action: "delete", notificationPolicy: "server-invite", operationID, eventID: event.id, calendarID: capability.calendarID, scope, expectedRevision: capability.expectedRevision, expectedStateVersion: observation.version, expectedSeriesVersion: capability.seriesVersion });
}
