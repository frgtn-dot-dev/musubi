import type { Request, Response } from "express";
import {
  getEventDeliveryStatus,
  requestEventDeliveryRetry,
  EventDeliveryRetryError,
} from "@musubi/db";
import { BadRequestError } from "@musubi/types";
import { deliverEventOutboxAndNotify } from "../sync/engine";
import { requireUUID } from "../request_validation";

export async function handlerGetEventDelivery(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const status = await getEventDeliveryStatus(req.user!.id, eventID);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(status);
}

export async function handlerRetryEventDelivery(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const operationID = requireUUID(req.params.operationId, "operationId");
  if (
    req.body != null &&
    (typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length)
  )
    throw new BadRequestError(
      "Retry does not accept changes to the saved operation.",
    );
  try {
    await requestEventDeliveryRetry(req.user!.id, eventID, operationID);
  } catch (error) {
    if (!(error instanceof EventDeliveryRetryError)) throw error;
    return res.status(409).json({ error: error.message, code: error.code });
  }
  const status = await getEventDeliveryStatus(req.user!.id, eventID);
  // Commit precedes this best-effort wakeup. Process termination leaves the same
  // durable operation for the scheduler; the response promises only admission.
  void deliverEventOutboxAndNotify(operationID);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(202).json(status);
}
