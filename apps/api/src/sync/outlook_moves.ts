import { randomUUID } from "node:crypto";
import { config } from "@musubi/config";
import { BadRequestError, OutlookMoveRequestSchema } from "@musubi/types";
import {
  claimOutlookMove, findOutlookMoveRequest, outlookMoveOptions, planOutlookMove, readGraphMeetingContext,
  saveOutlookMovePreview, pendingOutlookMoves, releaseOutlookMove, stopOutlookMove, outlookMoveChildStatus,
  sameOutlookMoveFamily, sameCaldavScopeContext as same, outlookMoveTime, outlookMoveZone, providerStateVersion, saveGraphOccurrenceContent,
} from "@musubi/db";
import { microsoftAdapter } from "./adapters/microsoft";

function enabled() {
  if (!config.api.providerOrganizerEditsEnabled || !config.api.eventTimeEditsEnabled)
    throw new BadRequestError("Moving Outlook occurrences is not available on this server.");
}
export async function observeOutlookMove(actorID: string, eventID: string, calendarID: string) {
  enabled();
  const context = await readGraphMeetingContext({ actorID, eventID, calendarID });
  const observed = await microsoftAdapter.observeGraphSeriesContent!(context, AbortSignal.timeout(20_000));
  if (!observed.timeZoneSupported) throw new BadRequestError("The series time zone is not supported by this Outlook mailbox.");
  return observed;
}
export async function previewOutlookMove(actorID: string, input: unknown, globalZones = false) {
  enabled();
  const request = OutlookMoveRequestSchema.parse(input);
  const replay = await findOutlookMoveRequest(actorID, request);
  if (replay) { assertOutlookMoveZoneVersion(outlookMoveZone(replay.journal.initial), globalZones); return replay; }
  const observed = await observeOutlookMove(actorID, request.eventID, request.calendarID);
  assertOutlookMoveZoneVersion(outlookMoveZone(observed), globalZones);
  return saveOutlookMovePreview(planOutlookMove(observed, request, randomUUID));
}
export async function outlookMoveChoices(actorID: string, eventID: string, calendarID: string, globalZones = false) {
  const options = outlookMoveOptions(await observeOutlookMove(actorID, eventID, calendarID));
  assertOutlookMoveZoneVersion(options.timeZone, globalZones);
  return options;
}

/** One child admission per tick. Its existing outbox owns dispatch/recovery;
 * neither browser polling nor this coordinator ever sends provider writes. */
export async function advanceOutlookMove(id: string) {
  const row = await claimOutlookMove(id);
  if (!row) return;
  const item = row.journal.items.find(n => n.status !== "completed");
  try {
    if (!item) return;
    if (item.status === "queued") {
      const child = await outlookMoveChildStatus(item.operationID);
      if (!child || !["pending", "attempting", "retry", "completed"].includes(child.status))
        await stopOutlookMove(row, item.eventID, !child || child.uncertain);
      return;
    }
    if (item.status !== "pending") return;
    enabled();
    const context = await readGraphMeetingContext({ actorID: row.actorID, eventID: item.eventID, calendarID: row.calendarID });
    if (!same(context.link, row.journal.initial.context.link) || context.masterID !== row.masterID) throw new Error("Source changed");
    const observed = await microsoftAdapter.observeGraphOccurrenceContent!(context, AbortSignal.timeout(20_000));
    if (!same(observed.identity, row.journal.initial.identity) || !sameOutlookMoveFamily(observed.baseline, row.journal.expected))
      throw new Error("Preview changed");
    const mapping = context.mappings.find(m => m.eventID === item.eventID)!;
    const event = context.family.find(e => e.id === item.eventID)!;
    const stateVersion = providerStateVersion(mapping);
    if (!stateVersion) throw new Error("Missing provider state");
    const request = { provider: "microsoft" as const, action: "update" as const, notificationPolicy: "server-invite" as const, scope: "occurrence" as const,
      operationID: item.operationID, eventID: item.eventID, calendarID: row.calendarID, expectedRevision: event.revision,
      expectedStateVersion: stateVersion, expectedSeriesVersion: observed.version, patch: { time: outlookMoveTime(item, outlookMoveZone(row.journal.initial)) } };
    const prepared = await microsoftAdapter.prepareGraphOccurrenceContent!(context, request, AbortSignal.timeout(20_000));
    await saveGraphOccurrenceContent({ ...prepared, bulkMove: { operationID: row.id, leaseToken: row.leaseToken! } });
  } catch {
    // If admission committed but its response was lost, its transaction already
    // cleared this lease. This cannot relabel a possibly dispatched child.
    if (item) await stopOutlookMove(row, item.eventID);
  } finally { await releaseOutlookMove(row); }
}
export async function drainOutlookMoves() {
  await Promise.all((await pendingOutlookMoves()).map(row => advanceOutlookMove(row.id)));
}

/** Pre-v10 clients have a strict UTC-only result schema and preview semantics. */
export function assertOutlookMoveZoneVersion(timeZone: string, globalZones: boolean) {
  if (!globalZones && timeZone !== "UTC") throw new BadRequestError("Update Musubi to move occurrences in this time zone.");
}
