import { CloudOff, RefreshCw } from "lucide-react";
import styles from "./primitives.module.css";

/** "3 minutes ago" — enough to judge the data, without a clock's precision. */
export function describeAge(savedAt: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - savedAt) / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Says the calendar on screen came out of a snapshot rather than from the server.
 *
 * Full width and above the calendar rather than tucked into the sidebar: on a
 * phone the sidebar is a drawer, and a reader who cannot see this would trust
 * data that may be days old. Wording carries the age, because "offline" alone
 * does not say whether what you are looking at is worth acting on.
 */
export function StaleBanner({
  savedAt,
  suffix,
  tone = "offline",
}: {
  savedAt: number | undefined;
  /** Extra sentence for a case the banner cannot infer, e.g. writes refused. */
  suffix?: string;
  /**
   * `offline` — nothing is coming until the server is back, so it reads as a
   * warning. `refreshing` — the same data, but fresher is already on its way,
   * which is a note rather than a problem.
   */
  tone?: "offline" | "refreshing";
}) {
  const age = savedAt ? describeAge(savedAt) : undefined;

  return (
    <div className={styles.staleBanner} data-tone={tone} role="status">
      {tone === "offline" ? (
        <CloudOff aria-hidden="true" size={14} strokeWidth={1.8} />
      ) : (
        <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
      )}
      <span>
        {tone === "offline"
          ? age
            ? `Offline — showing the calendar as it was ${age}.`
            : "Offline — the server cannot be reached."
          : age
            ? `Showing saved data from ${age} — refreshing.`
            : "Showing saved data — refreshing."}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}
