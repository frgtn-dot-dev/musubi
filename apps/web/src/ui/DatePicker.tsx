import * as Popover from "@radix-ui/react-popover";
import type { Settings } from "@musubi/types";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { getLongDateLabel, parseDateKey } from "~/calendar/calendar-math";
import { MiniCalendar } from "~/calendar/components/MiniCalendar";
import { toDateKey } from "~/calendar/date-key";
import { Button } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type DatePickerProps = {
  className?: string;
  disabled?: boolean;
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
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
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(value);
        setOpen(nextOpen);
      }}
    >
      <Popover.Trigger asChild>
        <button
          aria-label={`${label}: ${
            validValue ? getLongDateLabel(anchor) : "Choose date"
          }`}
          className={classNames(styles.datePickerTrigger, className)}
          disabled={disabled}
          type="button"
        >
          <span>
            {validValue ? getLongDateLabel(anchor) : "Choose date"}
          </span>
          <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          aria-label={`Choose ${label.toLocaleLowerCase()}`}
          className={styles.datePickerPopover}
          collisionPadding={12}
          ref={contentRef}
          side="left"
          sideOffset={8}
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
          </div>
          <p
            className={styles.datePickerHint}
            role={draft.length > 0 && !draftValid ? "alert" : undefined}
          >
            {draft.length > 0 && !draftValid
              ? min && draft < min
                ? `Choose ${min} or later.`
                : max && draft > max
                  ? `Choose ${max} or earlier.`
                  : "Use the format YYYY-MM-DD."
              : "Type a date and press Enter."}
          </p>
          <Popover.Arrow className={styles.datePickerArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
