import { CalendarSchema, EventSchema } from "@musubi/types";
import type { DehydratedState } from "@tanstack/react-query";
import { z } from "zod";
import {
 CalendarsResponseSchema,
 EventsResponseSchema,
 PagesResponseSchema,
 SettingsResponseSchema,
} from "~/api/contracts";
import { CACHE_BUSTER, CACHE_EVENT_RANGE_LIMIT } from "./cache-version";

/**
 * What a snapshot is allowed to hold, keyed by the first segment of the query
 * key. A whitelist rather than a blocklist: a query added later is not cached
 * until someone decides it should be, which is the safe direction for a store
 * that outlives the tab.
 *
 * Deliberately absent — `07-realtime-offline-federation.md:108-110`: `session`
 * (Better Auth owns it), `members`, `invites` and `attendees` (per-dialog detail
 * nobody needs offline), `server-capabilities` (a handshake, not data).
 */
const CACHEABLE = {
 calendars: CalendarsResponseSchema,
 events: EventsResponseSchema,
 // A composed shape rather than a contract of its own: the federated query
 // stitches remote calendars and events together client-side.
 federated: z.object({
  calendars: z.array(CalendarSchema),
  events: z.array(EventSchema),
  servers: z.array(
   z.object({
    connectionId: z.string(),
    label: z.string(),
    server: z.string(),
    state: z.enum(["active", "unauthorized", "unreachable"]),
   }),
  ),
 }),
 pages: PagesResponseSchema,
 settings: SettingsResponseSchema,
} as const;

type CacheableName = keyof typeof CACHEABLE;

export type Snapshot = {
 buster: string;
 savedAt: number;
 state: DehydratedState;
};

function nameOf(queryKey: readonly unknown[]): CacheableName | undefined {
 const [name] = queryKey;
 return typeof name === "string" && name in CACHEABLE
  ? (name as CacheableName)
  : undefined;
}

/**
 * Whether a query belongs in the snapshot at all.
 *
 * Only successful ones with data: an error is a moment in time, and restoring it
 * would greet the user with a failure that may no longer be true. Paused
 * mutations stay out for the same reason a write queue is out of scope — nothing
 * offline may look saved.
 */
export function shouldPersistQuery(query: {
 queryKey: readonly unknown[];
 state: { data: unknown; status: string };
}) {
 return query.state.status === "success" && query.state.data !== undefined
  ? Boolean(nameOf(query.queryKey))
  : false;
}

/**
 * Keep the most recently used event windows and drop the rest.
 *
 * Every date step makes another cache entry holding a full payload, so a week of
 * browsing would otherwise grow the snapshot without bound. Recency is measured
 * by when the data last arrived, which is the closest thing the cache has to
 * "when the user last looked at this".
 */
export function capEventRanges(
 queries: DehydratedState["queries"],
 limit = CACHE_EVENT_RANGE_LIMIT,
): DehydratedState["queries"] {
 const ranges = queries.filter((query) => nameOf(query.queryKey) === "events");
 if (ranges.length <= limit) return queries;

 const keep = new Set(
  [...ranges]
   .sort(
    (first, second) =>
     (second.state.dataUpdatedAt ?? 0) - (first.state.dataUpdatedAt ?? 0),
   )
   .slice(0, limit),
 );

 return queries.filter(
  (query) => nameOf(query.queryKey) !== "events" || keep.has(query),
 );
}

/**
 * Re-validate a restored entry through the contract it came from.
 *
 * This is what makes `event.start` a `Date` again: JSON has no date type, and
 * `z.coerce.date()` in the contracts is already the app's answer to that. It also
 * means a snapshot written by a shape the current build cannot parse is dropped
 * rather than rendered — the entry goes, the rest of the snapshot stays.
 */
export function reviveQueries(
 queries: DehydratedState["queries"],
): DehydratedState["queries"] {
 return queries.flatMap((query) => {
  const name = nameOf(query.queryKey);
  if (!name) return [];

  const parsed = CACHEABLE[name].safeParse(query.state.data);
  if (!parsed.success) return [];

  return [{ ...query, state: { ...query.state, data: parsed.data } }];
 });
}

/** A snapshot is usable when the same build wrote it and it is not too old. */
export function isSnapshotUsable(
 snapshot: Snapshot | undefined,
 maxAgeMs: number,
 now = Date.now(),
): snapshot is Snapshot {
 if (!snapshot || snapshot.buster !== CACHE_BUSTER) return false;
 const age = now - snapshot.savedAt;
 return age >= 0 && age <= maxAgeMs;
}
