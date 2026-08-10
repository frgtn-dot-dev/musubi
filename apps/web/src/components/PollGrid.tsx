import { useRef, useState, type ReactNode } from "react";
import type { Poll, PollSlot, VoteValue } from "~/api/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "~/ui/Popover";
import styles from "./poll-grid.module.css";

const ANSWERS: Array<{ label: string; value: VoteValue }> = [
  { label: "Yes", value: "yes" },
  { label: "If needed", value: "if-needed" },
  { label: "No", value: "no" },
];

const LABELS: Record<VoteValue, string> = {
  "if-needed": "if needed",
  no: "no",
  yes: "yes",
};

/**
 * Who can make which day: people down, candidate days across.
 *
 * One grid for both sides of a poll. The participant page hands it their own
 * answers and gets an editable last row; the organizer's dialog hands it an
 * action per column and gets a row of "pick this" buttons under the same
 * columns. Reading them differently would mean the person deciding is looking at
 * a different picture from the people who answered.
 */
export function PollGrid({
  action,
  answers,
  approximateStartTime,
  caption,
  chosenSlotID,
  leadingSlotIDs,
  mineID,
  onAnswer,
  people,
  personAction,
  showSlotTimes = false,
  slots,
  yourRow,
}: {
  /** Organizer mode: a control under each column, in a row of its own. */
  action?: (slot: PollSlot) => ReactNode;
  /** The reader's own answers, for the editable row. */
  answers?: Record<string, VoteValue | null>;
  /** One wall-clock hint for every candidate day; informational only. */
  approximateStartTime?: null | string;
  caption: string;
  chosenSlotID?: null | string;
  /** Columns worth a second look — the most yeses, marked, never auto-picked. */
  leadingSlotIDs?: string[];
  mineID?: null | string;
  /** Participant mode: absent means the row is read-only. */
  onAnswer?: (slotID: string, value: null | VoteValue) => void;
  people: Poll["people"];
  /** Optional quiet action beside each participant name. */
  personAction?: (person: Poll["people"][number]) => ReactNode;
  /** Keeps old, timed polls readable after new polls switched to day choices. */
  showSlotTimes?: boolean;
  slots: PollSlot[];
  /** The label of the reader's own row: a name, or a field to type one in. */
  yourRow?: ReactNode;
}) {
  const [openCell, setOpenCell] = useState<string>();
  /**
   * Which cell's menu is open, written the moment it changes rather than at the
   * next render.
   *
   * A closing menu's callbacks run after the next one has already opened, so
   * state captured in those closures is a render behind and would say the wrong
   * thing about which menu is now on screen.
   */
  const openCellRef = useRef(openCell);
  const setCell = (next: string | undefined) => {
    openCellRef.current = next;
    setOpenCell(next);
  };

  const leading = new Set(leadingSlotIDs ?? []);
  const mine = answers ?? {};
  const showTimeRow = Boolean(approximateStartTime || showSlotTimes);

  function pick(slotID: string, value: null | VoteValue) {
    onAnswer?.(slotID, value);
    setCell(undefined);
  }

  return (
    <div className={styles.box}>
      {/* Outside the scrolling box: an instruction that slides away when you
          scroll to Friday is not an instruction. */}
      <p className={styles.caption} id="poll-grid-caption">
        {caption}
      </p>
      <div className={styles.scroller}>
        <table aria-describedby="poll-grid-caption" className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.corner} rowSpan={showTimeRow ? 2 : 1} scope="col">
                Participants
              </th>
              {groupByDay(slots).map(([day, ofDay]) => (
                <th
                  className={styles.dayHead}
                  colSpan={ofDay.length}
                  key={day}
                  scope="colgroup"
                >
                  {day}
                </th>
              ))}
            </tr>
            {showTimeRow ? (
              <tr>
                {slots.map((slot) => (
                  <th
                    className={styles.timeHead}
                    data-chosen={slot.id === chosenSlotID ? "" : undefined}
                    data-leading={leading.has(slot.id) ? "" : undefined}
                    key={slot.id}
                    scope="col"
                  >
                    {formatStart(slot.start, approximateStartTime, showSlotTimes)}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>

          <tbody>
            {/* The count first, because it answers the question before anyone
                reads a single row. */}
            <tr className={styles.countRow}>
              {/* Not "Yes": in a column of people's names, a row labelled with an
                  answer reads as somebody called Yes. */}
              <th className={styles.rowHead} scope="row">
                Can make it
              </th>
              {slots.map((slot) => (
                <td
                  className={styles.count}
                  data-chosen={slot.id === chosenSlotID ? "" : undefined}
                  data-leading={leading.has(slot.id) ? "" : undefined}
                  key={slot.id}
                >
                  {slot.yes.length}
                  {slot.ifNeeded.length > 0 ? (
                    <span className={styles.countIfNeeded}>
                      +{slot.ifNeeded.length}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>

            {people
              .filter((person) => person.id !== mineID)
              .map((person) => (
                <tr key={person.id}>
                  <th className={styles.rowHead} scope="row">
                    <span className={styles.personRow}>
                      <span className={styles.personName}>{person.name}</span>
                      {personAction?.(person)}
                    </span>
                  </th>
                  {slots.map((slot) => (
                    <td className={styles.cell} key={slot.id}>
                      <Mark value={person.answers[slot.id]} />
                    </td>
                  ))}
                </tr>
              ))}

            {yourRow ? (
              <tr className={styles.yourRow}>
                <th className={styles.rowHead} scope="row">
                  {yourRow}
                </th>
                {slots.map((slot) => (
                  <td className={styles.cell} key={slot.id}>
                    {onAnswer ? (
                      // A menu rather than a cycling button: three answers plus
                      // clearing is four presses away by cycling, and a grid is
                      // where you go to set one cell and be done.
                      <Popover
                        onOpenChange={(open) => {
                          if (open) {
                            setCell(slot.id);
                            return;
                          }
                          // Only this cell's own menu may close it. Clicking
                          // straight from one cell to another used to open the
                          // new menu and then shut it again: the old menu's close
                          // callback landed last and wiped the state the new
                          // trigger had just set.
                          if (openCellRef.current === slot.id) setCell(undefined);
                        }}
                        open={openCell === slot.id}
                      >
                        <PopoverTrigger asChild>
                          <button
                            aria-label={`${formatSlot(slot, approximateStartTime, showSlotTimes)} — ${
                              mine[slot.id]
                                ? `you answered ${LABELS[mine[slot.id]!]}`
                                : "you have not answered"
                            }. Change your answer.`}
                            className={styles.cellButton}
                            type="button"
                          >
                            <Mark silent value={mine[slot.id]} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="center"
                          aria-label={`Your answer for ${formatSlot(slot, approximateStartTime, showSlotTimes)}`}
                          className={styles.picker}
                          mobileSurface="anchored"
                          onCloseAutoFocus={(event) => {
                            // Closing because another cell was just opened: this
                            // menu would pull focus back to its own cell, which
                            // is outside the new menu — and a non-modal popover
                            // closes itself the moment focus leaves it. Tapping
                            // from cell to cell used to shut the new menu that
                            // way, immediately after opening it.
                            const next = openCellRef.current;
                            if (next && next !== slot.id) event.preventDefault();
                          }}
                        >
                          {ANSWERS.map((option) => (
                            <button
                              aria-pressed={mine[slot.id] === option.value}
                              className={styles.pick}
                              key={option.value}
                              type="button"
                              onClick={() => pick(slot.id, option.value)}
                            >
                              <Mark silent value={option.value} />
                              {option.label}
                            </button>
                          ))}
                          {mine[slot.id] ? (
                            <button
                              className={styles.pick}
                              type="button"
                              onClick={() => pick(slot.id, null)}
                            >
                              <Mark silent />
                              Clear
                            </button>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <Mark value={mine[slot.id]} />
                    )}
                  </td>
                ))}
              </tr>
            ) : null}

            {action ? (
              <tr className={styles.actionRow}>
                <th className={styles.rowHead} scope="row">
                  Decide
                </th>
                {slots.map((slot) => (
                  <td className={styles.actionCell} key={slot.id}>
                    {action(slot)}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The field that names the reader's own row.
 *
 * It lives here rather than at the call site because the class that styles it is
 * this module's — `pollStyles.nameInput` on the poll page resolved to `undefined`
 * and the field rendered as a bare browser input, which is why it looked like it
 * belonged to a different product.
 */
export function PollNameField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <input
      aria-label="Your name"
      autoComplete="name"
      className={styles.nameInput}
      placeholder="Your name…"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** What the marks mean, said once under the grid. */
export function PollLegend() {
  return (
    <p className={styles.legend}>
      {ANSWERS.map((option) => (
        <span className={styles.legendItem} key={option.value}>
          <Mark silent value={option.value} />
          {option.label}
        </span>
      ))}
    </p>
  );
}

/**
 * One answer in one cell.
 *
 * Shape as well as colour — a grid read only by hue is unreadable to anyone who
 * cannot separate red from green, and this is the whole content of the page.
 */
function Mark({
  silent,
  value,
}: {
  /** Beside a written label: the glyph is then decoration, and naming a button
      "! If needed" instead of "If needed" is how it goes wrong. */
  silent?: boolean;
  value?: null | VoteValue;
}) {
  // An empty slot, drawn as an empty box: a dot reads like an answer, and in the
  // reader's own row the box is also the thing they are meant to click.
  if (!value) {
    return (
      <span aria-hidden={silent} className={styles.markNone}>
        {silent ? null : (
          <span className={styles.visuallyHidden}>No answer</span>
        )}
      </span>
    );
  }

  return (
    <span aria-hidden={silent} className={styles.mark} data-value={value}>
      {value === "yes" ? "✓" : value === "if-needed" ? "!" : "✕"}
    </span>
  );
}

/**
 * Slots under the day they fall on, in the order the organizer offered them.
 *
 * Grouped in the reader's own timezone — the same slot can be Friday night in
 * Prague and Friday afternoon in Boston, and each reader should see their own.
 */
function groupByDay(slots: PollSlot[]): Array<[string, PollSlot[]]> {
  const days = new Map<string, PollSlot[]>();
  for (const slot of slots) {
    const day = formatDay(slot.start);
    const existing = days.get(day);
    if (existing) existing.push(slot);
    else days.set(day, [slot]);
  }

  return [...days];
}

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
}

function formatStart(
  date: Date,
  approximateStartTime?: null | string,
  showSlotTime = false,
): string {
  if (approximateStartTime) return `Around ${approximateStartTime}`;
  if (!showSlotTime) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** In the reader's own timezone, which for a poll across places is the point. */
function formatTime(
  slot: Pick<PollSlot, "end" | "start">,
): string {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${time.format(slot.start)} – ${time.format(slot.end)}`;
}

export function formatSlot(
  slot: Pick<PollSlot, "end" | "start">,
  approximateStartTime?: null | string,
  showSlotTime = false,
): string {
  const day = formatDay(slot.start);
  if (approximateStartTime) return `${day}, around ${approximateStartTime}`;
  return showSlotTime ? `${day}, ${formatTime(slot)}` : day;
}
