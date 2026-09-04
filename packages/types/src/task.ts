import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "needs-action",
  "in-process",
  "completed",
  "cancelled",
]);

export const TaskSchema = z.object({
  id: z.string(),
  creatorID: z.string(),
  calendarID: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  status: TaskStatusSchema.default("needs-action"),
  start: z.coerce.date().nullish(),
  due: z.coerce.date().nullish(),
  isAllDay: z.boolean().default(false),
  completedAt: z.coerce.date().nullish(),
  percentComplete: z.number().int().min(0).max(100).default(0),
  priority: z.number().int().min(0).max(9).default(0),
  recurrence: z.string().nullish(),
  relatedTo: z.string().nullish(),
  sequence: z.number().int().nonnegative().default(0),
  url: z.string().nullish(),
});

export const TaskCreateSchema = TaskSchema.omit({
  creatorID: true,
  sequence: true,
});
export const TaskUpdateSchema = TaskCreateSchema.omit({ id: true });

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
