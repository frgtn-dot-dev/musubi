import type { Request, Response } from "express";
import {
  getEventDeliveryStatus,
  getEventDeliveryInbox,
  requestEventDeliveryRetry,
  EventDeliveryRetryError,
  EventDeliveryResolutionError,
  getEventDeliveryResolutionReplay,
  commitEventDeliveryResolution,
} from "@musubi/db";
import {
  BadRequestError,
  ResolveEventDeliveryRequestSchema,
} from "@musubi/types";
import { prepareEventDeliveryResolution } from "../sync/event_resolution";
import { deliverEventOutboxAndNotify } from "../sync/engine";
import { requireUUID } from "../request_validation";

export async function handlerGetEventDeliveryInbox(
  req: Request,
  res: Response,
) {
  if (Object.keys(req.query).some((key) => key !== "cursor"))
    throw new BadRequestError("Only a cursor may be supplied.");
  const cursor =
    req.query.cursor === undefined
      ? undefined
      : requireUUID(req.query.cursor, "cursor");
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(await getEventDeliveryInbox(req.user!.id, cursor));
}

export async function handlerGetEventDelivery(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const status = await getEventDeliveryStatus(req.user!.id, eventID);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(status);
}

export async function handlerGetEventDeliveryConflict(
  req: Request,
  res: Response,
) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const operationID = requireUUID(req.params.operationId, "operationId");
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const { preview } = await prepareEventDeliveryResolution(
      req.user!.id,
      eventID,
      operationID,
    );
    return res.json(preview);
  } catch (error) {
    if (!(
      error instanceof EventDeliveryResolutionError ||
      error instanceof EventDeliveryRetryError
    ))
      throw error;
    return res.status(409).json({ error: error.message, code: error.code });
  }
}

export async function handlerResolveEventDelivery(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const operationID = requireUUID(req.params.operationId, "operationId");
  const parsed = ResolveEventDeliveryRequestSchema.safeParse(req.body);
  if (!parsed.success)
    throw new BadRequestError(
      "A resolution requires the exact preview and a new mutation identity.",
    );
  const request = {
    ...parsed.data,
    mutationId: parsed.data.mutationId.toLowerCase(),
    expectedLatestOperationId:
      parsed.data.expectedLatestOperationId.toLowerCase(),
  };
  res.setHeader("Cache-Control", "private, no-store");
  try {
    let id = await getEventDeliveryResolutionReplay(
      req.user!.id,
      eventID,
      operationID,
      request,
    );
    if (!id) {
      const { proof, preview } = await prepareEventDeliveryResolution(
        req.user!.id,
        eventID,
        operationID,
      );
      if (!preview.canResolve)
        throw new EventDeliveryResolutionError(
          "delivery-resolution-unavailable",
        );
      id = await commitEventDeliveryResolution(req.user!.id, proof, request);
    }
    const status = await getEventDeliveryStatus(req.user!.id, eventID);
    void deliverEventOutboxAndNotify(id);
    return res.status(202).json(status);
  } catch (error) {
    if (!(
      error instanceof EventDeliveryResolutionError ||
      error instanceof EventDeliveryRetryError
    ))
      throw error;
    return res.status(409).json({ error: error.message, code: error.code });
  }
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
