import { PencilLine, X } from "lucide-react";
import styles from "./workspace.module.css";

type SaveBarProps = {
  dirty: boolean;
  onDiscard: () => void;
  onDismiss: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
};

export function SaveBar({
  dirty,
  onDiscard,
  onDismiss,
  onSave,
  onSaveAsNew,
}: SaveBarProps) {
  if (!dirty) {
    return null;
  }

  return (
    <div className={styles.saveBar} role="region" aria-label="Unsaved page changes">
      <span className={styles.saveBarIcon} aria-hidden="true">
        <PencilLine size={18} strokeWidth={1.6} />
      </span>
      <div className={styles.saveBarCopy}>
        <strong>Unsaved page changes</strong>
        <span>You have edited this Page.</span>
      </div>
      <div className={styles.saveBarActions}>
        <button className={styles.secondaryButton} type="button" onClick={onDiscard}>
          Discard
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onSaveAsNew}
        >
          Save as new
        </button>
        <button className={styles.primaryButton} type="button" onClick={onSave}>
          Save
        </button>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Dismiss save bar"
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={17} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
