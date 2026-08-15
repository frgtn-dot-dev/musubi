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

type ReminderDependencies = {
  assertCanView?: typeof assertCanViewEvent;
  getDocument?: typeof getRemindersDocument;
  notify?: typeof notifyCalendarMembers;
  setCalendar?: typeof setCalendarReminder;
  setEvent?: typeof setEventReminder;
};

export function createReminderHandlers(
  dependencies: ReminderDependencies = {},
) {
  const assertCanView = dependencies.assertCanView ?? assertCanViewEvent;
  const getDocument = dependencies.getDocument ?? getRemindersDocument;
  const notify = dependencies.notify ?? notifyCalendarMembers;
  const setCalendar = dependencies.setCalendar ?? setCalendarReminder;
  const setEvent = dependencies.setEvent ?? setEventReminder;

  function notifyOwnDevices(userID: string) {
    notify([userID], "reminders_updated", {});
  }

  return {
    async getReminders(req: Request, res: Response) {
      res.status(200).json(await getDocument(req.user!.id));
    },

    async putCalendarReminder(req: Request, res: Response) {
      const calendarID = requireUUID(req.params.calendarId, "calendarId");
      const rule = parseRule(req.body);

      // Membership IS the permission: the rule lives on the membership row, and
      // a viewer is as entitled to a reminder as an owner. No role check beyond
      // that — but a non-member must not be able to probe for calendar ids by
      // watching which writes succeed.
      const member = await setCalendar(req.user!.id, calendarID, rule);
      if (!member) {
        throw new ForbiddenError("You are not a member of this calendar.");
      }

      notifyOwnDevices(req.user!.id);
      res.status(204).end();
    },

    async putEventReminder(req: Request, res: Response) {
      const eventID = requireUUID(req.params.eventId, "eventId");
      const rule = parseRule(req.body);

      // Seeing the event is enough. Wanting to be reminded about something is
      // not an edit, and plenty of reminders are for events nobody can change.
      await assertCanView(req.user!.id, eventID);
      await setEvent(req.user!.id, eventID, rule);

      notifyOwnDevices(req.user!.id);
      res.status(204).end();
    },

    async deleteEventReminder(req: Request, res: Response) {
      const eventID = requireUUID(req.params.eventId, "eventId");
      await assertCanView(req.user!.id, eventID);
      await setEvent(req.user!.id, eventID, null);

      notifyOwnDevices(req.user!.id);
      res.status(204).end();
    },
  };
}

const handlers = createReminderHandlers();

export const handlerGetReminders = handlers.getReminders;
export const handlerPutCalendarReminder = handlers.putCalendarReminder;
export const handlerPutEventReminder = handlers.putEventReminder;
export const handlerDeleteEventReminder = handlers.deleteEventReminder;
