import { config } from "@musubi/config";
import { getEventShare, getSharedEventId } from "@musubi/db";
import {
  BadRequestError,
  EventPageContentSchema,
  NotFoundError,
} from "@musubi/types";
import type { Request, Response } from "express";
import {
  getMedia,
  putMedia,
  sniffImageMime,
  withMediaLock,
} from "../media_storage";
import { assertCanEditEvent } from "../permissions";

const COVER_MAX_BYTES = 5 * 1024 * 1024;
const coverKey = (eventID: string) =>
  `event-covers/${encodeURIComponent(eventID)}`;

export async function handlerPutEventCover(req: Request, res: Response) {
  const eventID = String(req.params.eventId);
  await assertCanEditEvent(req.user!.id, eventID);
  const share = await getEventShare(eventID);
  if (!share)
    throw new NotFoundError("Publish the event before adding a cover.");

  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (data.length === 0 || data.length > COVER_MAX_BYTES) {
    throw new BadRequestError("Cover must be a non-empty image up to 5 MB.");
  }
  const mimeType = sniffImageMime(data);
  if (!mimeType) {
    throw new BadRequestError("Cover must be a JPEG, PNG or WebP image.");
  }

  await withMediaLock(coverKey(eventID), () =>
    putMedia(coverKey(eventID), data, mimeType),
  );
  res.status(200).json({
    url: `${config.api.url}/api/v1/public/events/${share.token}/cover?v=${Date.now()}`,
  });
}

export async function handlerGetPublicEventCover(req: Request, res: Response) {
  const share = await getSharedEventId(String(req.params.token));
  if (
    !share ||
    EventPageContentSchema.parse(share.content ?? {}).cover.source !== "upload"
  ) {
    throw new NotFoundError("This event has no uploaded cover...");
  }
  const media = await getMedia(coverKey(share.eventID));
  if (!media) throw new NotFoundError("This event has no uploaded cover...");

  res.setHeader("Content-Type", media.mimeType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(media.data);
}
