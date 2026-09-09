import ICAL from "ical.js";
import {
  resolveEventTimeEdit,
  unambiguousCivilToInstant,
} from "@musubi/calendar";
import { EventWriteError, type EventTimeEdit } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";
import { calendarLines, replaceEventProperties } from "./caldav_event_ical";
import { caldavRsvpParameter } from "./caldav_rsvp";
function refuse(): never {
  throw new EventWriteError(
    "organizer",
    "unsupported",
    "CalDAV rescheduling requires unchanged time type and zone, unambiguous endpoints and a matching complete native timezone.",
  );
}
/** The installed offset decoder truncates seconds and trailing characters and
 * wraps values outside UTC-12..UTC+14. Validate physical unfolded values before
 * parsing/decorating so neither endpoint proof can use a changed native offset. */
function validateRawNativeOffsets(data: string) {
  for (const { unfolded } of calendarLines(data)) {
    if (!/^TZOFFSET(?:FROM|TO)(?:;|:)/i.test(unfolded)) continue;
    const match = /^TZOFFSET(?:FROM|TO):([+-])(\d{2})(\d{2})(?:00)?$/i.exec(
      unfolded,
    );
    if (!match) refuse();
    const hours = Number(match[2]),
      minutes = Number(match[3]);
    const seconds = (match[1] === "-" ? -1 : 1) * (hours * 3600 + minutes * 60);
    if (
      hours > 23 ||
      minutes > 59 ||
      seconds < -43200 ||
      seconds > 50400 ||
      (match[1] === "-" && seconds === 0)
    )
      refuse();
  }
}
/** Check native transition intervals independently of ical.js's local-time
 * offset choice, which deliberately chooses one side of an ambiguous fold. */
function nativeEndpointProof(definition: ICAL.Component) {
  const observances = definition.getAllSubcomponents().map((item) => {
    const start = item.getFirstPropertyValue("dtstart");
    const from = item.getFirstPropertyValue("tzoffsetfrom");
    const to = item.getFirstPropertyValue("tzoffsetto");
    const rules = item.getAllProperties("rrule");
    const dates = item.getAllProperties("rdate");
    const local = (value: unknown): value is ICAL.Time =>
      value instanceof ICAL.Time &&
      !value.isDate &&
      value.zone === ICAL.Timezone.localTimezone;
    if (
      !local(start) ||
      !(from instanceof ICAL.UtcOffset) ||
      !(to instanceof ICAL.UtcOffset) ||
      rules.length > 1 ||
      rules.some(
        (property) =>
          property.getValues().length !== 1 ||
          !(property.getFirstValue() instanceof ICAL.Recur),
      ) ||
      item.hasProperty("exdate") ||
      item.hasProperty("exrule") ||
      dates.some(
        (property) =>
          property.getValues().length !== 1 ||
          Object.keys(property.toJSON()[1]).length !== 0 ||
          !local(property.getFirstValue()),
      )
    )
      refuse();
    const rdates = dates.map(
      (property) => property.getFirstValue() as ICAL.Time,
    );
    // ical.js omits DTSTART when expanding an RDATE-only observance. Refuse
    // that incomplete representation unless DTSTART is explicitly included.
    if (
      !rules.length &&
      rdates.length &&
      !rdates.some((date) => date.toString() === start.toString())
    )
      refuse();
    return {
      start,
      from: from.toSeconds(),
      to: to.toSeconds(),
      rdates,
      rule: rules[0]?.getFirstValue() as ICAL.Recur | undefined,
    };
  });
  return (civil: string) => {
    const endpoint = Date.parse(civil.slice(0, 19) + "Z");
    const year = Number(civil.slice(0, 4));
    for (const observance of observances) {
      const check = (transition: ICAL.Time) => {
        const clock = Date.parse(transition.toString().slice(0, 19) + "Z");
        const shifted = clock + (observance.to - observance.from) * 1000;
        // Forward jumps have no matching instant; backward jumps have two.
        if (
          endpoint >= Math.min(clock, shifted) &&
          endpoint < Math.max(clock, shifted)
        )
          refuse();
      };
      check(observance.start);
      observance.rdates.forEach(check);
      if (observance.rule) {
        const rule = observance.rule.clone();
        if (rule.until?.zone === ICAL.Timezone.utcTimezone) {
          rule.until.adjust(0, 0, 0, observance.from);
          rule.until.zone = ICAL.Timezone.localTimezone;
        }
        const iterator = rule.iterator(observance.start);
        let complete = false;
        for (let count = 0; count < 20000; count++) {
          const transition = iterator.next();
          if (!transition || transition.year > year + 1) {
            complete = true;
            break;
          }
          check(transition);
        }
        // A bounded proof must finish; never silently accept a truncated rule.
        if (!complete) refuse();
      }
    }
  };
}
/** One-off endpoint proof. Never replace a native timezone with system rules. */
export function caldavOrganizerTimeEvidence(data: string) {
  validateRawNativeOffsets(data);
  const calendar = new ICAL.Component(ICAL.parse(data));
  const components = calendar.getAllSubcomponents("vevent");
  if (components.length !== 1) refuse();
  const event = components[0]!;
  if (
    ["rrule", "rdate", "exdate", "recurrence-id"].some((name) =>
      event.hasProperty(name),
    )
  )
    refuse();
  const original = normalizeCaldavResource({
    url: "https://fixture.invalid/meeting.ics",
    data,
  })[0]!;
  const model = original.timeModel;
  if (!model || !["zoned", "all-day"].includes(model.kind)) refuse();
  const start = event.getFirstProperty("dtstart"),
    end = event.getFirstProperty("dtend"),
    duration = event.getFirstProperty("duration");
  if (
    !start ||
    (!end && !duration) ||
    (end && duration) ||
    (duration && Object.keys(duration.toJSON()[1]).length)
  )
    refuse();
  for (const property of [start, ...(end ? [end] : [])]) {
    const value = property.getFirstValue();
    if (!(value instanceof ICAL.Time)) refuse();
    const tzid = property.getParameter("tzid");
    if (
      model.kind === "all-day"
        ? !value.isDate || tzid !== undefined
        : model.kind !== "zoned" ||
          value.isDate ||
          (model.timeZone === "UTC"
            ? tzid !== undefined || value.zone !== ICAL.Timezone.utcTimezone
            : tzid !== model.timeZone ||
              value.zone === ICAL.Timezone.utcTimezone)
    )
      refuse();
  }
  let zone: ICAL.Timezone | undefined;
  let verifyNativeEndpoint: ((civil: string) => void) | undefined;
  if (model.kind === "zoned" && model.timeZone !== "UTC") {
    const definitions = calendar
      .getAllSubcomponents("vtimezone")
      .filter((item) => item.getFirstPropertyValue("tzid") === model.timeZone);
    if (
      definitions.length !== 1 ||
      definitions[0]!.getAllProperties("tzid").length !== 1
    )
      refuse();
    const observances = definitions[0]!.getAllSubcomponents();
    if (
      !observances.length ||
      observances.some(
        (item) =>
          !["standard", "daylight"].includes(item.name) ||
          ["dtstart", "tzoffsetfrom", "tzoffsetto"].some(
            (name) => item.getAllProperties(name).length !== 1,
          ),
      )
    )
      refuse();
    verifyNativeEndpoint = nativeEndpointProof(definitions[0]!);
    zone = new ICAL.Timezone({
      component: definitions[0]!,
      tzid: model.timeZone,
    });
  }
  function verify(time: ReturnType<typeof resolveEventTimeEdit>) {
    if (
      time.timeModel.kind !== model!.kind ||
      (time.timeModel.kind === "zoned" &&
        (model!.kind !== "zoned" ||
          time.timeModel.timeZone !== model!.timeZone))
    )
      refuse();
    if (time.timeModel.kind !== "zoned") return;
    if (
      time.end <= time.start ||
      time.start.getUTCMilliseconds() ||
      time.end.getUTCMilliseconds()
    )
      refuse();
    for (const [civil, instant] of [
      [time.timeModel.startLocal, time.start],
      [time.timeModel.endLocal, time.end],
    ] as const) {
      if (
        unambiguousCivilToInstant(civil, time.timeModel.timeZone).getTime() !==
        instant.getTime()
      )
        refuse();
      if (zone) {
        verifyNativeEndpoint!(civil);
        const native = ICAL.Time.fromDateTimeString(civil.slice(0, 19));
        native.zone = zone;
        if (native.toUnixTime() * 1000 !== instant.getTime()) refuse();
      }
    }
  }
  verify(original as ReturnType<typeof resolveEventTimeEdit>);
  return { event, original, start, end, duration, verify };
}
/** Return unchanged bytes before any participation/sequence rewrite for a no-op. */
export function retimeCaldavOrganizer(
  data: string,
  time: EventTimeEdit,
  timestamp: ICAL.Time,
) {
  try {
    const evidence = caldavOrganizerTimeEvidence(data),
      desired = resolveEventTimeEdit(time);
    evidence.verify(desired);
    if (
      desired.start.getTime() === evidence.original.start.getTime() &&
      desired.end.getTime() === evidence.original.end.getTime()
    )
      return { data, rescheduled: false };
    const replacements = new Map<string, ICAL.Property[]>();
    for (const [name, old, instant, civil] of [
      [
        "dtstart",
        evidence.start,
        desired.start,
        desired.timeModel.kind === "zoned"
          ? desired.timeModel.startLocal
          : null,
      ],
      [
        "dtend",
        evidence.end,
        new Date(desired.end.getTime() + (desired.isAllDay ? 86400000 : 0)),
        desired.timeModel.kind === "zoned" ? desired.timeModel.endLocal : null,
      ],
    ] as const) {
      const property = old
        ? new ICAL.Property(structuredClone(old.toJSON()))
        : new ICAL.Property(name);
      property.setValue(
        desired.isAllDay
          ? ICAL.Time.fromDateString(instant.toISOString().slice(0, 10))
          : ICAL.Time.fromDateTimeString(
              civil!.slice(0, 19) +
                (desired.timeModel.kind === "zoned" &&
                desired.timeModel.timeZone === "UTC"
                  ? "Z"
                  : ""),
            ),
      );
      if (
        !old &&
        desired.timeModel.kind === "zoned" &&
        desired.timeModel.timeZone !== "UTC"
      )
        property.setParameter("tzid", desired.timeModel.timeZone);
      replacements.set(name, [property]);
    }
    if (evidence.duration) replacements.set("duration", []);
    const sequence = Number(
      evidence.event.getFirstPropertyValue("sequence") ?? 0,
    );
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      sequence >= 2147483647 ||
      Object.keys(
        evidence.event.getFirstProperty("sequence")?.toJSON()[1] ?? {},
      ).length
    )
      refuse();
    const revision = new ICAL.Property("sequence");
    revision.setValue(sequence + 1);
    replacements.set("sequence", [revision]);
    const stamp = new ICAL.Property("dtstamp");
    stamp.setValue(timestamp);
    replacements.set("dtstamp", [stamp]);
    let after = replaceEventProperties(data, 0, replacements);
    const organizer = String(
      evidence.event.getFirstPropertyValue("organizer"),
    ).toLowerCase();
    evidence.event.getAllProperties("attendee").forEach((attendee, ordinal) => {
      if (String(attendee.getFirstValue()).toLowerCase() !== organizer)
        after = caldavRsvpParameter(
          after,
          "attendee",
          ordinal,
          "partstat",
          "NEEDS-ACTION",
        );
    });
    const observed = normalizeCaldavResource({
      url: "https://fixture.invalid/meeting.ics",
      data: after,
    })[0]!;
    if (
      observed.start.getTime() !== desired.start.getTime() ||
      observed.end.getTime() !== desired.end.getTime() ||
      JSON.stringify(observed.timeModel) !== JSON.stringify(desired.timeModel)
    )
      refuse();
    return { data: after, rescheduled: true };
  } catch (error) {
    if (error instanceof RangeError) refuse();
    throw error;
  }
}
