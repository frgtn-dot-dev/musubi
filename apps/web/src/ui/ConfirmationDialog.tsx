import { type ReactNode, type RefObject, useRef } from "react";
import { Button, type ButtonVariant } from "./Button";
import { Dialog, DialogClose } from "./Dialog";
import styles from "./primitives.module.css";

type ConfirmationAction =
  | {
      confirmForm: string;
      onConfirm?: never;
    }
  | {
      confirmForm?: undefined;
      onConfirm: () => void;
    };

export type ConfirmationDialogProps = ConfirmationAction & {
  cancelLabel?: ReactNode;
  children: ReactNode;
  closeLabel: string;
  confirmDisabled?: boolean;
  confirmLabel: ReactNode;
  confirmVariant?: Extract<ButtonVariant, "destructive" | "primary">;
  description: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus?: HTMLElement | RefObject<HTMLElement | null> | null;
  title: ReactNode;
};

/**
 * A consequential choice with one safe exit and one explicit commit action.
 *
 * The cancel action receives initial focus by default so opening a destructive
 * prompt never puts its irreversible action under the user's next keystroke.
 * Typed confirmations may override that target with their confirmation field.
 */
export function ConfirmationDialog({
  cancelLabel = "Cancel",
  children,
  closeLabel,
  confirmDisabled = false,
  confirmForm,
  confirmLabel,
  confirmVariant = "destructive",
  description,
  initialFocus,
  loading = false,
  onConfirm,
  onOpenChange,
  open,
  returnFocus,
  title,
}: ConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      closeLabel={closeLabel}
      description={description}
      footer={
        <>
          <DialogClose>
            <Button disabled={loading} ref={cancelRef} variant="secondary">
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            disabled={confirmDisabled}
            form={confirmForm}
            loading={loading}
            type={confirmForm ? "submit" : "button"}
            variant={confirmVariant}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
      initialFocus={initialFocus ?? cancelRef}
      onOpenChange={onOpenChange}
      open={open}
      returnFocus={returnFocus}
      size="compact"
      title={title}
    >
      {children}
    </Dialog>
  );
}

export function ConfirmationNotice({
  children,
  icon,
}: {
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className={styles.confirmationNotice}>
      <span className={styles.confirmationNoticeIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.confirmationNoticeCopy}>{children}</div>
    </div>
  );
}

