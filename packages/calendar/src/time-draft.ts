import { assertSeriesTimeEdit } from "./series-time-edit";
import {
  editedEvent,
  EventTimeModelSchema,
  type Event,
  type EventTimeEdit,
  type EventWriteRequest,
} from "@musubi/types";
import { resolveEventTimeEdit } from "./time-edit";

export type EventTimeDraft = {
  timeLabel?: string;
  timeKind?: "legacy-unknown" | "zoned" | "floating" | "all-day";
  timeZone?: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  isAllDay: boolean;
};

function fields(start: string, end: string, isAllDay: boolean) {
  return {
    date: start.slice(0, 10),
    startTime: start.slice(11, 16),
    endDate: end.slice(0, 10),
    endTime: end.slice(11, 16),
    isAllDay,
  };
}

/** A known model's civil anchors, never a round trip through the viewer's zone. */
export function knownEventTimeDraft(event: Event): EventTimeDraft | null {
  const model = event.timeModel && EventTimeModelSchema.parse(event.timeModel);
  if (!model || model.kind === "legacy-unknown") return null;
  const start =
    model.kind === "all-day" ? event.start.toISOString() : model.startLocal;
  const end =
    model.kind === "all-day" ? event.end.toISOString() : model.endLocal;
  return {
    timeKind: model.kind,
    timeZone: model.kind === "zoned" ? model.timeZone : undefined,
    timeLabel:
      model.kind === "zoned"
        ? model.timeZone
        : model.kind === "floating"
          ? "Floating local time"
          : "All-day dates",
    ...fields(start, end, model.kind === "all-day"),
  };
}

// Legacy display matches the existing device-local editor. This is not a stored
// zone inference: adopting these visible values requires an explicit model/zone.
function legacyCivil(value: Date) {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`;
}
export function legacyEventTimeDraft(event: Pick<Event, "start" | "end" | "isAllDay">): EventTimeDraft {
  return {
    timeKind: "legacy-unknown",
    ...fields(
      event.isAllDay ? event.start.toISOString() : legacyCivil(event.start),
      event.isAllDay ? event.end.toISOString() : legacyCivil(event.end),
      event.isAllDay,
    ),
  };
}

export function chooseEventTimeKind<T extends EventTimeDraft>(
  draft: T,
  kind: "zoned" | "floating" | "all-day",
): T {
  return {
    ...draft,
    timeKind: kind,
    isAllDay: kind === "all-day",
    timeLabel:
      kind === "zoned"
        ? draft.timeZone || "Choose an event time zone"
        : kind === "floating"
          ? "Floating local time"
          : "All-day dates",
  };
}

export function editEventTimeDraft(
  event: Event,
  edited: Event,
  draft: EventTimeDraft,
): EventWriteRequest {
  const known = knownEventTimeDraft(event);
  const original = known ?? legacyEventTimeDraft(event);
  const kind = draft.timeKind ?? known?.timeKind;
  if (!kind || kind === "legacy-unknown") {
    if (known)
      throw new Error(
        "A known time model cannot be removed. No changes were saved.",
      );
    return editedEvent(event, edited);
  }
  if (draft.isAllDay !== (kind === "all-day"))
    throw new Error(
      "Choose a consistent time type before saving. No changes were saved.",
    );
  if (!event.recurrence && !event.seriesID && (event.recurrence ?? null) !== (edited.recurrence ?? null))
    throw new Error(
      "Changing this event's recurrence requires a time-aware scope edit. No changes were saved.",
    );
  const zone = (
    draft.timeZone ??
    (event.timeModel?.kind === "zoned" ? event.timeModel.timeZone : undefined)
  )?.trim();
  const fields = [
    "date",
    "startTime",
    "endDate",
    "endTime",
    "isAllDay",
  ] as const;
  if (
    known &&
    kind === known.timeKind &&
    (kind !== "zoned" || zone === known.timeZone) &&
    fields.every((key) => draft[key] === original[key])
  )
    return editedEvent(event, {
      ...edited,
      start: event.start,
      end: event.end,
      isAllDay: event.isAllDay,
      timeModel: event.timeModel,
    });
  let time: EventTimeEdit;
  if (kind === "all-day")
    time = { kind: "all-day", startDate: draft.date, endDate: draft.endDate };
  else {
    if (kind === "zoned" && !zone?.trim())
      throw new Error(
        "Enter an explicit event time zone, such as Europe/Prague. No changes were saved.",
      );
    const model = event.timeModel;
    const start =
      model?.kind === "zoned" || model?.kind === "floating"
        ? model.startLocal
        : event.isAllDay
          ? event.start.toISOString().slice(0, -1)
          : legacyCivil(event.start);
    const end =
      model?.kind === "zoned" || model?.kind === "floating"
        ? model.endLocal
        : event.isAllDay
          ? event.end.toISOString().slice(0, -1)
          : legacyCivil(event.end);
    // Only changed minute fields replace precision hidden by the controls.
    const civil = (date: string, minute: string, baseline: string) =>
      `${date}T${minute}${minute === baseline.slice(11, 16) ? baseline.slice(16) : ":00.000"}`;
    const anchors = {
      startLocal: civil(draft.date, draft.startTime, start),
      endLocal: civil(draft.endDate, draft.endTime, end),
    };
    time =
      kind === "zoned"
        ? { kind, timeZone: zone!.trim(), ...anchors }
        : { kind, ...anchors };
  }

  if (event.recurrence) assertSeriesTimeEdit(event, time);
  try {
    const resolved = resolveEventTimeEdit(time);
    return {
      ...editedEvent(event, { ...edited, ...resolved }),
      timeEdit: time,
    };
  } catch {
    throw new Error(
      "Enter a valid time zone, dates and times with the end on or after the start. No changes were saved.",
    );
  }
}

/** New definitions have no saved recurrence scope to transform. */
export function createEventTimeDraft(event: Event, draft: EventTimeDraft): EventWriteRequest {
  if (!draft.timeKind || draft.timeKind === "legacy-unknown") return event;
  const baseline = { ...event, recurrence: null, timeModel: null, seriesID: null, originalStart: null, revision: undefined };
  const { contentPatch, ...request } = editEventTimeDraft(baseline, baseline, draft);
  return { ...request, recurrence: event.recurrence };
}
