import { Event } from "@musubi/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SILENT = { minutesBefore: null, allDay: null };

// The seam: both of these reach React Native and Expo, which a node test has no
// business booting. Everything below them is the app's own logic.
const chooseOption = vi.fn();
const reminderRules = vi.fn();
const setEventReminderRule = vi.fn();

vi.mock("@/lib/confirm", () => ({
  chooseOption: (...args: unknown[]) => chooseOption(...args),
}));
vi.mock("@/services/notifications", () => ({
  reminderRules: () => reminderRules(),
  setEventReminderRule: (...args: unknown[]) => setEventReminderRule(...args),
}));

const { applySeriesEdit } = await import("./seriesEdit");

type Options = { label: string; onPress: () => void }[];

/** Answer the scope question with the option carrying this label. */
function answer(label: string) {
  chooseOption.mockImplementation(
    (_title: string, _message: string, options: Options) => {
      options.find((option) => option.label === label)!.onPress();
    },
  );
}

/** Back out of it, the way a tap outside the sheet does. */
function dismiss() {
  chooseOption.mockImplementation(
    (
      _title: string,
      _message: string,
      _options: Options,
      _quiet: boolean,
      onCancel: () => void,
    ) => {
      onCancel();
    },
  );
}

const master = {
  calendars: ["work"],
  end: new Date("2026-07-06T10:00:00Z"),
  id: "standup",
  isAllDay: false,
  recurrence: "FREQ=WEEKLY",
  start: new Date("2026-07-06T09:00:00Z"),
  title: "Standup",
} as unknown as Event;

// On this client an occurrence carries the master's id and its own times.
const occurrence = {
  ...master,
  end: new Date("2026-07-20T10:00:00Z"),
  start: new Date("2026-07-20T09:00:00Z"),
} as Event;

const edited = { ...occurrence, title: "Standup (long)" } as Event;

type EventWrite = (event: Event) => Promise<unknown>;

describe("applySeriesEdit", () => {
  let addEvent: ReturnType<typeof vi.fn<EventWrite>>;
  let updateEvent: ReturnType<typeof vi.fn<EventWrite>>;

  beforeEach(() => {
    vi.clearAllMocks();
    addEvent = vi.fn<EventWrite>(async () => undefined);
    updateEvent = vi.fn<EventWrite>(async () => undefined);
    reminderRules.mockReturnValue({ default: SILENT, calendars: {}, events: {} });
    setEventReminderRule.mockResolvedValue(undefined);
  });

  it("writes a plain event straight through, with no question", async () => {
    const plain = { ...master, recurrence: null } as Event;

    const saved = await applySeriesEdit({
      addEvent,
      edited: { ...plain, title: "Renamed" } as Event,
      master: plain,
      occurrence: plain,
      updateEvent,
    });

    expect(saved).toBe(true);
    expect(chooseOption).not.toHaveBeenCalled();
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("detaches one occurrence and leaves the series named as it was", async () => {
    answer("This event");

    await applySeriesEdit({ addEvent, edited, master, occurrence, updateEvent });

    // The series keeps its own title and loses this date.
    const [seriesWrite] = updateEvent.mock.calls[0]! as [Event];
    expect(seriesWrite.title).toBe("Standup");
    expect(seriesWrite.recurrence).toContain("EXDATE:20260720T090000Z");
    // The edit becomes a standalone event with an id of its own.
    const [detached] = addEvent.mock.calls[0]! as [Event];
    expect(detached.title).toBe("Standup (long)");
    expect(detached.recurrence).toBeNull();
    expect(detached.id).not.toBe(master.id);
  });

  it("shifts a whole-series edit rather than moving it onto one date", async () => {
    answer("All events");

    await applySeriesEdit({
      addEvent,
      edited: {
        ...edited,
        end: new Date("2026-07-20T12:00:00Z"),
        start: new Date("2026-07-20T11:00:00Z"),
      } as Event,
      master,
      occurrence,
      updateEvent,
    });

    const [seriesWrite] = updateEvent.mock.calls[0]! as [Event];
    expect(seriesWrite.title).toBe("Standup (long)");
    expect(seriesWrite.start.toISOString()).toBe("2026-07-06T11:00:00.000Z");
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("writes nothing when the question is dismissed", async () => {
    dismiss();

    const saved = await applySeriesEdit({
      addEvent,
      edited,
      master,
      occurrence,
      updateEvent,
    });

    // False is what keeps the composer open with the edit still in it.
    expect(saved).toBe(false);
    expect(updateEvent).not.toHaveBeenCalled();
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("carries the series' OVERRIDE onto the event a split creates", async () => {
    answer("This event");
    const override = { minutesBefore: 15, allDay: null };
    reminderRules.mockReturnValue({
      default: SILENT,
      calendars: {},
      events: { [master.id]: override },
    });

    await applySeriesEdit({ addEvent, edited, master, occurrence, updateEvent });

    const [reminderEvent, rule] = setEventReminderRule.mock.calls[0]! as [
      Event,
      unknown,
    ];
    expect(reminderEvent.id).not.toBe(master.id);
    expect(rule).toEqual(override);
  });

  it("writes nothing when the series only inherits its rule", async () => {
    answer("This event");

    await applySeriesEdit({ addEvent, edited, master, occurrence, updateEvent });

    // The split event sits in the same calendars, so it inherits the same rule
    // on its own. An override here would freeze it against later changes.
    expect(setEventReminderRule).not.toHaveBeenCalled();
  });
});
