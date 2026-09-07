import type { Request, Response } from "express";
import { getEventDeliveryStatus } from "@musubi/db";
import { requireUUID } from "../request_validation";

export async function handlerGetEventDelivery(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const status = await getEventDeliveryStatus(req.user!.id, eventID);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(status);
}
