import { hasKnownEventTime, EventTimeModelSchema, OccurrenceStartSchema, type Event, type GoogleReminderWrite, type ProviderEventState } from "@musubi/types";

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

/** Cancellation-only instances have identity, not the former overridden content. */
export function matchesGoogleOccurrenceProjection(
  expected: Event,
  actual: EventProjection & Partial<Pick<Event, "timeModel" | "originalStart" | "isCanceled">>,
) {
  const original = (value: unknown) => JSON.stringify(OccurrenceStartSchema.parse(value));
  const model = (value: unknown) => JSON.stringify(EventTimeModelSchema.parse(value));
  return !!expected.originalStart && !!actual.originalStart && original(expected.originalStart) === original(actual.originalStart) &&
    !!expected.isCanceled === !!actual.isCanceled &&
    (!!expected.isCanceled || (matchesEventProviderProjection("google", expected, actual) && model(expected.timeModel) === model(actual.timeModel)));
}

/** Shared by worker and pending pull; an equal instant is not evidence for a
 * different native civil model or occurrence identity. */
export function matchesReminderEventProjection(
  provider: string,
  expected: Event,
  actual: EventProjection & Partial<Pick<Event, "timeModel" | "seriesID" | "originalStart" | "isCanceled">> & { externalSeriesID?: string | null },
) {
  if (!matchesEventProviderProjection(provider, expected, actual) || expected.recurrence || expected.seriesID || expected.originalStart || expected.isCanceled || actual.recurrence || actual.seriesID || actual.externalSeriesID || actual.originalStart || actual.isCanceled) return false;
  if (!hasKnownEventTime(expected)) return true;
  if (provider !== "google" || !["zoned", "all-day"].includes(expected.timeModel!.kind)) return false;
  const observed = EventTimeModelSchema.safeParse(actual.timeModel);
  return observed.success && JSON.stringify(EventTimeModelSchema.parse(expected.timeModel)) === JSON.stringify(observed.data);
}

export function matchesGoogleReminderIntent(intent: GoogleReminderWrite, state: ProviderEventState | undefined) {
  if (state?.provider !== "google" || state.reminders.provider !== "google" || intent.useDefault !== state.reminders.useDefault) return false;
  if (intent.useDefault) return true;
  const canonical = (items: { method: string | null; minutes: number | null }[]) => JSON.stringify(items.map(item => [item.method, item.minutes]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  return canonical(intent.overrides) === canonical(state.reminders.overrides);
}
