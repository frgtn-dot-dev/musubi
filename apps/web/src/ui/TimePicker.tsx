import * as Popover from "@radix-ui/react-popover";
import type { Settings } from "@musubi/types";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createTimeGeometry } from "~/calendar/time-geometry";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

const TIME_PATTERN = /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i;
const SNAP_MINUTES = createTimeGeometry().snapMinutes;
const MINUTES_PER_DAY = 24 * 60;

const SNAPPED_TIMES = Array.from(
  { length: MINUTES_PER_DAY / SNAP_MINUTES },
  (_, index) => minutesToTime(index * SNAP_MINUTES),
);

export type TimePickerProps = {
  className?: string;
  disabled?: boolean;
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  relativeTo?: string;
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

function durationLabel(duration: number) {
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;

  if (hours === 0) return `+${minutes}m`;
  if (minutes === 0) return `+${hours}h`;
  return `+${hours}h ${minutes}m`;
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
  relativeTo,
  timeFormat,
  value,
}: TimePickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [activeValue, setActiveValue] = useState(value);
  const [draft, setDraft] = useState(() =>
    formatTimeValue(value, timeFormat),
  );
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const parsedDraft = parseTimeInput(draft);
  const draftValid = Boolean(
    parsedDraft && isAvailable(parsedDraft, min, max),
  );
  const relativeMinutes = relativeTo
    ? timeToMinutes(relativeTo)
    : null;

  const optionSet = new Set(
    SNAPPED_TIMES.filter((time) => isAvailable(time, min, max)),
  );
  if (isAvailable(value, min, max)) optionSet.add(value);
  const options = [...optionSet].sort(
    (left, right) =>
      (timeToMinutes(left) ?? 0) - (timeToMinutes(right) ?? 0),
  );

  function initialOption() {
    if (options.includes(value)) return value;
    return options.find((time) => time >= value) ?? options.at(-1) ?? "";
  }

  function revealOption(nextValue: string) {
    requestAnimationFrame(() => {
      optionRefs.current
        .get(nextValue)
        ?.scrollIntoView?.({ block: "center" });
    });
  }

  function openList() {
    const nextActive = initialOption();
    setDraft(formatTimeValue(value, timeFormat));
    setDirty(false);
    setActiveValue(nextActive);
    setOpen(true);
    revealOption(nextActive);
  }

  function choose(
    nextValue: string,
    { returnFocus = true }: { returnFocus?: boolean } = {},
  ) {
    if (!isAvailable(nextValue, min, max)) return;
    onChange(nextValue);
    setDraft(formatTimeValue(nextValue, timeFormat));
    setDirty(false);
    setActiveValue(nextValue);
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
    if (options.length === 0) return;
    const currentIndex = options.indexOf(activeValue);
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : options.length - 1
        : Math.max(
            0,
            Math.min(options.length - 1, currentIndex + direction),
          );
    const nextValue = options[nextIndex]!;
    setActiveValue(nextValue);
    setDraft(formatTimeValue(nextValue, timeFormat));
    setDirty(false);
    revealOption(nextValue);
  }

  const invalid = dirty && !draftValid;
  const error =
    min && parsedDraft && parsedDraft < min
      ? `Choose ${formatTimeValue(min, timeFormat)} or later.`
      : max && parsedDraft && parsedDraft > max
        ? `Choose ${formatTimeValue(max, timeFormat)} or earlier.`
        : "Type a valid time, such as 9, 9:30 or 21:15.";

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openList();
        } else {
          setOpen(false);
        }
      }}
    >
      <Popover.Anchor asChild>
        <div className={classNames(styles.timePicker, className)}>
          <input
            aria-activedescendant={
              open && activeValue
                ? `${id}-option-${activeValue.replace(":", "-")}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={`${id}-listbox`}
            aria-describedby={`${id}-hint`}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-invalid={invalid}
            aria-label={label}
            autoComplete="off"
            className={styles.timePickerInput}
            disabled={disabled}
            inputMode="numeric"
            ref={inputRef}
            role="combobox"
            value={open ? draft : formatTimeValue(value, timeFormat)}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                [...optionRefs.current.values()]
                  .some((option) => option.contains(event.relatedTarget))
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
              if (parsed && options.includes(parsed)) {
                setActiveValue(parsed);
                revealOption(parsed);
              } else {
                setActiveValue("");
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
              } else if (event.key === "Home" && open && !dirty) {
                event.preventDefault();
                const first = options[0];
                if (first) {
                  setActiveValue(first);
                  setDraft(formatTimeValue(first, timeFormat));
                  revealOption(first);
                }
              } else if (event.key === "End" && open && !dirty) {
                event.preventDefault();
                const last = options.at(-1);
                if (last) {
                  setActiveValue(last);
                  setDraft(formatTimeValue(last, timeFormat));
                  revealOption(last);
                }
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                if (dirty) {
                  commitDraft();
                } else if (activeValue) {
                  choose(activeValue);
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
      </Popover.Anchor>
      <Popover.Portal>
        {open ? (
          <Popover.Content
            align="start"
            aria-label={`Choose ${label.toLocaleLowerCase()}`}
            className={styles.timePickerPopover}
            collisionPadding={12}
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
            <div
              aria-label={`${label} options`}
              className={styles.timePickerList}
              id={`${id}-listbox`}
              role="listbox"
            >
              {options.map((time) => {
                const minutes = timeToMinutes(time);
                const duration =
                  minutes !== null &&
                  relativeMinutes !== null &&
                  minutes > relativeMinutes
                    ? durationLabel(minutes - relativeMinutes)
                    : null;
                const display = formatTimeValue(time, timeFormat);

                return (
                  <button
                    aria-label={
                      duration ? `${display}, ${duration}` : display
                    }
                    aria-selected={time === value}
                    className={styles.timePickerOption}
                    data-active={time === activeValue ? "" : undefined}
                    id={`${id}-option-${time.replace(":", "-")}`}
                    key={time}
                    ref={(node) => {
                      if (node) optionRefs.current.set(time, node);
                      else optionRefs.current.delete(time);
                    }}
                    role="option"
                    tabIndex={-1}
                    type="button"
                    onClick={() => choose(time)}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActiveValue(time)}
                  >
                    <span>{display}</span>
                    {duration ? <small>{duration}</small> : null}
                  </button>
                );
              })}
            </div>
            <p
              className={styles.timePickerHint}
              role={invalid ? "alert" : undefined}
            >
              {invalid
                ? error
                : "Type a time, or use ↑ and ↓ to choose."}
            </p>
            <Popover.Arrow className={styles.timePickerArrow} />
          </Popover.Content>
        ) : null}
      </Popover.Portal>
    </Popover.Root>
  );
}
