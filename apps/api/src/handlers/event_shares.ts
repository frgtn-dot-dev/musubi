import { randomBytes } from "node:crypto";
import {
  getEventShare,
  getSharedEvent,
  revokeEventShare,
  upsertEventShare,
} from "@musubi/db";
import { BadRequestError, NotFoundError } from "@musubi/types";
import { Request, Response } from "express";
import { config } from "@musubi/config";
import { assertCanEditEvent } from "../permissions";

// `link` — anyone holding the URL. `public` — the same, and the page may say a
// crawler is welcome. Access and indexability are separate questions: a public
// event is not automatically an indexed one (PRD §17.1).
const MODES = new Set(["link", "public"]);

/**
 * 128 bits, hex. The URL is the credential, so it has to be unguessable in the
 * way a calendar invite token is — an event id would not be, since anyone who
 * has seen one event's id knows the shape of every other.
 */
function shareToken() {
  return randomBytes(16).toString("hex");
}

function shareUrl(token: string) {
  return `${config.api.url}/e/${token}`;
}

export async function handlerGetEventShare(req: Request, res: Response) {
  const eventID = String(req.params.eventId);
  await assertCanEditEvent(req.user!.id, eventID);
  const share = await getEventShare(eventID);

  res.status(200).json(
    share
      ? {
          indexable: share.indexable,
          mode: share.mode,
          token: share.token,
          url: shareUrl(share.token),
        }
      : null,
  );
}

/**
 * Publish an event, or change how it is published.
 *
 * Gated on editing the event, not on merely seeing it: publishing hands the
 * thing to the open internet, which is not a read.
 */
export async function handlerPutEventShare(req: Request, res: Response) {
  const eventID = String(req.params.eventId);
  const mode = String(req.body?.mode ?? "");
  const indexable = req.body?.indexable === true;

  if (!MODES.has(mode)) {
    throw new BadRequestError("mode must be 'link' or 'public'...");
  }
  // Indexing an unlisted page would be a contradiction the UI could not undo:
  // the link mode exists precisely to stay out of search results.
  if (indexable && mode !== "public") {
    throw new BadRequestError("Only a public event page can be indexable...");
  }

  await assertCanEditEvent(req.user!.id, eventID);

  const share = await upsertEventShare({
    createdBy: req.user!.id,
    eventID,
    indexable,
    mode,
    token: shareToken(),
  });

  res.status(200).json({
    indexable: share.indexable,
    mode: share.mode,
    token: share.token,
    url: shareUrl(share.token),
  });
}

export async function handlerRevokeEventShare(req: Request, res: Response) {
  const eventID = String(req.params.eventId);
  await assertCanEditEvent(req.user!.id, eventID);
  await revokeEventShare(eventID);

  res.sendStatus(204);
}

/**
 * What an anonymous reader gets. Public, rate-limited, and deliberately narrow.
 *
 * Everything absent here is absent on purpose: no attendees, no calendar name,
 * no other events, no ids that could be used to ask for more. The organizer's
 * display name is the one identity on the page, because "who is inviting me"
 * is the question a stranger legitimately has.
 */
export async function handlerGetPublicEvent(req: Request, res: Response) {
  const shared = await getSharedEvent(String(req.params.token));
  if (!shared) throw new NotFoundError("This event page is not available...");

  res.status(200).json(publicEventProjection(shared));
}

export type SharedEventRow = {
  description: null | string;
  end: Date;
  indexable: boolean;
  isAllDay: boolean;
  isCanceled: boolean;
  location: null | string;
  organizerName: string;
  recurrence: null | string;
  start: Date;
  title: string;
  url: null | string;
};

/**
 * Exactly what an anonymous reader gets — built key by key, never spread.
 *
 * A column added to the query behind this must not become public because
 * somebody wrote `{...row}`. The self-check pins the key set, so widening the
 * page is a decision made on purpose rather than a side effect.
 *
 * A recurring event ships its RULE and its series start, and the page works out
 * which occurrence is next. Expanding here would answer in the SERVER's
 * timezone: recurrence is wall-clock (see `packages/calendar/recurrence.ts`), so
 * a UTC container would tell a reader in Prague the wrong hour after a
 * daylight-saving change. The rule is not a secret — it is the schedule the page
 * exists to publish.
 */
export function publicEventProjection(shared: SharedEventRow) {
  return {
    description: shared.description,
    end: shared.end.toISOString(),
    indexable: shared.indexable,
    isAllDay: shared.isAllDay,
    isCanceled: shared.isCanceled,
    location: shared.location,
    organizer: shared.organizerName,
    recurrence: shared.recurrence,
    start: shared.start.toISOString(),
    title: shared.title,
    url: shared.url,
  };
}
