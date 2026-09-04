import type { Request, Response } from "express";
import {
  BadRequestError,
  NotFoundError,
  TaskCreateSchema,
  TaskUpdateSchema,
  type TaskCreate,
  type TaskUpdate,
} from "@musubi/types";
import {
  createTask,
  getExternalLinkForCalendar,
  getTask,
  getUserTask,
  getUserTasks,
  removeTask,
  updateTask,
  type TaskMutation,
} from "@musubi/db";
import { assertCan } from "../permissions";
import { requireUUID } from "../request_validation";
import { pushTaskToCalendar } from "../sync/engine";

function normalizeCompletion<T extends TaskCreate | TaskUpdate>(task: T): T {
  if (task.status !== "completed") return task;
  return {
    ...task,
    completedAt: task.completedAt ?? new Date(),
    percentComplete: 100,
  };
}

function toMutation(task: TaskCreate | TaskUpdate): TaskMutation {
  return {
    calendarID: task.calendarID,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    start: task.start ?? null,
    due: task.due ?? null,
    isAllDay: task.isAllDay,
    completedAt: task.completedAt ?? null,
    percentComplete: task.percentComplete,
    priority: task.priority,
    recurrence: task.recurrence ?? null,
    relatedTo: task.relatedTo ?? null,
    url: task.url ?? null,
  };
}

export function parseTaskCreateBody(body: unknown) {
  try {
    const task = normalizeCompletion(TaskCreateSchema.parse(body));
    return {
      ...task,
      id: requireUUID(task.id, "task.id"),
      calendarID: requireUUID(task.calendarID, "task.calendarID"),
    };
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError("Request is missing valid task data...");
  }
}

export function parseTaskUpdateBody(body: unknown) {
  try {
    const task = normalizeCompletion(TaskUpdateSchema.parse(body));
    return {
      ...task,
      calendarID: requireUUID(task.calendarID, "task.calendarID"),
    };
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError("Request is missing valid task data...");
  }
}

async function assertTaskCapableCalendar(calendarID: string) {
  const link = await getExternalLinkForCalendar(calendarID);
  if (link && !link.supportsTasks) {
    throw new BadRequestError(
      "This external calendar does not support tasks...",
    );
  }
}

export async function handlerGetTasks(req: Request, res: Response) {
  res.status(200).json({ tasks: await getUserTasks(req.user!.id) });
}

export async function handlerGetTask(req: Request, res: Response) {
  const taskID = requireUUID(req.params.taskId, "taskId");
  const task = await getUserTask(req.user!.id, taskID);
  if (!task) throw new NotFoundError("Task not found...");
  res.status(200).json(task);
}

export async function handlerCreateTask(req: Request, res: Response) {
  const input = parseTaskCreateBody(req.body);
  await assertCan(req.user!.id, input.calendarID, "editTasks");
  await assertTaskCapableCalendar(input.calendarID);
  const task = await createTask({
    ...toMutation(input),
    id: input.id,
    creatorID: req.user!.id,
  });
  await pushTaskToCalendar(task, "create");
  res.status(201).json(task);
}

export async function handlerUpdateTask(req: Request, res: Response) {
  const taskID = requireUUID(req.params.taskId, "taskId");
  const existing = await getTask(taskID);
  if (!existing) throw new NotFoundError("Task not found...");
  await assertCan(req.user!.id, existing.calendarID, "editTasks");
  await assertTaskCapableCalendar(existing.calendarID);

  const input = parseTaskUpdateBody(req.body);
  if (input.calendarID !== existing.calendarID) {
    throw new BadRequestError(
      "Moving tasks between calendars is not supported yet...",
    );
  }
  const task = await updateTask(taskID, toMutation(input));
  if (!task) throw new NotFoundError("Task not found...");
  await pushTaskToCalendar(task, "update");
  res.status(200).json(task);
}

export async function handlerRemoveTask(req: Request, res: Response) {
  const taskID = requireUUID(req.params.taskId, "taskId");
  const existing = await getTask(taskID);
  if (!existing) throw new NotFoundError("Task not found...");
  await assertCan(req.user!.id, existing.calendarID, "editTasks");
  const task = await removeTask(taskID);
  if (!task) throw new NotFoundError("Task not found...");
  await pushTaskToCalendar(task, "delete");
  res.sendStatus(204);
}
