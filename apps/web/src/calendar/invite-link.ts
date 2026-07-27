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
 * Pasting is the primary entry point on the web: the origin server's
 * `/invite/:token` page hands off to the mobile app and cannot know which Musubi
 * server the visitor belongs to.
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
  const token = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!TOKEN_PATTERN.test(token)) return null;

  return url.origin === currentOrigin
    ? { token }
    : { server: url.origin, token };
}
