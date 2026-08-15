import {
  getRemindersDocument,
  setCalendarReminder,
  setEventReminder,
} from "@musubi/db";
import {
  BadRequestError,
  ForbiddenError,
  PutReminderRequestSchema,
} from "@musubi/types";
import type { Request, Response } from "express";
import { assertCanViewEvent } from "../permissions";
import { requireUUID } from "../request_validation";
import { notifyCalendarMembers } from "./stream";

// Reminder rules belong to one person. Nobody else is told when somebody's
// phone will buzz, so every broadcast here fans out to the caller alone — the
// point of the SSE is the caller's OTHER devices, which have to reschedule.

function parseRule(body: unknown) {
  const parsed = PutReminderRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError(
      "Body must be { rule } — a reminder rule, or null to inherit.",
    );
  }
  return parsed.data.rule;
}

async function notifyOwnDevices(userID: string) {
  notifyCalendarMembers([userID], "reminders_updated", {});
}

export async function handlerGetReminders(req: Request, res: Response) {
  res.status(200).json(await getRemindersDocument(req.user!.id));
}

export async function handlerPutCalendarReminder(req: Request, res: Response) {
  const calendarID = requireUUID(req.params.calendarId, "calendarId");
  const rule = parseRule(req.body);

  // Membership IS the permission: the rule lives on the membership row, and a
  // viewer is as entitled to a reminder as an owner. No role check beyond that.
  const member = await setCalendarReminder(req.user!.id, calendarID, rule);
  if (!member) throw new ForbiddenError("You are not a member of this calendar.");

  await notifyOwnDevices(req.user!.id);
  res.status(204).end();
}

export async function handlerPutEventReminder(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const rule = parseRule(req.body);

  // Seeing the event is enough. Wanting to be reminded about something is not
  // an edit, and plenty of reminders are for events the user cannot change.
  await assertCanViewEvent(req.user!.id, eventID);
  await setEventReminder(req.user!.id, eventID, rule);

  await notifyOwnDevices(req.user!.id);
  res.status(204).end();
}

export async function handlerDeleteEventReminder(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  await assertCanViewEvent(req.user!.id, eventID);
  await setEventReminder(req.user!.id, eventID, null);

  await notifyOwnDevices(req.user!.id);
  res.status(204).end();
}
