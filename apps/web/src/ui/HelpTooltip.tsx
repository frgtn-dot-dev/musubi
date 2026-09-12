import { CircleHelp } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { IconButton } from "./Button";
import { Popover, PopoverAnchor, PopoverContent } from "./Popover";
import styles from "./HelpTooltip.module.css";
import sharedStyles from "./primitives.module.css";

const HOVER_DELAY = 400;
const LEAVE_DELAY = 150;

/** Optional, non-interactive help. Required instructions and errors stay visible. */
export function HelpTooltip({ children, label }: { children: ReactNode; label: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovering = useRef(false);
  const hoveringContent = useRef(false);
  const focused = useRef(false);
  const pointerActivation = useRef(false);
  const dismissed = useRef(false);

  function clearTimer() {
    clearTimeout(timer.current);
    timer.current = undefined;
  }
  function dismiss() {
    clearTimer();
    hoveringContent.current = false;
    dismissed.current = true;
    setOpen(false);
  }
  function leave() {
    clearTimer();
    if (hovering.current || hoveringContent.current || focused.current) return;
    timer.current = setTimeout(() => setOpen(false), LEAVE_DELAY);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  return <Popover open={open} onOpenChange={next => { if (!next) dismiss(); }}>
    <PopoverAnchor asChild>
      <IconButton
        ref={trigger}
        className={sharedStyles.helpTooltipTrigger}
        label={label}
        title=""
        size="compact"
        aria-describedby={open ? id : undefined}
        onPointerEnter={event => {
          if (event.pointerType === "touch") return;
          hovering.current = true;
          dismissed.current = false;
          clearTimer();
          timer.current = setTimeout(() => { if (!dismissed.current) setOpen(true); }, HOVER_DELAY);
        }}
        onPointerLeave={event => {
          if (event.pointerType === "touch") return;
          hovering.current = false;
          leave();
        }}
        onPointerDown={() => { pointerActivation.current = true; clearTimer(); }}
        onPointerCancel={() => { pointerActivation.current = false; }}
        onFocus={() => {
          focused.current = true;
          if (pointerActivation.current) return;
          dismissed.current = false;
          clearTimer();
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          pointerActivation.current = false;
          leave();
        }}
        onClick={() => {
          pointerActivation.current = false;
          clearTimer();
          dismissed.current = false;
          setOpen(current => !current);
        }}
      >
        <CircleHelp aria-hidden="true" size={15} strokeWidth={1.5} />
      </IconButton>
    </PopoverAnchor>
    <PopoverContent
      role="region"
      aria-label={label}
      tabIndex={undefined}
      className={styles.content}
      side="top"
      mobileSurface="anchored"
      onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => event.preventDefault()}
      onFocusOutside={event => { if (hovering.current || hoveringContent.current) event.preventDefault(); }}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onInteractOutside={event => {
        if (trigger.current?.contains(event.target as Node)) event.preventDefault();
      }}
      onPointerEnter={event => {
        if (event.pointerType === "touch") return;
        hoveringContent.current = true;
        clearTimer();
      }}
      onPointerLeave={event => {
        if (event.pointerType === "touch") return;
        hoveringContent.current = false;
        leave();
      }}
    >
      <div id={id} role="tooltip">{children}</div>
    </PopoverContent>
  </Popover>;
}
