import { config } from "@musubi/config";
import { readGraphCreateAdoptionContext, validateGraphCreateAdoptionObservation, graphCreateAdoptionVersion, type GraphFamilyObservation } from "@musubi/db";
import { EventSchema, EventWriteError, type EventDeliveryConflict } from "@musubi/types";
import { getAdapter } from "./engine";
import type { NormalizedEvent, CalendarAdapter } from "./adapter";

export async function prepareGraphCreateAdoption(actorID: string, eventID: string, operationID: string, adapterFor: (provider: string) => CalendarAdapter | null = getAdapter) {
  if (!config.api.eventTimeEditsEnabled) return null;
  const context = await readGraphCreateAdoptionContext(actorID, eventID, operationID);
  if (!context) return null;
  const adapter = adapterFor("microsoft");
  if (!adapter?.readGraphCreateAdoption) throw new EventWriteError("event-write", "unsupported");
  const family = await adapter.readGraphCreateAdoption(actorID, context.row.accountID, context.row.externalCalendarID, EventSchema.parse(context.row.payload.graphSeriesCreate!.nativeEvent), { operationID, signal: AbortSignal.timeout(60_000) });
  if (!family) throw new EventWriteError("event-write", "unsupported");
  const project = (value: NormalizedEvent): GraphFamilyObservation["master"] => {
    if (!value.timeModel || !value.icalUid || !value.providerState) throw new EventWriteError("event-write", "unsupported");
    return { creationOperationID: value.creationOperationID, externalID: value.externalId, icalUid: value.icalUid, etag: value.etag ?? null, providerState: value.providerState, values: { title: value.title, description: value.description, location: value.location, organizer: value.organizer ?? "", url: value.url, start: value.start, end: value.end, isAllDay: value.isAllDay, recurrence: value.recurrence, timeModel: value.timeModel } };
  };
  const observation: GraphFamilyObservation = { master: project(family.master), instances: family.instances.map(value => {
    if (!value.originalStart) throw new EventWriteError("event-write", "unsupported");
    return { ...project(value), originalStart: value.originalStart };
  }), cancelled: family.cancelled };
  validateGraphCreateAdoptionObservation(context, observation);
  const stateVersion = graphCreateAdoptionVersion(context, observation);
  const content = (value: typeof observation.master.values) => ({ title: value.title, description: value.description, location: value.location, start: value.start, end: value.end, isAllDay: value.isAllDay, recurrence: value.recurrence, timeModel: value.timeModel });
  const preview: EventDeliveryConflict = { eventId: eventID, operationId: operationID, latestOperationId: operationID, localRevision: context.event.revision, local: content(context.event as typeof observation.master.values), remote: content(observation.master.values), remoteEtag: observation.master.etag, action: "create", canResolve: true, reason: null, graphCreateAdoption: { stateVersion, occurrenceCount: observation.instances.length } };
  return { context, observation, preview };
}
