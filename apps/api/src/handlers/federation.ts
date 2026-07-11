import { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import {
  addCalendarMember, createExternalUser, findExternalUser,
  getCalendar, getCalendarIDFromToken, saveMemberToken,
} from "@musubi/db";
import { BadRequestError } from "@musubi/types";

// Federation (Musubi ↔ Musubi), v1: an invite token doubles as the cross-server
// capability. A user from another server accepts an invite here and becomes a
// NATIVE member through a "shadow account" — a normal `user` row (isExternal)
// carrying their profile. Roles, permissions, member management and event
// attribution then work unchanged; the only new mechanics are this accept
// handshake and member-token authentication (see middleware/require_auth.ts).

export function hashMemberToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * POST /api/v1/federation/accept — public (the invite token IS the credential).
 * Body: { token, profile: { name, email, homeServer, image? } }
 * Verifies the invite, finds-or-creates the shadow user, adds them as a member
 * (viewer — the owner promotes via the normal member management), and issues a
 * bearer member token. The raw token is returned exactly once; only its SHA-256
 * hash is stored. Authorization stays with calendar_members — kicking the
 * member cuts access even though the token still authenticates.
 */
export async function handlerFederationAccept(req: Request, res: Response) {
  const { token, profile } = req.body ?? {};
  if (!token || typeof token !== "string") throw new BadRequestError("Missing invite token...");
  const { name, email, homeServer, image } = profile ?? {};
  if (!name || !email || !homeServer) throw new BadRequestError("Profile needs name, email and homeServer...");
  if (!/^https?:\/\//.test(homeServer)) throw new BadRequestError("homeServer must be an http(s) origin...");

  // Same semantics as the native join: token must exist (expired ones are
  // purged hourly); throws NotFound otherwise.
  const calendarID = await getCalendarIDFromToken(token);

  const shadow = await findExternalUser(homeServer, email)
    ?? await createExternalUser({ name, email, image, homeServer });

  await addCalendarMember(shadow.id, calendarID); // viewer; conflict-safe on re-accept

  const raw = randomBytes(32).toString("hex");
  await saveMemberToken(shadow.id, hashMemberToken(raw));

  const calendar = await getCalendar(calendarID);
  res.status(200).json({ memberToken: raw, userID: shadow.id, calendar });
}

/**
 * GET /invite/:token — a tiny HTML hand-off page every Musubi server serves for
 * its own invite links. Deep-links into the app via the custom scheme WITH the
 * origin server attached, so cross-server invites don't depend on any one
 * domain's verified app links.
 */
export function handlerInvitePage(origin: string) {
  return (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!/^[0-9a-f-]{16,64}$/i.test(token)) { res.status(400).send("Invalid invite."); return; }
    const appUrl = `musubi://invite/${token}?server=${encodeURIComponent(origin)}`;
    res.status(200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Musubi invite</title>
<style>body{font-family:system-ui;background:#0c0c0e;color:#e8e4d9;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}a{color:#c8553d;font-size:1.2rem}p{color:#a09c92}</style>
</head><body><div>
<h1>結び</h1>
<p>You've been invited to a Musubi calendar.</p>
<p><a href="${appUrl}">Open in the Musubi app</a></p>
<p>Don't have it? Get Musubi on <a href="https://play.google.com/store/apps/details?id=dev.frgtn.musubi">Google Play</a>.</p>
<script>location.href=${JSON.stringify(appUrl)};</script>
</div></body></html>`);
  };
}
