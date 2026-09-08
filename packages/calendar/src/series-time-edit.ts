import {
  editedEvent,
  EventTimeEditSchema,
  EventTimeModelSchema,
  type Event,
  type EventTimeEdit,
  type EventWriteRequest,
} from "@musubi/types";
import { resolveEventTimeEdit } from "./time-edit";

const unsupported = () =>
  new Error(
    "Only the whole series, with the same time type and zone and no explicit dates or exceptions, supports this time change. No changes were saved.",
  );

/** This slice changes anchors of a local master; it cannot reinterpret dated
 * exclusions/additions, detached identities, or another time model. */
export function assertSeriesTimeEdit(event: Event, time: EventTimeEdit) {
  const model = event.timeModel && EventTimeModelSchema.parse(event.timeModel);
  const rule = event.recurrence?.trim().replace(/^RRULE:/i, "");
  if (
    !model ||
    model.kind === "legacy-unknown" ||
    event.seriesID ||
    event.originalStart ||
    model.kind !== time.kind ||
    (model.kind === "zoned" &&
      time.kind === "zoned" &&
      model.timeZone !== time.timeZone) ||
    (rule !== undefined && (!/(^|;)FREQ=/i.test(rule) || /[:\r\n]/.test(rule)))
  )
    throw unsupported();
}

function anchors(event: Event): [string, string] {
  const model = event.timeModel && EventTimeModelSchema.parse(event.timeModel);
  if (!model || model.kind === "legacy-unknown") throw unsupported();
  return model.kind === "all-day"
    ? [
        event.start.toISOString().slice(0, 10) + "T00:00:00.000",
        event.end.toISOString().slice(0, 10) + "T00:00:00.000",
      ]
    : [model.startLocal, model.endLocal];
}

/** Move the stored anchors by the edit's CIVIL displacement from the tapped
 * occurrence. UTC suffixes below are only coordinates for calendar arithmetic,
 * never an inferred timezone or an elapsed-instant shift across DST. */
export function wholeSeriesTimeEdit(
  master: Event,
  occurrence: Event,
  edited: EventWriteRequest,
  scope: string,
): EventWriteRequest {
  if (
    scope !== "series" ||
    !edited.timeEdit ||
    !master.recurrence ||
    (edited.recurrence ?? null) !== (master.recurrence ?? null)
  )
    throw unsupported();
  if (master.revision !== occurrence.revision)
    throw new Error(
      "The series changed since this occurrence was displayed. Refresh and reopen it before changing its time. No changes were saved.",
    );
  const intent = EventTimeEditSchema.parse(edited.timeEdit);
  assertSeriesTimeEdit(master, intent);
  assertSeriesTimeEdit(occurrence, intent);
  const [masterStart, masterEnd] = anchors(master);
  const [oldStart, oldEnd] = anchors(occurrence);
  const [newStart, newEnd] =
    intent.kind === "all-day"
      ? [intent.startDate + "T00:00:00.000", intent.endDate + "T00:00:00.000"]
      : [intent.startLocal, intent.endLocal];
  const shift = (base: string, old: string, next: string) =>
    new Date(
      Date.parse(base + "Z") + Date.parse(next + "Z") - Date.parse(old + "Z"),
    )
      .toISOString()
      .slice(0, -1);
  const start = shift(masterStart, oldStart, newStart);
  const end = shift(masterEnd, oldEnd, newEnd);
  const time: EventTimeEdit =
    intent.kind === "all-day"
      ? {
          kind: "all-day",
          startDate: start.slice(0, 10),
          endDate: end.slice(0, 10),
        }
      : { ...intent, startLocal: start, endLocal: end };
  const resolved = resolveEventTimeEdit(time);
  return {
    ...editedEvent(master, {
      ...edited,
      ...resolved,
      id: master.id,
      revision: master.revision,
    }),
    timeEdit: time,
  };
}
