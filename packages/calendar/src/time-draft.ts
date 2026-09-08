import { editedEvent, EventTimeModelSchema, type Event, type EventTimeEdit, type EventWriteRequest } from "@musubi/types";
import { resolveEventTimeEdit } from "./time-edit";

export type EventTimeDraft = {
  timeLabel?: string;
  date: string; startTime: string; endDate: string; endTime: string; isAllDay: boolean;
};

/** A known model's civil anchors, never a round trip through the viewer's zone. */
export function knownEventTimeDraft(event: Event): EventTimeDraft | null {
  const model = event.timeModel && EventTimeModelSchema.parse(event.timeModel);
  if (!model || model.kind === "legacy-unknown") return null;
  const start = model.kind === "all-day" ? event.start.toISOString() : model.startLocal;
  const end = model.kind === "all-day" ? event.end.toISOString() : model.endLocal;
  return { timeLabel: model.kind === "zoned" ? model.timeZone : model.kind === "floating" ? "Floating local time" : "All-day dates", date: start.slice(0, 10), startTime: start.slice(11, 16), endDate: end.slice(0, 10), endTime: end.slice(11, 16), isAllDay: model.kind === "all-day" };
}

export function editKnownEventTime(event: Event, edited: Event, draft: EventTimeDraft): EventWriteRequest {
  const original = knownEventTimeDraft(event);
  if (!original) throw new Error("Choose an explicit time zone before changing this event's time. No changes were saved.");
  if (draft.isAllDay !== original.isAllDay)
    throw new Error("Changing this event's time type is not supported yet. No changes were saved.");
  if ((event.recurrence ?? null) !== (edited.recurrence ?? null))
    throw new Error("Changing this event's recurrence requires a time-aware scope edit. No changes were saved.");
  const fields = ["date", "startTime", "endDate", "endTime", "isAllDay"] as const;
  if (fields.every(key => draft[key] === original[key]))
    return editedEvent(event, { ...edited, start: event.start, end: event.end, isAllDay: event.isAllDay, timeModel: event.timeModel });
  if (event.recurrence || event.seriesID || event.originalStart)
    throw new Error("This time change requires an occurrence-aware scope edit. No changes were saved.");
  const model = EventTimeModelSchema.parse(event.timeModel);
  let time: EventTimeEdit;
  if (model.kind === "all-day") time = { kind: "all-day", startDate: draft.date, endDate: draft.endDate };
  else if (model.kind === "zoned" || model.kind === "floating") {
    // Date-only edits retain precision hidden by minute-level controls.
    const civil = (date: string, minute: string, baseline: string) => `${date}T${minute}${minute === baseline.slice(11, 16) ? baseline.slice(16) : ":00.000"}`;
    time = { ...model, startLocal: civil(draft.date, draft.startTime, model.startLocal), endLocal: civil(draft.endDate, draft.endTime, model.endLocal) };
  } else throw new Error("An explicit time model is required. No changes were saved.");
  try {
    const resolved = resolveEventTimeEdit(time);
    return { ...editedEvent(event, { ...edited, ...resolved }), timeEdit: time };
  } catch {
    throw new Error("Enter valid dates and times with the end after the start. No changes were saved.");
  }
}
