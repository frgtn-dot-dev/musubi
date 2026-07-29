import { AlertTriangle, PencilLine, X } from "lucide-react";
import { Button, IconButton } from "~/ui/Button";
import styles from "./workspace.module.css";

type SaveBarProps = {
  conflict?: boolean;
  dirty: boolean;
  onDiscard: () => void;
  onDismiss: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  saving?: boolean;
};

export function SaveBar({
  conflict = false,
  dirty,
  onDiscard,
  onDismiss,
  onSave,
  onSaveAsNew,
  saving = false,
}: SaveBarProps) {
  if (!dirty) {
    return null;
  }

  const title = conflict
    ? "This page changed on another device"
    : "Unsaved page changes";

  return (
    <div
      aria-label={title}
      className={styles.saveBar}
      data-tone={conflict ? "warning" : undefined}
      role={conflict ? "alert" : "region"}
    >
      <span className={styles.saveBarIcon} aria-hidden="true">
        {conflict ? (
          <AlertTriangle size={18} strokeWidth={1.6} />
        ) : (
          <PencilLine size={18} strokeWidth={1.6} />
        )}
      </span>
      <div className={styles.saveBarCopy}>
        <strong>{title}</strong>
        <span>
          {conflict
            ? "Your edits weren’t saved. Keep them as a new page, or discard them and use the latest version."
            : "You have edited this Page."}
        </span>
      </div>
      <div className={styles.saveBarActions}>
        {conflict ? (
          <>
            <Button
              className={styles.saveBarSecondaryAction}
              disabled={saving}
              size="compact"
              variant="secondary"
              onClick={onDiscard}
            >
              Discard my changes
            </Button>
            <Button
              loading={saving}
              size="compact"
              onClick={onSaveAsNew}
            >
              Save as a copy
            </Button>
          </>
        ) : (
          <>
            <Button
              className={styles.saveBarSecondaryAction}
              disabled={saving}
              size="compact"
              variant="secondary"
              onClick={onDiscard}
            >
              Discard
            </Button>
            <Button
              className={styles.saveBarSecondaryAction}
              disabled={saving}
              size="compact"
              variant="secondary"
              onClick={onSaveAsNew}
            >
              Save as new
            </Button>
            <Button loading={saving} size="compact" onClick={onSave}>
              Save
            </Button>
            <IconButton
              disabled={saving}
              label="Dismiss save bar"
              size="compact"
              onClick={onDismiss}
            >
              <X aria-hidden="true" size={17} strokeWidth={1.6} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
