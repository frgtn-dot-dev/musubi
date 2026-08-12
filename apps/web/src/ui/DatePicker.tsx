import type { Settings } from "@musubi/types";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { getLongDateLabel, parseDateKey } from "~/calendar/calendar-math";
import { MiniCalendar } from "~/calendar/components/MiniCalendar";
import { toDateKey } from "~/calendar/date-key";
import { Button } from "./Button";
import { classNames } from "./class-names";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import styles from "./primitives.module.css";

export type DatePickerProps = {
  className?: string;
  disabled?: boolean;
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  /**
   * Offered inside the popover when a date can be taken back. Outside it, a Clear
   * button beside the trigger changed the row's width and moved the trigger every
   * time a date was picked.
   */
  onClear?: () => void;
  /** What the trigger says while nothing is chosen. */
  placeholder?: string;
  value: string;
  weekStartsOn: Settings["weekStartsOn"];
};

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toDateKey(parseDateKey(value)) === value;
}

function isAvailable(value: string, min?: string, max?: string) {
  return (
    isDateKey(value) &&
    (!min || value >= min) &&
    (!max || value <= max)
  );
}

/**
 * Calendar-first for recognition, with an exact YYYY-MM-DD entry alongside it
 * for people who already know the date they want.
 */
export function DatePicker({
  className,
  disabled = false,
  label,
  max,
  min,
  onChange,
  onClear,
  placeholder = "Choose date",
  value,
  weekStartsOn,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const contentRef = useRef<HTMLDivElement>(null);
  const validValue = isDateKey(value);
  const anchor = validValue ? parseDateKey(value) : new Date();
  const draftValid = isAvailable(draft, min, max);
  const today = toDateKey(new Date());
  const todayAvailable = isAvailable(today, min, max);

  function choose(nextValue: string) {
    if (!isAvailable(nextValue, min, max)) return;
    onChange(nextValue);
    setDraft(nextValue);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(value);
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}: ${
            validValue ? getLongDateLabel(anchor) : placeholder
          }`}
          className={classNames(styles.datePickerTrigger, className)}
          disabled={disabled}
          type="button"
        >
          <span>
            {validValue ? getLongDateLabel(anchor) : placeholder}
          </span>
          <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`Choose ${label.toLocaleLowerCase()}`}
        className={styles.datePickerPopover}
        ref={contentRef}
        side="left"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => {
            const selected =
              contentRef.current?.querySelector<HTMLElement>(
                '[role="gridcell"][aria-selected="true"]',
              );
            selected?.focus();
          });
        }}
      >
        <MiniCalendar
          anchor={anchor}
          label={`Choose ${label.toLocaleLowerCase()}`}
          max={max}
          min={min}
          onDateChange={choose}
          weekStartsOn={weekStartsOn}
        />
        <div className={styles.datePickerEntry}>
          <label>
            <span>Exact date</span>
            <input
              aria-invalid={draft.length > 0 && !draftValid}
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !draftValid) return;
                event.preventDefault();
                choose(draft);
              }}
            />
          </label>
          <Button
            disabled={!todayAvailable}
            size="compact"
            variant="ghost"
            onClick={() => choose(today)}
          >
            Today
          </Button>
          {onClear ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
        {/* Only when it is wrong: the calendar above is the instruction. */}
        {draft.length > 0 && !draftValid ? (
          <p className={styles.datePickerHint} role="alert">
            {min && draft < min
              ? `Choose ${min} or later.`
              : max && draft > max
                ? `Choose ${max} or earlier.`
                : "Use the format YYYY-MM-DD."}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
