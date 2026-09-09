import { config } from "@musubi/config";
import { CaldavAlarmEditSchema, EventWriteError, type ProviderEventStateResponse } from "@musubi/types";
import { getCaldavAlarmContext, getCaldavAlarmReplay, commitCaldavAlarm, caldavAlarmVersion, type CaldavAlarmContext, type CaldavAlarmIntent } from "@musubi/db";
import { caldavAdapter } from "./adapters/caldav";
import { inspectCaldavAlarm, writeCaldavAlarm, type CaldavAlarmEvidence } from "./adapters/caldav_alarms";
const unavailable = () => new EventWriteError("event-write", "unsupported", "Refresh this CalDAV event before changing its alarm.");
export function prepareCaldavAlarmIntent(context: CaldavAlarmContext, observed: CaldavAlarmEvidence, request: CaldavAlarmIntent["request"]): CaldavAlarmIntent {
  if (observed.ref.externalEventId !== context.mapping.ref.externalEventId || observed.ref.icalUid !== context.mapping.ref.icalUid || observed.ref.etag !== context.mapping.ref.etag || request.expectedRevision !== context.event.revision || request.expectedStateVersion !== caldavAlarmVersion(context, observed.data)) throw unavailable();
  const after = writeCaldavAlarm(observed.data, context.event, observed.ref, request.alarms);
  return { context, request, before: observed.data, after, desiredState: inspectCaldavAlarm(after, context.event, observed.ref).state };
}
export async function caldavAlarmObservation(actorID: string, eventID: string, observation: ProviderEventStateResponse): Promise<ProviderEventStateResponse> {
  if (!config.api.caldavAlarmEditsEnabled || observation.state?.provider !== "caldav") return observation;
  try {
    const context = await getCaldavAlarmContext(actorID, eventID);
    const observed = await caldavAdapter.readCaldavAlarm!(context, AbortSignal.timeout(10_000));
    if (observed.ref.etag !== context.mapping.ref.etag) return observation;
    return { state: observed.state, version: caldavAlarmVersion(context, observed.data), reminderEdit: { provider: "caldav", expectedRevision: context.event.revision!, minutesBeforeStart: observed.alarms.minutesBeforeStart } };
  } catch { return observation; }
}
export async function queueCaldavAlarms(actorID: string, eventID: string, input: unknown) {
  if (!config.api.caldavAlarmEditsEnabled) throw unavailable();
  const request = CaldavAlarmEditSchema.parse(input), replay = await getCaldavAlarmReplay(actorID, eventID, request);
  if (replay) return replay;
  const context = await getCaldavAlarmContext(actorID, eventID);
  const observed = await caldavAdapter.readCaldavAlarm!(context, AbortSignal.timeout(10_000));
  return commitCaldavAlarm(prepareCaldavAlarmIntent(context, observed, request));
}
