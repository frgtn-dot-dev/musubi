import type { Event, PageConfigV1 } from "@musubi/types";

export const PAGE_ITEM_TYPES = ["events", "tasks", "meetings"] as const;
export type PageItemType = typeof PAGE_ITEM_TYPES[number];
export function pageItemTypes(filters: PageConfigV1["filters"]): readonly PageItemType[] {
  return filters.find(filter => filter.type === "item-types")?.value ?? PAGE_ITEM_TYPES;
}
export function eventItemType(event: Event): PageItemType {
  return event.isMeeting || event.hasAttendees ? "meetings" : "events";
}
