import { MUSUBI_CALENDAR_COLORS } from "@musubi/types";

// Keep the mobile-facing shape while deriving every value from the shared
// product palette.
export const appColors: { color: string; name: string }[] =
  MUSUBI_CALENDAR_COLORS.map(({ hex, name }) => ({
    color: hex,
    name,
  }));
