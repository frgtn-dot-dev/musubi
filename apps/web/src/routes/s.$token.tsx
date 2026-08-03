import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  eventPagePalette,
  eventPagePaletteVariables,
} from "@musubi/design-system";
import { Check, Info } from "lucide-react";
import { useState, type CSSProperties, type FormEvent } from "react";
import type { Poll, PollSlot, VoteValue } from "~/api/contracts";
import { getPoll, votePoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { BrandMark } from "~/components/BrandMark";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
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

  const [draft, setDraft] = useState<Record<string, VoteValue>>({});
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
  const answers: Record<string, VoteValue> = { ...data.mine, ...draft };
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

  function send() {
    vote.mutate({
      // Sent with the answers so a link-only participant stops being "Guest" to
      // everyone else in the grid. A signed-in account keeps the name it has.
      name: name.trim() || undefined,
      votes: Object.entries(answers).map(([slotID, value]) => ({
        slotID,
        value,
      })),
    });
  }

  return (
    // The published-event shell reads its colours from palette variables, so a
    // poll — which nobody themes — sets the default one rather than leaving
    // every border and surface resolving to nothing.
    <main
      className={styles.page}
      id="main-content"
      style={eventPagePaletteVariables(eventPagePalette(undefined)) as CSSProperties}
      tabIndex={-1}
    >
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
        <div className={pollStyles.gridWrap}>
          <table className={pollStyles.grid}>
            <caption className={pollStyles.gridCaption}>
              Who can make which time. Your own row is the last one.
            </caption>
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
                  {session.data?.user.name?.trim() || name.trim() || "You"}
                </th>
                {data.slots.map((slot) => (
                  <td className={pollStyles.cell} key={slot.id}>
                    {data.closed ? (
                      <Mark value={answers[slot.id]} />
                    ) : (
                      // One control per cell rather than three: a grid this wide
                      // has no room for a button trio, and cycling is how a
                      // spreadsheet-shaped thing is expected to behave.
                      <button
                        aria-label={`${formatSlot(slot)} — ${
                          answers[slot.id]
                            ? `you answered ${LABELS[answers[slot.id]!]}`
                            : "you have not answered"
                        }. Change your answer.`}
                        className={pollStyles.cellButton}
                        data-value={answers[slot.id] ?? "none"}
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            [slot.id]: nextAnswer(answers[slot.id]),
                          }))
                        }
                      >
                        <Mark value={answers[slot.id]} />
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <p className={pollStyles.legend}>
          {ANSWERS.map((option) => (
            <span className={pollStyles.legendItem} key={option.value}>
              <Mark value={option.value} />
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
              <p className={styles.rsvpError} role="alert">
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
              <>
                <Field label="Your name">
                  <input
                    autoComplete="name"
                    name="name"
                    placeholder="How the organizer knows you"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
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
              </>
            )}

            {message ? (
              <p className={styles.rsvpError} role="alert">
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

/** Cleared rather than stuck on "no": three states and a way back out. */
function nextAnswer(current: undefined | VoteValue): VoteValue {
  if (current === "yes") return "if-needed";
  if (current === "if-needed") return "no";

  return "yes";
}

/**
 * One answer in one cell.
 *
 * Shape as well as colour — a grid read only by hue is unreadable to anyone who
 * cannot separate red from green, and this is the whole content of the page.
 */
function Mark({ value }: { value?: VoteValue }) {
  if (!value) return <span className={pollStyles.markNone}>·</span>;

  return (
    <span className={pollStyles.mark} data-value={value}>
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
