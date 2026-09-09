import ICAL from "ical.js";
import { CaldavAlarmWriteSchema, EventWriteError, type CaldavAlarmWrite, type Event } from "@musubi/types";
import { matchesEventProviderProjection, sameCaldavScopeContext } from "@musubi/db";
import { calendarLines, replaceEventProperties } from "./caldav_event_ical";
import { sameCaldavResource } from "./caldav_series";
import { normalizeCaldavResource } from "./caldav_time";
import { caldavEventState } from "./provider_event_state";
import type { ExternalEventRef } from "../adapter";
import { requireEventEtag } from "../event_write";

const unsupported = () => new EventWriteError("event-write", "unsupported", "This CalDAV event alarm cannot be edited safely. Change it in the calendar app.");
/** The only edited physical span is the sole alarm or its TRIGGER property. */
function spans(data: string) {
  replaceEventProperties(data, 0, new Map());
  const lines = calendarLines(data), stack: string[] = [];
  let alarmStart = -1, alarmEnd = -1, trigger = -1, eventEnd = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].unfolded, boundary = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
    if (boundary) {
      const name = boundary[2].toLowerCase();
      if (boundary[1].toUpperCase() === "BEGIN") {
        if (name === "valarm") { if (alarmStart !== -1 || stack.join("/") !== "vcalendar/vevent") throw unsupported(); alarmStart = index; }
        stack.push(name);
      } else { if (name === "valarm") alarmEnd = index; if (name === "vevent") eventEnd = index; stack.pop(); }
    } else if (stack.join("/") === "vcalendar/vevent/valarm" && /^TRIGGER[:;]/i.test(line)) { if (trigger !== -1) throw unsupported(); trigger = index; }
  }
  return { lines, alarmStart, alarmEnd, trigger, eventEnd };
}
export function withoutCaldavAlarm(data: string): string {
  const { lines, alarmStart, alarmEnd } = spans(data);
  return lines.filter((_, index) => alarmStart < 0 || index < alarmStart || index > alarmEnd).map(line => line.raw).join("");
}
export function sameCaldavAlarmEvent(left: string, right: string): boolean {
  return sameCaldavResource(withoutCaldavAlarm(left), withoutCaldavAlarm(right));
}
export function inspectCaldavAlarm(data: string, event: Event, ref: ExternalEventRef) {
  try {
    const etag = requireEventEtag(ref.etag);
    const calendar = new ICAL.Component(ICAL.parse(data));
    const components = calendar.getAllSubcomponents("vevent");
    if (calendar.name !== "vcalendar" || calendar.hasProperty("method") || components.length !== 1 || calendar.getAllSubcomponents().some(component => !["vevent", "vtimezone"].includes(component.name))) throw unsupported();
    const component = components[0];
    if (!ref.icalUid || component.getFirstPropertyValue("uid") !== ref.icalUid || event.recurrence || event.seriesID || event.originalStart || event.isCanceled || !["zoned", "all-day"].includes(event.timeModel?.kind ?? "")) throw unsupported();
    if (["organizer", "attendee", "recurrence-id", "rrule", "rdate", "exdate"].some(name => component.hasProperty(name))) throw unsupported();
    for (const name of ["uid", "dtstart", "dtend", "duration", "summary", "description", "location", "status"]) if (component.getAllProperties(name).length > 1) throw unsupported();
    if (component.getAllSubcomponents().some(child => child.name !== "valarm")) throw unsupported();
    const normalized = normalizeCaldavResource({ url: ref.externalEventId, etag, data });
    if (normalized.length !== 1 || normalized[0].status !== "active" || !matchesEventProviderProjection("caldav", event, normalized[0]) || !sameCaldavScopeContext(normalized[0].timeModel, event.timeModel)) throw unsupported();
    const alarms = component.getAllSubcomponents("valarm");
    if (alarms.length > 1) throw unsupported();
    let minutesBeforeStart: number | null = null;
    if (alarms.length) {
      const physical = spans(data);
      for (const line of physical.lines.slice(physical.alarmStart + 1, physical.alarmEnd)) {
        const header = line.unfolded.slice(0, line.unfolded.indexOf(":"));
        if (/^(ACTION|DESCRIPTION)$/i.test(header)) continue;
        const [name, ...parameters] = header.split(";");
        if (name.toUpperCase() !== "TRIGGER" || parameters.some(value => !/^(RELATED=START|VALUE=DURATION)$/i.test(value)) || new Set(parameters.map(value => value.split("=")[0].toUpperCase())).size !== parameters.length) throw unsupported();
      }
      const alarm = alarms[0], properties = alarm.getAllProperties();
      if (alarm.getAllSubcomponents().length || properties.length !== 3 || ["action", "trigger", "description"].some(name => alarm.getAllProperties(name).length !== 1) || alarm.getFirstPropertyValue("action") !== "DISPLAY") throw unsupported();
      for (const property of properties) {
        const parameters = property.toJSON()[1] as Record<string, unknown>;
        if (Object.entries(parameters).some(([name, value]) => property.name !== "trigger" || !(name === "related" && value === "START" || name === "value" && value === "DURATION"))) throw unsupported();
      }
      if (alarm.getFirstProperty("action")!.type !== "text" || alarm.getFirstProperty("description")!.type !== "text") throw unsupported();
      const trigger = alarm.getFirstProperty("trigger")!;
      if (trigger.type !== "duration") throw unsupported();
      // Nominal days/weeks must not be converted into elapsed minutes at DST.
      const raw = calendarLines(data)[spans(data).trigger].unfolded.split(":").slice(1).join(":");
      const match = /^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(raw);
      if (!match || !match.slice(2).some(Boolean)) throw unsupported();
      const seconds = Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
      if (!Number.isSafeInteger(seconds) || seconds % 60 || seconds > 0 && !match[1]) throw unsupported();
      minutesBeforeStart = CaldavAlarmWriteSchema.parse({ minutesBeforeStart: seconds / 60 }).minutesBeforeStart;
    }
    spans(data);
    return { ref: { externalEventId: ref.externalEventId, icalUid: ref.icalUid, etag }, data, event: normalized[0], state: caldavEventState(component), alarms: { minutesBeforeStart } };
  } catch { throw unsupported(); }
}
export type CaldavAlarmEvidence = ReturnType<typeof inspectCaldavAlarm>;
export function writeCaldavAlarm(data: string, event: Event, ref: ExternalEventRef, input: CaldavAlarmWrite): string {
  const desired = CaldavAlarmWriteSchema.parse(input), observed = inspectCaldavAlarm(data, event, ref);
  if (desired.minutesBeforeStart === observed.alarms.minutesBeforeStart) return data;
  if (desired.minutesBeforeStart === null) return withoutCaldavAlarm(data);
  const { lines, alarmStart, trigger, eventEnd } = spans(data), newline = data.includes("\r\n") ? "\r\n" : "\n";
  const duration = desired.minutesBeforeStart ? `-PT${desired.minutesBeforeStart}M` : "PT0M";
  if (alarmStart >= 0) lines[trigger].raw = `TRIGGER:${duration}${newline}`;
  else lines[eventEnd].raw = ["BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${duration}`, "DESCRIPTION:Calendar reminder", "END:VALARM", ""].join(newline) + lines[eventEnd].raw;
  const result = lines.map(line => line.raw).join("");
  inspectCaldavAlarm(result, event, ref);
  return result;
}
