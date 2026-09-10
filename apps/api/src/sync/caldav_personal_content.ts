import type { CaldavSeriesWriteIntent } from "@musubi/db";

export type CaldavPersonalContentOperation = Pick<CaldavSeriesWriteIntent, "patch" | "targetEventID" | "cancelTarget" | "newDefinition" | "time" | "followingDelete">;

/** Operation evidence is derived from the concrete request/write, never a
 * persisted permission bit. Every other operation keeps strict ACL preflight. */
export function isCaldavPersonalContentOperation(operation: unknown): boolean {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return false;
  const value = operation as Record<string, unknown>;
  if (["targetEventID", "cancelTarget", "newDefinition", "time", "followingDelete"].some(key => value[key] !== undefined)) return false;
  if (!value.patch || typeof value.patch !== "object" || Array.isArray(value.patch)) return false;
  const patch = value.patch as Record<string, unknown>;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every(key => ["title", "description", "location"].includes(key)
    && (typeof patch[key] === "string" || key !== "title" && patch[key] === null));
}

/** Account discovery may move from the iCloud root to a partition host, but
 * an event resource must remain on the exact selected collection origin. */
export function isIcloudPersonalContentDestination(accountServerURL: string, calendarURL: string, resourceURL: string): boolean {
  try {
    const urls = [accountServerURL, calendarURL, resourceURL].map(value => new URL(value));
    return urls.every(url => url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && /^(?:caldav|p[0-9]+-caldav)\.icloud\.com$/.test(url.hostname))
      && urls[1]!.origin === urls[2]!.origin;
  } catch { return false; }
}
