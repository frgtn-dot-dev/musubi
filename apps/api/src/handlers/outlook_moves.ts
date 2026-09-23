import { assertCanViewEvent } from "../permissions";
import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "@musubi/config";
import { BadRequestError } from "@musubi/types";
import { getEventSnapshot, latestOutlookMove, outlookMoveResult, readOutlookMove, startOutlookMove } from "@musubi/db";
import { outlookMoveChoices, previewOutlookMove } from "../sync/outlook_moves";

async function target(req: Request) {
  const eventID = z.uuid().parse(req.params.eventId);
  await assertCanViewEvent(req.user!.id, eventID);
  const event = await getEventSnapshot(eventID);
  if (!event?.originCalendarID) throw new BadRequestError("This event has no Outlook source.");
  return { eventID, calendarID: event.originCalendarID };
}
export async function handlerOutlookMoveOptions(req: Request, res: Response) {
  const { eventID, calendarID } = await target(req);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await outlookMoveChoices(req.user!.id, eventID, calendarID));
}
export async function handlerLatestOutlookMove(req: Request, res: Response) {
  const { eventID, calendarID } = await target(req);
  res.setHeader("Cache-Control", "private, no-store");
  const row = await latestOutlookMove(req.user!.id, eventID, calendarID);
  res.json(row ? outlookMoveResult(row) : null);
}
export async function handlerPreviewOutlookMove(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(outlookMoveResult(await previewOutlookMove(req.user!.id, req.body)));
}
export async function handlerReadOutlookMove(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(outlookMoveResult(await readOutlookMove(req.user!.id, z.uuid().parse(req.params.operationId))));
}
export async function handlerStartOutlookMove(req: Request, res: Response) {
  if (!config.api.eventTimeEditsEnabled) throw new BadRequestError("Time editing is not available.");
  res.setHeader("Cache-Control", "private, no-store");
  res.status(202).json(outlookMoveResult(await startOutlookMove(req.user!.id, z.uuid().parse(req.params.operationId))));
}
