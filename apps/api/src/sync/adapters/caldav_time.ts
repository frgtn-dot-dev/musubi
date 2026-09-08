import { caldavEventState } from "./provider_event_state";
import ICAL from "ical.js";
import { civilToInstant, instantToCivil, resolveEventTimeEdit } from "@musubi/calendar";
import { EventTimeModelSchema, EventTimeZoneSchema, OccurrenceStartSchema, type OccurrenceStart } from "@musubi/types";
import type { NormalizedEvent } from "../adapter";

type Stamp = { kind: "date" | "floating" | "instant"; civil: string; zone: string; instant: Date };
function stamp(property: ICAL.Property | null): Stamp {
  const value = property?.getFirstValue();
  if (!(value instanceof ICAL.Time)) throw new Error("CalDAV component requires a valid time property.");
  const civil = value.toString().replace(/Z$/, "");
  if (value.isDate) {
    OccurrenceStartSchema.parse({ kind: "date", value: civil });
    return { kind: "date", civil, zone: "UTC", instant: new Date(`${civil}T00:00:00.000Z`) };
  }
  const tzid = property!.getParameter("tzid");
  const zone = tzid ? EventTimeZoneSchema.parse(tzid) : value.zone === ICAL.Timezone.utcTimezone ? "UTC" : null;
  return { kind: zone ? "instant" : "floating", civil, zone: zone ?? "UTC", instant: civilToInstant(civil, zone ?? "UTC", "explicit")! };
}
function text(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" ? value : null;
}
function identity(value: Stamp): OccurrenceStart {
  return OccurrenceStartSchema.parse({ kind: value.kind, value: value.kind === "instant" ? value.instant.toISOString() : value.civil });
}
function shiftedCivil(civil: string, days: number): string {
  const carrier = new Date(civil.length === 10 ? `${civil}T00:00:00Z` : `${civil}Z`);
  carrier.setUTCDate(carrier.getUTCDate() + days);
  return carrier.toISOString().slice(0, civil.length === 10 ? 10 : 19);
}
function times(component: ICAL.Component) {
  const start = stamp(component.getFirstProperty("dtstart"));
  const endProperty = component.getFirstProperty("dtend");
  const duration = component.getFirstPropertyValue("duration");
  if (endProperty && duration) throw new Error("CalDAV DTEND and DURATION are mutually exclusive.");
  let end = endProperty ? stamp(endProperty) : start;
  if ((end.kind === "date") !== (start.kind === "date") || (end.kind === "floating") !== (start.kind === "floating"))
    throw new Error("CalDAV start and end time kinds disagree.");
  if (duration) {
    if (!(duration instanceof ICAL.Duration) || duration.isNegative) throw new Error("Invalid CalDAV event duration.");
    const days = duration.weeks * 7 + duration.days;
    const seconds = duration.hours * 3600 + duration.minutes * 60 + duration.seconds;
    if (start.kind === "date" && seconds) throw new Error("All-day duration requires whole days.");
    const civil = shiftedCivil(start.civil, days);
    // RFC 5545: nominal days first, then accurate hours/minutes/seconds.
    const instant = new Date((start.kind === "date" ? new Date(`${civil}T00:00:00Z`) : civilToInstant(civil, start.zone, "explicit")!).getTime() + seconds * 1000);
    end = { ...start, instant, civil: start.kind === "date" ? instant.toISOString().slice(0, 10) : instantToCivil(instant, start.zone) };
  }
  if (start.kind === "date") {
    const exclusive = !endProperty && !duration ? shiftedCivil(start.civil, 1) : end.civil;
    if (exclusive <= start.civil) throw new Error("CalDAV all-day DTEND must be after DTSTART.");
    return resolveEventTimeEdit({ kind: "all-day", startDate: start.civil, endDate: shiftedCivil(exclusive, -1) });
  }
  if (end.instant < start.instant) throw new Error("CalDAV end precedes start.");
  const timeModel = EventTimeModelSchema.parse({ kind: start.kind === "floating" ? "floating" : "zoned", ...(start.kind === "instant" ? { timeZone: start.zone } : {}), startLocal: start.civil, endLocal: start.zone === end.zone ? end.civil : instantToCivil(end.instant, start.zone) });
  // Keep exact endpoints: converting a duration/UTC end back through an
  // ambiguous local clock would silently choose the first half of a fold.
  return { start: start.instant, end: end.instant, isAllDay: false, timeModel };
}

/** Read only: never serializes or mutates the resource, its alarms or extensions.
 * Unsupported resources throw before a sync cursor or component can be accepted.
 */
export function normalizeCaldavResource(object: { url: string; etag?: string; data?: string }): NormalizedEvent[] {
  if (!object.data) throw new Error("CalDAV resource has no body.");
  const calendar = new ICAL.Component(ICAL.parse(object.data));
  const components = calendar.getAllSubcomponents("vevent");
  if (!components.length) return [];
  const masters = components.filter(component => !component.hasProperty("recurrence-id"));
  if (masters.length !== 1) throw new Error("CalDAV resource requires exactly one master; masterless overrides are not yet supported.");
  const master = masters[0]!;
  const uid = text(master, "uid");
  if (!uid || components.some(component => text(component, "uid") !== uid)) throw new Error("CalDAV resource contains inconsistent UIDs.");
  const seen = new Set<string>();
  return [master, ...components.filter(component => component !== master)].map(component => {
    const recurrenceID = component.getFirstProperty("recurrence-id");
    if (recurrenceID?.getParameter("range")) throw new Error("CalDAV RANGE overrides require scope support.");
    const originalStart = recurrenceID ? identity(stamp(recurrenceID)) : null;
    const suffix = originalStart ? `#musubi-original=${encodeURIComponent(JSON.stringify(originalStart))}` : "";
    if (seen.has(suffix)) throw new Error("CalDAV resource contains duplicate occurrence identities.");
    seen.add(suffix);
    const recurrence = ["rrule", "rdate", "exdate"].flatMap(name => component.getAllProperties(name).map(property => property.toICALString())).join("\n") || null;
    const duration = component.getFirstPropertyValue("duration");
    if (recurrence && duration instanceof ICAL.Duration && (duration.days || duration.weeks) && !(component.getFirstPropertyValue("dtstart") as ICAL.Time)?.isDate)
      throw new Error("Recurring nominal-day durations require a duration-aware recurrence model.");
    if (originalStart && recurrence) throw new Error("CalDAV override cannot define another series.");
    const cancelled = text(component, "status")?.toUpperCase() === "CANCELLED";
    return {
      providerState: caldavEventState(component),
      externalId: object.url + suffix, externalSeriesID: originalStart ? object.url : null, originalStart,
      status: cancelled && !originalStart ? "cancelled" : "active", isCanceled: cancelled && !!originalStart,
      ...times(component), title: text(component, "summary") ?? "(untitled)",
      description: text(component, "description"), location: text(component, "location"),
      organizer: text(component, "organizer")?.replace(/^mailto:/i, "") ?? null,
      recurrence, url: null, etag: object.etag ?? null, icalUid: uid,
    };
  });
}
