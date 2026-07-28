import { can, type Calendar } from "@musubi/types";
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
import { type EventFormValues, validateEventForm } from "../event-form";
import { federatedConnectionMap } from "../federation-routing";
import styles from "./workspace.module.css";

type FormError = {
  message: string;
  requestId?: string;
};

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

      <label className={styles.formRow}>
        <CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
        <span className={styles.srOnly}>Date</span>
        <input
          disabled={saving}
          required
          type="date"
          value={values.date}
          onChange={(event) => patch({ date: event.target.value })}
        />
      </label>

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
        <label className={styles.formRow}>
          <CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
          <span className={styles.formHint}>Ends</span>
          <input
            disabled={saving}
            min={values.date}
            required
            type="date"
            value={values.endDate}
            onChange={(event) => patch({ endDate: event.target.value })}
          />
        </label>
      ) : null}

      {!values.isAllDay ? (
        <div className={styles.formRow}>
          <Clock3 aria-hidden="true" size={17} strokeWidth={1.5} />
          <label>
            <span className={styles.srOnly}>Start time</span>
            <input
              disabled={saving}
              required
              type="time"
              value={values.startTime}
              onChange={(event) => patch({ startTime: event.target.value })}
            />
          </label>
          <span className={styles.timeSeparator}>to</span>
          <label>
            <span className={styles.srOnly}>End time</span>
            <input
              disabled={saving}
              required
              type="time"
              value={values.endTime}
              onChange={(event) => patch({ endTime: event.target.value })}
            />
          </label>
        </div>
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
            backgroundColor: selectedCalendar?.color ?? "#7a8ba3",
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
