import { randomBytes } from "node:crypto";
import {
  getEventShare,
  getSharedEvent,
  getSharedEventId,
  listEventRsvps,
  nameAnonymousUser,
  revokeEventShare,
  setEventRsvp,
  upsertEventShare,
  type RsvpStatus,
} from "@musubi/db";
import {
  BadRequestError,
  EventPageThemeSchema,
  NotFoundError,
} from "@musubi/types";
import { Request, Response } from "express";
import { config } from "@musubi/config";
import { assertCanEditEvent } from "../permissions";

// `link` — anyone holding the URL. `public` — the same, and the page may say a
// crawler is welcome. Access and indexability are separate questions: a public
// event is not automatically an indexed one (PRD §17.1).
const MODES = new Set(["link", "public"]);
// What a reader learns about who is coming. The organizer decides (PRD §18.2).
const VISIBILITIES = new Set(["counts", "hidden", "names"]);

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
          attendeeVisibility: share.attendeeVisibility,
          indexable: share.indexable,
          mode: share.mode,
          theme: EventPageThemeSchema.parse(share.theme ?? {}),
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
  const attendeeVisibility = String(req.body?.attendeeVisibility ?? "counts");
  // Parsed against the closed set, never stored as given: this is the boundary
  // that keeps "no arbitrary CSS" true, so an unknown key or value is a refusal
  // rather than something that ends up in a style attribute later.
  const theme = EventPageThemeSchema.safeParse(req.body?.theme ?? {});
  if (!theme.success) {
    throw new BadRequestError("That page style is not one of the options...");
  }

  if (!MODES.has(mode)) {
    throw new BadRequestError("mode must be 'link' or 'public'...");
  }
  // Indexing an unlisted page would be a contradiction the UI could not undo:
  // the link mode exists precisely to stay out of search results.
  if (indexable && mode !== "public") {
    throw new BadRequestError("Only a public event page can be indexable...");
  }
  // Publishing straight from the public page: the account was made a moment ago
  // by an emailed code, and "Organized by" reads from the profile. Only fills an
  // empty name, so it can never rewrite an existing one.
  const organizer = String(req.body?.name ?? "").trim().slice(0, 80);
  if (organizer) await nameAnonymousUser(req.user!.id, organizer);

  if (!VISIBILITIES.has(attendeeVisibility)) {
    throw new BadRequestError(
      "attendeeVisibility must be counts, names or hidden...",
    );
  }

  await assertCanEditEvent(req.user!.id, eventID);

  const share = await upsertEventShare({
    attendeeVisibility,
    theme: theme.data,
    createdBy: req.user!.id,
    eventID,
    indexable,
    mode,
    token: shareToken(),
  });

  res.status(200).json({
    attendeeVisibility: share.attendeeVisibility,
    indexable: share.indexable,
    mode: share.mode,
    theme: share.theme,
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
  theme?: unknown;
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
    // Parsed on the way out as well: a row written before a knob existed, or by
    // an older server, still renders as a valid look instead of a broken one.
    theme: EventPageThemeSchema.parse(
      (shared.theme && typeof shared.theme === "object") ? shared.theme : {},
    ),
    title: shared.title,
    url: shared.url,
  };
}

// ── RSVP ─────────────────────────────────────────────────────────────────────

const RSVP_STATUSES = new Set(["declined", "going", "maybe"]);

/**
 * Answer a published event.
 *
 * Requires a session, and always has: the page signs the guest in with an
 * emailed code first (`emailOTP`), so every row here is an address somebody
 * proved. That is what lets a count mean something — and it is why no
 * "unverified RSVP" state exists to be cleaned up later (PRD §18.3).
 */
export async function handlerPutPublicRsvp(req: Request, res: Response) {
  const status = String(req.body?.status ?? "");
  if (!RSVP_STATUSES.has(status)) {
    throw new BadRequestError("status must be going, maybe or declined...");
  }
  // Somebody who arrived through an emailed code has an address and nothing
  // else, and a list of blanks helps nobody. Only fills an empty name, so it
  // can never rewrite the profile of a member who happens to answer.
  const name = String(req.body?.name ?? "").trim().slice(0, 80);
  if (name) await nameAnonymousUser(req.user!.id, name);

  const share = await getSharedEventId(String(req.params.token));
  if (!share) throw new NotFoundError("This event page is not available...");

  await setEventRsvp({
    eventID: share.eventID,
    status: status as RsvpStatus,
    userID: req.user!.id,
  });

  res.status(200).json(await rsvpSummary(share, req.user!.id));
}

/** The reader's own answer plus whatever the organizer lets readers see. */
export async function handlerGetPublicRsvp(req: Request, res: Response) {
  const share = await getSharedEventId(String(req.params.token));
  if (!share) throw new NotFoundError("This event page is not available...");

  res.status(200).json(await rsvpSummary(share, req.user!.id));
}

async function rsvpSummary(
  share: { attendeeVisibility: string; eventID: string },
  userID: string,
) {
  const rsvps = await listEventRsvps(share.eventID);

  return {
    counts: rsvpCounts(rsvps),
    mine: rsvps.find((rsvp) => rsvp.userID === userID)?.status ?? null,
    // Names only when the organizer said so, and only of people who are coming:
    // "maybe" and "no" are answers people give in confidence.
    names:
      share.attendeeVisibility === "names"
        ? rsvps
            .filter((rsvp) => rsvp.status === "going")
            // Never a blank in the list: an account can still be nameless if the
            // answer came from somewhere that did not ask.
            .map((rsvp) => rsvp.name.trim() || "Guest")
        : [],
    visibility: share.attendeeVisibility,
  };
}

/**
 * Who answered, for the person running the event.
 *
 * Deliberately NOT filtered by `attendeeVisibility`: that setting decides what a
 * READER of the page learns. An organizer who set it to "show nothing" still has
 * to be able to see the answers — otherwise the feature collects replies nobody
 * can read, which is how it shipped an hour ago.
 */
export async function handlerGetEventRsvps(req: Request, res: Response) {
  const eventID = String(req.params.eventId);
  await assertCanEditEvent(req.user!.id, eventID);

  res.status(200).json(groupRsvps(await listEventRsvps(eventID)));
}

export function groupRsvps(rsvps: Array<{ name: string; status: string }>) {
  const named = (status: string) =>
    rsvps
      .filter((rsvp) => rsvp.status === status)
      // An account that arrived through a code and never gave a name still has
      // to appear — a blank row would read as a bug.
      .map((rsvp) => rsvp.name.trim() || "Guest")
      .sort((left, right) => left.localeCompare(right));

  return {
    counts: rsvpCounts(rsvps),
    declined: named("declined"),
    going: named("going"),
    maybe: named("maybe"),
  };
}

export function rsvpCounts(rsvps: Array<{ status: string }>) {
  return {
    declined: rsvps.filter((rsvp) => rsvp.status === "declined").length,
    going: rsvps.filter((rsvp) => rsvp.status === "going").length,
    maybe: rsvps.filter((rsvp) => rsvp.status === "maybe").length,
  };
}
