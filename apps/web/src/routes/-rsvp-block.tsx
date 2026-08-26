import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import type { RsvpStatus, RsvpSummary } from "~/api/contracts";
import { answerEvent, getEventRsvp } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { Avatar } from "~/ui/Avatar";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import styles from "./event-page.module.css";

const ANSWERS: Array<{ label: string; value: RsvpStatus }> = [
  { label: "Going", value: "going" },
  { label: "Maybe", value: "maybe" },
  { label: "Can’t go", value: "declined" },
];

/**
 * Answering a published event, for someone who has never heard of Musubi.
 *
 * The order is the one people expect (`PRD §18.1`): pick an answer, then say who
 * you are. The pick is held in this component until the address is confirmed —
 * there is deliberately no half-answered row in the database, so a count is
 * always a count of confirmed people.
 */
export function RsvpBlock({
  children,
  token,
}: {
  children?: ReactNode;
  token: string;
}) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);
  const rsvpKey = ["public-rsvp", token];

  const [pending, setPending] = useState<RsvpStatus>();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  const summary = useQuery({
    queryFn: ({ signal }) => getEventRsvp(token, signal),
    queryKey: rsvpKey,
    retry: false,
  });

  const answer = useMutation({
    mutationFn: (input: { name?: string; status: RsvpStatus }) =>
      answerEvent({ ...input, token }),
    onSuccess: (result) => {
      queryClient.setQueryData(rsvpKey, result);
      setPending(undefined);
    },
  });

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
    // Signed in — send the answer they picked before we asked who they were.
    if (pending) answer.mutate({ name: name.trim(), status: pending });
  }

  const mine = summary.data?.mine;
  // An attendee list is a list of people, so an answer needs a name. A member who
  // already has one is never asked; an account made by an emailed code is.
  const needsName = signedIn && !session.data?.user.name?.trim();
  const identityReady = name.trim().length > 0 && email.trim().length > 0;

  return (
    <>
      <section aria-labelledby="rsvp-title" className={styles.rsvp}>
        <h2 id="rsvp-title">Are you coming?</h2>

        {needsName ? (
          <Field label="Your name">
            <input
              autoComplete="name"
              name="name"
              placeholder="How the organizer knows you"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        ) : null}

        <div className={styles.answers} role="group" aria-label="Your answer">
          {ANSWERS.map((option) => {
            const chosen = (mine ?? pending) === option.value;

            return (
              <Button
                aria-pressed={chosen}
                disabled={needsName && name.trim().length === 0}
                key={option.value}
                loading={
                  answer.isPending && answer.variables?.status === option.value
                }
                variant={chosen ? "primary" : "secondary"}
                onClick={() => {
                  if (signedIn) {
                    answer.mutate({
                      name: name.trim() || undefined,
                      status: option.value,
                    });
                    return;
                  }
                  // Held here, not sent: nothing is recorded until an address is
                  // confirmed, so nobody can put words in a stranger's mouth.
                  setPending(option.value);
                }}
              >
                {option.label}
              </Button>
            );
          })}
        </div>

        {mine ? (
          <p className={styles.rsvpState}>
            {mine === "going"
              ? "You’re on the list."
              : mine === "maybe"
                ? "Marked as a maybe."
                : "You’ve said you can’t make it."}
          </p>
        ) : null}

        {pending && !signedIn ? (
          <form
            className={styles.rsvpForm}
            onSubmit={(event) =>
              void (sent ? confirmCode(event) : requestCode(event))
            }
          >
            {/* Said plainly, before anything is created: an answer needs somewhere
              to belong, and the PRD asks for that to be explained rather than
              discovered (§18.2). */}
            <p className={styles.rsvpExplainer}>
              Confirm your email so the organizer knows the answer is really
              yours. That creates a Musubi account with no password — next time
              a code is all you need.
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
                    required
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

            {/* Asked before the code is sent, not after: the server refuses a
              nameless answer, and finding that out post-login is a dead end. */}
            <Button disabled={!sent && !identityReady} type="submit">
              {sent ? "Confirm" : "Send me a code"}
            </Button>
          </form>
        ) : null}
      </section>
      {children}
      <Attending summary={summary.data} />
    </>
  );
}

/** What a reader learns about everyone else, which the organizer decided. */
function Attending({ summary }: { summary?: RsvpSummary }) {
  if (!summary || summary.visibility === "hidden") return null;

  const { counts } = summary;
  if (counts.going + counts.maybe === 0) return null;

  return (
    <section className={styles.attendeeCard} aria-labelledby="attendees-title">
      <h2 id="attendees-title">Guests</h2>
      <p className={styles.attending}>
        {counts.going} going
        {counts.maybe > 0 ? ` · ${counts.maybe} maybe` : ""}
      </p>
      {summary.visibility === "names" && summary.attendees.length > 0 ? (
        <ul className={styles.attendeeList}>
          {summary.attendees.map((attendee) => (
            <li key={`${attendee.name}-${attendee.avatarUrl}`}>
              <Avatar
                image={attendee.avatarUrl}
                name={attendee.name}
                size={30}
              />
              <span>{attendee.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
