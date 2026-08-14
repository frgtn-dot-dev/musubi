/**
 * Renderer-free foundation values shared by Musubi clients.
 *
 * Dimensions are numeric so web can serialize them as px/rem while React
 * Native consumes the same optical values as density-independent points.
 */
export const typeSizes = {
  10: 10,
  11: 11,
  12: 12,
  13: 13,
  14: 14,
  15: 15,
  16: 16,
  18: 18,
  19: 19,
  20: 20,
  22: 22,
  24: 24,
  26: 26,
  28: 28,
  32: 32,
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
} as const;

export const radii = {
  sm: 5,
  md: 9,
  lg: 14,
  pill: 999,
  sheet: 20,
  card: 15,
  control: 10,
  chip: 8,
} as const;

export const controlHeights = {
  pointer: {
    control: 44,
    compact: 38,
  },
  touch: {
    control: 48,
    compact: 44,
  },
} as const;

export const componentDimensions = {
  rowMinHeight: 62,
} as const;

/**
 * Shared motion roles with platform-tuned durations in milliseconds.
 * Native transitions need slightly longer to read through touch feedback.
 */
export const motionDurations = {
  web: {
    fast: 140,
    standard: 220,
    slow: 300,
  },
  native: {
    fast: 160,
    standard: 260,
    slow: 320,
  },
} as const;

export type TypeSize = keyof typeof typeSizes;
export type SpacingStep = keyof typeof spacing;
export type RadiusName = keyof typeof radii;
export type MotionRole = keyof (typeof motionDurations)["web"];
