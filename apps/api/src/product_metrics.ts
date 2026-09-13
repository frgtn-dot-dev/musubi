import { sql, type SQL } from "drizzle-orm";

// Ordered, bounded families shared by the database snapshot and request metrics.
// User-Agent is a hint, not a hardware identifier. Unknown is intentional.
const families = {
  device: [["bot", "bot|crawler|spider"], ["tablet", "ipad|tablet"], ["mobile", "mobi|iphone|android"], ["desktop", "windows|macintosh|x11|linux"]],
  os: [["ios", "iphone|ipad"], ["android", "android"], ["windows", "windows"], ["macos", "macintosh|mac os"], ["linux", "linux|x11"]],
  browser: [["edge", "edg/|edga/|edgios/"], ["firefox", "firefox/|fxios/"], ["chrome", "chrome/|crios/"], ["safari", "safari/"]],
} as const;
export function clientFamily(ua: string | undefined, kind: keyof typeof families): string {
  return families[kind].find(([, pattern]) => new RegExp(pattern, "i").test((ua ?? "").slice(0, 2048)))?.[0] ?? "unknown";
}
export function clientFamilySql(column: SQL, kind: keyof typeof families): SQL<string> {
  return sql<string>`case ${sql.join(families[kind].map(([name, pattern]) => sql`when left(coalesce(${column}, ''), 2048) ~* ${pattern} then ${name}`), sql` `)} else 'unknown' end`;
}
export function providerFamily(value: string | null): string {
  return value === null ? "musubi" : ["google", "microsoft", "caldav", "credential"].includes(value) ? value : "unknown";
}
export function syncStatusFamily(value: string): string {
  return ["active", "reconnect_required", "unmonitored"].includes(value) ? value : "unknown";
}
export function taskStatusFamily(value: string): string {
  return ["needs-action", "in-process", "completed", "cancelled"].includes(value) ? value : "unknown";
}
export function priorityFamily(value: number): string {
  return value === 0 ? "none" : value >= 1 && value <= 4 ? "high" : value === 5 ? "medium" : value >= 6 && value <= 9 ? "low" : "unknown";
}

/** Single flight, failure backoff and last-good preservation. Errors never turn
 * an unavailable inventory into a fabricated zero or break operational scrapes. */
export function snapshotCache<T>(load: () => Promise<T>, ttlMs = 60_000, now = () => performance.now(), timeoutMs = 5000) {
  let value: T | undefined;
  let retryAt = -Infinity;
  let pending: Promise<T | undefined> | undefined;
  let healthy = false;
  let lastSuccess = 0;
  return {
    get healthy() { return healthy; },
    get lastSuccess() { return lastSuccess; },
    get(): Promise<T | undefined> {
      if (pending) return pending;
      if (now() < retryAt) return Promise.resolve(value);
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Inventory refresh deadline")), timeoutMs);
      });
      pending = Promise.race([Promise.resolve().then(load), deadline]).then((fresh) => {
        value = fresh;
        healthy = true;
        lastSuccess = Date.now() / 1000;
        return value;
      }, () => {
        healthy = false;
        return value;
      }).finally(() => {
        clearTimeout(timer);
        retryAt = now() + ttlMs;
        pending = undefined;
      });
      return pending;
    },
  };
}
