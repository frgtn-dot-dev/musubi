import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useContext, forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

type ActiveInspector = { id: symbol; close: (after: () => void) => void };
const InspectorIdentity = createContext<symbol | undefined>(undefined);
let activeInspector: ActiveInspector | undefined;
const subscribe = (callback: () => void) => {
  const query = matchMedia("(max-width: 1023px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

/** One selected object at a time. The owner can guard deactivation for a draft. */
export function Inspector({ open, onOpenChange, onRequestClose, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: (after: () => void) => void;
  children: ReactNode;
}) {
  const [id] = useState(() => Symbol("inspector"));
  const close = useRef(onRequestClose);
  useLayoutEffect(() => { close.current = onRequestClose; }, [onRequestClose]);
  const modal = useSyncExternalStore(subscribe, () => matchMedia("(max-width: 1023px)").matches, () => false);
  useEffect(() => {
    if (!open) return;
    const identity = id;
    activeInspector = { id: identity, close: after => close.current(after) };
    return () => { if (activeInspector?.id === identity) activeInspector = undefined; };
  }, [open, id]);
  return <InspectorIdentity.Provider value={id}><DialogPrimitive.Root modal={modal} open={open} onOpenChange={next => {
    if (!next) { onRequestClose(() => {}); return; }
    if (activeInspector && activeInspector.id !== id) activeInspector.close(() => onOpenChange(true));
    else onOpenChange(true);
  }}>{children}</DialogPrimitive.Root></InspectorIdentity.Provider>;
}

export const InspectorTrigger = forwardRef<ElementRef<typeof DialogPrimitive.Trigger>, ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>>(function InspectorTrigger(props, ref) { return <DialogPrimitive.Trigger {...props} data-inspector-trigger="" ref={ref} />; });
export const InspectorClose = DialogPrimitive.Close;
export const InspectorTitle = DialogPrimitive.Title;

export const InspectorContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { accessibleTitle: string }>(
  function InspectorContent({ className, children, accessibleTitle, ...props }, ref) {
    const identity = useContext(InspectorIdentity);
    return <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-dialog-overlay="" className={styles.dialogOverlay} />
      <DialogPrimitive.Content aria-describedby={undefined} {...props} onCloseAutoFocus={event => { props.onCloseAutoFocus?.(event); if (activeInspector && activeInspector.id !== identity) event.preventDefault(); }} ref={ref} className={classNames(styles.dialog, styles.dialog_right, styles.inspector, className)}>
        <DialogPrimitive.Title className={styles.visuallyHidden} aria-hidden="true">{accessibleTitle}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>;
  },
);
