import ICAL from "ical.js";
import { matchesEventProviderProjection } from "@musubi/db";
import { EventSchema, EventTimeModelSchema, EventWriteError, OccurrenceStartSchema, type Event } from "@musubi/types";
import type { ExternalEventRef, NormalizedEvent } from "../adapter";
import { ProviderEventWriteError, requireEventEtag } from "../event_write";
import { replaceEventProperties } from "./caldav_event_ical";
import { normalizeCaldavResource } from "./caldav_time";

export type CaldavSeriesIntent = {
  ref: ExternalEventRef;
  master: Event;
  children: Event[];
};

/** Internal evidence only. The full resource can contain private alarms and
 * extensions: never return this body through an API or log it. */
export type CaldavSeriesEvidence = {
  ref: ExternalEventRef;
  data: string;
  master: NormalizedEvent;
  exceptions: NormalizedEvent[];
};

/** Durable server-only input for one content-only resource replacement. The
 * accepted validator never advances merely because a newer GET was observed. */
export type CaldavSeriesWrite = import("@musubi/db").CaldavSeriesWriteIntent;

/** Compare unfolded physical properties, never a lossy typed projection.
 * Only line folding/endings and ordering between different property names are
 * ignored. Unknown values, parameter spelling/order, repeated-property order
 * and subcomponent order stay exact and therefore fail closed on transforms. */
export function sameCaldavResource(left: string, right: string): boolean {
  type Component = { name: string; properties: { name: string; line: string }[]; children: Component[] };
  const canonical = (data: string): unknown => {
    // The shared span reader rejects malformed boundaries and trailing content.
    replaceEventProperties(data, 0, new Map());
    const lines = data.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    const roots: Component[] = [], stack: Component[] = [];
    for (const line of lines) {
      const boundary = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
      if (boundary) {
        if (boundary[1].toUpperCase() === "BEGIN") {
          const component: Component = { name: boundary[2].toLowerCase(), properties: [], children: [] };
          (stack.length ? stack[stack.length - 1].children : roots).push(component);
          stack.push(component);
        } else stack.pop(); // Already validated by the physical span reader.
      } else if (stack.length) {
        const name = /^([A-Z0-9-]+)[:;]/i.exec(line)?.[1];
        if (!name) throw new ProviderEventWriteError("provider-conflict");
        stack[stack.length - 1].properties.push({ name: name.toLowerCase(), line });
      }
    }
    const sort = (component: Component): unknown => [component.name, component.properties.sort((a, b) => a.name.localeCompare(b.name)).map(property => property.line), component.children.map(sort)];
    return roots.map(sort);
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Refuse ambiguous path encodings before sending account credentials. Some
 * DAV servers decode escaped separators or a second percent-encoding layer. */
export function caldavSeriesResourceURL(collectionID: string, resourceID: string): URL {
  const collection = new URL(collectionID);
  const resource = new URL(resourceID);
  const safePath = (url: URL) => url.pathname.split("/").every(segment => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded !== "." && decoded !== ".." && !/[\/\\%\u0000-\u001f\u007f]/.test(decoded);
    } catch { return false; }
  });
  if (!["http:", "https:"].includes(resource.protocol) || resource.origin !== collection.origin || collection.username || collection.password ||
      resource.username || resource.password || collection.search || collection.hash ||
      resource.search || resource.hash || !safePath(collection) || !safePath(resource) ||
      !collection.pathname.endsWith("/") || !resource.pathname.startsWith(collection.pathname) ||
      !resource.pathname.slice(collection.pathname.length) || resource.pathname.slice(collection.pathname.length).includes("/"))
    throw new ProviderEventWriteError("provider-conflict");
  return resource;
}

/** One complete GET plus its accepted resource ETag covers all components.
 * A future PUT must still use that exact ETag, never one from a projected REPORT.
 */
export function caldavSeriesEvidence(data: string, intent: CaldavSeriesIntent): CaldavSeriesEvidence {
  const conflict = () => new ProviderEventWriteError("provider-conflict");
  const master = EventSchema.parse(intent.master);
  const children = intent.children.map(child => EventSchema.parse(child));
  if (!intent.ref.icalUid || master.seriesID || master.originalStart || !master.recurrence || master.isCanceled ||
      children.some(child => child.seriesID !== master.id || !child.originalStart) ||
      new Set([master.id, ...children.map(child => child.id)]).size !== children.length + 1)
    throw conflict();
  const calendar = new ICAL.Component(ICAL.parse(data));
  if (calendar.name !== "vcalendar" || calendar.hasProperty("method")) throw conflict();
  const components = calendar.getAllSubcomponents("vevent");
  // This capability is deliberately personal-only. Organizer semantics and
  // scheduling side effects belong to the meeting write path.
  for (const component of components) {
    if (component.hasProperty("attendee") || component.hasProperty("organizer"))
      throw new EventWriteError("event-write", "unsupported", "CalDAV meeting series require explicit scheduling support.");
    for (const name of ["uid", "recurrence-id", "dtstart", "dtend", "duration", "summary", "description", "location", "status"])
      if (component.getAllProperties(name).length > 1) throw conflict();
    if (component.getFirstPropertyValue("uid") !== intent.ref.icalUid) throw conflict();
  }
  const masterIndex = components.findIndex(component => !component.hasProperty("recurrence-id"));
  if (masterIndex < 0) throw conflict();
  replaceEventProperties(data, masterIndex, new Map()); // Validate physical structure without serializing untouched bytes.
  const ref = { ...intent.ref, etag: requireEventEtag(intent.ref.etag) };
  const [observedMaster, ...exceptions] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data });
  const original = (value: unknown) => JSON.stringify(OccurrenceStartSchema.parse(value));
  const matches = (expected: Event, actual: NormalizedEvent) =>
    actual.status === "active" && !!expected.isCanceled === !!actual.isCanceled &&
    matchesEventProviderProjection("caldav", expected, actual) &&
    JSON.stringify(EventTimeModelSchema.parse(expected.timeModel)) === JSON.stringify(actual.timeModel);
  if (!observedMaster || !matches(master, observedMaster) || exceptions.length !== children.length) throw conflict();
  const byOriginal = new Map(children.map(child => [original(child.originalStart), child]));
  if (byOriginal.size !== children.length) throw conflict();
  for (const exception of exceptions) {
    const expected = byOriginal.get(original(exception.originalStart));
    if (!expected || !matches(expected, exception)) throw conflict();
  }
  return { ref, data, master: observedMaster, exceptions };
}
