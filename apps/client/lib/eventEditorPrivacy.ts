import type { Calendar, Event } from "@musubi/types";

// Ephemeral observation metadata belongs to the opened snapshot, never the
// Event DTO or its accepted write revision. Weak keys disappear with the draft.
const privacyObservations = new WeakMap<Event, { revision: number; sourceID: string }>();

export function clearedPrivateEvent(event: Event): Event {
  return { ...event, title: "Busy", description: null, location: null, url: null, organizer: "" };
}

/** A role update alone is not confirmation of new readable content. Keep the
 * accepted temporal tuple and revision even when replacing private fields. */
export function privateEditorRefresh(snapshot: Event | undefined, current: Event | undefined, calendars: Calendar[], removed = false): Event | undefined {
  if (!snapshot) return;
  if (removed) {
    const cleared = clearedPrivateEvent(snapshot);
    return samePrivateDetails(snapshot, cleared) ? undefined : cleared;
  }
  const observed = privacyObservations.get(snapshot);
  if (!current || current.id !== snapshot.id || (current.revision ?? 0) <= Math.max(snapshot.revision ?? 0, observed?.revision ?? 0)) return;
  const source = calendars.find(calendar => calendar.id === current.originCalendarID);
  if (!source || !["google", "microsoft", "caldav"].includes(source.provider ?? "") || !((current.providerReadRetiredRevision ?? 0) > (snapshot.revision ?? 0) || observed?.sourceID === source.id || (source.provider === "google" && source.role === "viewer") || (
    current.title === "Busy" && !current.description && !current.location && !current.url && !current.organizer
  ))) return;
  const refreshed = { ...snapshot, providerReadRetiredRevision: current.providerReadRetiredRevision, title: current.title, description: current.description, location: current.location, url: current.url, organizer: current.organizer, color: current.color };
  privacyObservations.set(refreshed, { revision: current.revision ?? 0, sourceID: source.id });
  return refreshed;
}

/** Only unchanged copied values follow the provider. An explicit field delta,
 * including clearing an old value, belongs to the person's unsaved draft. */
export function refreshedPrivateField(value: string, before: string | null | undefined, after: string | null | undefined) {
  return value === (before ?? "") ? after ?? "" : value;
}

function samePrivateDetails(a: Event, b: Event) {
  return a.title === b.title && a.description === b.description && a.location === b.location && a.url === b.url && a.organizer === b.organizer && a.color === b.color;
}
