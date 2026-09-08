import { EventTimeEditSchema, type EventTimeModel } from "@musubi/types";
import { civilToInstant } from "./time-zone";

export type ResolvedEventTimeEdit = {
  start: Date;
  end: Date;
  isAllDay: boolean;
  timeModel: EventTimeModel;
};

/** Resolve a complete explicit time intent before the authoritative CAS write.
 * This pure function cannot change identity, recurrence, revisions or storage.
 */
export function resolveEventTimeEdit(input: unknown): ResolvedEventTimeEdit {
  const edit = EventTimeEditSchema.parse(input);
  if (edit.kind === "all-day") {
    return {
      start: new Date(`${edit.startDate}T00:00:00.000Z`),
      end: new Date(`${edit.endDate}T00:00:00.000Z`),
      isAllDay: true,
      timeModel: { kind: "all-day" },
    };
  }
  // Floating has no authoritative instant. UTC is only a deterministic disk/
  // legacy compatibility projection; consumers resolve the civil model anew.
  const zone = edit.kind === "zoned" ? edit.timeZone : "UTC";
  const start = civilToInstant(edit.startLocal, zone, "explicit")!;
  const end = civilToInstant(edit.endLocal, zone, "explicit")!;
  if (end < start)
    throw new RangeError("The resolved event end must not precede its start.");
  return { start, end, isAllDay: false, timeModel: edit };
}
