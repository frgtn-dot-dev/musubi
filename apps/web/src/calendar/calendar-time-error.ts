/** A presentation error, without exposing raw event metadata or parser output. */
export class CalendarTimeError extends Error {
  constructor(
    area: "calendar" | "reminders",
    readonly cause: unknown,
  ) {
    super(
      area === "reminders"
        ? "Reminders could not be calculated from the event times or recurrence rules. Refresh or update Musubi and try again. Your saved events have not changed."
        : "Some event times or recurrence rules could not be displayed. Refresh or update Musubi and try again. Your saved events have not changed.",
    );
    this.name = "CalendarTimeError";
  }
}
