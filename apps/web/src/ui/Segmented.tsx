import {
  type KeyboardEvent,
  type ReactNode,
  useRef,
} from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type SegmentedOption<Value extends string> = {
  disabled?: boolean;
  label: ReactNode;
  value: Value;
};

export type SegmentedSize = "compact" | "control";

export type SegmentedProps<Value extends string> = {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: Value) => void;
  options: ReadonlyArray<SegmentedOption<Value>>;
  size?: SegmentedSize;
  value: Value;
};

function enabledIndex<Value extends string>(
  options: ReadonlyArray<SegmentedOption<Value>>,
  from: number,
  direction: 1 | -1,
) {
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (from + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return from;
}

/**
 * A short, visible choice set. Selection follows focus for arrow navigation,
 * matching native radio groups and avoiding a second confirmation step.
 */
export function Segmented<Value extends string>({
  className,
  disabled = false,
  label,
  onChange,
  options,
  size = "compact",
  value,
}: SegmentedProps<Value>) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const fallbackIndex = options.findIndex((option) => !option.disabled);
  const selectedOption = options[selectedIndex];
  const tabbableIndex =
    selectedIndex >= 0 && !selectedOption?.disabled
      ? selectedIndex
      : fallbackIndex;

  function choose(index: number) {
    const option = options[index];
    if (!option || disabled || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    optionRefs.current[index]?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = enabledIndex(options, index, -1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = enabledIndex(options, index, 1);
    } else if (event.key === "Home") {
      nextIndex = options.findIndex((option) => !option.disabled);
    } else if (event.key === "End") {
      nextIndex = options.findLastIndex((option) => !option.disabled);
    }

    if (nextIndex === undefined || nextIndex < 0) return;
    event.preventDefault();
    choose(nextIndex);
  }

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-orientation="horizontal"
      className={classNames(
        styles.segmented,
        styles[`segmented_${size}`],
        className,
      )}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;

        return (
          <button
            aria-checked={selected}
            className={styles.segmentedOption}
            disabled={disabled || option.disabled}
            key={option.value}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            role="radio"
            tabIndex={index === tabbableIndex ? 0 : -1}
            type="button"
            onClick={() => choose(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
