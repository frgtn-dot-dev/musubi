import { notifyCalendarMembers } from "./stream";
import { getCalendarMembers } from "@musubi/db";
import { prepareGraphCreateAdoption } from "../sync/graph_create_adoption";
import { adoptGraphCreatedFamily, graphCreateAdoptionReplay } from "@musubi/db";
import { GraphCreateAdoptionRequestSchema } from "@musubi/types";
import { discardCaldavAlarm } from "@musubi/db";
import { z } from "zod";
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
  EventWriteError,
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
    const adoption = await prepareGraphCreateAdoption(req.user!.id, eventID, operationID);
    if (adoption) return res.json(adoption.preview);
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
  if (req.body?.kind === "graph-create-adoption") {
    const request = GraphCreateAdoptionRequestSchema.parse(req.body);
    res.setHeader("Cache-Control", "private, no-store");
    try {
      if (!await graphCreateAdoptionReplay(req.user!.id, eventID, operationID, request)) {
        const prepared = await prepareGraphCreateAdoption(req.user!.id, eventID, operationID);
        if (!prepared) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
        await adoptGraphCreatedFamily(prepared.context, prepared.observation, request);
        // Post-commit refresh only. Delivery retirement must not dispatch a write.
        void getCalendarMembers(prepared.context.row.calendarID).then(members => notifyCalendarMembers([...new Set([req.user!.id, ...members.map(member => member.userID)])], "external_sync", { calendars: [prepared.context.row.calendarID] })).catch(() => undefined);
      }
      return res.json(await getEventDeliveryStatus(req.user!.id, eventID));
    } catch { return res.status(409).json({ error: "The provider family or saved creation changed. Load a fresh comparison before accepting it." }); }
  }
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

export async function handlerDiscardEventAlarm(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId"), operationID = requireUUID(req.params.operationId, "operationId");
  const body = z.object({ expectedRevision: z.number().int().positive() }).strict().safeParse(req.body);
  if (!body.success) throw new BadRequestError("Discard requires the exact saved alarm revision.");
  try { await discardCaldavAlarm(req.user!.id, eventID, operationID, body.data.expectedRevision); }
  catch (error) {
    if (error instanceof EventDeliveryRetryError || error instanceof EventWriteError) return res.status(409).json({ error: "The saved alarm or its source changed. Refresh delivery details before discarding." });
    throw error;
  }
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(await getEventDeliveryStatus(req.user!.id, eventID));
}
