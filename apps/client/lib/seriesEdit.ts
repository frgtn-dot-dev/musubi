import { Event } from "@musubi/types";
import { EditScope, seriesEditWrites } from "@musubi/calendar";
import { uuidv7 } from "uuidv7";
import { chooseOption } from "@/lib/confirm";
import { reminderRules, setEventReminderRule } from "@/services/notifications";

/**
 * Ask which occurrences an edit belongs to, then run the writes it produces.
 *
 * Editing one occurrence of a series is three different edits wearing one
 * button, and the choice cannot be guessed from the gesture — the same reason
 * deleting one already asks. A plain event skips the question entirely.
 */
export async function applySeriesEdit({
  addEvent,
  edited,
  master,
  occurrence,
  updateEvent,
}: {
  addEvent: (event: Event) => Promise<unknown>;
  edited: Event;
  /** The stored row, which carries the series' own anchor times. */
  master: Event | undefined;
  /** The occurrence as it was tapped, before the form touched it. */
  occurrence: Event;
  updateEvent: (event: Event) => Promise<unknown>;
}): Promise<boolean> {
  if (!master?.recurrence) {
    await updateEvent(edited);
    return true;
  }

  const scope = await new Promise<EditScope | undefined>((resolve) => {
    chooseOption(
      "Change recurring event",
      `Which events should take the changes to “${edited.title}”?`,
      [
        { label: "This event", onPress: () => resolve("occurrence") },
        {
          label: "This and following events",
          onPress: () => resolve("following"),
        },
        { label: "All events", onPress: () => resolve("series") },
      ],
      true,
      () => resolve(undefined),
    );
  });

  // Backing out of the question is not a decision to discard the edit.
  if (!scope) return false;

  const { creates, updates } = seriesEditWrites({
    edited,
    master,
    // React Native has no crypto.randomUUID; the app's own generator also keeps
    // ids sortable by creation time.
    newId: uuidv7,
    occurrence,
    scope,
  });

  // Sequential: the update carries the exclusion that keeps the created event
  // from briefly showing twice.
  for (const update of updates) {
    await updateEvent(update);
  }
  for (const create of creates) {
    await addEvent(create);
    // A split gives the occurrence a new id, so an OVERRIDE on the series does
    // not follow by itself — the series keeps it and the detached event
    // silently falls back to whatever its calendar says. Inherited rules need
    // no copying: the new event is in the same calendars.
    const override = reminderRules()?.events[master.id];
    if (override) {
      await setEventReminderRule(create, override).catch(() => undefined);
    }
  }

  return true;
}
