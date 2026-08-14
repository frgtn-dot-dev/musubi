import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { clear, createStore, del, get, set } from "idb-keyval";
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE_MS,
  cacheNamespace,
} from "./cache-version";
import {
  capEventRanges,
  isSnapshotUsable,
  reviveQueries,
  shouldPersistQuery,
  type Snapshot,
} from "./snapshot";

const DATABASE = "musubi-offline";
const STORE = "query-cache";
const SNAPSHOT_KEY = "snapshot";
/** Long enough that a burst of invalidations writes once, short enough to survive a close. */
const WRITE_DELAY_MS = 1_000;

// IndexedDB, not localStorage: event payloads are too big for a 5 MB synchronous
// store, and blocking the main thread to save a calendar is the wrong trade
// (`02-tooling-and-stack.md:16`).
const store = () => createStore(DATABASE, STORE);

// Every persister that is currently saving. `clearAllSnapshots` silences them
// before it wipes the store: a write scheduled a moment earlier would otherwise
// land a moment later and put back what sign-out just removed.
const writers = new Set<() => void>();

function snapshotKey(namespace: string) {
  return `${namespace}:${SNAPSHOT_KEY}`;
}

/**
 * Persist the query cache for one account on one server, and restore it on the
 * next start.
 *
 * The snapshot is a cache, never a second authority: the server stays the source
 * of truth, and everything restored is immediately refetched when there is a
 * network (`01-target-architecture.md:10`).
 */
export function createSnapshotPersister({
  maxAgeMs = CACHE_MAX_AGE_MS,
  origin,
  queryClient,
  userId,
}: {
  maxAgeMs?: number;
  origin: string;
  queryClient: QueryClient;
  userId: string;
}) {
  const namespace = cacheNamespace(origin, userId);
  const key = snapshotKey(namespace);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  // Restoring writes to the cache, which would immediately schedule a write of
  // what we just read. Nothing is saved until the restore is done.
  let restoring = true;

  async function write() {
    timer = undefined;
    if (restoring) return;

    const state = dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: shouldPersistQuery,
    });
    const snapshot: Snapshot = {
      buster: CACHE_BUSTER,
      savedAt: Date.now(),
      state: { ...state, queries: capEventRanges(state.queries) },
    };

    try {
      await set(key, snapshot, store());
    } catch {
      // A full or blocked store is not worth breaking the app over; the cache is
      // an optimisation, and the next write will try again.
    }
  }

  function schedule() {
    if (restoring || timer) return;
    timer = setTimeout(() => void write(), WRITE_DELAY_MS);
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    restoring = true;
    writers.delete(stop);
  }

  return {
    /** Read the snapshot into the cache. Resolves once, restored or not. */
    async restore() {
      try {
        const snapshot = await get<Snapshot>(key, store());

        if (isSnapshotUsable(snapshot, maxAgeMs)) {
          hydrate(queryClient, {
            ...snapshot.state,
            queries: reviveQueries(snapshot.state.queries),
          });
          return { restored: true, savedAt: snapshot.savedAt };
        }

        // A stale or foreign-build snapshot is removed rather than left to rot.
        if (snapshot) await del(key, store()).catch(() => undefined);
      } catch {
        // Private mode, a blocked database, a corrupt record: start empty.
      }

      return { restored: false, savedAt: undefined };
    },

    /** Start saving. Call after `restore()`, or the first write echoes the read. */
    subscribe() {
      restoring = false;
      unsubscribe = queryClient.getQueryCache().subscribe(schedule);
      writers.add(stop);
      // Saving only on the next cache event would mean a client that is already
      // loaded and then goes quiet never gets written at all.
      schedule();
      return stop;
    },

    stop,

    /** Drop this account's snapshot. Part of the sign-out sequence. */
    async remove() {
      stop();
      await del(key, store()).catch(() => undefined);
    },
  };
}

/**
 * Remove every snapshot in the database, whoever wrote it.
 *
 * The teardown for a shared computer: on sign-out the namespace of the account
 * that is leaving must go, and anything left behind by an earlier account has no
 * business surviving either (`06-settings-pages-sync.md:167-175`).
 */
export async function clearAllSnapshots() {
  // Silence first, then wipe. Sign-out empties the query cache on its way here,
  // and that emptying is itself a cache event: it schedules a write that would
  // land after the wipe and recreate the leaving account's key. The provider
  // that owns the persister is still mounted at this point — it only unmounts
  // once the navigation to the login route happens, which is later.
  for (const stop of [...writers]) stop();
  await clear(store()).catch(() => undefined);
}
