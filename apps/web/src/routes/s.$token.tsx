import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Info } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { VoteValue } from "~/api/contracts";
import { getPoll, votePoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { BrandMark } from "~/components/BrandMark";
import { formatSlot, PollGrid, PollLegend } from "~/components/PollGrid";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import { RouteState } from "~/ui/RouteState";
import styles from "./event-page.module.css";
import pollStyles from "./poll-page.module.css";

/** The reader's own timezone, which is the one every slot above is written in. */
function localZone() {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

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
        /* Somewhere to go: without this the page is a wall. Whoever sent the link
           is the only one who can restore it, so the offer is the thing this
           reader can do on their own. */
        actions={
          <Link className={styles.secondaryLink} to="/find-a-time">
            Ask people for a time yourself
          </Link>
        }
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

        {/* People down, times across — the same grid the organizer reads, so the
            person deciding and the people answering see one picture. */}
        <PollGrid
          answers={answers}
          /* Before anyone has answered, the grid needs to say what to do with it;
             after that it only needs to say what it shows. Both name the timezone,
             because the same slot is Friday night in one place and Friday
             afternoon in another and these times are the reader's own. */
          caption={
            data.closed
              ? `How everyone answered. Times in ${localZone()}.`
              : Object.keys(answers).length > 0
                ? `Who can make which time. Times in ${localZone()}.`
                : `Fill in your own row — the last one — then send. Times in ${localZone()}.`
          }
          chosenSlotID={data.chosenSlotID}
          mineID={data.mineID}
          people={data.people}
          slots={data.slots}
          yourRow={
            myName ? (
              myName
            ) : (
              // Typed in the row it names, so it is obvious whose row it is.
              // Confirming the address still happens below — this only says who
              // to call you.
              <input
                aria-label="Your name"
                autoComplete="name"
                className={pollStyles.nameInput}
                placeholder="Your name…"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )
          }
          onAnswer={data.closed ? undefined : pick}
        />

        <PollLegend />

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






