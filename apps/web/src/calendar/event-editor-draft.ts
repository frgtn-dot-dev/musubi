import { EventSchema, type Event } from "@musubi/types";

// Content in the URL can survive reload; write authority cannot. A full-editor
// handoff retains its original snapshot in this tab, never the latest query row.
const baselines = new Map<string, Event>();
export function handoffEventEditor(event: Event) {
  baselines.set(event.id, structuredClone(EventSchema.parse(event)));
}
export function eventEditorBaseline(id: string) {
  return baselines.get(id);
}
export function clearEventEditorBaseline(id: string) {
  baselines.delete(id);
}
