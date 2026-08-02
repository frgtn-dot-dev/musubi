import { z } from "zod";

export const InviteSchema = z.object({
  id: z.string(),
  calendarID: z.string().uuid(),
  expiresAt: z.coerce.date().nullable(), // null = never expires
  maxUses: z.number().int().positive().nullable(), // null = unlimited
  uses: z.number().default(0), // consumed joins — server-maintained
});

export type Invite = z.infer<typeof InviteSchema>;

export type ParsedInvite = {
  /** Absent when the invite belongs to this server (a native join). */
  server?: string;
  token: string;
};

const TOKEN_PATTERN = /^[0-9a-f-]{16,64}$/i;

/**
 * Read an invite link the user pasted.
 *
 * Accepts a full `https://<server>/invite/<token>` link or a bare token. A link
 * pointing at this server is a native join, so no server is returned — that
 * distinction decides whether we federate or just consume the invite locally.
 *
 * Shared by both clients on purpose: an invite that a phone accepts and a
 * browser rejects (or the reverse) is a bug nobody would look for here.
 */
export function parseInviteLink(
  value: string,
  currentOrigin: string,
): ParsedInvite | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (TOKEN_PATTERN.test(trimmed)) return { token: trimmed };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // Last non-empty path segment, so /invite/<token> and /join/<token> both work.
  const segments = url.pathname.split("/").filter(Boolean);
  const token = segments[segments.length - 1] ?? "";
  if (!TOKEN_PATTERN.test(token)) return null;

  return url.origin === currentOrigin
    ? { token }
    : { server: url.origin, token };
}
