import { googleReminderEventEvidence } from "./google";
import type { GoogleRsvpEvidence } from "./google_rsvp";

/** Temporal projection follows full RSVP identity verification. Strip identity
 * only from a temporary normalization input; the frozen native baseline used by
 * the conditional writer remains intact. No zone is invented for an instance. */
export function googleRsvpEventEvidence(evidence: GoogleRsvpEvidence) {
  if (!evidence.occurrence) return googleReminderEventEvidence(evidence.baseline);
  const { recurringEventId: _series, originalStartTime: _original, ...content } = evidence.baseline;
  const native = googleReminderEventEvidence(content);
  return { ...native, externalSeriesID: evidence.occurrence.externalSeriesID, originalStart: evidence.occurrence.originalStart };
}
