import type { Attendee } from "~/api/contracts";

/** What a client may ask for. `none` is the answer withdrawn. */
export type AttendanceChoice = Attendee["status"] | "none";

/** An answer, not a setting — the order is the one people answer in. */
export const ATTENDANCE_CHOICES: Array<{
  label: string;
  value: Attendee["status"];
}> = [
  { label: "Going", value: "going" },
  { label: "Maybe", value: "maybe" },
  { label: "Can’t go", value: "declined" },
];

const GROUPS: Array<{ status: Attendee["status"]; title: string }> = [
  { status: "going", title: "Going" },
  { status: "maybe", title: "Maybe" },
  { status: "declined", title: "Can’t go" },
];

/**
 * The list cut into groups. The server already sorted it, so this only slices —
 * two sort orders for one list is how the phone and the browser start disagreeing
 * about who is first.
 */
export function groupAttendees(attendees: Attendee[]) {
  return GROUPS.map(({ status, title }) => ({
    items: attendees.filter((attendee) => attendee.status === status),
    status,
    title,
  })).filter((group) => group.items.length > 0);
}

/** The answer as the menu's trigger says it. */
export function answerLabel(mine: Attendee["status"] | undefined) {
  return ATTENDANCE_CHOICES.find((choice) => choice.value === mine)?.label;
}
