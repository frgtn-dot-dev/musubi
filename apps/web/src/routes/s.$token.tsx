import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  eventPagePalette,
  eventPagePaletteVariables,
} from "@musubi/design-system";
import { CalendarClock, Check, Info } from "lucide-react";
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
    mutationFn: (votes: Array<{ slotID: string; value: VoteValue }>) =>
      votePoll({ token, votes }),
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
    vote.mutate(
      Object.entries(answers).map(([slotID, value]) => ({ slotID, value })),
    );
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
      <article className={styles.card}>
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

        {/* Grouped by day, because a poll spanning three weeks is a long page and
            "I'm away that whole week" is the answer people actually have. Each
            day heading answers its own times in one press. */}
        {groupByDay(data.slots).map(([day, slots]) => (
          <section className={pollStyles.day} key={day}>
            <header className={pollStyles.dayHead}>
              <h2 className={pollStyles.dayName}>{day}</h2>
              {data.closed || slots.length < 2 ? null : (
                <div
                  aria-label={`Answer every time on ${day}`}
                  className={pollStyles.answers}
                  role="group"
                >
                  {/* Named, because the buttons below say the same three words:
                      this row answers the whole day, those answer one time. */}
                  <span className={pollStyles.allLabel}>All</span>
                  {ANSWERS.map((option) => (
                    <Button
                      aria-pressed={slots.every(
                        (slot) => answers[slot.id] === option.value,
                      )}
                      key={option.value}
                      size="compact"
                      title={`${option.label} to all ${slots.length} times on ${day}`}
                      variant="secondary"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          ...Object.fromEntries(
                            slots.map((slot) => [slot.id, option.value]),
                          ),
                        }))
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
            </header>

            <ul className={pollStyles.slots}>
              {slots.map((slot) => (
                <li className={pollStyles.slot} key={slot.id}>
                  <div className={pollStyles.slotWhen}>
                    <CalendarClock
                      aria-hidden="true"
                      size={15}
                      strokeWidth={1.6}
                    />
                    <span>{formatTime(slot)}</span>
                  </div>
                  <Tally slot={slot} />
                  {data.closed ? null : (
                    <div
                      aria-label={`Your answer for ${formatSlot(slot)}`}
                      className={pollStyles.answers}
                      role="group"
                    >
                      {ANSWERS.map((option) => (
                        <Button
                          aria-pressed={answers[slot.id] === option.value}
                          key={option.value}
                          size="compact"
                          variant={
                            answers[slot.id] === option.value
                              ? "primary"
                              : "secondary"
                          }
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              [slot.id]: option.value,
                            }))
                          }
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

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

function Tally({ slot }: { slot: PollSlot }) {
  // Joined, not concatenated: a slot only somebody was unsure about used to read
  // "· If needed: Mika", separator and all.
  const parts = [
    slot.yes.length > 0 ? `Yes: ${slot.yes.join(", ")}` : null,
    slot.ifNeeded.length > 0 ? `If needed: ${slot.ifNeeded.join(", ")}` : null,
    slot.no.length > 0 ? `No: ${slot.no.length}` : null,
  ].filter(Boolean);

  return (
    <p className={pollStyles.tally}>
      {parts.length > 0 ? parts.join(" · ") : "No answers yet"}
    </p>
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
