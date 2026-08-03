import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Info } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Poll, PollSlot, VoteValue } from "~/api/contracts";
import { getPoll, votePoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { BrandMark } from "~/components/BrandMark";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import { Popover, PopoverContent, PopoverTrigger } from "~/ui/Popover";
import { RouteState } from "~/ui/RouteState";
import styles from "./event-page.module.css";
import pollStyles from "./poll-page.module.css";

const ANSWERS: Array<{ label: string; value: VoteValue }> = [
  { label: "Yes", value: "yes" },
  { label: "If needed", value: "if-needed" },
  { label: "No", value: "no" },
];

export const Route = createFileRoute("/s/$token")({
  component: PollRoute,
  head: () => ({
    // A poll is a private coordination between named people. Never indexed,
    // whatever the link is pasted into.
    meta: [{ content: "noindex, nofollow", name: "robots" }],
  }),
});

/**
 * "When can everyone meet?" from the participant's side.
 *
 * The identity is the same passwordless one the RSVP page uses: answering needs
 * a proved address, reading does not — you can see what you are being asked
 * before you say who you are.
 */
function PollRoute() {
  const { token } = Route.useParams();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const pollKey = ["poll", token];

  // `null` is "answered, then cleared" — different from a slot never touched,
  // which is what lets withdrawing one answer be sent rather than ignored.
  const [draft, setDraft] = useState<Record<string, VoteValue | null>>({});
  const [openCell, setOpenCell] = useState<string>();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  const poll = useQuery({
    queryFn: ({ signal }) => getPoll(token, signal),
    queryKey: pollKey,
    retry: false,
  });

  const vote = useMutation({
    mutationFn: (input: {
      name?: string;
      votes: Array<{ slotID: string; value: VoteValue }>;
    }) => votePoll({ ...input, token }),
    onSuccess: (result) => {
      queryClient.setQueryData(pollKey, result);
      setDraft({});
    },
  });

  if (poll.isPending) {
    return <RouteState busy eyebrow="Musubi" title="Opening the poll…" />;
  }

  if (poll.isError) {
    return (
      <RouteState
        description="The link may have been withdrawn, or the poll no longer exists."
        eyebrow="Musubi"
        title="This poll is not available."
      />
    );
  }

  const data = poll.data;
  const chosen = data.slots.find((slot) => slot.id === data.chosenSlotID);
  // What is on screen: their saved answers, with anything they have just clicked
  // laid over the top.
  const answers: Record<string, VoteValue | null> = { ...data.mine, ...draft };
  // What their own row is called. The projection wins over the session because it
  // is what everybody else sees, and it is already right the moment a name is
  // sent. "Guest" is the projection's placeholder for an empty name, so it counts
  // as no name at all — which is what puts the field back.
  const myRow = data.people.find((person) => person.id === data.mineID);
  const myName =
    (myRow && myRow.name !== "Guest" ? myRow.name : "") ||
    session.data?.user.name?.trim() ||
    "";
  const unsaved = Object.keys(draft).length > 0;

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim().toLowerCase(),
      type: "sign-in",
    });
    if (result.error) {
      setMessage(result.error.message ?? "That code could not be sent.");
      return;
    }
    setSent(true);
  }

  async function confirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const result = await authClient.signIn.emailOtp({
      email: email.trim().toLowerCase(),
      otp: code.trim(),
    });
    if (result.error) {
      setMessage(result.error.message ?? "That code did not work.");
      return;
    }
    send();
  }

  function pick(slotID: string, value: null | VoteValue) {
    setDraft((current) => ({ ...current, [slotID]: value }));
    setOpenCell(undefined);
  }

  function send() {
    vote.mutate({
      // Sent with the answers so a link-only participant stops being "Guest" to
      // everyone else in the grid. A signed-in account keeps the name it has.
      name: name.trim() || undefined,
      votes: Object.entries(answers)
        .filter(([, value]) => value !== null)
        .map(([slotID, value]) => ({ slotID, value: value! })),
    });
  }

  return (
    <main className={pollStyles.page} id="main-content" tabIndex={-1}>
      {/* A poll is a working page, not a poster: it follows the reader's system
          setting and lets them override it, like the app does. */}
      <div className={pollStyles.themeRow}>
        <ThemeToggle />
      </div>

      <article className={`${styles.card} ${pollStyles.card}`}>
        <header className={styles.header}>
          <span aria-hidden="true" className={styles.brand}>
            <BrandMark focusable="false" />
          </span>
          <h1>{data.title}</h1>
          <p className={styles.organizer}>
            {data.durationMinutes} minutes ·{" "}
            {data.respondents === 1
              ? "1 person has answered"
              : `${data.respondents} people have answered`}
          </p>
        </header>

        {data.description ? (
          <p className={styles.description}>{data.description}</p>
        ) : null}

        {chosen ? (
          <p className={pollStyles.decided}>
            <Check aria-hidden="true" size={15} strokeWidth={2} />
            Decided: {formatSlot(chosen)}
          </p>
        ) : null}

        {/* People down, times across — the shape of the question. Everybody's
            answers stay visible while you give your own, because "who else can
            make Tuesday" is what a poll is for. */}
        <div className={pollStyles.gridBox}>
          {/* Outside the scrolling box: an instruction that slides away when you
              scroll to Friday is not an instruction. */}
          <p className={pollStyles.gridCaption} id="grid-caption">
            Who can make which time. Your own row is the last one.
          </p>
          <div className={pollStyles.gridWrap}>
            <table aria-describedby="grid-caption" className={pollStyles.grid}>
            <thead>
              <tr>
                <th className={pollStyles.corner} rowSpan={2} scope="col">
                  Participants
                </th>
                {groupByDay(data.slots).map(([day, slots]) => (
                  <th
                    className={pollStyles.dayHead}
                    colSpan={slots.length}
                    key={day}
                    scope="colgroup"
                  >
                    {day}
                  </th>
                ))}
              </tr>
              <tr>
                {data.slots.map((slot) => (
                  <th className={pollStyles.timeHead} key={slot.id} scope="col">
                    {formatStart(slot.start)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* The count first, because it answers the question before anyone
                  reads a single row. */}
              <tr className={pollStyles.countRow}>
                <th className={pollStyles.rowHead} scope="row">
                  Yes
                </th>
                {data.slots.map((slot) => (
                  <td className={pollStyles.count} key={slot.id}>
                    {slot.yes.length}
                    {slot.ifNeeded.length > 0 ? (
                      <span className={pollStyles.countIfNeeded}>
                        +{slot.ifNeeded.length}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>

              {data.people
                .filter((person) => person.id !== data.mineID)
                .map((person) => (
                  <tr key={person.id}>
                    <th className={pollStyles.rowHead} scope="row">
                      {person.name}
                    </th>
                    {data.slots.map((slot) => (
                      <td className={pollStyles.cell} key={slot.id}>
                        <Mark value={person.answers[slot.id]} />
                      </td>
                    ))}
                  </tr>
                ))}

              <tr className={pollStyles.yourRow}>
                <th className={pollStyles.rowHead} scope="row">
                  {myName ? (
                    myName
                  ) : (
                    // Typed in the row it names, so it is obvious whose row it
                    // is. Confirming the address still happens below — this only
                    // says who to call you.
                    <input
                      aria-label="Your name"
                      autoComplete="name"
                      className={pollStyles.nameInput}
                      placeholder="Your name…"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </th>
                {data.slots.map((slot) => (
                  <td className={pollStyles.cell} key={slot.id}>
                    {data.closed ? (
                      <Mark value={answers[slot.id]} />
                    ) : (
                      // A menu rather than a cycling button: three answers plus
                      // clearing is four presses away by cycling, and a grid is
                      // where you go to set one cell and be done.
                      <Popover
                        onOpenChange={(open) =>
                          setOpenCell(open ? slot.id : undefined)
                        }
                        open={openCell === slot.id}
                      >
                        <PopoverTrigger asChild>
                          <button
                            aria-label={`${formatSlot(slot)} — ${
                              answers[slot.id]
                                ? `you answered ${LABELS[answers[slot.id]!]}`
                                : "you have not answered"
                            }. Change your answer.`}
                            className={pollStyles.cellButton}
                            type="button"
                          >
                            <Mark silent value={answers[slot.id]} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="center"
                          aria-label={`Your answer for ${formatSlot(slot)}`}
                          className={pollStyles.picker}
                          mobileSurface="anchored"
                        >
                          {ANSWERS.map((option) => (
                            <button
                              aria-pressed={answers[slot.id] === option.value}
                              className={pollStyles.pick}
                              key={option.value}
                              type="button"
                              onClick={() => pick(slot.id, option.value)}
                            >
                              <Mark silent value={option.value} />
                              {option.label}
                            </button>
                          ))}
                          {answers[slot.id] ? (
                            <button
                              className={pollStyles.pick}
                              type="button"
                              onClick={() => pick(slot.id, null)}
                            >
                              <span aria-hidden="true" className={pollStyles.markNone}>
                                ·
                              </span>
                              Clear
                            </button>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
            </table>
          </div>
        </div>

        <p className={pollStyles.legend}>
          {ANSWERS.map((option) => (
            <span className={pollStyles.legendItem} key={option.value}>
              <Mark silent value={option.value} />
              {option.label}
            </span>
          ))}
        </p>

        {data.closed ? null : session.data ? (
          <div className={pollStyles.send}>
            <Button
              disabled={!unsaved}
              loading={vote.isPending}
              onClick={send}
            >
              {unsaved ? "Send my answers" : "Answers saved"}
            </Button>
            {vote.error ? (
              <p className={pollStyles.error} role="alert">
                {vote.error.message}
              </p>
            ) : null}
          </div>
        ) : unsaved ? (
          <form
            className={styles.rsvpForm}
            onSubmit={(event) =>
              void (sent ? confirmCode(event) : requestCode(event))
            }
          >
            {/* What leaves this browser, said before it does (PRD §19.1). */}
            <p className={pollStyles.disclosure}>
              <Info aria-hidden="true" size={14} strokeWidth={1.7} />
              You are sending your answers and the name you type here. Your own
              calendar is never sent — nothing on this page has read it.
            </p>

            {sent ? (
              <Field label="Code from your email">
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  name="code"
                  placeholder="123456"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
            ) : (
              <Field label="Email">
                  <input
                    autoCapitalize="none"
                    autoComplete="email"
                    inputMode="email"
                    name="email"
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
            )}

            {message ? (
              <p className={pollStyles.error} role="alert">
                {message}
              </p>
            ) : null}

            <Button type="submit">{sent ? "Confirm and send" : "Send me a code"}</Button>
          </form>
        ) : null}
      </article>

      <p className={styles.footer}>
        Published with <a href="https://musubi.pro">Musubi</a>
      </p>
    </main>
  );
}

const LABELS: Record<VoteValue, string> = {
  "if-needed": "if needed",
  no: "no",
  yes: "yes",
};

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
  value?: VoteValue | null;
}) {
  if (!value) {
    return (
      <span aria-hidden={silent} className={pollStyles.markNone}>
        ·
      </span>
    );
  }

  return (
    <span aria-hidden={silent} className={pollStyles.mark} data-value={value}>
      {value === "yes" ? "\u2713" : value === "if-needed" ? "!" : "\u2715"}
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

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
}

/** Just the start: one poll is one length of meeting, and the header says it. */
function formatStart(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** In the reader's own timezone, which for a poll across places is the point. */
function formatTime(slot: Pick<Poll["slots"][number], "end" | "start">): string {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${time.format(slot.start)} – ${time.format(slot.end)}`;
}

function formatSlot(slot: Pick<Poll["slots"][number], "end" | "start">): string {
  return `${formatDay(slot.start)}, ${formatTime(slot)}`;
}
