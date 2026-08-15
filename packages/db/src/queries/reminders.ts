import { and, eq } from "drizzle-orm";
import type { ReminderRule, RemindersDocument } from "@musubi/types";
import { calendarMembers, db, eventReminders } from "..";
import { getUserSettings } from "./settings";

// Reminder rules are read as one document rather than per event: they are tiny
// (only explicit choices are stored), every client needs all of them to resolve
// anything, and one round trip beats one per event in a month view.

export async function getRemindersDocument(
  userID: string,
): Promise<RemindersDocument> {
  const [settings, memberships, overrides] = await Promise.all([
    getUserSettings(userID),
    db
      .select({
        calendarID: calendarMembers.calendarID,
        reminder: calendarMembers.reminder,
      })
      .from(calendarMembers)
      .where(eq(calendarMembers.userID, userID)),
    db
      .select({ eventID: eventReminders.eventID, rule: eventReminders.rule })
      .from(eventReminders)
      .where(eq(eventReminders.userID, userID)),
  ]);

  const calendars: Record<string, ReminderRule> = {};
  for (const row of memberships) {
    // A null column is "inherit", which the document says by omission.
    if (row.reminder) calendars[row.calendarID] = row.reminder;
  }

  const events: Record<string, ReminderRule> = {};
  for (const row of overrides) events[row.eventID] = row.rule;

  return { default: settings.defaultReminder, calendars, events };
}

/** My rule for one calendar. `null` puts it back to inheriting. */
export async function setCalendarReminder(
  userID: string,
  calendarID: string,
  rule: ReminderRule | null,
) {
  const [updated] = await db
    .update(calendarMembers)
    .set({ reminder: rule })
    .where(
      and(
        eq(calendarMembers.userID, userID),
        eq(calendarMembers.calendarID, calendarID),
      ),
    )
    .returning({ calendarID: calendarMembers.calendarID });

  // No row means no membership, which the handler turns into a 403 rather than
  // silently accepting a rule for a calendar the caller cannot see.
  return updated !== undefined;
}

/** My override on one event. `null` removes it and goes back to inheriting. */
export async function setEventReminder(
  userID: string,
  eventID: string,
  rule: ReminderRule | null,
) {
  if (rule === null) {
    await db
      .delete(eventReminders)
      .where(
        and(
          eq(eventReminders.userID, userID),
          eq(eventReminders.eventID, eventID),
        ),
      );
    return;
  }

  await db
    .insert(eventReminders)
    .values({ eventID, rule, userID })
    .onConflictDoUpdate({
      target: [eventReminders.eventID, eventReminders.userID],
      set: { rule, updatedAt: new Date() },
    });
}
