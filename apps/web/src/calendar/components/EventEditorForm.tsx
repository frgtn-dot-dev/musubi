import {
  can,
  DEFAULT_CALENDAR_COLOR,
  type Calendar,
  type Settings,
} from "@musubi/types";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Link2,
  MapPin,
  Repeat2,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { DatePicker } from "~/ui/DatePicker";
import { Segmented } from "~/ui/Segmented";
import {
  minutesToTime,
  TimePicker,
  timeToMinutes,
} from "~/ui/TimePicker";
import { type EventFormValues, validateEventForm } from "../event-form";
import { federatedConnectionMap } from "../federation-routing";
import { createTimeGeometry } from "../time-geometry";
import styles from "./workspace.module.css";

type FormError = {
  message: string;
  requestId?: string;
};

const TIME_SNAP_MINUTES = createTimeGeometry().snapMinutes;
const LAST_MINUTE = 24 * 60 - 1;
const LATEST_START_TIME = minutesToTime(
  LAST_MINUTE - TIME_SNAP_MINUTES,
);
const LATEST_END_TIME = minutesToTime(LAST_MINUTE);
const TIME_PRESETS = [
  {
    endTime: "10:00",
    label: "Morning",
    startTime: "09:00",
    value: "09:00–10:00",
  },
  {
    endTime: "14:00",
    label: "Afternoon",
    startTime: "13:00",
    value: "13:00–14:00",
  },
  {
    endTime: "19:00",
    label: "Evening",
    startTime: "18:00",
    value: "18:00–19:00",
  },
] as const;

/** The "when" fields a gesture outside the form can move under it. */
export type EventWhen = Pick<
  EventFormValues,
  "date" | "endDate" | "endTime" | "isAllDay" | "startTime"
>;

type EventEditorFormProps = {
  calendarLocked?: boolean;
  calendars: Calendar[];
  /**
   * Quick create: only what a new event cannot do without — name, when, which
   * calendar — with the rest behind one disclosure. Same form, same validation,
   * same submit; only how much of it is on screen differs (R3, R5).
   */
  compact?: boolean;
  /**
   * Where "More options" leads when the extra fields belong somewhere else — a
   * full page, in practice. It receives what is already filled in, so the draft
   * travels with the user. Absent reveals the rest in place.
   */
  onExpand?: (values: EventFormValues) => void;
  initialValues: EventFormValues;
  /**
   * A new "when" from outside the form — the draft block being dragged on the
   * grid while this is open. Only these fields are replaced, so a title that is
   * already typed survives the move.
   */
  when?: EventWhen;
  onCancel: () => void;
  onError: (error: unknown, values: EventFormValues) => FormError;
  onSubmit: (values: EventFormValues) => Promise<void>;
  submitLabel: string;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

export function EventEditorForm({
  calendarLocked = false,
  calendars,
  compact = false,
  initialValues,
  onCancel,
  onExpand,
  onError,
  onSubmit,
  submitLabel,
  timeFormat,
  weekStartsOn,
  when,
}: EventEditorFormProps) {
  const id = useId();
  const [values, setValues] = useState(initialValues);
  const [expanded, setExpanded] = useState(!compact);
  // Adjusted during render rather than from an effect: the form must never
  // paint a time the grid has already moved on from.
  const whenSignature = when ? Object.values(when).join("|") : "";
  const [syncedWhen, setSyncedWhen] = useState(whenSignature);
  if (when && syncedWhen !== whenSignature) {
    setSyncedWhen(whenSignature);
    setValues((current) => ({ ...current, ...when }));
  }
  const [error, setError] = useState<FormError>();
  const [saving, setSaving] = useState(false);
  const selectedCalendar = calendars.find(
    (calendar) => calendar.id === values.calendarId,
  );
  const customRecurrence = ![
    "",
    "FREQ=DAILY",
    "FREQ=WEEKLY",
    "FREQ=MONTHLY",
    "FREQ=YEARLY",
  ].includes(values.recurrence);

  function patch(next: Partial<EventFormValues>) {
    setValues((current) => ({ ...current, ...next }));
    setError(undefined);
  }

  function changeStartTime(startTime: string) {
    const previousStart = timeToMinutes(values.startTime);
    const previousEnd = timeToMinutes(values.endTime);
    const nextStart = timeToMinutes(startTime);
    if (nextStart === null) return;

    const previousDuration =
      previousStart !== null &&
      previousEnd !== null &&
      previousEnd > previousStart
        ? previousEnd - previousStart
        : 60;
    const nextEnd = Math.min(
      LAST_MINUTE,
      nextStart + Math.max(TIME_SNAP_MINUTES, previousDuration),
    );

    patch({
      endTime: minutesToTime(nextEnd),
      startTime,
    });
  }

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const validationError = validateEventForm(
      values,
      federatedConnectionMap(calendars),
    );

    if (validationError) {
      setError({ message: validationError });
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await onSubmit(values);
    } catch (submitError) {
      setError(onError(submitError, values));
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <form onKeyDown={handleKeyDown} onSubmit={handleSubmit}>
      <label className={styles.srOnly} htmlFor={`${id}-title`}>
        Event title
      </label>
      <input
        autoFocus
        className={styles.titleInput}
        disabled={saving}
        id={`${id}-title`}
        placeholder="Event title"
        value={values.title}
        onChange={(event) => patch({ title: event.target.value })}
      />

      <div className={styles.formRow}>
        <CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
        <DatePicker
          disabled={saving}
          label="Date"
          value={values.date}
          weekStartsOn={weekStartsOn}
          onChange={(date) => patch({ date })}
        />
      </div>

      <label className={styles.allDayRow}>
        <span
          className={`${styles.checkbox} ${
            values.isAllDay ? styles.checkboxChecked : ""
          }`}
          aria-hidden="true"
        >
          {values.isAllDay ? <Check size={12} strokeWidth={2} /> : null}
        </span>
        <input
          checked={values.isAllDay}
          disabled={saving}
          type="checkbox"
          onChange={(event) => patch({ isAllDay: event.target.checked })}
        />
        <span>All day</span>
      </label>

      {values.isAllDay ? (
        <div className={styles.formRow}>
          <CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
          <span className={styles.formHint}>Ends</span>
          <DatePicker
            disabled={saving}
            label="Ends"
            min={values.date}
            value={values.endDate}
            weekStartsOn={weekStartsOn}
            onChange={(endDate) => patch({ endDate })}
          />
        </div>
      ) : null}

      {!values.isAllDay ? (
        <>
          <div className={styles.formRow}>
            <Clock3 aria-hidden="true" size={17} strokeWidth={1.5} />
            <TimePicker
              disabled={saving}
              label="Start time"
              max={LATEST_START_TIME}
              timeFormat={timeFormat}
              value={values.startTime}
              onChange={changeStartTime}
            />
            <span className={styles.timeSeparator}>to</span>
            <TimePicker
              disabled={saving}
              label="End time"
              max={LATEST_END_TIME}
              min={minutesToTime(
                Math.min(
                  LAST_MINUTE,
                  (timeToMinutes(values.startTime) ?? 0) +
                    TIME_SNAP_MINUTES,
                ),
              )}
              relativeTo={values.startTime}
              timeFormat={timeFormat}
              value={values.endTime}
              onChange={(endTime) => patch({ endTime })}
            />
          </div>
          <div className={styles.timePresets}>
            <Segmented
              disabled={saving}
              label="Time range presets"
              options={TIME_PRESETS}
              value={`${values.startTime}–${values.endTime}`}
              onChange={(presetValue) => {
                const preset = TIME_PRESETS.find(
                  (option) => option.value === presetValue,
                );
                if (!preset) return;
                patch({
                  endTime: preset.endTime,
                  startTime: preset.startTime,
                });
              }}
            />
          </div>
        </>
      ) : null}

      {expanded ? (
        <>
          <label className={styles.formRow}>
            <MapPin aria-hidden="true" size={17} strokeWidth={1.5} />
            <span className={styles.srOnly}>Location</span>
            <input
              disabled={saving}
              placeholder="Add location"
              value={values.location}
              onChange={(event) => patch({ location: event.target.value })}
            />
          </label>

          <label className={styles.formRow}>
            <FileText aria-hidden="true" size={17} strokeWidth={1.5} />
            <span className={styles.srOnly}>Description</span>
            <input
              disabled={saving}
              placeholder="Add notes"
              value={values.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </label>

          <label className={styles.formRow}>
            <Link2 aria-hidden="true" size={17} strokeWidth={1.5} />
            <span className={styles.srOnly}>URL</span>
            <input
              disabled={saving}
              placeholder="Add link"
              type="url"
              value={values.url}
              onChange={(event) => patch({ url: event.target.value })}
            />
          </label>

          <label className={styles.formRow}>
            <Repeat2 aria-hidden="true" size={17} strokeWidth={1.5} />
            <span className={styles.srOnly}>Repeat</span>
            <select
              disabled={saving}
              value={values.recurrence}
              onChange={(event) => patch({ recurrence: event.target.value })}
            >
              <option value="">Does not repeat</option>
              <option value="FREQ=DAILY">Every day</option>
              <option value="FREQ=WEEKLY">Every week</option>
              <option value="FREQ=MONTHLY">Every month</option>
              <option value="FREQ=YEARLY">Every year</option>
              {customRecurrence ? (
                <option value={values.recurrence}>Custom recurrence</option>
              ) : null}
            </select>
            <ChevronDown
              className={styles.selectChevron}
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
            />
          </label>

          <label className={styles.allDayRow}>
            <span
              className={`${styles.checkbox} ${
                values.hasAttendees ? styles.checkboxChecked : ""
              }`}
              aria-hidden="true"
            >
              {values.hasAttendees ? <Check size={12} strokeWidth={2} /> : null}
            </span>
            <input
              checked={values.hasAttendees}
              disabled={saving}
              type="checkbox"
              onChange={(event) =>
                patch({ hasAttendees: event.target.checked })
              }
            />
            <UsersRound aria-hidden="true" size={15} strokeWidth={1.5} />
            <span>Allow attendance</span>
          </label>
        </>
      ) : null}

      <label
        className={`${styles.formRow} ${
          calendarLocked ? styles.formRowLocked : ""
        }`}
      >
        <span
          className={styles.calendarDot}
          style={{
            backgroundColor:
              selectedCalendar?.color ?? DEFAULT_CALENDAR_COLOR,
          }}
        />
        <span className={styles.srOnly}>Calendar</span>
        <select
          disabled={calendarLocked || saving}
          value={values.calendarId}
          onChange={(event) => {
            const calendarId = event.target.value;
            const replacingOnlyHome =
              values.calendarIds.length === 1 &&
              values.calendarIds[0] === values.calendarId;
            patch({
              calendarId,
              calendarIds: replacingOnlyHome
                ? [calendarId]
                : values.calendarIds.includes(calendarId)
                  ? values.calendarIds
                  : [...values.calendarIds, calendarId],
            });
          }}
        >
          {calendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.name}
            </option>
          ))}
        </select>
        {!calendarLocked ? (
          <ChevronDown
            className={styles.selectChevron}
            aria-hidden="true"
            size={16}
            strokeWidth={1.5}
          />
        ) : null}
      </label>

      {expanded && calendars.length > 1 ? (
        <fieldset className={styles.calendarChoices}>
          <legend>Also show in</legend>
          {calendars.map((calendar) => {
            const checked = values.calendarIds.includes(calendar.id);
            const isHome = values.calendarId === calendar.id;
            const mutable = !calendarLocked || can(calendar.role, "editEvents");

            return (
              <label key={calendar.id}>
                <input
                  checked={checked}
                  disabled={saving || isHome || !mutable}
                  type="checkbox"
                  onChange={(event) =>
                    patch({
                      calendarIds: event.target.checked
                        ? [...values.calendarIds, calendar.id]
                        : values.calendarIds.filter(
                            (calendarId) => calendarId !== calendar.id,
                          ),
                    })
                  }
                />
                <span
                  className={styles.calendarDot}
                  style={{ backgroundColor: calendar.color }}
                />
                <span>{calendar.name}</span>
                {isHome ? <small>Home</small> : null}
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {error ? (
        <div className={styles.formError} role="alert">
          <p>{error.message}</p>
          {error.requestId ? <span>Request {error.requestId}</span> : null}
        </div>
      ) : null}

      <div className={styles.createActions}>
        {expanded ? (
          <button
            className={styles.textButton}
            disabled={saving}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : (
          // One disclosure, in place: the draft carries over because it is the
          // same form state, not a second editor.
          <button
            className={styles.textButton}
            type="button"
            onClick={() =>
              onExpand ? onExpand(values) : setExpanded(true)
            }
          >
            More options
          </button>
        )}
        <button
          className={styles.primaryButton}
          disabled={saving}
          type="submit"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
