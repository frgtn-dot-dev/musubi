// Platform-specific geometry and gesture tuning for the custom calendar views.
// Pure calendar/date layout lives in @musubi/calendar/layout.
export const HOUR_H = 64;          // px per hour on the timeline
export const GUTTER = 46;          // time-label column width
export const GRID_H = 24 * HOUR_H;
export const DOW_H = 26;           // weekday initials row in month view
export const INK = "#26241f";      // text on colored event blocks — palette is muted, ink reads on all

// ── Drag-to-create / draft manipulation tuning ──────────────────────────────
export const SNAP_DRAG_MIN = 15;   // minutes — drag resize/move snap
export const SNAP_TAP_MIN = 30;    // minutes — quick-tap draft snap
export const HOLD_CREATE_MS = 280; // hold before drag-to-create activates on the grid
export const HOLD_GRAB_MS = 150;   // hold before an existing draft can be grabbed
export const GRAB_DOT_HIT = 44;    // draft ghost: corner-box touch zone around each resize dot (finger-sized)
export const GHOST_LEFT_INSET = 2;
export const GHOST_DAY_RIGHT_INSET = 28;  // room for the centered lift scale on wide day columns
export const GHOST_WEEK_RIGHT_INSET = 6;  // keep narrow week columns usable
// Overlapping events cascade (Google-mobile style): each overlap level shifts
// right and renders ON TOP of the previous, leaving a colored stripe of the
// one underneath. Levels past the cap stack at the same offset (z-order still
// keeps the latest on top) so deep clusters can't push events off the column.
export const CASCADE_OFFSET = 10;  // px shift per overlap level
export const CASCADE_MAX_LEVELS = 3;
export const GRAB_SCALE = 1.04;    // "lifted" ghost scale while dragging
export const GRAB_SPRING = { damping: 30, stiffness: 400 };

// ── Month → day zoom ─────────────────────────────────────────────────────────
// Short and snappy. Geometry begins on Reanimated's UI thread immediately;
// the heavier day content joins once that moving geometry has landed.
export const ZOOM_IN_MS = 240;
export const ZOOM_OUT_MS = 170;
export const DRILL_OPEN_MIN = 8 * 60 + 45; // minutes-from-midnight the drilled day view scrolls to (08:45)

// ── Timeline pinch zoom ──────────────────────────────────────────────────────
// HOUR_H is the default; a pinch scales the live hour height between these.
export const ZOOM_HOUR_MIN = 30;   // whole day compressed (~720px)
export const ZOOM_HOUR_MAX = 180;  // one hour fills the screen

export type Draft = { start: Date; end: Date };
export type Rect = { x: number; y: number; w: number; h: number };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const minutesToY = (m: number) => (m / 60) * HOUR_H;
export const yToMinutes = (y: number, snap: number) =>
  clamp(Math.round((y / HOUR_H) * 60 / snap) * snap, 0, 24 * 60 - snap);
