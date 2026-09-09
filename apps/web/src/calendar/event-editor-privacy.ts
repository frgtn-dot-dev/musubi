import type { Calendar, Event } from "@musubi/types";
import { eventFormValues, type EventFormValues } from "./event-form";
import { getEventHomeCalendar } from "./event-permissions";

export const privateEditorFields = ["title", "description", "location", "url"] as const;

/** A canonical revision is required: a role-only refresh is not new content.
 * Busy's cleared shape also covers batched downgrade/upgrade notifications that
 * never render the intermediate viewer role. No private recovery DTO is needed. */
export function isGoogleEditorPrivacyRefresh(baseline: Event, current: Event | undefined, calendars: Calendar[]) {
  if (!current || current.id !== baseline.id || (current.revision ?? 0) <= (baseline.revision ?? 0)) return false;
  return isGoogleEditorRestricted(current, calendars);
}

export function isGoogleEditorRestricted(current: Event, calendars: Calendar[]) {
  const home = getEventHomeCalendar(current, calendars);
  return home?.provider === "google" && (home.role === "viewer" || (
    current.title === "Busy" && !current.description && !current.location && !current.url && !current.organizer
  ));
}

/** Replace copied provider values, retaining only changes made to the draft. */
export function refreshPrivateEditorValues(values: EventFormValues, baseline: Event, current: Event, owned: readonly PrivateEditorField[] = []): EventFormValues {
  const before = eventFormValues(baseline);
  const after = eventFormValues(current);
  const refreshed = { ...values };
  for (const field of privateEditorFields) {
    if (!owned.includes(field) && values[field] === before[field]) refreshed[field] = after[field];
  }
  return refreshed;
}

/** Keep the accepted write revision and occurrence geometry frozen. */
export function refreshPrivateEditorBaseline(baseline: Event, current: Event): Event {
  return { ...baseline, title: current.title, description: current.description, location: current.location, url: current.url, organizer: current.organizer, color: current.color };
}

export type PrivateEditorField = typeof privateEditorFields[number];

/** Ownership survives a copied baseline becoming equal to an authored value. */
export function rememberPrivateEditorChanges(before: EventFormValues, after: EventFormValues, owned: readonly PrivateEditorField[] = []): PrivateEditorField[] {
  return [...new Set([...owned, ...privateEditorFields.filter(field => before[field] !== after[field])])];
}

export function privateEditorSearch(values: EventFormValues, baseline?: Event) {
  const draftFields = baseline ? rememberPrivateEditorChanges(eventFormValues(baseline), values, values.privateDraftFields) : undefined;
  const field = (name: PrivateEditorField) => values[name] || (draftFields?.includes(name) ? "" : undefined);
  return { draftFields, title: field("title"), description: field("description"), location: field("location"), url: field("url") };
}
