import ICAL from "ical.js";
import { isDeepStrictEqual } from "node:util";
import { resolveEventTimeEdit } from "@musubi/calendar";
import {
  CivilDateTimeSchema,
  EventWriteError,
  type CaldavOrganizerRequest,
} from "@musubi/types";
import { caldavEventCreateIdentity } from "../event_create_identity";
import { requireEventEtag, ProviderEventWriteError } from "../event_write";
import type { CaldavSchedulingProof } from "../caldav_scheduling";
import { replaceEventProperties } from "./caldav_event_ical";
import { caldavRsvpParameter } from "./caldav_rsvp";
import { canonicalCaldavResource } from "./caldav_series";
import { normalizeCaldavResource } from "./caldav_time";
import { caldavEventState } from "./provider_event_state";

function fail(): never {
  throw new EventWriteError(
    "organizer",
    "unsupported",
    "A complete one-off organizer meeting with verified server scheduling is required.",
  );
}
const address = (value: unknown): string =>
  typeof value === "string" && /^mailto:[^\s<>@]+@[^\s<>@]+$/i.test(value)
    ? value.toLowerCase()
    : fail();
export type CaldavOrganizerNative = {
  id: string;
  etag: string;
  iCalUID: string;
  scheduleTag: string;
  data: string;
  proof: CaldavSchedulingProof;
};
export function caldavOrganizerNative(value: CaldavOrganizerNative) {
  requireEventEtag(value.etag);
  requireEventEtag(value.scheduleTag);
  const { proof, data } = value;
  if (
    proof.principal !== proof.owner ||
    !proof.addresses.length ||
    new Set(proof.addresses).size !== proof.addresses.length
  )
    fail();
  replaceEventProperties(data, 0, new Map());
  const calendar = new ICAL.Component(ICAL.parse(data)),
    components = calendar.getAllSubcomponents("vevent");
  if (
    calendar.name !== "vcalendar" ||
    calendar.hasProperty("method") ||
    components.length !== 1 ||
    calendar
      .getAllSubcomponents()
      .some((item) => !["vevent", "vtimezone"].includes(item.name))
  )
    fail();
  const event = components[0]!;
  for (const name of ["rrule", "rdate", "exdate", "recurrence-id"])
    if (event.hasProperty(name)) fail();
  for (const name of [
    "uid",
    "organizer",
    "dtstart",
    "dtend",
    "duration",
    "status",
    "dtstamp",
    "sequence",
    "summary",
    "description",
    "location",
  ])
    if (event.getAllProperties(name).length > 1) fail();
  if (
    event.getFirstPropertyValue("uid") !== value.iCalUID ||
    String(event.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED"
  )
    fail();
  const organizer = event.getFirstProperty("organizer");
  if (!organizer) fail();
  const own = address(organizer.getFirstValue());
  if (!proof.addresses.includes(own)) fail();
  const attendees = event.getAllProperties("attendee");
  if (!attendees.length || attendees.length > 101) fail();
  const addresses = attendees.map((item) => address(item.getFirstValue()));
  if (
    new Set(addresses).size !== addresses.length ||
    !addresses.some((item) => !proof.addresses.includes(item)) ||
    addresses.some((item) => proof.addresses.includes(item) && item !== own)
  )
    fail();
  for (const person of [organizer, ...attendees]) {
    if (
      ["sent-by", "delegated-from", "delegated-to", "schedule-force-send"].some(
        (name) => person.getParameter(name) !== undefined,
      ) ||
      ![undefined, "SERVER"].includes(
        person.getParameter("schedule-agent")?.toString().toUpperCase(),
      )
    )
      fail();
    if (
      ["ROOM", "RESOURCE"].includes(
        person.getParameter("cutype")?.toString().toUpperCase() ?? "",
      )
    )
      fail();
  }
  // Validate every participant's physical parameter header without changing it.
  caldavRsvpParameter(data, "organizer", 0, "schedule-status");
  attendees.forEach((_, i) =>
    caldavRsvpParameter(data, "attendee", i, "schedule-status"),
  );
  const rawStamps = data
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .filter((line) => /^DTSTAMP[:;]/i.test(line));
  if (rawStamps.length) {
    if (
      rawStamps.length !== 1 ||
      !/^DTSTAMP:\d{8}T\d{6}Z$/i.test(rawStamps[0]!)
    )
      fail();
    stamp(rawStamps[0]!.slice(8));
  }
  if (Object.keys(event.getFirstProperty("sequence")?.toJSON()[1] ?? {}).length)
    fail();
  const sequence = event.getFirstPropertyValue("sequence");
  if (
    sequence != null &&
    (!Number.isInteger(sequence) ||
      Number(sequence) < 0 ||
      Number(sequence) > 2147483647)
  )
    fail();
  const normalized = normalizeCaldavResource({
    url: value.id,
    etag: value.etag,
    data,
  });
  const projection = normalized[0];
  if (
    normalized.length !== 1 ||
    !projection ||
    !["zoned", "all-day"].includes(projection.timeModel?.kind ?? "") ||
    (!projection.isAllDay && projection.end <= projection.start)
  )
    fail();
  return { ...value, projection, state: caldavEventState(event) };
}
function property(name: string, value: string) {
  const prop = new ICAL.Property(name);
  prop.setValue(value);
  return prop;
}
function stamp(value: string) {
  if (!/^\d{8}T\d{6}Z$/.test(value)) fail();
  CivilDateTimeSchema.parse(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`,
  );
  const parsed = ICAL.Time.fromDateTimeString(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
  );
  return parsed;
}
export type CaldavOrganizerDesired = {
  id: string;
  iCalUID: string;
  data: string;
  proof: CaldavSchedulingProof;
  stamp: string;
};
export function caldavOrganizerDesired(
  collection: string,
  request: CaldavOrganizerRequest,
  baseline: CaldavOrganizerNative | null,
  proof: CaldavSchedulingProof,
  timestamp: string,
): CaldavOrganizerDesired | null {
  stamp(timestamp);
  if (request.action === "delete") {
    if (!baseline) fail();
    return null;
  }
  if (request.action === "create") {
    if (
      baseline ||
      proof.addresses.length !== 1 ||
      request.guests.some((guest) =>
        proof.addresses.includes(`mailto:${guest.email}`),
      )
    )
      fail();
    let time;
    try {
      time = resolveEventTimeEdit(request.time);
    } catch (error) {
      if (error instanceof RangeError) fail();
      throw error;
    }
    if (
      time.timeModel.kind !== "all-day" &&
      (time.timeModel.kind !== "zoned" ||
        time.timeModel.timeZone !== "UTC" ||
        time.end <= time.start)
    )
      fail();
    const { uid, url } = caldavEventCreateIdentity(collection, request);
    const calendar = new ICAL.Component(["vcalendar", [], []]);
    calendar.addPropertyWithValue("version", "2.0");
    calendar.addPropertyWithValue("prodid", "-//Musubi//Organizer//EN");
    const event = new ICAL.Component("vevent");
    calendar.addSubcomponent(event);
    event.addPropertyWithValue("uid", uid);
    event.addPropertyWithValue("dtstamp", stamp(timestamp));
    event.addPropertyWithValue("sequence", 0);
    event.addProperty(property("organizer", proof.addresses[0]!));
    event.addProperty(property("summary", request.content.title));
    if (request.content.description !== null)
      event.addProperty(property("description", request.content.description));
    if (request.content.location !== null)
      event.addProperty(property("location", request.content.location));
    for (const [name, instant] of [
      ["dtstart", time.start],
      ["dtend", new Date(time.end.getTime() + (time.isAllDay ? 86400000 : 0))],
    ] as const) {
      if (!time.isAllDay && instant.getUTCMilliseconds()) fail();
      const text = instant.toISOString();
      event.addPropertyWithValue(
        name,
        time.isAllDay
          ? ICAL.Time.fromDateString(text.slice(0, 10))
          : ICAL.Time.fromDateTimeString(text.slice(0, 19) + "Z"),
      );
    }
    for (const guest of request.guests) {
      const prop = property("attendee", `mailto:${guest.email}`);
      prop.setParameter("partstat", "NEEDS-ACTION");
      prop.setParameter(
        "role",
        guest.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT",
      );
      prop.setParameter("rsvp", "TRUE");
      event.addProperty(prop);
    }
    return {
      id: url,
      iCalUID: uid,
      data: calendar.toString() + "\r\n",
      proof: structuredClone(proof),
      stamp: timestamp,
    };
  }
  if (!baseline) fail();
  caldavOrganizerNative(baseline);
  const changes = new Map<string, ICAL.Property[]>();
  for (const [field, name] of [
    ["title", "summary"],
    ["description", "description"],
    ["location", "location"],
  ] as const) {
    const value = request.patch[field];
    if (value !== undefined)
      changes.set(name, value === null ? [] : [property(name, value)]);
  }
  const data = replaceEventProperties(baseline.data, 0, changes);
  return {
    id: baseline.id,
    iCalUID: baseline.iCalUID,
    data,
    proof: structuredClone(proof),
    stamp: timestamp,
  };
}
/** Strip only validated scheduling metadata. No attendee response, time, alarm,
 * conference, parameter or unknown-property difference can confirm this write. */
function comparable(data: string) {
  const event = new ICAL.Component(ICAL.parse(data)).getFirstSubcomponent(
    "vevent",
  )!;
  const dtstamp = event.getFirstPropertyValue("dtstamp");
  if (
    dtstamp != null &&
    (!(dtstamp instanceof ICAL.Time) ||
      dtstamp.isDate ||
      dtstamp.zone !== ICAL.Timezone.utcTimezone)
  )
    fail();
  let value = replaceEventProperties(
    data,
    0,
    new Map([
      ["dtstamp", []],
      ["sequence", []],
    ]),
  );
  for (let i = 0; i < event.getAllProperties("attendee").length; i++) {
    const status = event
      .getAllProperties("attendee")
      [i]!.getParameter("schedule-status");
    if (
      status !== undefined &&
      !/^\d\.\d+(?:\.\d+)?(?:,\d\.\d+(?:\.\d+)?)*$/.test(String(status))
    )
      fail();
    value = caldavRsvpParameter(value, "attendee", i, "schedule-status");
  }
  return canonicalCaldavResource(value);
}
export function matchesCaldavOrganizer(
  current: CaldavOrganizerNative,
  desired: CaldavOrganizerDesired,
  baseline: CaldavOrganizerNative | null,
) {
  try {
    caldavOrganizerNative(current);
    if (
      current.id !== desired.id ||
      current.iCalUID !== desired.iCalUID ||
      !isDeepStrictEqual(current.proof, desired.proof)
    )
      return false;
    const sequence = (data: string) =>
      Number(
        new ICAL.Component(ICAL.parse(data))
          .getFirstSubcomponent("vevent")!
          .getFirstPropertyValue("sequence") ?? 0,
      );
    if (sequence(current.data) < sequence(baseline?.data ?? desired.data))
      return false;
    return isDeepStrictEqual(
      comparable(current.data),
      comparable(desired.data),
    );
  } catch {
    return false;
  }
}
