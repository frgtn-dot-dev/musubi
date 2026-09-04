// Calendar roles & permissions — single source of truth, shared by server
// (authorization) and client (UI gating).
export type CalendarRole = "owner" | "editor" | "viewer";

export type CalendarAction =
  | "editCalendar" // rename, recolor, ... the calendar itself
  | "deleteCalendar"
  | "manageMembers" // change roles / remove members
  | "editEvents" // create / update / delete events
  | "editTasks" // create / update / delete tasks
  | "invite";

const PERMISSIONS: Record<CalendarRole, CalendarAction[]> = {
  owner: [
    "editCalendar",
    "deleteCalendar",
    "manageMembers",
    "editEvents",
    "editTasks",
    "invite",
  ],
  editor: ["editEvents", "editTasks", "invite"],
  viewer: [],
};

export function can(
  role: CalendarRole | string | null | undefined,
  action: CalendarAction,
): boolean {
  if (!role || !(role in PERMISSIONS)) return false;
  return PERMISSIONS[role as CalendarRole].includes(action);
}
