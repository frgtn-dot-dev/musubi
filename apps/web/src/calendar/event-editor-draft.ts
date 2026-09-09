import { EventSchema, type Event } from "@musubi/types";

// Content in the URL can survive reload; write authority cannot. A full-editor
// handoff retains its original write snapshot in this tab. A confirmed privacy
// refresh may clear copied fields without upgrading that write revision.
const baselines = new Map<string, Event>();
const privacyRefreshed = new Set<string>();
export function handoffEventEditor(event: Event, redacted = false) {
  baselines.set(event.id, structuredClone(EventSchema.parse(event)));
  if (redacted) privacyRefreshed.add(event.id);
  else privacyRefreshed.delete(event.id);
}
export function eventEditorBaseline(id: string) {
  return baselines.get(id);
}
export function eventEditorBaselineRedacted(id: string) {
  return privacyRefreshed.has(id);
}
export function clearEventEditorBaseline(id: string) {
  privacyRefreshed.delete(id);
  baselines.delete(id);
}
