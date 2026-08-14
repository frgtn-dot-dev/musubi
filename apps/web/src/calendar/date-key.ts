export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function fromDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** Whole days from one date key to another; negative when going back. */
export function dayDelta(fromKey: string, toKey: string): number {
  const from = fromDateKey(fromKey);
  const to = fromDateKey(toKey);
  // Local midnights, so a DST boundary in between cannot round to 0.
  return Math.round(
    (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1_000),
  );
}

/** A date key moved by whole days. */
export function shiftDayKey(key: string, days: number): string {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}
