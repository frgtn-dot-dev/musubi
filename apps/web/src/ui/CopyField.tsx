import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

export type CopyFieldProps = {
  className?: string;
  /** Accessible name for the value, which carries no visible label. */
  label: string;
  value: string;
};

const RESET_DELAY = 2_000;

/**
 * A link to hand over: readable, selectable, and copied in one press.
 *
 * The button says what actually happened rather than assuming. A copy that
 * failed — no clipboard outside a secure context, or a refused permission —
 * leaves the value selected, because the way out is copying it by hand and
 * that should take one keystroke.
 */
export function CopyField({ className, label, value }: CopyFieldProps) {
  const [state, setState] = useState<"copied" | "failed" | "idle">("idle");
  const valueRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      valueRef.current?.select();
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), RESET_DELAY);
  }

  return (
    <div className={classNames(styles.copyField, className)}>
      <input
        aria-label={label}
        className={styles.copyFieldValue}
        readOnly
        ref={valueRef}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        icon={
          state === "copied" ? (
            <Check size={15} strokeWidth={1.8} />
          ) : (
            <Copy size={15} strokeWidth={1.6} />
          )
        }
        size="compact"
        variant="secondary"
        onClick={() => void copy()}
      >
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed"
            : "Copy"}
      </Button>
    </div>
  );
}
