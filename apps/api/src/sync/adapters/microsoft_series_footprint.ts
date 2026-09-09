import { finiteSeriesFootprint, FINITE_SERIES_MAX_DAYS, FINITE_SERIES_MAX_OCCURRENCES, type FiniteSeriesOccurrence } from "@musubi/calendar";
import { EventWriteError, type Event } from "@musubi/types";
import { graphRecurrenceForEvent, recurrenceFromGraph } from "./microsoft_recurrence";
import { graphTimeForEvent } from "./microsoft_time";

export const GRAPH_SERIES_MAX_OCCURRENCES = FINITE_SERIES_MAX_OCCURRENCES;
export const GRAPH_SERIES_MAX_DAYS = FINITE_SERIES_MAX_DAYS;
export type GraphSeriesOccurrence = FiniteSeriesOccurrence;

/** Native shape plus complete finite original-slot proof, shared with durable
 * admission and full-family persistence. No window absence implies cancellation. */
export function graphSeriesFootprint(event: Event): GraphSeriesOccurrence[] {
  const candidate = graphRecurrenceForEvent(event);
  // Both directions must remain exact before any permission read or POST. In
  // particular an endDate must have a representable, unambiguous RRULE cutoff.
  const nativeRule = recurrenceFromGraph(event, candidate);
  const slots = finiteSeriesFootprint(event);
  const nativeSlots = finiteSeriesFootprint({ ...event, recurrence: nativeRule });
  if (JSON.stringify(slots) !== JSON.stringify(nativeSlots)) {
    throw new EventWriteError("recurrence", "unsupported", "Outlook finite recurrence does not preserve the saved original slots.");
  }
  for (const slot of slots) graphTimeForEvent(slot);
  return slots;
}
