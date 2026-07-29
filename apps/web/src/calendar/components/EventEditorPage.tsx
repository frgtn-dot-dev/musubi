import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/ui/Button";
import styles from "./styles/editor-page.module.css";

type EventEditorPageProps = {
  children?: ReactNode;
  description?: ReactNode;
  onBack: () => void;
  title: ReactNode;
};

/**
 * The focused page shell shared by full create and edit flows. Calendar chrome
 * stays behind, but the way back remains stable and keyboard reachable.
 */
export function EventEditorPage({
  children,
  description,
  onBack,
  title,
}: EventEditorPageProps) {
  return (
    <main
      className={styles.page}
      data-event-editor-page=""
      id="main-content"
    >
      <nav aria-label="Event editor" className={styles.navigation}>
        <div className={styles.navigationInner}>
          <Button
            className={styles.backButton}
            icon={<ArrowLeft size={16} strokeWidth={1.7} />}
            variant="text"
            onClick={onBack}
          >
            Back to calendar
          </Button>
        </div>
      </nav>

      <div className={styles.content}>
        <header className={styles.heading}>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </header>
        {children ? (
          <section
            aria-label="Event details"
            className={styles.formSurface}
            data-event-editor-surface=""
          >
            {children}
          </section>
        ) : null}
      </div>
    </main>
  );
}
