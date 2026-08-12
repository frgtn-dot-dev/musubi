import type { EditScope } from "@musubi/calendar";
import type { ReactNode } from "react";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import styles from "./styles/recurrence-scope.module.css";

const OPTION_LABELS: Record<
  "change" | "delete",
  Array<{ label: string; scope: EditScope }>
> = {
  change: [
    { label: "This event", scope: "occurrence" },
    { label: "This and following events", scope: "following" },
    { label: "All events", scope: "series" },
  ],
  delete: [
    { label: "This event", scope: "occurrence" },
    { label: "This and following events", scope: "following" },
    { label: "Entire series", scope: "series" },
  ],
};

/**
 * Which occurrences a change to a recurring event applies to.
 *
 * Asked up front rather than offered as Undo afterwards: the three answers are
 * different edits, not one edit to take back, and the choice cannot be guessed
 * from the gesture. The new time is spelled out because the calendar behind the
 * dialog still shows the old one — nothing is written until an answer comes.
 */
export function RecurrenceScopeDialog({
  action = "change",
  busyScope,
  consequence,
  error,
  onResolve,
  returnFocus,
  timeLabel,
  title,
}: {
  action?: "change" | "delete";
  busyScope?: EditScope;
  consequence?: string;
  error?: ReactNode;
  /** The chosen scope, or undefined when dismissed. */
  onResolve: (scope: EditScope | undefined) => void;
  /**
   * Where focus was when the gesture happened. There is no trigger to return to
   * — a drag or Alt+arrow opened this — so it is carried in.
   */
  returnFocus?: HTMLElement | null;
  timeLabel?: string;
  title: string;
}) {
  const deleting = action === "delete";

  return (
    <Dialog
      closeLabel={`Close ${deleting ? "delete" : "change"} recurring event dialog`}
      /* Always raised from an event's own layer — the preview popover or a drag
         over the grid — so it has to clear the surface that asked. */
      elevated
      description={
        deleting
          ? `Choose which events to remove from “${title}”.`
          : timeLabel
            ? // The calendar behind the dialog still shows the old time, so the
              // new one is spelled out rather than pointed at.
              `“${title}” moves to ${timeLabel}. Which events should change?`
            : `Which events should take the changes to “${title}”?`
      }
      /* No Cancel row: the header's close button and Escape both resolve this the
         same way, and a footer for one of them made backing out look like a
         choice on par with the scopes. */
      onOpenChange={(open) => {
        if (!open && !busyScope) onResolve(undefined);
      }}
      open
      returnFocus={returnFocus}
      size="compact"
      title={deleting ? "Delete recurring event" : "Change recurring event"}
    >
      {consequence ? (
        <p className={styles.consequence}>{consequence}</p>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.scopeOptions}>
        {OPTION_LABELS[action].map((option) => (
          <Button
            className={styles.scopeOption}
            data-destructive={deleting ? "" : undefined}
            disabled={Boolean(busyScope)}
            key={option.scope}
            loading={busyScope === option.scope}
            variant="secondary"
            onClick={() => onResolve(option.scope)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
