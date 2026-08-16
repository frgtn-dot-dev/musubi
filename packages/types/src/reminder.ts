import { z } from "zod";

/** Four weeks. Further ahead than that is a calendar entry, not a reminder. */
const MAX_MINUTES_BEFORE = 40_320;
const MINUTES_PER_DAY = 1_440;

/**
 * When to remind somebody about an event.
 *
 * Two branches because the two kinds of event ask different questions. A timed
 * event has a start instant, so "15 minutes before" is meaningful. An all-day
 * event does not — "15 minutes before Christmas" is 23:45 on the 24th, which is
 * nobody's idea of a reminder. All-day events get a wall-clock time instead.
 *
 * `null` on a branch means "do not remind for this kind of event". A rule with
 * both branches null is a real answer — it is how a calendar says "never".
 */
export const ReminderRuleSchema = z
  .object({
    minutesBefore: z
      .number()
      .int()
      .min(0)
      .max(MAX_MINUTES_BEFORE)
      .nullable(),
    allDay: z
      .object({
        daysBefore: z.number().int().min(0).max(30),
        /** Minutes past local midnight; 1080 is 18:00. */
        atMinute: z
          .number()
          .int()
          .min(0)
          .max(MINUTES_PER_DAY - 1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type ReminderRule = z.infer<typeof ReminderRuleSchema>;

/**
 * Inheriting is the ABSENCE of a rule, never a rule value.
 *
 * Encoding "inherit" as a value would allow a rule that inherits from itself,
 * and every reader would have to carry a cycle check it has no way to resolve.
 * A missing row (event override) or a null column (calendar) is the whole of it.
 */
export const ReminderRuleOrInheritSchema = ReminderRuleSchema.nullable();

/** The one thing above which there is nothing left to inherit from. */
export const DEFAULT_REMINDER_RULE: ReminderRule = {
  minutesBefore: 10,
  allDay: { daysBefore: 1, atMinute: 18 * 60 },
};

export const SILENT_REMINDER_RULE: ReminderRule = {
  minutesBefore: null,
  allDay: null,
};

/** Does this rule ever produce a reminder? */
export function isSilentRule(rule: ReminderRule) {
  return rule.minutesBefore === null && rule.allDay === null;
}

/**
 * Two rules that say the same thing.
 *
 * Used to decide whether an event needs an override at all: a form that always
 * wrote one would turn every event into an exception and quietly undo the point
 * of having calendar rules.
 */
export function sameRule(left: ReminderRule, right: ReminderRule) {
  return (
    left.minutesBefore === right.minutesBefore &&
    left.allDay?.daysBefore === right.allDay?.daysBefore &&
    left.allDay?.atMinute === right.allDay?.atMinute
  );
}

/** Everything a client needs to resolve reminders without asking again. */
export const RemindersDocumentSchema = z
  .object({
    default: ReminderRuleSchema,
    /** Calendar id → my rule for it. Absent means inherit the default. */
    calendars: z.record(z.string(), ReminderRuleSchema),
    /** Event id → my override. Absent means inherit from the calendar. */
    events: z.record(z.string(), ReminderRuleSchema),
  })
  .strict();

export type RemindersDocument = z.infer<typeof RemindersDocumentSchema>;

/** Body of the two PUTs. `rule: null` clears the override / goes back to inheriting. */
export const PutReminderRequestSchema = z
  .object({ rule: ReminderRuleOrInheritSchema })
  .strict();

export type PutReminderRequest = z.infer<typeof PutReminderRequestSchema>;

/**
 * Which emails about OTHER PEOPLE'S actions this account wants.
 *
 * Separate from reminder rules on purpose: a reminder is a promise you made to
 * yourself about your own calendar, these arrive because somebody else did
 * something. Different question, different switch.
 *
 * The calendar invite is deliberately absent. It is transactional — somebody
 * typed an address and pressed send, and the recipient may not have an account
 * to hold a preference in. You do not opt out of being invited any more than
 * you opt out of a password reset you asked for.
 */
export const NotificationEmailsSchema = z
  .object({
    /** An event you are attending was cancelled or moved. */
    eventChanged: z.boolean(),
    /** A poll you answered has a time. */
    pollDecided: z.boolean(),
  })
  .strict();

export type NotificationEmails = z.infer<typeof NotificationEmailsSchema>;

// On by default. Both only fire when a human deliberately changed something
// that affects you, which is the kind of mail people are cross about MISSING.
export const DEFAULT_NOTIFICATION_EMAILS: NotificationEmails = {
  eventChanged: true,
  pollDecided: true,
};
