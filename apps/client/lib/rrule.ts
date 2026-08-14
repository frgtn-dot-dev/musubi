// Compatibility path for the mobile composer; the dependency-free logic is
// shared with web without pulling the runtime rrule parser into either editor.
import {
	isEditableRRule,
	parseRRule,
	splitRecurrence,
} from "@musubi/calendar/rrule-editor";

export * from "@musubi/calendar/rrule-editor";

/** Keep imported clauses the mobile controls cannot represent until replacement. */
export function rawUnsupportedRecurrence(
	recurrence: string | null | undefined,
): string | null {
	if (!recurrence) return null;
	const { rrule } = splitRecurrence(recurrence);
	return rrule && parseRRule(rrule) === "custom" && !isEditableRRule(rrule)
		? recurrence
		: null;
}
