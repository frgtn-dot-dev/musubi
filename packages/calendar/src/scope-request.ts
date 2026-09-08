import { EventScopeRequestSchema, EventTimeContentPatchSchema, eventContentPatch, hasKnownEventTime, requireEventRevision, type Event, type EventScopeRequest, type EventTimeEdit, type EventWriteRequest } from "@musubi/types";
import type { EditScope } from "./recurrence-edit";

const pending = new WeakMap<Event, Map<string, string>>();
/** Keep the operation identity while retrying the same frozen draft. */
export function eventScopeRequest(master: Event, occurrence: Event, scope: EditScope, edited?: EventWriteRequest, newID: () => string = () => crypto.randomUUID(), ensureDefinition = false): EventScopeRequest {
  if (!master.recurrence || !hasKnownEventTime(master)) throw new Error("Refresh this series with an explicit time model before using scope editing.");
  if ((!edited || edited.timeEdit || scope !== "series") && !occurrence.seriesID && requireEventRevision(occurrence) !== requireEventRevision(master)) throw new Error("The series changed since this occurrence was opened. Refresh and reopen it.");
  if (occurrence.seriesID && occurrence.seriesID !== master.id) throw new Error("The occurrence belongs to a different series.");
  const model = occurrence.timeModel;
  const originalStart = occurrence.originalStart ?? (model?.kind === "all-day" ? { kind: "date", value: occurrence.start.toISOString().slice(0, 10) } : model?.kind === "floating" ? { kind: "floating", value: model.startLocal } : { kind: "instant", value: occurrence.start.toISOString() });
  let time = edited?.timeEdit;
  if (edited && !time && (edited.start.getTime() !== occurrence.start.getTime() || edited.end.getTime() !== occurrence.end.getTime())) throw new Error("This move needs an explicit civil time intent.");
  if (time && scope === "series") {
    const base = master.timeModel;
    if (!base || base.kind === "legacy-unknown" || !model || model.kind === "legacy-unknown" || base.kind !== time.kind || model.kind !== time.kind || (base.kind === "zoned" && time.kind === "zoned" && (base.timeZone !== time.timeZone || (model.kind === "zoned" && model.timeZone !== time.timeZone)))) throw new Error("Save changes to the series time type or zone from its master.");
    const anchors = (event: Event) => event.timeModel?.kind === "all-day" ? [event.start.toISOString().slice(0, 10) + "T00:00:00.000", event.end.toISOString().slice(0, 10) + "T00:00:00.000"] : [(event.timeModel as { startLocal: string }).startLocal, (event.timeModel as { endLocal: string }).endLocal];
    const [a, b] = anchors(master); const [c, d] = anchors(occurrence);
    const [e, f] = time.kind === "all-day" ? [time.startDate + "T00:00:00.000", time.endDate + "T00:00:00.000"] : [time.startLocal, time.endLocal];
    const shift = (anchor: string, old: string, next: string) => new Date(Date.parse(anchor + "Z") + Date.parse(next + "Z") - Date.parse(old + "Z")).toISOString().slice(0, -1);
    const start = shift(a!, c!, e); const end = shift(b!, d!, f);
    time = time.kind === "all-day" ? { kind: "all-day", startDate: start.slice(0, 10), endDate: end.slice(0, 10) } : { ...time, startLocal: start, endLocal: end } as EventTimeEdit;
  }
  let patch;
  if (edited) {
    const { start: _start, end: _end, isAllDay: _allDay, ...content } = eventContentPatch(occurrence, edited);
    patch = EventTimeContentPatchSchema.parse(content);
  }
  const intent = { expectedRevision: requireEventRevision(master), scope, ...(scope === "series" ? {} : { originalStart, expectedOccurrenceRevision: occurrence.seriesID ? requireEventRevision(occurrence) : null }), ...(edited ? { action: "update", patch, ...(ensureDefinition && scope !== "series" ? { ensureDefinition: true } : {}), ...(time ? { time } : {}) } : { action: "delete" }) };
  const key = JSON.stringify({ master: master.id, intent });
  const owner = occurrence;
  let requests = pending.get(owner);
  if (!requests) { requests = new Map(); pending.set(owner, requests); }
  let operationID = requests.get(key);
  if (!operationID) { operationID = newID(); requests.set(key, operationID); }
  return EventScopeRequestSchema.parse({ ...intent, operationID });
}
