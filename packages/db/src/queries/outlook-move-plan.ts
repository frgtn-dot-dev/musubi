import { instantToCivil, shiftCivilMinutes, unambiguousCivilToInstant, outlookEndpointZonesMatch } from "@musubi/calendar";
import { BadRequestError, type OutlookMoveOptions, type OutlookMoveRequest, type OutlookMoveResult } from "@musubi/types";
import { graphMeetingVersion } from "./graph-meeting-cancel";
import { graphOccurrenceTimeChange, type GraphOccurrenceContent } from "./graph-occurrence-content";
import type { GraphFamilyObservation } from "./graph-family";
import { sameCaldavScopeContext as same } from "./caldav-series-scope";

export type OutlookMoveObservation = Pick<GraphOccurrenceContent, "context" | "baseline" | "identity" | "template" | "native" | "nativeExceptions">;
export type OutlookMoveItem = OutlookMoveResult["items"][number] & { operationID: string; nativeID: string };
export type OutlookMoveJournal = {
  request: OutlookMoveRequest; initial: OutlookMoveObservation; expected: GraphFamilyObservation;
  items: OutlookMoveItem[];
};
export function outlookMoveZone(observed: Pick<OutlookMoveObservation, "template">): string {
  const model = observed.template.timeModel;
  if (model?.kind !== "zoned") throw new BadRequestError("The verified series time zone is missing.");
  return model.timeZone;
}
export function outlookMoveOptions(observed: OutlookMoveObservation): OutlookMoveOptions {
  const { baseline, template, native, context } = observed;
  if (template.timeModel?.kind !== "zoned" || template.isAllDay ||
      !outlookEndpointZonesMatch(native, template.timeModel.timeZone) || !baseline.instances.length)
    throw new BadRequestError("Moving selected occurrences requires a verified finite series in its original time zone.");
  const ordinary = baseline.instances.filter(n => n.providerState.eventType === "occurrence" && n.originalStart.kind === "instant" && !n.values.isAllDay);
  const occurrences = ordinary.flatMap(n => {
    const mapping = context.mappings.find(m => m.externalEventID === n.externalID);
    const event = context.family.find(e => e.id === mapping?.eventID && !e.isCanceled && !e.deletedAt);
    return event ? [{ eventID: event.id, start: new Date(n.values.start).toISOString(), end: new Date(n.values.end).toISOString() }] : [];
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (!occurrences.length) throw new BadRequestError("No unchanged, synchronized occurrences are available to move.");
  return { eventID: context.address.eventID, calendarID: context.address.calendarID, version: graphMeetingVersion(observed),
    title: baseline.master.values.title, timeZone: template.timeModel.timeZone, meeting: baseline.master.providerState.attendees.length > 0,
    preserved: { edited: baseline.instances.filter(n => n.providerState.eventType === "exception").length, cancelled: baseline.cancelled.length, unavailable: ordinary.length - occurrences.length }, occurrences };
}
export function planOutlookMove(observed: OutlookMoveObservation, request: OutlookMoveRequest, newID: () => string): OutlookMoveJournal {
  const options = outlookMoveOptions(observed);
  if (request.expectedVersion !== options.version || request.eventID !== options.eventID || request.calendarID !== options.calendarID)
    throw new BadRequestError("The series changed. Refresh the preview.");
  const items = request.eventIDs.map(eventID => {
    const before = options.occurrences.find(n => n.eventID === eventID);
    const mapping = observed.context.mappings.find(m => m.eventID === eventID);
    if (!before || !mapping) throw new BadRequestError("Choose only unchanged occurrences from this preview.");
    const civil = (instant: string) => instantToCivil(new Date(instant), options.timeZone);
    const shifted = (instant: string) => {
      try { return unambiguousCivilToInstant(shiftCivilMinutes(civil(instant), request.offsetMinutes), options.timeZone).toISOString(); }
      catch { throw new BadRequestError("Choose a move outside ambiguous or missing daylight-saving times."); }
    };
    const newStart = shifted(before.start), newEnd = shifted(before.end);
    // Keep occupied local dates. A UTC midnight is not a civil-day boundary.
    if (civil(before.start).slice(0, 10) !== civil(newStart).slice(0, 10) || civil(before.end).slice(0, 10) !== civil(newEnd).slice(0, 10))
      throw new BadRequestError("Keep each occurrence on its existing dates in the series time zone.");
    const item = { ...before, newStart, newEnd, operationID: newID(), nativeID: mapping.externalEventID, status: "pending" as const };
    graphOccurrenceTimeChange({ ...observed, targetID: mapping.externalEventID,
      request: { provider: "microsoft", action: "update", notificationPolicy: "server-invite", scope: "occurrence",
        operationID: item.operationID, eventID, calendarID: request.calendarID, expectedRevision: 1,
        expectedStateVersion: "0".repeat(64), expectedSeriesVersion: "0".repeat(64), patch: { time: outlookMoveTime(item, options.timeZone) } } });
    return item;
  }).sort((a, b) => a.start.localeCompare(b.start));
  return { request, initial: observed, expected: observed.baseline, items };
}
export function outlookMoveTime(item: Pick<OutlookMoveItem, "newStart" | "newEnd">, timeZone: string) {
  return { kind: "zoned" as const, timeZone, startLocal: instantToCivil(new Date(item.newStart), timeZone), endLocal: instantToCivil(new Date(item.newEnd), timeZone) };
}
/** An earlier authorized occurrence PATCH can refresh sibling ETags. Everything
 * else must still match the last atomically acknowledged family. */
export function sameOutlookMoveFamily(a: GraphFamilyObservation, b: GraphFamilyObservation) {
  const withoutTokens = (v: GraphFamilyObservation) => ({ ...v,
    master: { ...v.master, etag: null }, instances: v.instances.map(n => ({ ...n, etag: null })) });
  return same(withoutTokens(a), withoutTokens(b));
}
