import { Request, Response } from "express";
import { createInvite, deleteInvite, getCalendar, getCalendarInvites, getInvite, NewCalendarInvite } from '@musubi/db';
import { BadRequestError, Invite, InviteSchema, NotFoundError } from "@musubi/types";
import { config } from "@musubi/config";
import { canSendEmail, getCalendarInviteHtml, sendEmail } from "@musubi/emails";
import { z } from "zod";
import { assertCan } from "../permissions";
import { requireUUID } from "../request_validation";


const SendInviteSchema = z
  .object({ email: z.string().email().max(320) })
  .strict();

export async function handlerCreateCalendarInvite(req: Request, res: Response) {
  let invite: Invite;
  try {
    invite = InviteSchema.parse(req.body);
  } catch (err) {
    throw new BadRequestError("Request is missing valid invite data...");
  }
  await assertCan(req.user!.id, invite.calendarID, "invite");
  const newCalendarInvite: NewCalendarInvite = {
    expiresAt: invite.expiresAt, // null = never expires
    maxUses: invite.maxUses,     // null = unlimited
    calendarID: invite.calendarID,
  }
  const result = await createInvite(newCalendarInvite);

  res.status(201).json(result);
}

// Who may create invites may also see and revoke them — one "invite" gate.
export async function handlerGetCalendarInvites(req: Request, res: Response) {
  const calendarID = req.params.calendarId as string;
  await assertCan(req.user!.id, calendarID, "invite");
  res.status(200).json(await getCalendarInvites(calendarID));
}

export async function handlerRevokeInvite(req: Request, res: Response) {
  const invite = await getInvite(req.params.inviteId as string);
  await assertCan(req.user!.id, invite.calendarID, "invite");
  await deleteInvite(invite.id); // token stops working immediately — joins validate per request
  res.sendStatus(200);
}

/**
 * Send an existing invite link to an address.
 *
 * A route that emails whatever address it is handed is a spam relay unless it
 * is fenced: this one needs a session, needs the `invite` permission on that
 * particular calendar, takes one address at a time, and is capped per ACCOUNT
 * rather than per IP — the account is what an abuser has to keep making.
 *
 * The link itself is not new. This sends the one the owner could already copy,
 * which keeps revocation working exactly as before.
 */
export async function handlerSendCalendarInvite(req: Request, res: Response) {
  const inviteID = requireUUID(req.params.inviteId, "inviteId");
  const parsed = SendInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError("Body must be { email } with one address.");
  }

  const invite = await getInvite(inviteID);
  await assertCan(req.user!.id, invite.calendarID, "invite");

  if (!canSendEmail()) {
    throw new BadRequestError(
      "This server has no mail configured, so it cannot send invitations. Copy the link instead.",
    );
  }

  const calendar = await getCalendar(invite.calendarID);
  if (!calendar) throw new NotFoundError("Calendar not found...");

  await sendEmail(
    parsed.data.email,
    `${req.user!.name} shared a calendar with you`,
    getCalendarInviteHtml(
      req.user!.name,
      calendar.name,
      // The invite id IS the token — `getCalendarIDFromToken` looks it up by id.
      `${config.api.url}/invite/${invite.id}`,
      expiresInWords(invite.expiresAt),
    ),
  );

  res.status(204).end();
}

/** "3 days", or null for an invite that never expires. */
function expiresInWords(expiresAt: Date | null) {
  if (!expiresAt) return null;
  const days = Math.round((expiresAt.getTime() - Date.now()) / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
