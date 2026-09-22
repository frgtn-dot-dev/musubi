import { and, eq, sql } from "drizzle-orm";
import { EventSchema, EventScopeRequestSchema, EventWriteError, type EventScopeRequest } from "@musubi/types";
import { db } from "..";
import { eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { appendEventOutbox } from "./event-outbox";
import { sameCaldavScopeContext as same } from "./caldav-series-scope";
import { graphFamilyContextInTransaction, lockGraphFamilyAddress, replaceGraphFamilyInTransaction, type GraphFamilyContext, type GraphFamilyObservation } from "./graph-family";

export type GraphSeriesDeletionPrepared = {
  version: 1;
  context: GraphFamilyContext;
  request: EventScopeRequest;
  baseline: GraphFamilyObservation;
  targetID: string;
};
const refuse = () => { throw new EventWriteError("event-write", "unsupported", "The Outlook series changed. Sync and reopen it before deleting."); };

export function assertGraphSeriesDeleteContext(context: GraphFamilyContext, actorID: string, input: unknown) {
  const request = EventScopeRequestSchema.parse(input);
  if (request.action !== "delete" || !["series", "occurrence"].includes(request.scope) || context.address.userID !== actorID ||
    !["owner", "editor"].includes(context.grant.role) || context.root.deletedAt || context.root.revision !== request.expectedRevision) refuse();
  if (request.scope === "occurrence" && !context.children.some(child => !child.deletedAt && !child.isCanceled && same(child.originalStart, request.originalStart) && child.revision === request.expectedOccurrenceRevision)) refuse();
}

/** Caller holds the Graph calendar fence and parent-before-child locks. The
 * immutable native proof precedes local tombstones; queued context follows them. */
export async function appendGraphSeriesDeletion(tx: DbTransaction, actorID: string, prepared: GraphSeriesDeletionPrepared) {
  const context = await graphFamilyContextInTransaction(tx, prepared.context.address);
  const root = context.mappings.find(mapping => mapping.eventID === context.root.id)!;
  const event = EventSchema.parse({ ...context.root, calendars: [context.address.calendarID] });
  const operationID = prepared.request.operationID;
  await appendEventOutbox(tx, event, [{
    id: operationID, actorID, mutationID: operationID, position: 0, eventID: event.id,
    calendarID: context.address.calendarID, externalCalendarLinkID: context.link.id,
    provider: "microsoft", userID: actorID, accountID: context.link.accountID,
    externalCalendarID: context.link.externalCalendarID, externalEventID: root.externalEventID,
    expectedEtag: root.etag, icalUid: root.icalUid, action: "delete",
    payload: { event, graphSeriesDeletion: { ...prepared, context } },
  }]);
}

async function currentDelete(tx: DbTransaction, id: string, token: string) {
  const [initial] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, id));
  const saved = initial?.payload.graphSeriesDeletion;
  if (!saved || saved.version !== 1 || initial.provider !== "microsoft" || initial.action !== "delete") return;
  await lockGraphFamilyAddress(tx, saved.context.address);
  const current = await graphFamilyContextInTransaction(tx, saved.context.address, id);
  if (!same(current, saved.context) || !["owner", "editor"].includes(current.grant.role)) return;
  const [row] = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), eq(eventOutbox.status, "attempting"), sql`${eventOutbox.leaseUntil} > clock_timestamp()`)).for("update");
  if (!row || !same(row.payload.graphSeriesDeletion, saved) || row.userID !== current.address.userID || row.accountID !== current.link.accountID || row.externalCalendarLinkID !== current.link.id || row.revision !== current.root.revision) return;
  return { row, current, saved };
}

export async function confirmGraphSeriesDeletionOutbox(id: string, token: string) {
  return db.transaction(async tx => !!(await currentDelete(tx, id, token)));
}

/** Complete native absence/family observation and local projection commit
 * together. Synchronization cannot revive optimistic deletions in between. */
export async function completeGraphSeriesDeletionOutbox(id: string, token: string, observation: GraphFamilyObservation | null) {
  return db.transaction(async tx => {
    const proof = await currentDelete(tx, id, token);
    if (!proof || (proof.saved.request.scope === "series") !== (observation === null)) return false;
    if (observation) await replaceGraphFamilyInTransaction(tx, proof.current, observation, id);
    await tx.update(eventOutbox).set({ status: "completed", errorCode: null, uncertain: false, leaseToken: null, leaseUntil: null, remoteSnapshot: null, updatedAt: new Date() }).where(eq(eventOutbox.id, id));
    return true;
  });
}
