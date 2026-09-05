import { z } from "zod";

export const EventRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const EventSchema = z.object({
  id: z.string(),
  // Optional only for old disk caches. Absence never grants a writable revision.
  revision: EventRevisionSchema.optional(),
  creatorID: z.string(),
  organizer: z.string(),
  title: z.string(),
  color: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  calendars: z.array(z.string()),
  originCalendarID: z.string().nullish(),
  isCanceled: z.boolean(),
  isAllDay: z.boolean(),
  hasAttendees: z.boolean().default(false),
  description: z.string().nullish(),
  location: z.string().nullish(),
  recurrence: z.string().nullish(),
  url: z.string().nullish(),
});

export type Event = z.infer<typeof EventSchema>;

const eventWriteDate = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .pipe(z.coerce.date());
export const EventCreateRequestSchema = EventSchema.omit({ revision: true })
  .extend({ start: eventWriteDate, end: eventWriteDate })
  .strict();
export const EventPatchSchema = EventSchema.omit({
  id: true,
  revision: true,
  creatorID: true,
  originCalendarID: true,
})
  .extend({
    // Read defaults must never turn an omitted PATCH field into a write.
    hasAttendees: z.boolean(),
    start: eventWriteDate,
    end: eventWriteDate,
  })
  .partial()
  .strict();
export type EventPatch = z.infer<typeof EventPatchSchema>;
const patchRequest = z
  .object({
    id: z.string().uuid(),
    expectedRevision: EventRevisionSchema,
    patch: EventPatchSchema,
  })
  .strict();
export const ScopeEditIntentSchema = z.object({
  updates: z.array(patchRequest).length(1),
  creates: z.array(EventCreateRequestSchema).max(1),
})
  .strict();
export const EventPatchRequestSchema = patchRequest.extend({
  scopeEdit: ScopeEditIntentSchema.optional(),
});
export type EventPatchRequest = z.infer<typeof EventPatchRequestSchema>;
export const EventDeleteRequestSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: EventRevisionSchema,
  })
  .strict();
export const EventUnlinkRequestSchema = EventDeleteRequestSchema.extend({
  unlinkCalendarID: z.string().uuid(),
});
export const EventLinkRequestSchema = z
  .object({
    calendarID: z.string().uuid(),
    expectedRevision: EventRevisionSchema,
  })
  .strict();
export const EventForkRequestSchema = EventLinkRequestSchema;

// UI request-only fields. Transports encode the distinct wire contracts above;
// EventSchema strips these fields before any cache, SSE or provider use.
export type EventWriteRequest = Event & {
  contentPatch?: EventPatch;
  scopeEdit?: { updates: EventWriteRequest[]; creates: Event[] };
};

export function requireEventRevision(event: Pick<Event, "revision">): number {
  const parsed = EventRevisionSchema.safeParse(event.revision);
  if (!parsed.success)
    throw new Error(
      "Refresh this event before editing. Its saved revision is unavailable.",
    );
  return parsed.data;
}

export function eventContentPatch(baseline: Event, edited: Event): EventPatch {
  const patch: EventPatch = {};
  const fields = Object.keys(EventPatchSchema.shape) as (keyof EventPatch)[];
  for (const key of fields) {
    const value = edited[key];
    if (value === undefined) continue;
    const comparable = (v: unknown) =>
      v instanceof Date
        ? v.toISOString()
        : Array.isArray(v)
          ? [...new Set(v)].sort().join("\n")
          : (v ?? null);
    if (comparable(value) !== comparable(baseline[key]))
      Object.assign(patch, { [key]: value });
  }
  return patch;
}

export function eventPatchRequest(event: EventWriteRequest): EventPatchRequest {
  const request = {
    id: event.id,
    expectedRevision: requireEventRevision(event),
    patch:
      event.contentPatch ??
      EventPatchSchema.parse(
        Object.fromEntries(
          Object.keys(EventPatchSchema.shape).map((key) => [
            key,
            event[key as keyof Event],
          ]),
        ),
      ),
  };
  return {
    ...request,
    ...(event.scopeEdit
      ? {
          scopeEdit: {
            updates: event.scopeEdit.updates.map((update) =>
              eventPatchRequest({ ...update, scopeEdit: undefined }),
            ),
            creates: event.scopeEdit.creates.map(eventCreateRequest),
          },
        }
      : {}),
  };
}

export function eventCreateRequest(
  event: Event,
): z.infer<typeof EventCreateRequestSchema> {
  const { revision: _revision, ...create } = EventSchema.parse(event);
  return EventCreateRequestSchema.parse(create);
}

export function editedEvent(baseline: Event, edited: Event): EventWriteRequest {
  return {
    ...edited,
    revision: baseline.revision,
    contentPatch: eventContentPatch(baseline, edited),
  };
}

export const EventMutationFailureSchema = z.object({
  error: z.string(),
  code: z.string(),
  localCommitted: z.boolean(),
  current: EventSchema.extend({
    deletedAt: z.coerce.date().nullish(),
  }).optional(),
  currentRevision: EventRevisionSchema.optional(),
  // Last committed snapshots are evidence, never confirmed-latest cache authority.
  committed: z.array(EventSchema.extend({ deletedAt: z.coerce.date().nullish() })).optional(),
});
export class EventMutationError extends Error {
  constructor(
    message: string,
    readonly localCommitted: boolean,
    readonly current?: Event & { deletedAt?: Date | null },
    readonly code?: string,
  ) {
    super(message);
    this.name = "EventMutationError";
  }
  static from(payload: unknown) {
    const parsed = EventMutationFailureSchema.parse(payload);
    return new EventMutationError(
      parsed.error,
      parsed.localCommitted,
      parsed.current,
      parsed.code,
    );
  }
}

/** A draft owns dates and links as well as content and the read revision. */
export function snapshotEvent(event: Event): Event {
  const snapshot = EventSchema.parse(event);
  return { ...snapshot, start: new Date(snapshot.start), end: new Date(snapshot.end), calendars: [...snapshot.calendars] };
}
