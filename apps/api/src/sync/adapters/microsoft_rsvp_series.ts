import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { EventSchema, microsoftRsvpDesiredState } from "@musubi/types";
import { graphOrganizerMasterTimeFromUtc, graphMasterForSavedZone } from "./microsoft_time";
import { recurrenceFromGraph } from "./microsoft_recurrence";
import { graphSeriesFootprint } from "./microsoft_series_footprint";
import { graphSeriesFamilyEvidence } from "./microsoft_series_family";
import { microsoftEventState } from "./provider_event_state";
import { ProviderEventWriteError } from "../event_write";
import {
  graphRsvpMasterNativeSchema,
  graphRsvpOccurrenceNativeSchema,
  microsoftRsvpEvidence,
  microsoftRsvpHash,
  matchesMicrosoftRsvp,
  type MicrosoftRsvpEvidence,
} from "./microsoft_rsvp";

const fail = (): never => {
  throw new ProviderEventWriteError("provider-conflict");
};
const expanded = () =>
  graphRsvpMasterNativeSchema.extend({
    exceptionOccurrences: z.array(graphRsvpOccurrenceNativeSchema).max(366),
    cancelledOccurrences: z.array(z.string().min(1)).max(366),
    "exceptionOccurrences@odata.nextLink": z.never().optional(),
    "cancelledOccurrences@odata.nextLink": z.never().optional(),
  });

/** Transient expansion template only. Never creates/adopts a local series. */
export function graphRsvpSeriesTemplate(master: unknown) {
  const item = expanded().parse(master);
  const time = graphOrganizerMasterTimeFromUtc(item); // Time parser, not an organizer grant.
  // The shared recurrence expander needs a UUID; this transient ID is never persisted.
  const template = EventSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    creatorID: "",
    organizer: item.organizer.emailAddress.address,
    title: item.subject,
    color: "",
    calendars: [],
    isCanceled: false,
    ...time,
  });
  // Normalize proven Windows/IANA labels only in the expansion candidate. The
  // original native family remains untouched in the durable baseline/readback.
  const candidate = expanded().parse(graphMasterForSavedZone(item, time));
  return { ...template, recurrence: recurrenceFromGraph(template, candidate.recurrence) };
}

// GET, /instances and expanded navigation properties have different envelopes.
// Compare every event field; these three annotations only describe transport.
function withoutEnvelope(input: Record<string, unknown>) {
  const item = structuredClone(input);
  for (const key of ["@odata.context", "calendar@odata.associationLink", "calendar@odata.navigationLink"])
    delete item[key];
  return item;
}

export function validateMicrosoftRsvpSeries(evidence: MicrosoftRsvpEvidence) {
  const master = expanded().parse(evidence.master);
  if (!evidence.occurrence || !evidence.series || master.id !== evidence.occurrence.externalSeriesID) fail();
  const template = graphRsvpSeriesTemplate(master);
  graphSeriesFamilyEvidence(master, evidence.series!, template, {
    externalEventId: master.id,
    icalUid: master.iCalUId,
  });
  const organizer = master.organizer.emailAddress.address.toLowerCase();
  for (const native of [master, ...evidence.series!, ...master.exceptionOccurrences]) {
    const item =
      native.type === "seriesMaster"
        ? graphRsvpMasterNativeSchema.parse(native)
        : graphRsvpOccurrenceNativeSchema.parse(native);
    const own = item.attendees.filter((person) => person.emailAddress.address.toLowerCase() === evidence.selfAddress);
    if (
      own.length !== 1 ||
      own[0]!.type === "resource" ||
      item.organizer.emailAddress.address.toLowerCase() !== organizer ||
      organizer === evidence.selfAddress ||
      item.attendees.some((person) => "proposedNewTime" in person) ||
      new Set(item.attendees.map((person) => person.emailAddress.address.toLowerCase())).size !== item.attendees.length
    )
      fail();
    microsoftRsvpDesiredState(
      microsoftEventState({ ...item, type: "singleInstance" }),
      evidence.selfAddress,
      evidence.response,
    );
  }
  const family = new Map(evidence.series!.map((item) => [item.id, item]));
  const target = family.get(evidence.id);
  if (!target || !isDeepStrictEqual(withoutEnvelope(target), withoutEnvelope(evidence.native))) fail();
  // Full raw exception proof as well as the shared normalized finite proof.
  for (const exception of master.exceptionOccurrences) {
    const listed = family.get(exception.id);
    if (listed && !isDeepStrictEqual(withoutEnvelope(listed), withoutEnvelope(exception))) fail();
  }
}

/** Opaque public preview version is independent of the user's later choice. */
export function microsoftRsvpSeriesVersion(evidence: MicrosoftRsvpEvidence) {
  validateMicrosoftRsvpSeries(evidence);
  return microsoftRsvpHash({ ...evidence, response: "accepted" });
}

function asSingle(input: Record<string, unknown>) {
  const item = withoutEnvelope(input);
  for (const key of ["seriesMasterId", "originalStart", "exceptionOccurrences", "cancelledOccurrences"])
    delete item[key];
  return { ...item, type: "singleInstance", recurrence: null };
}
function unchangedException(before: Record<string, unknown>, after: Record<string, unknown>) {
  const clean = (value: Record<string, unknown>) => {
    const item = graphRsvpOccurrenceNativeSchema.parse(withoutEnvelope(value));
    for (const key of ["@odata.etag", "changeKey", "lastModifiedDateTime"])
      delete (item as Record<string, unknown>)[key];
    delete item.responseStatus.time; // Graph refreshes this while preserving the override.
    return item;
  };
  return isDeepStrictEqual(clean(before), clean(after));
}
export function matchesMicrosoftSeriesRsvp(before: MicrosoftRsvpEvidence, after: MicrosoftRsvpEvidence) {
  try {
    validateMicrosoftRsvpSeries(before);
    validateMicrosoftRsvpSeries(after);
    if (
      !isDeepStrictEqual(before.occurrence, after.occurrence) ||
      before.id !== after.id ||
      before.selfAddress !== after.selfAddress ||
      before.response !== after.response
    )
      return false;
    const first = expanded().parse(before.master),
      next = expanded().parse(after.master);
    if (
      !isDeepStrictEqual(first.recurrence, next.recurrence) ||
      !isDeepStrictEqual(first.cancelledOccurrences, next.cancelledOccurrences)
    )
      return false;
    const answered = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      a.type === b.type &&
      matchesMicrosoftRsvp(microsoftRsvpEvidence(asSingle(a), before.selfAddress, before.response), asSingle(b));
    if (!answered(first, next)) return false;
    const sameMembers = (a: Record<string, unknown>[], b: Record<string, unknown>[]) => {
      const byID = new Map(b.map((item) => [item.id, item]));
      return (
        a.length === b.length &&
        byID.size === b.length &&
        a.every((item) => {
          const observed = byID.get(item.id);
          return (
            !!observed &&
            item.type === observed.type &&
            item.originalStart === observed.originalStart &&
            item.seriesMasterId === observed.seriesMasterId &&
            (item.type === "exception" ? unchangedException(item, observed) : answered(item, observed))
          );
        })
      );
    };
    return (
      sameMembers(first.exceptionOccurrences, next.exceptionOccurrences) && sameMembers(before.series!, after.series!)
    );
  } catch {
    return false;
  }
}

/** Complete finite range, paginated /instances and repeated expanded master.
 * Exceptions moved outside the range come from the expanded master. Neither
 * repeated reads nor an ETag constitute an atomic remote-family snapshot. */
export async function readMicrosoftRsvpSeries(
  get: (url: string, missing?: boolean) => Promise<any>,
  masterURL: string,
) {
  const url = masterURL + "?$select=*,cancelledOccurrences,exceptionOccurrences&$expand=exceptionOccurrences";
  const first = await get(url, true);
  if (!first) return null;
  const master = expanded().parse(first),
    template = graphRsvpSeriesTemplate(master),
    slots = graphSeriesFootprint(template);
  const path = masterURL + "/instances",
    query = new URL(path);
  query.searchParams.set("startDateTime", slots[0]!.start.toISOString());
  query.searchParams.set(
    "endDateTime",
    new Date(Math.max(...slots.map((slot) => slot.end.getTime() + (slot.isAllDay ? 86400000 : 0)))).toISOString(),
  );
  query.searchParams.set("$select", "*,originalStart");
  query.searchParams.set("$top", "100");
  const visited = new Set<string>(),
    values: Record<string, unknown>[] = [];
  let next: string | undefined = query.href,
    total: number | undefined;
  const schema = z.object({
    value: z.array(graphRsvpOccurrenceNativeSchema),
    "@odata.nextLink": z.string().optional(),
    "@odata.count": z.number().int().nonnegative().optional(),
  });
  while (next) {
    const pageURL = new URL(next);
    if (
      pageURL.origin !== query.origin ||
      pageURL.pathname !== query.pathname ||
      pageURL.username ||
      pageURL.password ||
      pageURL.hash ||
      visited.has(next) ||
      visited.size >= 366
    )
      fail();
    visited.add(next);
    const page = schema.parse(await get(next));
    if (page["@odata.count"] !== undefined) {
      if (total !== undefined && total !== page["@odata.count"]) fail();
      total = page["@odata.count"];
    }
    values.push(...page.value);
    if (values.length > slots.length) fail();
    next = page["@odata.nextLink"];
  }
  if (total !== undefined && total !== values.length) fail();
  graphSeriesFamilyEvidence(first, values, template, { externalEventId: master.id, icalUid: master.iCalUId });
  const byID = new Map(values.map((item) => [item.id, item]));
  if (byID.size !== values.length) fail();
  for (const exception of master.exceptionOccurrences) {
    const listed = byID.get(exception.id);
    if (listed && !isDeepStrictEqual(withoutEnvelope(listed), withoutEnvelope(exception))) fail();
    byID.set(exception.id, exception);
  }
  const again = await get(url);
  if (!isDeepStrictEqual(first, again)) fail();
  return {
    master: first as Record<string, unknown>,
    instances: [...byID.values()].sort((a, b) => String(a.originalStart).localeCompare(String(b.originalStart))),
  };
}
