import { BadRequestError } from "@musubi/types";
import type { NewEvent } from "../schema";
import type { EventContentPatch } from "./events";

/** Current writers carry no coherent time-model update or occurrence scope.
 * Check the actual diff while holding the authoritative event lock, before
 * writing content, links or an accepted provider validator. A later metadata-
 * aware writer must replace this gate with atomic model/scope validation.
 */
export function assertLegacyEventTimePatch(
  current: Pick<NewEvent, "timeModel" | "seriesID" | "originalStart">,
  patch: EventContentPatch,
) {
  const protectedTime =
    (current.timeModel != null &&
      current.timeModel.kind !== "legacy-unknown") ||
    current.seriesID != null ||
    current.originalStart != null;
  if (
    protectedTime &&
    (["start", "end", "isAllDay", "recurrence"] as const).some(
      (field) => patch[field] !== undefined,
    )
  ) {
    throw new BadRequestError(
      "This event requires a time-model-aware edit to change its time or recurrence. No changes were saved.",
    );
  }
}
