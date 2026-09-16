import { useRef, useState, useLayoutEffect, useId, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./TimeDial.module.css";

type Phase = "hour" | "minute";
type Props = {
  hour: number; minute: number; format: "12h" | "24h"; phase: Phase;
  hours: number[]; minutes: number[];
  onPhase: (phase: Phase) => void;
  onPreview: (hour: number, minute: number) => void;
  onChoose: (hour: number, minute: number) => void;
};

function ClockFace({ angle, inner, dragging, phase, children }: { angle: number; inner: boolean; dragging: boolean; phase: Phase; children: ReactNode }) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const previous = useRef(angle);
  useLayoutEffect(() => {
    const delta = ((angle - previous.current + 540) % 360 + 360) % 360 - 180;
    previous.current += delta;
    ref.current?.style.setProperty("--angle", `${previous.current}deg`);
  }, [angle]);
  const silhouette = <g className={styles.hand}>
    <rect x="129" width="2" className={styles.stem} />
    <circle cx="130" r="16" className={styles.tip} />
    <circle cx="130" cy="130" r="3" />
  </g>;
  return <svg ref={ref} className={styles.clock} viewBox="0 0 260 260" aria-hidden="true" data-phase={phase} data-dragging={dragging || undefined}
    style={{ "--reach": inner ? "64px" : "104px" } as CSSProperties}>
    <defs>
      {/* Matching geometry and CSS keep the pigment and text mask in sync. */}
      <mask id={`${id}-clip`} className={styles.mask} maskUnits="userSpaceOnUse" x="0" y="0" width="260" height="260">{silhouette}</mask>
    </defs>
    <g key={`${phase}-base`} className={styles.numbers}>{children}</g>
    <g className={styles.pigment}>{silhouette}</g>
    <g mask={`url(#${id}-clip)`} className={styles.contrast}>
      <g key={`${phase}-contrast`} className={styles.numbers}>{children}</g>
    </g>
  </svg>;
}

/** Clock geometry is normalized to a 260px face, independent of zoom. */
export function dialValue(x: number, y: number, phase: Phase, format: Props["format"], hour: number) {
  const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  if (phase === "minute") return Math.round(angle / 6) % 60;
  const tick = Math.round(angle / 30) % 12;
  if (format === "12h") return tick + (hour >= 12 ? 12 : 0);
  return Math.hypot(x, y) < 82 ? (tick === 0 ? 0 : tick + 12) : (tick || 12);
}

export function TimeDial({ hour, minute, format, phase, hours, minutes, onPhase, onPreview, onChoose }: Props) {
  const pointer = useRef<number | null>(null);
  const [dragAngle, setDragAngle] = useState<number | null>(null);
  const current = phase === "hour" ? hour : minute;
  const available = phase === "hour" ? hours : minutes;
  const inner = phase === "hour" && format === "24h" && (hour === 0 || hour > 12);
  const angle = dragAngle ?? (phase === "hour" ? hour % 12 * 30 : minute * 6);
  const labels = phase === "hour"
    ? (format === "24h" ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i + (hour >= 12 ? 12 : 0)))
    : Array.from({ length: 12 }, (_, i) => i * 5);

  function position(event: PointerEvent<HTMLDivElement>, finish = false) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2) * 260 / rect.width;
    const y = (event.clientY - rect.top - rect.height / 2) * 260 / rect.height;
    if (Math.hypot(x, y) < 18) return false;
    const next = dialValue(x, y, phase, format, hour);
    if (!available.includes(next)) return false;
    setDragAngle(finish ? null : (phase === "hour" ? next % 12 * 30 : (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360));
    if (phase === "hour") {
      onPreview(next, minute);
      if (finish) onPhase("minute");
    } else if (finish) onChoose(hour, next);
    else onPreview(hour, next);
    return true;
  }

  return <div className={styles.picker}>
    <div className={styles.readout}>
      <Button variant={phase === "hour" ? "secondary" : "ghost"} aria-pressed={phase === "hour"} aria-label="Choose hour" onClick={() => onPhase("hour")}>
        {String(format === "12h" ? hour % 12 || 12 : hour).padStart(2, "0")}
      </Button>
      <span aria-hidden="true">:</span>
      <Button variant={phase === "minute" ? "secondary" : "ghost"} aria-pressed={phase === "minute"} aria-label="Choose minute" onClick={() => onPhase("minute")}>
        {String(minute).padStart(2, "0")}
      </Button>
    </div>
    <div className={styles.face} role="slider" tabIndex={0}
      aria-label={phase === "hour" ? "Hour dial" : "Minute dial"}
      aria-valuemin={available.length ? Math.min(...available) : 0} aria-valuemax={available.length ? Math.max(...available) : 0}
      aria-valuenow={current} aria-valuetext={`${String(current).padStart(2, "0")} ${phase === "hour" ? "hours" : "minutes"}`}
      onPointerDown={event => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        event.currentTarget.focus();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        position(event);
      }}
      onPointerMove={event => { if (pointer.current === event.pointerId) position(event); }}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return;
        pointer.current = null;
        setDragAngle(null);
        position(event, true);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { pointer.current = null; setDragAngle(null); }}
      onLostPointerCapture={() => { pointer.current = null; setDragAngle(null); }}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (phase === "hour") onPhase("minute"); else onChoose(hour, minute);
          return;
        }
        const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : ["ArrowDown", "ArrowLeft"].includes(event.key) ? -1 : 0;
        if (!direction && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const next = event.key === "Home" ? available[0] : event.key === "End" ? available.at(-1) : available[(available.indexOf(current) + direction + available.length) % available.length];
        if (next !== undefined) onPreview(phase === "hour" ? next : hour, phase === "minute" ? next : minute);
      }}>
      <ClockFace angle={angle} inner={inner} dragging={dragAngle !== null} phase={phase}>
        {labels.map(number => {
          const isInner = phase === "hour" && format === "24h" && (number === 0 || number > 12);
          const radians = (phase === "hour" ? number % 12 * 30 : number * 6) * Math.PI / 180;
          const radius = isInner ? 64 : 104;
          return <text key={number} className={styles.number} data-disabled={!available.includes(number) || undefined}
            x={130 + Math.sin(radians) * radius} y={130 - Math.cos(radians) * radius}>
            {phase === "hour" && format === "12h" ? number % 12 || 12 : String(number).padStart(2, "0")}
          </text>;
        })}
      </ClockFace>
    </div>
    <p className={styles.caption} aria-live="polite">{phase === "hour" ? "Choose hour" : "Choose minute"}</p>
  </div>;
}
