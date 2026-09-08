import { z } from "zod";
import { EventRevisionSchema, EventTimeContentPatchSchema } from "./event";
import { EventTimeEditSchema, OccurrenceStartSchema } from "./event_time";

const identity = {
  operationID: z.string().uuid().transform(value => value.toLowerCase()),
  expectedRevision: EventRevisionSchema,
  scope: z.enum(["occurrence", "following", "series"]),
  originalStart: OccurrenceStartSchema.optional(),
  // null identifies a generated occurrence; a persisted override supplies its
  // own revision in addition to the master revision.
  expectedOccurrenceRevision: EventRevisionSchema.nullable().optional(),
};
export const EventScopeRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("update"), patch: EventTimeContentPatchSchema, ensureDefinition: z.boolean().optional(), time: EventTimeEditSchema.optional() }).strict(),
  z.object({ ...identity, action: z.literal("delete") }).strict(),
]).superRefine((request, context) => {
  if (request.scope !== "series" && (!request.originalStart || request.expectedOccurrenceRevision === undefined))
    context.addIssue({ code: "custom", message: "Occurrence scopes require original identity and an explicit occurrence revision or null." });
  if (request.scope === "series" && (request.originalStart !== undefined || request.expectedOccurrenceRevision !== undefined))
    context.addIssue({ code: "custom", message: "Whole-series time is anchored at the master, not a displayed occurrence." });
  if (request.action === "update" && request.scope === "occurrence" && request.patch.recurrence !== undefined)
    context.addIssue({ code: "custom", message: "An occurrence cannot define recurrence." });
});
export type EventScopeRequest = z.infer<typeof EventScopeRequestSchema>;

const committedRevision = z.object({ id: z.string().uuid(), revision: EventRevisionSchema }).strict();
export const EventScopeOutcomeSchema = z.object({
  operationID: z.string().uuid(),
  changed: z.boolean(),
  events: z.array(committedRevision),
  deleted: z.array(committedRevision),
}).strict();
export type EventScopeOutcome = z.infer<typeof EventScopeOutcomeSchema>;
export const EventScopeResponseSchema = EventScopeOutcomeSchema.extend({
  localCommitted: z.literal(true),
  replayed: z.boolean(),
});
