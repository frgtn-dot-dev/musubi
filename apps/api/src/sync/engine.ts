import { EventWriteError, type Event, type Task } from "@musubi/types";
import { logger } from "@musubi/config";
import {
  deleteExternalEvent,
  deleteExternalTask,
  diffEventContent,
  getCalendarMembers,
  getEventCalendars,
  getExternalEvent,
  getExternalTask,
  getDisabledExternalCalendarIDs,
  getExternalLinkForCalendar,
  getUserExternalCalendars,
  importExternalCalendar,
  importExternalEvent,
  importExternalTask,
  removeCalendar,
  setAccountLabel,
  setCursor,
  setExternalCalendarCapabilities,
  setExternalEventSyncData,
  setExternalTaskSyncData,
  setMemberRole,
  sweepExternalEvents,
  sweepExternalTasks,
  upsertExternalEvent,
  upsertExternalTask,
} from "@musubi/db";
import { notifyCalendarMembers } from "../handlers/stream";
import type {
  CalendarAdapter,
  EventWriteOperation,
  NormalizedEvent,
  NormalizedTask,
} from "./adapter";
import { googleAdapter } from "./adapters/google";
import { caldavAdapter } from "./adapters/caldav";
import { microsoftAdapter } from "./adapters/microsoft";
import {
  isOptionalTaskError,
  isTransientSyncError,
  providerAuthErrorFields,
  ProviderAuthError,
} from "./errors";
import { recordExternalSyncFailure } from "../metrics";
import { ProviderEventWriteError, requireEventPatch } from "./event_write";
import { type ProviderSyncOptions, runProviderSyncs } from "./orchestrator";

// provider -> adapter. Register new providers here.
const adapters: Record<string, CalendarAdapter> = {
  google: googleAdapter,
  caldav: caldavAdapter,
  microsoft: microsoftAdapter,
};

export function getAdapter(provider: string): CalendarAdapter | null {
  return adapters[provider] ?? null;
}

// NormalizedEvent -> the primitive column values the DB layer expects.
// (organizer is NOT NULL in the schema; color comes from the calendar.)
function toEventValues(n: NormalizedEvent, calColor: string) {
  return {
    title: n.title,
    color: calColor,
    start: n.start,
    end: n.end,
    isAllDay: n.isAllDay,
    description: n.description,
    location: n.location,
    organizer: n.organizer ?? "",
    recurrence: n.recurrence,
    url: n.url,
  };
}

function toTaskValues(task: NormalizedTask) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    start: task.start,
    due: task.due,
    isAllDay: task.isAllDay,
    completedAt: task.completedAt,
    percentComplete: task.percentComplete,
    priority: task.priority,
    recurrence: task.recurrence,
    relatedTo: task.relatedTo,
    sequence: task.sequence,
    url: task.url,
  };
}

type ExternalChangeWriter = {
  deleteEvent(externalID: string): Promise<boolean>;
  deleteTask(externalID: string): Promise<boolean>;
  upsertEvent(event: NormalizedEvent): Promise<boolean>;
  upsertTask(task: NormalizedTask): Promise<boolean>;
  sweepEvents(seenExternalIDs: string[]): Promise<number>;
  sweepTasks(seenExternalIDs: string[]): Promise<number>;
};

/** Apply one complete provider collection delta without mixing VEVENT and VTODO sweeps. */
export async function reconcileExternalChanges(
  changes: Array<
    | { kind: "event"; data: NormalizedEvent }
    | { kind: "task"; data: NormalizedTask }
  >,
  reset: boolean | undefined,
  writer: ExternalChangeWriter,
): Promise<number> {
  let changed = 0;
  const seenEvents: string[] = [];
  const seenTasks: string[] = [];

  for (const change of changes) {
    if (change.kind === "event") {
      if (change.data.status === "cancelled") {
        if (await writer.deleteEvent(change.data.externalId)) changed++;
      } else {
        seenEvents.push(change.data.externalId);
        if (await writer.upsertEvent(change.data)) changed++;
      }
    } else if (change.data.deleted) {
      if (await writer.deleteTask(change.data.externalId)) changed++;
    } else {
      seenTasks.push(change.data.externalId);
      if (await writer.upsertTask(change.data)) changed++;
    }
  }

  if (reset) {
    changed += await writer.sweepEvents(seenEvents);
    changed += await writer.sweepTasks(seenTasks);
  }
  return changed;
}

// A user who lost their last link is absent from subsequent event deltas.
// Include the accepted local revision so a delayed removal cannot evict a newer row.
async function notifyExternalEventUnlinks(
  calendarID: string,
  unlinks: { id: string; revision: number }[],
) {
  if (unlinks.length === 0) return;
  const previousMembers = await getCalendarMembers(calendarID);
  for (const { id, revision } of unlinks) {
    const remainingCalendars = await getEventCalendars(id);
    const remainingMembers = new Set<string>();
    for (const calendar of remainingCalendars) {
      for (const member of await getCalendarMembers(calendar))
        remainingMembers.add(member.userID);
    }
    notifyCalendarMembers(
      previousMembers
        .filter((member) => !remainingMembers.has(member.userID))
        .map((member) => member.userID),
      "event_removed",
      { id, revision },
    );
  }
}

// Pull: reconcile calendars, then pull each calendar's changes into Musubi. Scoped
// to ONE connected account of the provider.
export async function syncProvider(
  adapter: CalendarAdapter,
  userID: string,
  account: { id: string; label: string },
) {
  const startedAt = performance.now();
  const provider = adapter.provider;
  const accountId = account.id;

  logger.debug("sync.account.started", { provider, userId: userID, accountId });

  // keep the human label fresh on this account's calendars
  await setAccountLabel(provider, userID, accountId, account.label);

  // 1. reconcile the calendar list
  const { calendars: remote, taskListsComplete } = await adapter.listCalendars(
    userID,
    accountId,
  );
  const remoteIDs = new Set(remote.map((c) => c.externalId));
  logger.debug("sync.account.calendars_discovered", {
    provider,
    userId: userID,
    accountId,
    calendars: remote.length,
  });

  // remote calendar gone -> drop the Musubi mirror (removeCalendar handles orphan events)
  for (const link of await getUserExternalCalendars(
    provider,
    userID,
    accountId,
  )) {
    if (
      !remoteIDs.has(link.externalCalendarID) &&
      (taskListsComplete || link.supportsEvents || !link.supportsTasks)
    ) {
      await removeCalendar(link.calendarID);
    }
  }
  // new remote calendar -> import; existing -> keep the read-only flag fresh
  // (also self-heals calendars imported before readOnly existed, e.g. holidays)
  const links = await getUserExternalCalendars(provider, userID, accountId);
  const disabled = new Set(
    await getDisabledExternalCalendarIDs(provider, userID, accountId),
  );
  for (const cal of remote) {
    if (disabled.has(cal.externalId)) continue; // user opted this calendar out of sync
    const desiredRole = cal.readOnly ? "viewer" : "owner";
    const capabilities = {
      supportsEvents: cal.supportsEvents ?? true,
      supportsTasks: cal.supportsTasks ?? false,
    };
    const link = links.find((l) => l.externalCalendarID === cal.externalId);
    if (link) {
      await setMemberRole(userID, link.calendarID, desiredRole);
      await setExternalCalendarCapabilities(
        provider,
        userID,
        accountId,
        cal.externalId,
        capabilities,
      );
    } else {
      await importExternalCalendar(
        provider,
        userID,
        accountId,
        account.label,
        cal,
        desiredRole,
      );
    }
  }

  // 2. pull objects per (now reconciled) calendar. Track which calendars really
  // changed so the scheduled sync can wake connected clients — the etag-aware
  // upsert makes a CalDAV full-fetch a quiet no-op when nothing moved.
  const changedCalendarIDs: string[] = [];
  for (const link of await getUserExternalCalendars(
    provider,
    userID,
    accountId,
  )) {
    const taskOnly = link.supportsTasks && !link.supportsEvents;
    if (taskOnly && !remoteIDs.has(link.externalCalendarID)) continue;
    const calendarStartedAt = performance.now();
    let fetched;
    try {
      fetched = await adapter.fetchChanges(
        userID,
        accountId,
        link.externalCalendarID,
        link.cursor,
      );
    } catch (error) {
      if (
        !taskOnly ||
        (provider !== "google" && provider !== "microsoft") ||
        !isOptionalTaskError(error)
      )
        throw error;
      logger.warn("sync.tasks.fetch_unavailable", {
        provider,
        userId: userID,
        accountId,
        calendarId: link.calendarID,
      });
      continue;
    }
    const { changes, nextCursor, reset } = fetched;

    const unlinkedEventIDs: { id: string; revision: number }[] = [];
    const onUnlink = (id: string, revision: number) => {
      unlinkedEventIDs.push({ id, revision });
    };
    let changed: number;
    try {
      changed = await reconcileExternalChanges(changes, reset, {
        deleteEvent: (externalID) =>
          deleteExternalEvent(provider, link.calendarID, externalID, onUnlink),
        deleteTask: (externalID) =>
          deleteExternalTask(provider, link.calendarID, externalID),
        upsertEvent: (event) =>
          upsertExternalEvent(
            provider,
            userID,
            link.calendarID,
            link.externalCalendarID,
            event.externalId,
            toEventValues(event, link.calColor),
            event.etag ?? null,
            event.icalUid ?? null,
          ),
        upsertTask: (task) =>
          upsertExternalTask(
            provider,
            userID,
            link.calendarID,
            link.externalCalendarID,
            task.externalId,
            toTaskValues(task),
            task.etag ?? null,
            task.icalUid ?? null,
          ),
        sweepEvents: (seenExternalIDs) =>
          sweepExternalEvents(
            provider,
            link.calendarID,
            seenExternalIDs,
            onUnlink,
          ),
        sweepTasks: (seenExternalIDs) =>
          sweepExternalTasks(provider, link.calendarID, seenExternalIDs),
      });
    } finally {
      // Earlier unlinks have committed even if a later resource fails.
      await notifyExternalEventUnlinks(link.calendarID, unlinkedEventIDs);
    }

    if (changed > 0) changedCalendarIDs.push(link.calendarID);
    await setCursor(link.calendarID, nextCursor);
    logger.debug("sync.calendar.completed", {
      provider,
      userId: userID,
      accountId,
      calendarId: link.calendarID,
      fetchedEvents: changes.filter(({ kind }) => kind === "event").length,
      fetchedTasks: changes.filter(({ kind }) => kind === "task").length,
      changedObjects: changed,
      fullSet: !!reset,
      durationMs: Math.round((performance.now() - calendarStartedAt) * 10) / 10,
    });
  }
  logger.debug("sync.account.completed", {
    provider,
    userId: userID,
    accountId,
    calendars: remote.length,
    changedCalendars: changedCalendarIDs.length,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  });
  return changedCalendarIDs;
}

// Sync every connected account of every registered provider. listAccounts returns
// [] when the provider isn't connected, so unconnected providers are a clean no-op.
// When anything actually changed, the affected calendars' members get an SSE
// "external_sync" nudge — connected clients run a silent delta refresh, which is
// what makes provider changes land in the app without a manual pull-to-refresh.
export async function syncUser(
  userID: string,
  options: ProviderSyncOptions = {},
) {
  const changedCalendarIDs = await runProviderSyncs(
    Object.values(adapters),
    userID,
    options,
    {
      syncAccount: syncProvider,
      onFailure: ({ stage, provider, accountId, error }) => {
        recordExternalSyncFailure(stage, provider);
        // Provider/network hiccups are warn: the next poll retries them. error
        // is reserved for what a human has to act on (revoked grant, our bug).
        const level = isTransientSyncError(error) ? "warn" : "error";
        logger[level](
          stage === "discovery"
            ? "sync.provider.failed"
            : "sync.account.failed",
          {
            provider,
            userId: userID,
            ...(accountId ? { accountId } : {}),
            error,
            ...providerAuthErrorFields(error),
          },
        );
      },
    },
  );

  if (changedCalendarIDs.length > 0) {
    const memberIDs = new Set<string>();
    for (const cal of changedCalendarIDs) {
      for (const m of await getCalendarMembers(cal)) memberIDs.add(m.userID);
    }
    notifyCalendarMembers([...memberIDs], "external_sync", {
      calendars: changedCalendarIDs,
    });
  }
  return changedCalendarIDs;
}

// Push a Musubi event out to every provider-linked calendar it belongs to.
// For "delete", the caller MUST invoke this BEFORE removing the Musubi event,
// so the external mapping is still present to look up.
export async function pushEventToProviders(
  event: Event,
  action: "create" | "update" | "delete",
) {
  return pushEventToCalendars(event, event.calendars, action);
}

// Push an event to a specific set of calendars (used by update to reconcile the
// diff: "delete" for removed calendars, "create" for added, "update" for kept).
export async function pushEventToCalendars(
  event: Event,
  calendarIDs: string[],
  action: "create" | "update" | "delete",
) {
  const deliver = await prepareEventWrites([{ event, calendarIDs, action }]);
  await deliver();
}

export type CalendarEventWrite = Omit<EventWriteOperation, "external"> & {
  calendarIDs: string[];
};

export type EventDeliveryReceipt = {
  action: EventWriteOperation["action"];
  eventID: string;
  calendarID: string;
  provider: string;
  accountID: string;
  externalCalendarID: string;
  externalEventID?: string;
  status:
    | "not-attempted"
    | "completed"
    | "not-needed"
    | "conflict"
    | "not-written"
    | "unconfirmed";
};

/** Request-scoped delivery only. Handler must add localCommitted/current revision;
 * these receipts are neither a durable outbox nor proof of multi-target atomicity.
 */
export class EventDeliveryError extends Error {
  constructor(
    readonly receipts: EventDeliveryReceipt[],
    readonly failure: Error,
  ) {
    super("Event provider delivery did not complete.");
    this.name = "EventDeliveryError";
  }
}

/** Validate the ENTIRE operation before returning a delivery function. Handlers
 * call this before touching event/link rows, including before removed-copy deletes.
 * It is deliberately request-scoped, not a reservation or an outbox.
 */
export async function prepareEventWrites(writes: CalendarEventWrite[]) {
  const prepared: Array<{
    operation: CalendarEventWrite;
    calendarID: string;
    link: NonNullable<Awaited<ReturnType<typeof getExternalLinkForCalendar>>>;
    adapter: CalendarAdapter;
    external: Awaited<ReturnType<typeof getExternalEvent>> | null;
    receipt: EventDeliveryReceipt;
  }> = [];
  for (const write of writes) {
    // Legacy handlers provide a server-read previous snapshot. This narrows
    // payloads, but is NOT local CAS. Next-stage CAS supplies its actual patch.
    const operation = structuredClone(write);
    if (
      operation.action === "update" &&
      operation.patch === undefined &&
      operation.previous
    ) {
      operation.patch = diffEventContent(operation.previous, operation.event);
    }
    for (const calendarID of new Set(operation.calendarIDs)) {
      const link = await getExternalLinkForCalendar(calendarID);
      if (!link) continue;
      if (!link.supportsEvents)
        throw new EventWriteError("event-write", "unsupported");
      const adapter = getAdapter(link.provider);
      if (!adapter?.assertEventWrite)
        throw new EventWriteError("event-write", "unknown");
      const external =
        operation.action === "create"
          ? null
          : await getExternalEvent(
              link.provider,
              operation.event.id,
              link.externalCalendarID,
              calendarID,
            );
      if (operation.action === "update" && external)
        requireEventPatch(operation.patch);
      try {
        await adapter.assertEventWrite(
          link.userID,
          link.accountID,
          link.externalCalendarID,
          {
            ...operation,
            external: external ?? undefined,
          },
        );
      } catch (error) {
        if (
          error instanceof EventWriteError ||
          error instanceof ProviderAuthError ||
          error instanceof ProviderEventWriteError
        )
          throw error;
        throw new EventWriteError("event-write", "unknown");
      }
      prepared.push({
        operation,
        calendarID,
        link,
        adapter,
        external,
        receipt: {
          action: operation.action,
          eventID: operation.event.id,
          calendarID,
          provider: link.provider,
          accountID: link.accountID,
          externalCalendarID: link.externalCalendarID,
          externalEventID: external?.externalEventId,
          status: "not-attempted",
        },
      });
    }
  }
  let failure: EventDeliveryError | undefined;
  return async (
    onlyAction?: EventWriteOperation["action"],
    committedRevision?: number | ReadonlyMap<string, number>,
  ) => {
    if (failure) throw failure;
    for (const {
      operation,
      calendarID,
      link,
      adapter,
      external,
      receipt,
    } of prepared) {
      const acceptedRevision = typeof committedRevision === "number"
        ? committedRevision : committedRevision?.get(operation.event.id);
      const { action, event } = operation;
      if (onlyAction && action !== onlyAction) continue;
      // A closure is single-attempt; calling it again cannot retry a conflict
      // or re-send completed creates/deletes. Reconciliation is a new request.
      if (receipt.status !== "not-attempted") continue;
      try {
        if (action === "create") {
          const external = await adapter.pushCreate(
            link.userID,
            link.accountID,
            link.externalCalendarID,
            event,
          );
          receipt.externalEventID = external.externalEventId;
          const accepted = await importExternalEvent(
            link.provider,
            event.id,
            calendarID,
            link.externalCalendarID,
            external.externalEventId,
            external.etag ?? null,
            external.icalUid ?? null,
            acceptedRevision,
          );
          if (!accepted)
            throw new ProviderEventWriteError(
              "provider-write-failed",
              "unconfirmed",
            );
        } else {
          if (!external) {
            receipt.status = "not-needed";
            continue;
          }
          if (action === "update") {
            const result = await adapter.pushUpdate(
              link.userID,
              link.accountID,
              link.externalCalendarID,
              external.externalEventId,
              event,
              external,
              operation.patch,
            );
            if (result) {
              const accepted = await setExternalEventSyncData(
                link.provider,
                event.id,
                link.externalCalendarID,
                {
                  etag: result.etag ?? null,
                  icalUid: result.icalUid ?? external.icalUid ?? null,
                },
                calendarID,
                acceptedRevision === undefined
                  ? undefined
                  : {
                      revision: acceptedRevision,
                      etag: external.etag,
                      externalEventID: external.externalEventId,
                    },
              );
              if (!accepted)
                throw new ProviderEventWriteError(
                  "provider-write-failed",
                  "unconfirmed",
                );
            }
          } else {
            await adapter.pushDelete(
              link.userID,
              link.accountID,
              link.externalCalendarID,
              external.externalEventId,
              external,
            );
          }
        }
        receipt.status = "completed";
      } catch (e) {
        receipt.status =
          e instanceof ProviderEventWriteError
            ? e.code === "provider-conflict"
              ? "conflict"
              : e.outcome
            : "unconfirmed";
        recordExternalSyncFailure("push", link.provider);
        logger.error("sync.push.failed", {
          action,
          provider: link.provider,
          userId: link.userID,
          accountId: link.accountID,
          calendarId: calendarID,
          eventId: event.id,
          error: e,
        });
        failure = new EventDeliveryError(
          prepared.map(({ receipt }) => ({ ...receipt })),
          e instanceof Error
            ? e
            : new Error("Unknown provider delivery failure"),
        );
        throw failure;
      }
    }
    return prepared.map(({ receipt }) => ({ ...receipt }));
  };
}

export async function pushTaskToCalendar(
  task: Task,
  action: "create" | "update" | "delete",
) {
  const link = await getExternalLinkForCalendar(task.calendarID);
  if (!link?.supportsTasks) return;
  const adapter = getAdapter(link.provider);
  if (
    !adapter?.pushTaskCreate ||
    !adapter.pushTaskUpdate ||
    !adapter.pushTaskDelete
  )
    return;

  try {
    const external = await getExternalTask(
      link.provider,
      task.id,
      link.externalCalendarID,
    );
    if (action === "delete") {
      if (!external) return;
      await adapter.pushTaskDelete(
        link.userID,
        link.accountID,
        link.externalCalendarID,
        external.externalTaskId,
        external,
      );
      return;
    }

    if (!external) {
      const created = await adapter.pushTaskCreate(
        link.userID,
        link.accountID,
        link.externalCalendarID,
        task,
      );
      await importExternalTask(
        link.provider,
        task.id,
        task.calendarID,
        link.externalCalendarID,
        created.externalTaskId,
        created.etag ?? null,
        created.icalUid ?? null,
      );
      return;
    }

    const result = await adapter.pushTaskUpdate(
      link.userID,
      link.accountID,
      link.externalCalendarID,
      external.externalTaskId,
      task,
      external,
    );
    if (result) {
      await setExternalTaskSyncData(
        link.provider,
        task.id,
        link.externalCalendarID,
        {
          etag: result.etag ?? null,
          icalUid: result.icalUid ?? external.icalUid ?? null,
        },
      );
    }
  } catch (error) {
    recordExternalSyncFailure("push", link.provider);
    logger.error("sync.task.push.failed", {
      action,
      provider: link.provider,
      userId: link.userID,
      accountId: link.accountID,
      calendarId: task.calendarID,
      taskId: task.id,
      error,
    });
  }
}
