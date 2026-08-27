import type { Settings } from "@musubi/types";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createTimeGeometry } from "~/calendar/time-geometry";
import { classNames } from "./class-names";
import { Popover, PopoverAnchor, PopoverContent } from "./Popover";
import { Segmented } from "./Segmented";
import styles from "./primitives.module.css";

const TIME_PATTERN = /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i;
const SNAP_MINUTES = createTimeGeometry().snapMinutes;
const MINUTES_PER_DAY = 24 * 60;

const SNAPPED_TIMES = Array.from(
  { length: MINUTES_PER_DAY / SNAP_MINUTES },
  (_, index) => minutesToTime(index * SNAP_MINUTES),
);
const HOURS_24 = Array.from({ length: 24 }, (_, hour) => hour);
/** 12 first, the way a clock face reads. */
const HOURS_12 = [12, ...Array.from({ length: 11 }, (_, index) => index + 1)];
/** Every minute, not the grid's snap steps: the column scrolls either way, and
    a meeting at :07 is a real thing to have to type today. */
const MINUTES = Array.from({ length: 60 }, (_, index) => index);

type Period = "AM" | "PM";
type Column = "hour" | "minute";

/** The hour a 12-hour dial means once the period is known. */
function hourFromDial(dialHour: number, period: Period): number {
  if (period === "AM") return dialHour === 12 ? 0 : dialHour;
  return dialHour === 12 ? 12 : dialHour + 12;
}

function dialFromHour(hour: number): number {
  return hour % 12 || 12;
}

export type TimePickerProps = {
  className?: string;
  disabled?: boolean;
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  timeFormat: Settings["timeFormat"];
  value: string;
};

export function timeToMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);

  if (
    hours === undefined ||
    minutes === undefined ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const bounded = Math.max(
    0,
    Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)),
  );
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(
    bounded % 60,
  ).padStart(2, "0")}`;
}

export function parseTimeInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const compact = trimmed.match(/^(\d{3,4})\s*(am|pm)?$/);
  const expanded = compact
    ? `${compact[1]!.slice(0, -2)}:${compact[1]!.slice(-2)}${
        compact[2] ? ` ${compact[2]}` : ""
      }`
    : trimmed;
  const match = expanded.match(TIME_PATTERN);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const period = match[3]?.toLowerCase();

  if (minutes > 59) return null;

  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === "am") {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours > 23) {
    return null;
  }

  return minutesToTime(hours * 60 + minutes);
}

export function formatTimeValue(
  value: string,
  timeFormat: Settings["timeFormat"],
): string {
  const total = timeToMinutes(value);
  if (total === null) return value;
  if (timeFormat === "24h") return value;

  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const period = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 || 12;

  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function isAvailable(value: string, min?: string, max?: string) {
  return (
    timeToMinutes(value) !== null &&
    (!min || value >= min) &&
    (!max || value <= max)
  );
}

/**
 * An editable combobox: recognition from a scannable 15-minute list, speed
 * from direct typing. The stored value remains the form's canonical HH:mm.
 */
export function TimePicker({
  className,
  disabled = false,
  label,
  max,
  min,
  onChange,
  placeholder = "Select time",
  timeFormat,
  value,
}: TimePickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [column, setColumn] = useState<Column>("hour");
  /** Set only once somebody flips it; otherwise the value decides. */
  const [period, setPeriod] = useState<Period>();
  const [draft, setDraft] = useState(() =>
    formatTimeValue(value, timeFormat),
  );
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const parsedDraft = parseTimeInput(draft);
  const draftValid = Boolean(
    parsedDraft && isAvailable(parsedDraft, min, max),
  );

  const firstAvailable =
    SNAPPED_TIMES.find((time) => isAvailable(time, min, max)) ?? "00:00";
  /** What the two columns are standing on: the typed draft while it parses,
      otherwise the committed value, otherwise the first time on offer. */
  const pending =
    (parsedDraft && isAvailable(parsedDraft, min, max) ? parsedDraft : null) ??
    (isAvailable(value, min, max) ? value : firstAvailable);
  const pendingMinutes = timeToMinutes(pending) ?? 0;
  const pendingHour = Math.floor(pendingMinutes / 60);
  const pendingMinute = pendingMinutes - pendingHour * 60;

  /** An hour is on offer only if at least one of its steps is. */
  function hourAvailable(hour: number) {
    return MINUTES.some((minute) =>
      isAvailable(minutesToTime(hour * 60 + minute), min, max),
    );
  }

  const periodInUse: Period = period ?? (pendingHour < 12 ? "AM" : "PM");
  const hourOptions =
    timeFormat === "24h"
      ? HOURS_24.filter(hourAvailable)
      : HOURS_12.map((dial) => hourFromDial(dial, periodInUse)).filter(
          hourAvailable,
        );
  const minuteOptions = MINUTES.filter((minute) =>
    isAvailable(minutesToTime(pendingHour * 60 + minute), min, max),
  );
  const periodAvailable = (candidate: Period) =>
    HOURS_12.some((dial) => hourAvailable(hourFromDial(dial, candidate)));

  const activeHour = hourOptions.includes(pendingHour)
    ? pendingHour
    : (hourOptions[0] ?? pendingHour);
  const activeMinute = minuteOptions.includes(pendingMinute)
    ? pendingMinute
    : (minuteOptions[0] ?? pendingMinute);
  const activeId =
    column === "hour"
      ? `${id}-hour-${activeHour}`
      : `${id}-minute-${activeMinute}`;

  function revealOption(key: string) {
    requestAnimationFrame(() => {
      optionRefs.current.get(key)?.scrollIntoView?.({ block: "center" });
    });
  }

  function openList() {
    setDraft(formatTimeValue(value, timeFormat));
    setDirty(false);
    setColumn("hour");
    setPeriod(undefined);
    setOpen(true);
    revealOption(`hour-${Math.floor((timeToMinutes(value) ?? 0) / 60)}`);
  }

  /** Moves the columns without committing, so the draft stays the source. */
  function moveTo(hour: number, minute: number) {
    const nextMinutes = MINUTES.some(
      (step) => step === minute && isAvailable(minutesToTime(hour * 60 + step), min, max),
    )
      ? minute
      : (MINUTES.find((step) =>
          isAvailable(minutesToTime(hour * 60 + step), min, max),
        ) ?? minute);
    setDraft(formatTimeValue(minutesToTime(hour * 60 + nextMinutes), timeFormat));
    setDirty(false);
  }

  function choose(
    nextValue: string,
    { returnFocus = true }: { returnFocus?: boolean } = {},
  ) {
    if (!isAvailable(nextValue, min, max)) return;
    onChange(nextValue);
    setDraft(formatTimeValue(nextValue, timeFormat));
    setDirty(false);
    setOpen(false);
    if (returnFocus) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function commitDraft(returnFocus = true) {
    const parsed = parseTimeInput(draft);
    if (parsed && isAvailable(parsed, min, max)) {
      choose(parsed, { returnFocus });
      return;
    }
    setDraft(formatTimeValue(value, timeFormat));
    setDirty(false);
    setOpen(false);
  }

  function moveActive(direction: -1 | 1) {
    const steps = column === "hour" ? hourOptions : minuteOptions;
    if (steps.length === 0) return;
    const current = column === "hour" ? activeHour : activeMinute;
    const index = steps.indexOf(current);
    const next =
      steps[
        Math.max(
          0,
          Math.min(steps.length - 1, (index < 0 ? 0 : index) + direction),
        )
      ]!;

    if (column === "hour") {
      moveTo(next, activeMinute);
      revealOption(`hour-${next}`);
    } else {
      moveTo(activeHour, next);
      revealOption(`minute-${next}`);
    }
  }

  const invalid = dirty && !draftValid;
  const error =
    min && parsedDraft && parsedDraft < min
      ? `Choose ${formatTimeValue(min, timeFormat)} or later.`
      : max && parsedDraft && parsedDraft > max
        ? `Choose ${formatTimeValue(max, timeFormat)} or earlier.`
        : "Type a valid time, such as 9, 9:30 or 21:15.";

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openList();
        } else {
          setOpen(false);
        }
      }}
    >
      <PopoverAnchor asChild>
        <div className={classNames(styles.timePicker, className)}>
          <input
            aria-activedescendant={open ? activeId : undefined}
            aria-autocomplete="list"
            aria-controls={`${id}-hours ${id}-minutes`}
            aria-describedby={`${id}-hint`}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-invalid={invalid}
            aria-label={label}
            autoComplete="off"
            className={styles.timePickerInput}
            disabled={disabled}
            inputMode="numeric"
            placeholder={placeholder}
            ref={inputRef}
            role="combobox"
            value={open ? draft : formatTimeValue(value, timeFormat)}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                contentRef.current?.contains(event.relatedTarget)
              ) {
                return;
              }
              if (dirty) {
                commitDraft(false);
              } else {
                setOpen(false);
              }
            }}
            onChange={(event) => {
              const nextDraft = event.target.value;
              const parsed = parseTimeInput(nextDraft);
              setDraft(nextDraft);
              setDirty(true);
              setOpen(true);
              if (parsed && isAvailable(parsed, min, max)) {
                revealOption(`hour-${Math.floor((timeToMinutes(parsed) ?? 0) / 60)}`);
              }
            }}
            onClick={() => {
              if (!open) openList();
            }}
            onFocus={() => {
              if (!open) openList();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!open) openList();
                else moveActive(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) openList();
                else moveActive(-1);
              } else if (
                (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
                open &&
                !dirty
              ) {
                // Left and right change which column the arrows walk. Only
                // while nothing is typed: in a text field they are the caret.
                event.preventDefault();
                setColumn(event.key === "ArrowRight" ? "minute" : "hour");
              } else if (
                (event.key === "Home" || event.key === "End") &&
                open &&
                !dirty
              ) {
                event.preventDefault();
                const steps = column === "hour" ? hourOptions : minuteOptions;
                const step =
                  event.key === "Home" ? steps[0] : steps.at(-1);
                if (step !== undefined) {
                  if (column === "hour") moveTo(step, activeMinute);
                  else moveTo(activeHour, step);
                  revealOption(`${column}-${step}`);
                }
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                if (dirty) {
                  commitDraft();
                } else {
                  choose(minutesToTime(activeHour * 60 + activeMinute));
                }
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setDraft(formatTimeValue(value, timeFormat));
                setDirty(false);
                setOpen(false);
              }
            }}
          />
          <ChevronDown
            aria-hidden="true"
            className={styles.timePickerChevron}
            size={15}
            strokeWidth={1.5}
          />
          <span className={styles.visuallyHidden} id={`${id}-hint`}>
            Type a time or use the arrow keys to choose from the list.
          </span>
        </div>
      </PopoverAnchor>
      {open ? (
        <PopoverContent
          align="start"
          aria-label={`Choose ${label.toLocaleLowerCase()}`}
          className={styles.timePickerPopover}
          ref={contentRef}
          side="bottom"
          sideOffset={6}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === inputRef.current) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <h2 className={styles.timePickerSheetTitle}>
            Choose {label.toLocaleLowerCase()}
          </h2>
          {timeFormat === "12h" ? (
            <Segmented
              className={styles.timePickerPeriod}
              label={`${label} before or after noon`}
              options={(["AM", "PM"] as const).map((option) => ({
                disabled: !periodAvailable(option),
                label: option,
                value: option,
              }))}
              size="compact"
              value={periodInUse}
              onChange={(next) => {
                setPeriod(next);
                moveTo(
                  hourFromDial(dialFromHour(pendingHour), next),
                  pendingMinute,
                );
              }}
            />
          ) : null}
          <div className={styles.timePickerColumns}>
            {(
              [
                { key: "hour", label: "Hour", steps: hourOptions },
                { key: "minute", label: "Minute", steps: minuteOptions },
              ] as const
            ).map((axis) => (
              <div
                aria-label={`${label} ${axis.label.toLocaleLowerCase()}`}
                className={styles.timePickerList}
                id={`${id}-${axis.key}s`}
                key={axis.key}
                role="listbox"
                onWheel={(event) => {
                  event.currentTarget.scrollTop += event.deltaY;
                  event.preventDefault();
                }}
              >
                {axis.steps.map((step) => {
                  const hour = axis.key === "hour" ? step : activeHour;
                  const minute = axis.key === "hour" ? activeMinute : step;
                  const time = minutesToTime(hour * 60 + minute);
                  const display =
                    axis.key === "hour"
                      ? String(
                          timeFormat === "24h"
                            ? step
                            : dialFromHour(step),
                        ).padStart(timeFormat === "24h" ? 2 : 1, "0")
                      : String(step).padStart(2, "0");
                  const active =
                    axis.key === "hour"
                      ? step === activeHour
                      : step === activeMinute;

                  return (
                    <button
                      aria-label={display}
                      aria-selected={
                        axis.key === "hour"
                          ? step === Math.floor((timeToMinutes(value) ?? -1) / 60)
                          : step === (timeToMinutes(value) ?? -1) % 60
                      }
                      className={styles.timePickerOption}
                      data-active={
                        active && column === axis.key ? "" : undefined
                      }
                      id={`${id}-${axis.key}-${step}`}
                      key={step}
                      ref={(node) => {
                        const mapKey = `${axis.key}-${step}`;
                        if (node) optionRefs.current.set(mapKey, node);
                        else optionRefs.current.delete(mapKey);
                      }}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      /* The hour narrows, the minute decides. Committing on
                         the hour would close the list before the column beside
                         it could be used. */
                      onClick={() => {
                        if (axis.key === "hour") {
                          moveTo(step, activeMinute);
                          setColumn("minute");
                        } else {
                          choose(time);
                        }
                      }}
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerMove={() => setColumn(axis.key)}
                    >
                      <span>{display}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p
            className={styles.timePickerHint}
            role={invalid ? "alert" : undefined}
          >
            {invalid
              ? error
              : "Type a time, or use the arrow keys to choose."}
          </p>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
