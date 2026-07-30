import { PAGE_ICONS, type PageIcon } from "@musubi/types";
import {
  Briefcase,
  CalendarDays,
  Circle,
  Coffee,
  Diamond,
  Flag,
  Heart,
  House,
  Music,
  Plane,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";

// Named imports, not a lookup by string: the bundler can only tree-shake what it
// can see, and a dynamic `icons[name]` would pull all of lucide into the client.
const PAGE_ICON_COMPONENTS: Record<PageIcon, LucideIcon> = {
  briefcase: Briefcase,
  "calendar-days": CalendarDays,
  circle: Circle,
  coffee: Coffee,
  diamond: Diamond,
  flag: Flag,
  heart: Heart,
  house: House,
  music: Music,
  plane: Plane,
  sparkles: Sparkles,
  star: Star,
};

const PAGE_ICON_LABELS: Record<PageIcon, string> = {
  briefcase: "Briefcase",
  "calendar-days": "Calendar",
  circle: "Circle",
  coffee: "Coffee",
  diamond: "Diamond",
  flag: "Flag",
  heart: "Heart",
  house: "House",
  music: "Music",
  plane: "Plane",
  sparkles: "Sparkles",
  star: "Star",
};

/**
 * Which icon a Page shows. Pages saved before icons existed have none, and they
 * keep the look they had: the default Page is home, everything else a calendar.
 */
export function resolvePageIcon(
  icon: PageIcon | undefined,
  isDefault: boolean,
): PageIcon {
  return icon ?? (isDefault ? "house" : "calendar-days");
}

export function pageIconComponent(icon: PageIcon): LucideIcon {
  return PAGE_ICON_COMPONENTS[icon];
}

export function pageIconLabel(icon: PageIcon): string {
  return PAGE_ICON_LABELS[icon];
}

export const pageIconChoices = PAGE_ICONS.map((icon) => ({
  icon,
  label: PAGE_ICON_LABELS[icon],
}));
