import { EventSchema, EventScopeRequestSchema, occurrenceKey, type Event, type EventScopeRequest, type OccurrenceIdentity, type OccurrenceStart } from "@musubi/types";
import { expandRecurringEvents } from "./recurrence";
import { civilToInstant, instantToCivil } from "./time-zone";
import { resolveEventTimeEdit } from "./time-edit";

export type EventScopePlan = { updates: Event[]; creates: Event[]; deletes: string[] };
const key = (master: Event, original: OccurrenceStart) => occurrenceKey({ seriesId: master.id, originalStart: original });
const originalDate = (original: OccurrenceStart) => new Date(original.kind === "date" ? `${original.value}T00:00:00Z` : original.kind === "floating" ? `${original.value}Z` : original.value);
function civilStart(event: Event): string {
  if (event.timeModel?.kind === "all-day") return event.start.toISOString().slice(0, 10) + "T00:00:00.000";
  if (event.timeModel?.kind === "zoned" || event.timeModel?.kind === "floating") return event.timeModel.startLocal;
  throw new Error("Scope planning requires an explicit time model.");
}
function shiftedOriginal(master: Event, next: Event, original: OccurrenceStart): OccurrenceStart {
  if (master.timeModel?.kind !== next.timeModel?.kind) throw new Error("Changing a family's time kind requires explicit exception reconciliation.");
  const delta = Date.parse(civilStart(next) + "Z") - Date.parse(civilStart(master) + "Z");
  const sameZone = master.timeModel?.kind !== "zoned" || next.timeModel?.kind !== "zoned" || master.timeModel.timeZone === next.timeModel.timeZone;
  if (delta === 0 && sameZone) return original;
  const oldCivil = original.kind === "instant" && master.timeModel?.kind === "zoned"
    ? instantToCivil(new Date(original.value), master.timeModel.timeZone)
    : original.kind === "date" ? original.value + "T00:00:00.000" : original.value;
  const shifted = new Date(Date.parse(oldCivil + "Z") + delta).toISOString().slice(0, -1);
  return original.kind === "instant" && next.timeModel?.kind === "zoned"
    ? { kind: "instant", value: civilToInstant(shifted, next.timeModel.timeZone, "explicit")!.toISOString() }
    : original.kind === "date" ? { kind: "date", value: shifted.slice(0, 10) } : { kind: "floating", value: shifted };
}
function assertMembers(master: Event, children: readonly Event[]) {
  if (!children.length) return;
  if (!master.recurrence) throw new Error("Removing recurrence requires explicit exception reconciliation.");
  for (const child of children) {
    const point = originalDate(child.originalStart!);
    const member = expandRecurringEvents<Event & { occurrenceIdentity?: OccurrenceIdentity }>([master], point, point, { consumerTimeZone: "UTC" })
      .some(event => event.occurrenceIdentity && occurrenceKey(event.occurrenceIdentity) === key(master, child.originalStart!));
    if (!member) throw new Error("Changing recurrence would orphan an existing exception.");
  }
}
const empty = (): EventScopePlan => ({ updates: [], creates: [], deletes: [] });
function unchanged(before: Event, after: Event): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}
function edit(event: Event, request: Extract<EventScopeRequest, { action: "update" }>): Event {
  return EventSchema.parse({ ...event, ...request.patch, ...(request.time ? resolveEventTimeEdit(request.time) : {}) });
}

/** Pure write-set planning for a locked, authoritative local family. It does
 * not authorize, persist, enqueue provider work or promise a distributed commit.
 * The DB boundary must reserve operationID and recheck the supplied revisions.
 */
export function planEventScope(masterInput: Event, childrenInput: readonly Event[], input: unknown, newID: () => string = () => crypto.randomUUID()): EventScopePlan {
  const request = EventScopeRequestSchema.parse(input);
  const master = EventSchema.parse(masterInput);
  const children = childrenInput.map(child => EventSchema.parse(child));
  if (master.revision !== request.expectedRevision) throw new Error("The series revision changed.");
  if (master.seriesID || !master.recurrence || master.isCanceled || !master.timeModel || master.timeModel.kind === "legacy-unknown")
    throw new Error("Scope planning requires a live explicit recurring master.");
  if (children.some(child => !Number.isSafeInteger(child.revision) || !child.revision)) throw new Error("A persisted occurrence requires a known revision.");
  if (children.some(child => child.seriesID !== master.id || !child.originalStart)) throw new Error("The supplied family contains unrelated events.");
  // Validate the complete input, even cancellations, before calculating changes.
  expandRecurringEvents([master, ...children.map(child => ({ ...child, isCanceled: false }))], master.start, master.end, { consumerTimeZone: "UTC" });
  const finish = (plan: EventScopePlan): EventScopePlan => {
    const existingIDs = new Set([master.id, ...children.map(child => child.id)]);
    const createdIDs = new Set<string>();
    for (const event of plan.creates) {
      occurrenceKey({ seriesId: event.id, originalStart: { kind: "instant", value: event.start.toISOString() } });
      if (existingIDs.has(event.id) || createdIDs.has(event.id)) throw new Error("A scope plan cannot reuse an existing ID for a new definition.");
      createdIDs.add(event.id);
    }
    const result = new Map([master, ...children].map(event => [event.id, event]));
    for (const id of plan.deletes) result.delete(id);
    for (const event of [...plan.updates, ...plan.creates]) result.set(event.id, event);
    const values = [...result.values()].map(event => ({ ...event, isCanceled: false }));
    if (values.length) expandRecurringEvents(values, master.start, master.end, { consumerTimeZone: "UTC" });
    return plan;
  };
  if (request.scope === "series") {
    if (request.action === "delete") return { updates: [], creates: [], deletes: [master.id, ...children.map(child => child.id)] };
    const next = edit(master, request);
    if (unchanged(master, next)) return empty();
    const anchorChanged = civilStart(master) !== civilStart(next) || (master.timeModel?.kind === "zoned" && next.timeModel?.kind === "zoned" && master.timeModel.timeZone !== next.timeModel.timeZone);
    if (anchorChanged && /(?:^|\n)(?:RDATE|EXDATE)(?:;|:)/i.test(master.recurrence))
      throw new Error("Moving dated additions or exclusions requires explicit date reconciliation.");
    const nextChildren = children.map(child => ({ ...child, originalStart: shiftedOriginal(master, next, child.originalStart!) }));
    if (next.recurrence !== master.recurrence || anchorChanged) assertMembers(next, nextChildren);
    return finish({ updates: [next, ...nextChildren], creates: [], deletes: [] });
  }
  const original = request.originalStart!;
  const targetKey = key(master, original);
  const existing = children.find(child => key(master, child.originalStart!) === targetKey);
  if ((existing?.revision ?? null) !== request.expectedOccurrenceRevision) throw new Error("The occurrence revision changed.");
  const date = originalDate(original);
  const generated = expandRecurringEvents<Event & { occurrenceIdentity?: OccurrenceIdentity }>([master], date, date, { consumerTimeZone: "UTC" })
    .find(event => event.occurrenceIdentity && occurrenceKey(event.occurrenceIdentity) === targetKey);
  if (!existing && !generated) throw new Error("The original occurrence is not part of the series.");
  if (request.scope === "occurrence") {
    const base = EventSchema.parse({ ...(existing ?? generated!), id: existing?.id ?? newID(), revision: existing?.revision, seriesID: master.id, originalStart: original, recurrence: null });
    const next = request.action === "delete" ? { ...base, isCanceled: true } : { ...edit(base, request), isCanceled: false };
    if (unchanged(base, next) && (existing || request.action !== "update" || !request.ensureDefinition)) return empty();
    return finish({ updates: existing ? [master, next] : [master], creates: existing ? [] : [next], deletes: [] });
  }
  // A single RRULE has an exact count partition. Dated additions/exclusions and
  // RANGE definitions need a richer partition, never a guessed UNTIL rewrite.
  if (!generated || /[\r\n]/.test(master.recurrence) || !/^(?:RRULE:)?FREQ=/i.test(master.recurrence))
    throw new Error("Following scope currently requires one RRULE and a generated cut point.");
  if (request.action === "update" && !request.ensureDefinition && unchanged(EventSchema.parse(generated), edit(EventSchema.parse(generated), request))) return empty();
  const prior = expandRecurringEvents<Event & { occurrenceIdentity?: OccurrenceIdentity }>([master], master.start, date, { consumerTimeZone: "UTC" })
    .filter(event => event.occurrenceIdentity && originalDate(event.occurrenceIdentity.originalStart) < date);
  const futureChildren = children.filter(child => originalDate(child.originalStart!) >= date);
  if (!prior.length) {
    if (request.action === "delete") return { updates: [], creates: [], deletes: [master.id, ...children.map(child => child.id)] };
    return planEventScope(master, children, { ...request, scope: "series", originalStart: undefined, expectedOccurrenceRevision: undefined }, newID);
  }
  const rule = master.recurrence.replace(/^RRULE:/i, "").toUpperCase();
  const parts = rule.split(";");
  const count = parts.find(part => part.startsWith("COUNT="));
  const before = { ...master, recurrence: "RRULE:" + parts.filter(part => !/^(COUNT|UNTIL)=/.test(part)).concat(`COUNT=${prior.length}`).join(";") };
  if (request.action === "delete") return finish({ updates: [before], creates: [], deletes: futureChildren.map(child => child.id) });
  const remainder = count ? parts.map(part => part.startsWith("COUNT=") ? `COUNT=${Number(count.slice(6)) - prior.length}` : part).join(";") : rule;
  const base = EventSchema.parse({ ...generated, id: newID(), revision: undefined, recurrence: "RRULE:" + remainder });
  const next = edit(base, request);
  const nextChildren = futureChildren.map(child => ({ ...child, seriesID: next.id, originalStart: shiftedOriginal(base, next, child.originalStart!) }));
  assertMembers(next, nextChildren);
  return finish({ updates: [before, ...nextChildren], creates: [next], deletes: [] });
}
