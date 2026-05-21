import { z } from "zod";

export const EventSchema = z.object({
  id: z.string().optional(),
  creatorID: z.string(),
  organizer: z.string(),
  title: z.string(),
  color: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  calendars: z.array(z.string()),
  isCanceled: z.boolean(),
  isAllDay: z.boolean(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  recurrence: z.string().nullish(),
  url: z.string().nullish(),
});

export type Event = z.infer<typeof EventSchema>;
