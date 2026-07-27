import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { SHORTCUT_GROUPS } from "../shortcuts";
import styles from "./workspace.module.css";

/** The `?` overlay. Lists the same map `shortcutFor` dispatches. */
export function ShortcutsDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="shortcuts-description"
          className={styles.manageDialog}
        >
          <header className={styles.manageDialogHeader}>
            <div>
              <Dialog.Title>Keyboard shortcuts</Dialog.Title>
              <Dialog.Description id="shortcuts-description">
                Every shortcut runs the same action as its control.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close shortcuts"
                className={styles.iconButton}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </header>

          <div className={styles.shortcutGroups}>
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className={styles.shortcutGroupTitle}>{group.title}</h3>
                <dl className={styles.shortcutList}>
                  {group.items.map((item) => (
                    <div key={item.action}>
                      <dt>{item.action}</dt>
                      <dd>
                        <kbd>{item.keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
