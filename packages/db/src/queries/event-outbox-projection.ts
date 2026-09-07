import type { Event } from "@musubi/types";

type EventProjection = Pick<
  Event,
  | "title"
  | "start"
  | "end"
  | "isAllDay"
  | "description"
  | "location"
  | "recurrence"
>;

/** Compare the projection actually serialized by each EVENT adapter. Local
 * appearance and provider-owned organizer/meeting metadata are separate. */
export function matchesEventProviderProjection(
  provider: string,
  intended: EventProjection,
  observed: EventProjection,
) {
  const time = (value: Date) => {
    const milliseconds = new Date(value).getTime();
    return intended.isAllDay
      ? Math.floor(milliseconds / 86_400_000) * 86_400_000
      : provider === "caldav"
        ? Math.floor(milliseconds / 1000) * 1000
        : milliseconds;
  };
  const text = (value: string | null | undefined) =>
    (provider === "microsoft" ? value?.trim() : value) || null;
  const recurrence = (value: string | null | undefined) =>
    value
      ? [...new Set(value.split("\n").filter(Boolean))].sort().join("\n")
      : null;
  return (
    intended.title === observed.title &&
    intended.isAllDay === observed.isAllDay &&
    time(intended.start) === new Date(observed.start).getTime() &&
    time(intended.end) === new Date(observed.end).getTime() &&
    text(intended.description) === (observed.description || null) &&
    text(intended.location) === (observed.location || null) &&
    recurrence(intended.recurrence) === recurrence(observed.recurrence)
  );
}
