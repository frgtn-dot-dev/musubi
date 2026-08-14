import {
  providerDisplayName,
  providerFlavor,
  type Calendar,
} from "@musubi/types";

export type CalendarSourceGroup = {
  calendars: Calendar[];
  detail: string;
  flavor: string | null;
  key: string;
  title: string;
};

function externalGroupKey(calendar: Calendar) {
  if (calendar.accountId) {
    return `${calendar.provider}:${calendar.accountId}`;
  }
  return `${calendar.provider}:${
    calendar.accountLabel || calendar.serverUrl || "default"
  }`;
}

/**
 * Mirrors the mental model used by calendar products on mobile and desktop:
 * calendars owned by this Musubi server come first, followed by one stable
 * section per connected account.
 */
export function groupCalendars(calendars: Calendar[]): CalendarSourceGroup[] {
  const native = calendars
    .filter((calendar) => !calendar.provider)
    .sort(
      (left, right) =>
        Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)),
    );
  const external = new Map<string, CalendarSourceGroup>();

  for (const calendar of calendars) {
    if (!calendar.provider) continue;

    const key = externalGroupKey(calendar);
    const existing = external.get(key);
    if (existing) {
      existing.calendars.push(calendar);
      continue;
    }

    const flavor = providerFlavor(calendar);
    external.set(key, {
      calendars: [calendar],
      detail:
        flavor === "musubi"
          ? "Shared from another Musubi server"
          : providerDisplayName(calendar),
      flavor,
      key,
      title: calendar.accountLabel?.trim() || providerDisplayName(calendar),
    });
  }

  const groups: CalendarSourceGroup[] = [];
  if (native.length > 0) {
    groups.push({
      calendars: native,
      detail: "Calendars saved on this server",
      flavor: null,
      key: "musubi",
      title: "Musubi",
    });
  }
  groups.push(...external.values());
  return groups;
}
