import {
  CalendarSchema,
  EventSchema,
  SettingsSchema,
} from "@musubi/types";
import { z } from "zod";

export const CalendarsResponseSchema = z.array(CalendarSchema);

export const EventsResponseSchema = z.object({
  deletedIds: z.array(z.string()),
  events: z.array(EventSchema),
  serverTime: z.string(),
});

export const RemoveEventResponseSchema = z.object({
  calendars: z.array(z.string()),
  id: z.string(),
  removed: z.boolean(),
});

export const SettingsResponseSchema = SettingsSchema;

export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type RemoveEventResponse = z.infer<
  typeof RemoveEventResponseSchema
>;
