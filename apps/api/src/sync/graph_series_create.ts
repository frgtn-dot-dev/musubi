import { config } from "@musubi/config";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { EventSchema, EventTimeCreateRequestSchema, EventWriteError, BadRequestError } from "@musubi/types";
import { graphSeriesCreateProjection, queueGraphSeriesCreate, findGraphSeriesCreateReplay } from "@musubi/db";
import { graphSeriesFootprint } from "./adapters/microsoft_series_footprint";
import { graphSeriesCreateBody } from "./adapters/microsoft_series_create";

function projectRequest(actorID: string, input: unknown) {
  const request = EventTimeCreateRequestSchema.parse(input);
  const calendars = [...new Set(request.event.calendars.map(value => value.toLowerCase()))];
  const origin = request.event.originCalendarID?.toLowerCase() ?? calendars[0];
  let time;
  try { time = resolveEventTimeEdit(request.time); }
  catch { throw new BadRequestError("The requested event time is invalid. No changes were saved."); }
  return EventSchema.parse({ ...request.event, ...time, id: request.event.id.toLowerCase(), revision: 1, creatorID: actorID, organizer: actorID, originCalendarID: origin, calendars });
}

export async function findGraphSeriesCreateRequest(actorID: string, operationID: string, input: unknown) {
  return findGraphSeriesCreateReplay(actorID, operationID, projectRequest(actorID, input));
}

/** Public request admission only. Native permission and delivery are checked by
 * the durable worker; this receipt promises a local intent, not a native write. */
export async function queueGraphSeriesCreateRequest(actorID: string, operationID: string, input: unknown) {
  if (!config.api.eventTimeEditsEnabled) throw new EventWriteError("event-write", "unsupported");
  const event = projectRequest(actorID, input);
  if (event.calendars.length !== 1 || event.originCalendarID !== event.calendars[0]) throw new BadRequestError("Outlook recurring creation requires one origin calendar.");
  try {
    const native = graphSeriesCreateProjection(event, actorID);
    graphSeriesFootprint(native);
    graphSeriesCreateBody(native, { operationID });
  } catch (error) {
    if (error instanceof EventWriteError) throw error;
    throw new BadRequestError("The requested recurring event cannot be represented. No changes were saved.");
  }
  return queueGraphSeriesCreate(actorID, operationID, event);
}
