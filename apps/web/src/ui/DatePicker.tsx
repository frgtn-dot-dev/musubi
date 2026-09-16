import type { Settings } from "@musubi/types";
import { ChevronDown } from "lucide-react";
import { useRef, useState, createContext, useContext } from "react";
import { getLongDateLabel, parseDateKey } from "~/calendar/calendar-math";
import { MiniCalendar } from "~/calendar/components/MiniCalendar";
import { toDateKey } from "~/calendar/date-key";
import { Button } from "./Button";
import { classNames } from "./class-names";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import styles from "./primitives.module.css";

export const DateFormatContext = createContext<Settings["dateFormat"]>("ymd");

function formatEntry(value: string, format: Settings["dateFormat"]) {
  if (!isDateKey(value)) return value;
  const [year, month, day] = value.split("-");
  return format === "dmy" ? `${day}/${month}/${year}` : format === "mdy" ? `${month}/${day}/${year}` : value;
}

function parseEntry(value: string, format: Settings["dateFormat"]) {
  const match = value.trim().match(format === "ymd" ? /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/ : /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!match) return "";
  const [, a, b, c] = match;
  const [year, month, day] = format === "ymd" ? [a!, b!, c!] : format === "dmy" ? [c!, b!, a!] : [c!, a!, b!];
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isDateKey(result) ? result : "";
}

export type DatePickerProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
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
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
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
  const dateFormat = useContext(DateFormatContext);
  const entryPlaceholder = dateFormat === "dmy" ? "DD/MM/YYYY" : dateFormat === "mdy" ? "MM/DD/YYYY" : "YYYY-MM-DD";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatEntry(value, dateFormat));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const validValue = isDateKey(value);
  const anchor = validValue ? parseDateKey(value) : new Date();
  const parsedDraft = parseEntry(draft, dateFormat);
  const draftValid = isAvailable(parsedDraft, min, max);
  const today = toDateKey(new Date());
  const todayAvailable = isAvailable(today, min, max);

  function choose(nextValue: string) {
    if (!isAvailable(nextValue, min, max)) return;
    onChange(nextValue);
    setDraft(formatEntry(nextValue, dateFormat));
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(formatEntry(value, dateFormat));
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          ref={triggerRef}
          aria-describedby={describedBy}
          aria-invalid={invalid}
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
            const active = document.activeElement;
            if (active !== document.body && active !== triggerRef.current && active !== contentRef.current) return;
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
          monthYearSelectors
          label={`Choose ${label.toLocaleLowerCase()}`}
          max={max}
          min={min}
          onDateChange={choose}
          weekStartsOn={weekStartsOn}
        />
        <div className={styles.datePickerEntry}>
          <label>
            <span className={styles.visuallyHidden}>Exact date</span>
            <input
              aria-invalid={draft.length > 0 && !draftValid}
              inputMode="numeric"
              placeholder={entryPlaceholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !draftValid) return;
                event.preventDefault();
                choose(parsedDraft);
              }}
            />
          </label>
          <Button
            disabled={!todayAvailable}
            size="compact"
            variant="secondary"
            onClick={() => choose(today)}
          >
            Today
          </Button>
          {onClear ? (
            <Button
              size="compact"
              variant="secondary"
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
            {min && parsedDraft && parsedDraft < min
              ? `Choose ${formatEntry(min, dateFormat)} or later.`
              : max && parsedDraft && parsedDraft > max
                ? `Choose ${formatEntry(max, dateFormat)} or earlier.`
                : `Use the format ${entryPlaceholder}.`}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
