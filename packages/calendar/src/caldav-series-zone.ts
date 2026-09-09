import { EventSchema, EventWriteError, type Event, type EventTimeEdit } from "@musubi/types";
import { finiteSeriesFootprint } from "./finite-series";
import { resolveEventTimeEdit } from "./time-edit";

/** A displayed occurrence can have a synthetic ID and only a partial family.
 * Check its explicit clock choice here; prove COUNT against the stored master
 * only after the scope request has translated the occurrence's anchors. */
export function assertCaldavUTCDraft(event: Event, time: EventTimeEdit): void {
  const source = event.timeModel;
  const target = resolveEventTimeEdit(time).timeModel;
  if (event.seriesID || event.originalStart || source?.kind !== "zoned" || target.kind !== "zoned" || source.timeZone === "UTC" || target.timeZone !== "UTC" ||
      source.startLocal !== target.startLocal || source.endLocal !== target.endLocal ||
      !/(?:^|;)COUNT=[1-9]\d*(?:;|$)/i.test(event.recurrence ?? "") || /[\r\n]/.test(event.recurrence ?? ""))
    throw new EventWriteError("event-write", "unsupported", "Choose UTC with unchanged local dates and times, then save the whole series.");
}

/** Explicit wall-clock conversion, not preservation of the old UTC instants.
 * Finite source and target proofs also reject skipped gaps, folds, and elapsed
 * durations which would change the requested local end time. */
export function assertCaldavSeriesUTCConversion(master: Event, time: EventTimeEdit): void {
  const refuse = (): never => { throw new EventWriteError("event-write", "unsupported", "Changing a CalDAV series zone requires UTC, unchanged local dates and times, and 1–366 unambiguous COUNT occurrences within 730 days. Save other changes separately."); };
  try {
    master = EventSchema.parse(master);
    assertCaldavUTCDraft(master, time);
    const before = finiteSeriesFootprint(master);
    const after = finiteSeriesFootprint({ ...master, ...resolveEventTimeEdit(time) });
    if (before.length !== after.length || before.some((slot, index) => {
      const other = after[index]!;
      return slot.timeModel.kind !== "zoned" || other.timeModel.kind !== "zoned" ||
        slot.timeModel.startLocal !== other.timeModel.startLocal || slot.timeModel.endLocal !== other.timeModel.endLocal;
    })) refuse();
  } catch { refuse(); }
}
