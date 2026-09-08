import type { ProviderEventState } from "@musubi/types";

/** Read-only labels. Unknown provider values stay visible rather than acquiring
 * invented RSVP, privacy or alarm semantics. Never drives notification delivery. */
export function providerEventDetails(state: ProviderEventState) {
  const provider = state.provider === "google" ? "Google Calendar" : state.provider === "microsoft" ? "Outlook" : "CalDAV";
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => { if (value) rows.push({ label, value }); };
  const person = (value: { name: string | null; address: string | null }) => [value.name, value.address].filter(Boolean).join(" · ") || "Unnamed participant";
  add("Organizer", state.organizer ? person(state.organizer) : null);
  add("Your role", state.isOrganizer === null ? null : state.isOrganizer ? "Organizer" : "Not the organizer");
  add("Your provider response", state.ownResponse ?? "Not reported");
  if (state.attendees.length) add("Provider participants", state.attendees.map(attendee => [person(attendee), attendee.role, attendee.response].filter(Boolean).join(" · ")).join("\n"));
  if (!state.attendeesComplete) add("Participant list", "May be incomplete");
  add(state.reminders.provider === "caldav" ? "Provider alarms" : "Provider reminders", providerReminderDescription(state.reminders));
  add("Availability", state.availability);
  add("Privacy", state.privacy);
  add("Provider status", state.status);
  add("Provider event type", state.eventType);
  return { provider, rows };
}

export function providerReminderDescription(reminder: ProviderEventState["reminders"]): string {
  if (reminder.provider === "google") {
    return reminder.useDefault === true ? "Calendar defaults" : reminder.useDefault === null ? "Not reported" : reminder.overrides.length ? reminder.overrides.map(item => `${item.method ?? "Unknown method"} · ${item.minutes === null ? "time not reported" : `${item.minutes} minutes before start`}`).join("\n") : "Off";
  } else if (reminder.provider === "microsoft") {
    return reminder.isOn === false ? "Off" : reminder.isOn === null ? "Not reported" : reminder.minutesBeforeStart === null ? "On · time not reported" : `${reminder.minutesBeforeStart} minutes before start`;
  } else {
    return reminder.alarms.length ? reminder.alarms.map(alarm => [alarm.action ?? "Unknown action", alarm.trigger ?? "trigger not reported", alarm.related, alarm.repeat ? `repeat ${alarm.repeat}` : null, alarm.duration].filter(Boolean).join(" · ")).join("\n") : "None in this event";
  }
}
