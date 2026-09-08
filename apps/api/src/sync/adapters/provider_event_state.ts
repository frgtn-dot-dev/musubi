import ICAL from "ical.js";
import { ProviderEventStateSchema, type ProviderEventState } from "@musubi/types";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" ? value : null;
const boolean = (value: unknown) => typeof value === "boolean" ? value : null;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const person = (value: unknown) => { const item = record(value); return { address: string(item.email), name: string(item.displayName), self: boolean(item.self) }; };
const urls = (values: unknown[]) => [...new Set(values.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value)))];

/** Read evidence only. None of this is a provider mutation or Musubi attendance. */
export function googleEventState(input: unknown): ProviderEventState {
  const item = record(input); const organizer = record(item.organizer); const reminder = record(item.reminders);
  const attendees = list(item.attendees).map(value => { const a = record(value); return { ...person(a), role: a.resource === true ? "resource" : a.optional === true ? "optional" : "required", response: string(a.responseStatus) }; });
  const self = attendees.filter(a => a.self === true);
  return ProviderEventStateSchema.parse({ provider: "google", organizer: item.organizer ? person(organizer) : null, isOrganizer: boolean(organizer.self), attendees, attendeesComplete: item.attendeesOmitted !== true, ownResponse: self.length === 1 ? self[0]!.response : null,
    reminders: { provider: "google", useDefault: boolean(reminder.useDefault), overrides: list(reminder.overrides).map(value => { const entry = record(value); return { method: string(entry.method), minutes: integer(entry.minutes) }; }) },
    availability: string(item.transparency), privacy: string(item.visibility), status: string(item.status), eventType: string(item.eventType),
    conferenceURLs: urls([item.hangoutLink, ...list(record(item.conferenceData).entryPoints).map(value => record(value).uri)]),
  });
}
export function microsoftEventState(input: unknown): ProviderEventState {
  const item = record(input);
  const address = (value: unknown) => { const a = record(record(value).emailAddress); return { address: string(a.address), name: string(a.name), self: null }; };
  return ProviderEventStateSchema.parse({ provider: "microsoft", organizer: item.organizer ? address(item.organizer) : null, isOrganizer: boolean(item.isOrganizer),
    attendees: list(item.attendees).map(value => { const a = record(value); return { ...address(a), role: string(a.type), response: string(record(a.status).response) }; }),
    attendeesComplete: Array.isArray(item.attendees), ownResponse: string(record(item.responseStatus).response),
    reminders: { provider: "microsoft", isOn: boolean(item.isReminderOn), minutesBeforeStart: integer(item.reminderMinutesBeforeStart) },
    availability: string(item.showAs), privacy: string(item.sensitivity), status: item.isCancelled === true ? "cancelled" : item.isCancelled === false ? "active" : null, eventType: string(item.type),
    conferenceURLs: urls([record(item.onlineMeeting).joinUrl, item.onlineMeetingUrl]),
  });
}
export function caldavEventState(component: ICAL.Component): ProviderEventState {
  const value = (name: string) => string(component.getFirstPropertyValue(name));
  const propertyPerson = (property: ICAL.Property) => ({ address: string(property.getFirstValue()), name: string(property.getParameter("cn")), self: null });
  const organizer = component.getFirstProperty("organizer");
  return ProviderEventStateSchema.parse({ provider: "caldav", organizer: organizer ? propertyPerson(organizer) : null, isOrganizer: null,
    attendees: component.getAllProperties("attendee").map(property => ({ ...propertyPerson(property), role: string(property.getParameter("role")), response: string(property.getParameter("partstat")) })),
    attendeesComplete: true, ownResponse: null,
    reminders: { provider: "caldav", alarms: component.getAllSubcomponents("valarm").map(alarm => {
      const trigger = alarm.getFirstProperty("trigger");
      const text = (name: string) => { const v = alarm.getFirstPropertyValue(name); return v == null ? null : String(v); };
      return { action: text("action"), trigger: text("trigger"), related: trigger ? string(trigger.getParameter("related")) : null, repeat: text("repeat"), duration: text("duration") };
    }) },
    availability: value("transp"), privacy: value("class"), status: value("status"), eventType: null, conferenceURLs: urls(component.getAllProperties("conference").map(property => property.getFirstValue())),
  });
}
