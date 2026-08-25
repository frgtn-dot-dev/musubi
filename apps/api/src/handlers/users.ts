import type { Request, Response } from "express";
import { deleteUserAvatar, getUserAvatar, userExists } from "@musubi/db";
import { config, logger } from "@musubi/config";
import { auth } from "@musubi/auth";
import { BadRequestError, NotFoundError } from "@musubi/types";
import {
  deleteMedia,
  getMedia,
  putMedia,
  withMediaLock,
} from "../media_storage";

// Step 1 (authenticated, from the app): triggers Better Auth's
// sendDeleteAccountVerification, which emails a confirmation link and returns
// without deleting. The account is only removed after the emailed link is
// confirmed via handlerConfirmDeleteUser.
export async function handlerDeleteUser(req: Request, res: Response) {
  const result = await auth.api.deleteUser({
    headers: new Headers(req.headers as Record<string, string>),
    body: {},
  });

  if (!result.success) {
    throw new Error(result.message);
  }
  res.sendStatus(200);
}

// Step 2 (public, from the website link): completes deletion token-only. The
// emailed token is the proof of email ownership (same model as password reset),
// so no session is required — the browser opening the link has none. Uses Better
// Auth's own internal adapter so cleanup matches its native delete flow.
export async function handlerConfirmDeleteUser(req: Request, res: Response) {
  const { token } = req.body ?? {};
  if (!token || typeof token !== "string")
    throw new BadRequestError("token is required...");

  const ctx = await auth.$context;
  const identifier = `delete-account-${token}`;
  const pending = await ctx.internalAdapter.findVerificationValue(identifier);
  if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
    throw new BadRequestError("This deletion link is invalid or has expired.");
  }

  await withMediaLock(avatarKey(pending.value), async () => {
    const record =
      await ctx.internalAdapter.consumeVerificationValue(identifier);
    if (!record) {
      throw new BadRequestError(
        "This deletion link is invalid or has expired.",
      );
    }

    const userId = record.value;
    await ctx.internalAdapter.deleteUser(userId);
    await ctx.internalAdapter.deleteUserSessions(userId);
    await ctx.internalAdapter.deleteAccounts(userId);
    try {
      await deleteMedia(avatarKey(userId));
    } catch (error) {
      // Bucket stays private and avatar reads verify user existence, so failed
      // cleanup cannot expose media belonging to a deleted account.
      logger.error("media.avatar_delete_failed", { error, userID: userId });
    }
  });
  res.sendStatus(200);
}

// Validation here is the trust boundary: size cap + magic bytes.
const AVATAR_MAX_BYTES = 256 * 1024;
const avatarKey = (userID: string) => `avatars/${encodeURIComponent(userID)}`;

async function loadAvatar(userID: string) {
  const key = avatarKey(userID);
  return withMediaLock(key, async () => {
    if (!(await userExists(userID))) return null;
    const stored = await getMedia(key);
    if (stored) return stored;

    // Lazy one-way migration keeps existing installations working without a
    // separate downtime-prone migration command.
    const legacy = await getUserAvatar(userID);
    if (!legacy) return null;
    try {
      await putMedia(key, legacy.data, legacy.mimeType);
      await deleteUserAvatar(userID);
    } catch (error) {
      logger.warn("media.avatar_migration_failed", { error, userID });
    }
    return legacy;
  });
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  if (
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

export async function handlerUploadAvatar(req: Request, res: Response) {
  const data = req.body?.data as string | undefined;
  if (!data) throw new BadRequestError("data (base64 image) is required...");

  let buf: Buffer;
  try {
    buf = Buffer.from(data, "base64");
  } catch {
    throw new BadRequestError("Invalid base64 data...");
  }
  if (buf.length === 0 || buf.length > AVATAR_MAX_BYTES) {
    throw new BadRequestError(
      `Avatar must be a non-empty image up to ${AVATAR_MAX_BYTES / 1024} KB.`,
    );
  }
  const mime = sniffImageMime(buf);
  if (!mime)
    throw new BadRequestError("Avatar must be a JPEG, PNG or WebP image.");

  const userID = req.user!.id;
  await withMediaLock(avatarKey(userID), async () => {
    if (!(await userExists(userID)))
      throw new NotFoundError("User not found...");
    await putMedia(avatarKey(userID), buf, mime);
    await deleteUserAvatar(userID);
  });
  // versioned URL → immutable caching; client saves it into user.image
  const url = `${config.api.url}/api/v1/users/${userID}/avatar?v=${Date.now()}`;
  res.status(200).json({ url });
}

// Public on purpose (like Gravatar): plain <Image uri> can't send auth headers,
// and other members need to see each other's avatars.
export async function handlerGetAvatar(req: Request, res: Response) {
  const media = await loadAvatar(req.params.userId as string);
  if (!media) throw new NotFoundError("Avatar not found...");
  res.set("Content-Type", media.mimeType);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(media.data);
}
