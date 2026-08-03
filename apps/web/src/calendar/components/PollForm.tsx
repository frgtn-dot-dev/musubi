import type { Settings } from "@musubi/types";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { PollDayPicker } from "./PollDayPicker";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import { TimePicker } from "~/ui/TimePicker";
import styles from "./styles/scheduling.module.css";

/** Quick presets. The field beside them takes anything from 5 minutes to a day. */
const DURATIONS = [15, 30, 45, 60, 90];
const MIN_DURATION = 5; // The API's floor.
const MAX_DURATION = 24 * 60;

/**
 * Matches the API's cap. Beyond this a poll stops being a question and becomes a
 * survey — and the grid people have to answer stops fitting on a phone.
 */
const MAX_POLL_SLOTS = 60;

export type PollDraft = {
  durationMinutes: number;
  slots: Array<{ start: string }>;
  title: string;
};

/**
 * What a poll asks: which days, at what times, for how long.
 *
 * Days and times are separate on purpose — one time covers every day picked, so
 * three weeks of evenings is a drag and a time rather than twenty-one rows.
 *
 * It reports a draft and nothing else. Inside the app that draft goes straight to
 * the server; on the public page it waits for an address to be confirmed first,
 * and neither host should have to know about the other.
 */
export function PollForm({
  busy = false,
  error,
  onSubmit,
  submitLabel = "Create the poll",
  timeFormat,
  weekStartsOn,
}: {
  busy?: boolean;
  error?: string;
  onSubmit: (draft: PollDraft) => void;
  submitLabel?: string;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const [title, setTitle] = useState("");
  // Held as text so the field can be empty while it is being retyped; five
  // presets do not cover everybody's meeting.
  const [duration, setDuration] = useState("60");
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>(["18:00"]);
  const [newTime, setNewTime] = useState("19:00");

  const durationMinutes = Number(duration);
  const durationValid =
    Number.isInteger(durationMinutes) &&
    durationMinutes >= MIN_DURATION &&
    durationMinutes <= MAX_DURATION;

  // Days × times. Written out because it is what the poll actually asks, and
  // because seeing "6 days × 2 times = 12 options" is what stops somebody
  // producing sixty by accident.
  const slots = days.flatMap((day) =>
    times.map((time) => ({ start: new Date(`${day}T${time}`).toISOString() })),
  );
  const tooMany = slots.length > MAX_POLL_SLOTS;
  const ready =
    title.trim().length > 0 && slots.length > 0 && !tooMany && durationValid;

  return (
    <div className={styles.form}>
      <Field label="What is it about">
        <input
          placeholder="Studio planning"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Which days</span>
        <PollDayPicker
          onChange={setDays}
          selected={days}
          weekStartsOn={weekStartsOn}
        />
        {days.length > 0 ? (
          <button
            className={styles.clear}
            type="button"
            onClick={() => setDays([])}
          >
            Clear {days.length} {days.length === 1 ? "day" : "days"}
          </button>
        ) : null}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>At what time</span>
        {/* One set of times for every chosen day. That is the whole trick for a
            long horizon: three weeks of evenings is three weeks and one time,
            not twenty-one rows. */}
        <div className={styles.times}>
          {times.map((time) => (
            <Button
              aria-label={`Remove ${time}`}
              icon={<X size={13} strokeWidth={1.8} />}
              key={time}
              size="compact"
              variant="secondary"
              onClick={() =>
                setTimes((current) => current.filter((item) => item !== time))
              }
            >
              {time}
            </Button>
          ))}
          <TimePicker
            className={styles.timeInput}
            label="Add a time"
            timeFormat={timeFormat}
            value={newTime}
            onChange={setNewTime}
          />
          <Button
            disabled={!newTime || times.includes(newTime)}
            icon={<Plus size={14} strokeWidth={1.8} />}
            size="compact"
            variant="secondary"
            onClick={() => {
              setTimes((current) => [...current, newTime].sort());
              setNewTime("");
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <fieldset className={styles.durations}>
        <legend>How long</legend>
        {DURATIONS.map((minutes) => (
          <Button
            aria-pressed={durationMinutes === minutes}
            key={minutes}
            size="compact"
            variant={durationMinutes === minutes ? "primary" : "secondary"}
            onClick={() => setDuration(String(minutes))}
          >
            {minutes} min
          </Button>
        ))}
        {/* "or" earns its word: the field carries the same value as the chips, so
            without it the number beside a lit-up "60 min" reads as a second,
            contradictory setting instead of the way to type a sixth one. */}
        <span className={styles.minutesField}>
          <span className={styles.minutesOr}>or</span>
          <input
            aria-label="Minutes"
            className={styles.minutes}
            inputMode="numeric"
            max={MAX_DURATION}
            min={MIN_DURATION}
            type="number"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
          <span className={styles.minutesUnit}>min</span>
        </span>
      </fieldset>

      {duration !== "" && !durationValid ? (
        <p className={styles.error} role="alert">
          A slot lasts between {MIN_DURATION} minutes and a whole day.
        </p>
      ) : null}

      <p className={tooMany ? styles.error : styles.summary}>
        {slots.length === 0
          ? "Pick at least one day and one time."
          : `${days.length} ${days.length === 1 ? "day" : "days"} × ${
              times.length
            } ${
              times.length === 1 ? "time" : "times"
            } = ${slots.length} options${
              tooMany
                ? ` — ${MAX_POLL_SLOTS} is the most a poll can ask about`
                : ""
            }`}
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <Button
        disabled={!ready}
        loading={busy}
        onClick={() =>
          onSubmit({ durationMinutes, slots, title: title.trim() })
        }
      >
        {submitLabel}
      </Button>
    </div>
  );
}
