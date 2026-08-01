const DESKTOP_VIEWPORT = {
  height: 900,
  width: 1200,
} as const;

const MOBILE_VIEWPORT = {
  height: 844,
  width: 390,
} as const;

export const DESKTOP_MODES = {
  "light desktop": {
    colorScheme: "light",
    locale: "en-US",
    theme: "light",
    viewport: DESKTOP_VIEWPORT,
  },
  "dark desktop": {
    colorScheme: "dark",
    locale: "en-US",
    theme: "dark",
    viewport: DESKTOP_VIEWPORT,
  },
} as const;

export const MOBILE_MODES = {
  "light mobile": {
    colorScheme: "light",
    hasTouch: true,
    locale: "en-US",
    theme: "light",
    viewport: MOBILE_VIEWPORT,
  },
  "dark mobile": {
    colorScheme: "dark",
    hasTouch: true,
    locale: "en-US",
    theme: "dark",
    viewport: MOBILE_VIEWPORT,
  },
} as const;
