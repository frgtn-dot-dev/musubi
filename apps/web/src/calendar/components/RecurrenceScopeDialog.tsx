import * as Dialog from "@radix-ui/react-dialog";
import type { EditScope } from "../recurrence-edit";
import styles from "./workspace.module.css";

const OPTIONS: Array<{ label: string; scope: EditScope }> = [
  { label: "This event", scope: "occurrence" },
  { label: "This and following events", scope: "following" },
  { label: "All events", scope: "series" },
];

/**
 * Which occurrences a change to a recurring event applies to.
 *
 * Asked up front rather than offered as Undo afterwards: the three answers are
 * different edits, not one edit to take back, and the choice cannot be guessed
 * from the gesture. The new time is spelled out because the calendar behind the
 * dialog still shows the old one — nothing is written until an answer comes.
 */
export function RecurrenceScopeDialog({
  onResolve,
  timeLabel,
  title,
}: {
  /** The chosen scope, or undefined when dismissed. */
  onResolve: (scope: EditScope | undefined) => void;
  timeLabel: string;
  title: string;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => open || onResolve(undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="recurrence-scope-description"
          className={styles.scopeDialog}
        >
          <Dialog.Title>Change recurring event</Dialog.Title>
          <Dialog.Description id="recurrence-scope-description">
            “{title}” moves to {timeLabel}. Which events should change?
          </Dialog.Description>
          <div className={styles.scopeOptions}>
            {OPTIONS.map((option) => (
              <button
                className={styles.secondaryButton}
                key={option.scope}
                type="button"
                onClick={() => onResolve(option.scope)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Dialog.Close asChild>
            <button className={styles.textButton} type="button">
              Cancel
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
