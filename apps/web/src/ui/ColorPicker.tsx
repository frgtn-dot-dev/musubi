import {
  MICROSOFT_CALENDAR_COLORS,
  MUSUBI_CALENDAR_COLORS,
  nearestMicrosoftCalendarColor,
} from "@musubi/types";
import { Check, Plus } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";
import { getReadableEventTextColor } from "~/calendar/event-color";
import { classNames } from "./class-names";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import styles from "./primitives.module.css";

type PaletteColor = {
  hex: string;
  name: string;
};

export type ColorPickerProps = {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  provider?: string | null;
  value: string;
};

export function normalizeHexColor(value: string): string | null {
  const match = /^#?([\da-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1]!.toUpperCase()}` : null;
}

function displayName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function matches(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

/**
 * A compact, named palette for quick recognition with an explicit custom hex
 * path. The value remains a plain #RRGGBB string for existing form contracts.
 */
export function ColorPicker({
  className,
  disabled = false,
  label,
  onChange,
  provider,
  value,
}: ColorPickerProps) {
  const id = useId();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const customInputRef = useRef<HTMLInputElement>(null);
  const microsoft = provider === "microsoft";
  const palette: readonly PaletteColor[] = microsoft
    ? MICROSOFT_CALENDAR_COLORS
    : MUSUBI_CALENDAR_COLORS;
  const normalizedValue = normalizeHexColor(value);
  const matchedPaletteColor = microsoft
    ? nearestMicrosoftCalendarColor(value).hex
    : palette.find((color) => matches(color.hex, value))?.hex;
  const customSelected =
    !microsoft &&
    Boolean(
      normalizedValue &&
        !palette.some((color) => matches(color.hex, normalizedValue)),
    );
  const selectedKey = customSelected
    ? "custom"
    : (matchedPaletteColor ?? palette[0]!.hex);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(selectedKey);
  const [customOpen, setCustomOpen] = useState(customSelected);
  const [customDraft, setCustomDraft] = useState(
    normalizedValue ?? value,
  );
  const [customDirty, setCustomDirty] = useState(false);
  const validCustom = normalizeHexColor(customDraft);
  const optionKeys = [
    ...palette.map((color) => color.hex),
    ...(!microsoft ? ["custom"] : []),
  ];
  const columns = 3;

  function beginOpen() {
    const nextCustomSelected =
      !microsoft &&
      Boolean(
        normalizedValue &&
          !palette.some((color) =>
            matches(color.hex, normalizedValue),
          ),
      );
    const nextKey = nextCustomSelected
      ? "custom"
      : (matchedPaletteColor ?? palette[0]!.hex);
    setActiveKey(nextKey);
    setCustomOpen(nextCustomSelected);
    setCustomDraft(normalizedValue ?? value);
    setCustomDirty(false);
    setOpen(true);
  }

  function choose(hex: string) {
    onChange(hex);
    setOpen(false);
  }

  function focusOption(key: string) {
    setActiveKey(key);
    optionRefs.current.get(key)?.focus();
  }

  function moveFocus(event: KeyboardEvent, currentKey: string) {
    const currentIndex = optionKeys.indexOf(currentKey);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex += 1;
    else if (event.key === "ArrowLeft") nextIndex -= 1;
    else if (event.key === "ArrowDown") nextIndex += columns;
    else if (event.key === "ArrowUp") nextIndex -= columns;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = optionKeys.length - 1;
    else return;

    event.preventDefault();
    nextIndex = Math.max(0, Math.min(optionKeys.length - 1, nextIndex));
    focusOption(optionKeys[nextIndex]!);
  }

  function openCustom() {
    setActiveKey("custom");
    setCustomOpen(true);
    setCustomDraft(normalizedValue ?? value);
    setCustomDirty(false);
    requestAnimationFrame(() => {
      customInputRef.current?.focus();
      customInputRef.current?.select();
    });
  }

  const triggerColor = microsoft
    ? nearestMicrosoftCalendarColor(value).hex
    : (normalizedValue ?? palette[0]!.hex);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) beginOpen();
        else setOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}: ${triggerColor}`}
          className={classNames(styles.colorPickerTrigger, className)}
          disabled={disabled}
          style={{ "--picker-color": triggerColor } as CSSProperties}
          type="button"
        >
          <span aria-hidden="true" className={styles.colorPickerSwatch} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        aria-labelledby={`${id}-title`}
        className={styles.colorPickerPopover}
        side="bottom"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() =>
            optionRefs.current.get(activeKey)?.focus(),
          );
        }}
      >
        <div className={styles.colorPickerHeader}>
          <h2 id={`${id}-title`}>Choose color</h2>
          <p>
            {microsoft
              ? "Outlook supports these colors."
              : "Choose a pigment or enter your own."}
          </p>
        </div>
        <div
          aria-label={`${label} options`}
          className={styles.colorPickerGrid}
          data-provider={microsoft ? "microsoft" : "musubi"}
          role="listbox"
        >
          {palette.map((color) => {
            const selected = matches(color.hex, selectedKey);
            const foreground = getReadableEventTextColor(color.hex);

            return (
              <button
                aria-label={`${displayName(color.name)}, ${color.hex}`}
                aria-selected={selected}
                className={styles.colorPickerOption}
                key={color.hex}
                ref={(node) => {
                  if (node) optionRefs.current.set(color.hex, node);
                  else optionRefs.current.delete(color.hex);
                }}
                role="option"
                tabIndex={activeKey === color.hex ? 0 : -1}
                type="button"
                onClick={() => choose(color.hex)}
                onFocus={() => setActiveKey(color.hex)}
                onKeyDown={(event) => moveFocus(event, color.hex)}
              >
                <span
                  aria-hidden="true"
                  className={styles.colorPickerOptionSwatch}
                  style={
                    {
                      "--option-color": color.hex,
                      "--option-foreground": foreground,
                    } as CSSProperties
                  }
                >
                  {selected ? <Check size={18} strokeWidth={2} /> : null}
                </span>
                <span>{displayName(color.name)}</span>
              </button>
            );
          })}
          {!microsoft ? (
            <button
              aria-label="Custom color"
              aria-selected={customSelected}
              className={styles.colorPickerOption}
              ref={(node) => {
                if (node) optionRefs.current.set("custom", node);
                else optionRefs.current.delete("custom");
              }}
              role="option"
              tabIndex={activeKey === "custom" ? 0 : -1}
              type="button"
              onClick={openCustom}
              onFocus={() => setActiveKey("custom")}
              onKeyDown={(event) => moveFocus(event, "custom")}
            >
              <span
                aria-hidden="true"
                className={styles.colorPickerCustomSwatch}
              >
                <Plus size={18} strokeWidth={1.5} />
              </span>
              <span>Custom</span>
            </button>
          ) : null}
        </div>
        {customOpen ? (
          <div className={styles.colorPickerCustom}>
            <span
              aria-hidden="true"
              className={styles.colorPickerPreview}
              style={
                {
                  "--preview-color":
                    validCustom ?? normalizedValue ?? palette[0]!.hex,
                } as CSSProperties
              }
            />
            <label>
              <span>Hex color</span>
              <input
                aria-describedby={`${id}-custom-hint`}
                aria-invalid={customDirty && !validCustom}
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={7}
                placeholder="#B3A48A"
                ref={customInputRef}
                spellCheck={false}
                value={customDraft}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  const normalized = normalizeHexColor(nextDraft);
                  setCustomDraft(nextDraft);
                  setCustomDirty(true);
                  if (normalized) onChange(normalized);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && validCustom) {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
              />
            </label>
            <button
              className={styles.colorPickerDone}
              disabled={!validCustom}
              type="button"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
            <p
              id={`${id}-custom-hint`}
              role={customDirty && !validCustom ? "alert" : undefined}
            >
              {customDirty && !validCustom
                ? "Enter six hexadecimal characters."
                : "Changes preview as you type."}
            </p>
          </div>
        ) : null}
        <p className={styles.colorPickerHint}>
          Use arrow keys to move between colors.
        </p>
      </PopoverContent>
    </Popover>
  );
}
