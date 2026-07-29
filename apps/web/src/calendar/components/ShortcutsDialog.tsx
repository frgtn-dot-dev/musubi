import { Dialog } from "~/ui/Dialog";
import { SHORTCUT_GROUPS } from "../shortcuts";
import styles from "./styles/shortcuts.module.css";

/** The `?` overlay. Lists the same map `shortcutFor` dispatches. */
export function ShortcutsDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog
      closeLabel="Close shortcuts"
      description="Every shortcut runs the same action as its control."
      open={open}
      title="Keyboard shortcuts"
      onOpenChange={onOpenChange}
    >
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
    </Dialog>
  );
}
