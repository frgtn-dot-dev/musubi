import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useContext, useCallback, forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";
import { AppWindow, GripHorizontal, PanelRight } from "lucide-react";
import { IconButton } from "./Button";
import { useInspectorPreference, type InspectorPresentation } from "./inspector-preferences";

type WindowPosition = { x: number; y: number };
type ActiveInspector = { id: symbol; close: (after: () => void) => void };
const InspectorContext = createContext<{
  id: symbol; modal: boolean; open: boolean; expanded: boolean;
  presentation: InspectorPresentation;
  setPresentation: (value: InspectorPresentation) => void;
  position: RefObject<WindowPosition | null>;
} | undefined>(undefined);
let activeInspector: ActiveInspector | undefined;
/** Admit imperative entry points through the same guard as an inspector trigger. */
export function requestInspectorTransition(after: () => void) {
  if (activeInspector) activeInspector.close(after);
  else after();
}

const subscribe = (callback: () => void) => {
  const query = matchMedia("(max-width: 1023px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

/** Keep the open object’s mode and position until it closes, including detail/edit handoffs. */
export function useInspectorPresentation(open: boolean) {
  const [preferred] = useInspectorPreference();
  const [session, setSession] = useState({ open, presentation: preferred });
  const position = useRef<WindowPosition | null>(null);
  useEffect(() => { if (!open) position.current = null; }, [open]);
  // Reset only for a newly opened object; toggling never remounts its draft.
  if (session.open !== open) setSession({ open, presentation: open ? preferred : session.presentation });
  return [session.presentation, (presentation: InspectorPresentation) => setSession(current => ({ ...current, presentation })), position] as const;
}

/** One selected object at a time. The owner can guard deactivation for a draft. */
export function Inspector({ open, onOpenChange, onRequestClose, children, expanded = false, presentation: controlledPresentation, onPresentationChange, position: controlledPosition }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: (after: () => void) => void;
  children: ReactNode;
  /** Expand the same mounted editor without losing its draft or window placement. */
  expanded?: boolean;
  presentation?: InspectorPresentation;
  onPresentationChange?: (value: InspectorPresentation) => void;
  position?: RefObject<WindowPosition | null>;
}) {
  const [localPresentation, setLocalPresentation, localPosition] = useInspectorPresentation(open);
  const position = controlledPosition ?? localPosition;
  const presentation = controlledPresentation ?? localPresentation;
  const setPresentation = onPresentationChange ?? setLocalPresentation;
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
  return <InspectorContext.Provider value={{ id, modal, open, expanded, presentation, setPresentation, position }}><DialogPrimitive.Root modal={modal} open={open} onOpenChange={next => {
    if (!next) { onRequestClose(() => {}); return; }
    if (activeInspector && activeInspector.id !== id) activeInspector.close(() => onOpenChange(true));
    else onOpenChange(true);
  }}>{children}</DialogPrimitive.Root></InspectorContext.Provider>;
}

export const InspectorTrigger = forwardRef<ElementRef<typeof DialogPrimitive.Trigger>, ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>>(function InspectorTrigger(props, ref) { return <DialogPrimitive.Trigger {...props} data-inspector-trigger="" ref={ref} />; });
export const InspectorClose = DialogPrimitive.Close;
export const InspectorTitle = DialogPrimitive.Title;

/** The same placement and keyboard movement controls in every inspector header. */
export function InspectorHeaderActions({ children }: { children: ReactNode }) {
  const inspector = useContext(InspectorContext);
  const floating = inspector?.presentation === "floating";
  return <div className={styles.inspectorHeaderActions}>
    {inspector && !inspector.modal && !inspector.expanded ? <>
      {floating ? <IconButton size="compact" data-inspector-move="" label="Move window with arrow keys" title="Drag to move · Arrow keys to move · Shift for larger steps"
        onKeyDown={event => {
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!direction) return;
          event.preventDefault(); event.stopPropagation();
          const node = event.currentTarget.closest<HTMLElement>('[data-ui="inspector"]');
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const step = event.shiftKey ? 32 : 8;
          placeWindow(node, rect.x + direction[0]! * step, rect.y + direction[1]! * step, inspector.position);
        }}><GripHorizontal size={17} aria-hidden="true" /></IconButton> : null}
      <IconButton size="compact" label={floating ? "Dock to side" : "Float window"}
        onClick={() => inspector.setPresentation(floating ? "panel" : "floating")}>
        {floating ? <PanelRight size={17} aria-hidden="true" /> : <AppWindow size={17} aria-hidden="true" />}
      </IconButton>
    </> : null}
    {children}
  </div>;
}

function placeWindow(node: HTMLElement, x: number, y: number, position?: RefObject<WindowPosition | null>) {
  const style = getComputedStyle(node);
  const gutterValue = style.getPropertyValue("--layer-viewport-gutter").trim();
  const gutter = parseFloat(gutterValue) * (gutterValue.endsWith("rem") ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1) || 0;
  const bounds = node.getBoundingClientRect();
  const next = {
    x: Math.max(gutter, Math.min(x, window.innerWidth - bounds.width - gutter)),
    y: Math.max(gutter, Math.min(y, window.innerHeight - bounds.height - gutter)),
  };
  node.style.left = `${next.x}px`;
  node.style.top = `${next.y}px`;
  if (position) position.current = next;
}

export const InspectorContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { accessibleTitle: string; persistent?: boolean }>(
  function InspectorContent({ className, children, accessibleTitle, persistent = false, ...props }, ref) {
    const inspector = useContext(InspectorContext);
    const identity = inspector?.id;
    const position = inspector?.position;
    const expanded = inspector?.expanded;
    const floating = !expanded && !inspector?.modal && inspector?.presentation === "floating";
    const content = useRef<HTMLDivElement | null>(null);
    // Radix mounts portal content after its parent; position when the DOM arrives.
    const [attached, setAttached] = useState(false);
    const contentRef = useCallback((node: HTMLDivElement | null) => {
      content.current = node;
      setAttached(Boolean(node));
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }, [ref]);
    const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
    useLayoutEffect(() => {
      const node = content.current;
      if (!node || !inspector?.open) return;
      drag.current = null;
      delete node.dataset.dragging;
      if (!floating) { node.style.left = ""; node.style.top = ""; return; }
      const rect = node.getBoundingClientRect();
      // Keep placement when switching between a task detail and its editor.
      const previous = position?.current;
      placeWindow(node, previous?.x ?? (window.innerWidth - rect.width) / 2, previous?.y ?? (window.innerHeight - rect.height) / 2, position);
      const constrain = () => { const rect = node.getBoundingClientRect(); placeWindow(node, rect.x, rect.y, position); };
      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(constrain);
      });
      observer.observe(node);
      window.addEventListener("resize", constrain);
      return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", constrain); };
    }, [attached, floating, inspector?.open, position]);
    return <DialogPrimitive.Portal>
      {/* Keep the desktop form mounted when expanding; changing Radix's modal
          mode would replace it. Narrow inspectors already have a modal backdrop. */}
      {expanded && !inspector?.modal ? (
        <div aria-hidden="true" data-dialog-overlay="" data-state={inspector?.open ? "open" : "closed"} className={styles.dialogOverlay} />
      ) : <DialogPrimitive.Overlay data-dialog-overlay="" className={styles.dialogOverlay} />}
      <DialogPrimitive.Content aria-modal={inspector?.modal || undefined} data-ui="inspector" data-inspector-persistent={persistent ? "" : undefined} aria-describedby={undefined} {...props}
        data-presentation={expanded ? "expanded" : floating ? "floating" : "panel"}
        onPointerDown={event => {
          props.onPointerDown?.(event);
          if (event.defaultPrevented || !floating || event.button !== 0 || !(event.target instanceof Element)) return;
          if (!event.target.closest('[data-inspector-header]')) return;
          if (event.target.closest('button, a, input, textarea, select, [role="button"]') && !event.target.closest('[data-inspector-move]')) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.x, top: rect.y };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.dataset.dragging = "";
        }}
        onPointerMove={event => {
          props.onPointerMove?.(event);
          const start = drag.current;
          if (!start || event.pointerId !== start.pointer) return;
          placeWindow(event.currentTarget, start.left + event.clientX - start.x, start.top + event.clientY - start.y, position);
        }}
        onPointerUp={event => {
          props.onPointerUp?.(event);
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null; delete event.currentTarget.dataset.dragging;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={event => { props.onLostPointerCapture?.(event); drag.current = null; delete event.currentTarget.dataset.dragging; }}
        onCloseAutoFocus={event => { if (activeInspector && activeInspector.id !== identity) { event.preventDefault(); return; } props.onCloseAutoFocus?.(event); }}
        ref={contentRef}
        className={classNames(styles.dialog, styles.dialog_right, styles.inspector, floating && styles.inspector_floating, expanded && styles.inspector_expanded, className)}>
        <DialogPrimitive.Title className={styles.visuallyHidden} aria-hidden="true">{accessibleTitle}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>;
  },
);
