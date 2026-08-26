import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { RsvpStatus, RsvpSummary } from "~/api/contracts";
import { answerEvent, getEventRsvp } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { Avatar } from "~/ui/Avatar";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import { EmailIdentity } from "~/components/EmailIdentity";
import { Dialog } from "~/ui/Dialog";
import styles from "./event-page.module.css";

const ANSWERS: Array<{ label: string; value: RsvpStatus }> = [
  { label: "Going", value: "going" },
  { label: "Maybe", value: "maybe" },
  { label: "Can’t go", value: "declined" },
];

/** Answering requires a verified address; reading never does. */
export function RsvpBlock({
  children,
  token,
}: {
  children?: ReactNode;
  token: string;
}) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [identified, setIdentified] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<RsvpStatus>();
  const rsvpKey = ["public-rsvp", token];
  const signedIn = Boolean(session.data);
  const canRespond = (signedIn || identified) && !identifying;

  const summary = useQuery({
    queryFn: ({ signal }) => getEventRsvp(token, signal),
    queryKey: rsvpKey,
    retry: false,
  });

  const answer = useMutation({
    mutationFn: (input: { name?: string; status: RsvpStatus }) =>
      answerEvent({ ...input, token }),
    onError: () => setPending(undefined),
    onSuccess: (result) => {
      queryClient.setQueryData(rsvpKey, result);
      setPending(undefined);
    },
  });

  const mine = summary.data?.mine;
  const needsName = signedIn && !identified && !session.data?.user.name?.trim();

  if (summary.data?.isOrganizer) {
    return (
      <>
        {children}
        <Attending summary={summary.data} />
      </>
    );
  }

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
                  setPending(option.value);
                  if (canRespond) {
                    answer.mutate({
                      name: name.trim() || undefined,
                      status: option.value,
                    });
                  }
                }}
              >
                {option.label}
              </Button>
            );
          })}
        </div>

        {pending && !canRespond ? (
          <EmailIdentity
            disclosure={
              <p className={styles.rsvpExplainer}>
                Confirm your email so the organizer knows the answer is really
                yours. That creates a Musubi account with no password — next
                time a code is all you need.
              </p>
            }
            onIdentified={(identity) => {
              setName(identity.name);
              setIdentifying(false);
              setIdentified(true);
              answer.mutate({ name: identity.name, status: pending });
            }}
            onStart={() => setIdentifying(true)}
          />
        ) : null}

        {mine ? (
          <p className={styles.rsvpState}>
            {mine === "going"
              ? "You’re on the list."
              : mine === "maybe"
                ? "Marked as a maybe."
                : "You’ve said you can’t make it."}
          </p>
        ) : null}
      </section>
      {children}
      <Attending summary={summary.data} />
    </>
  );
}

/** What a reader learns about everyone else, which the organizer decided. */
function Attending({ summary }: { summary?: RsvpSummary }) {
  const [open, setOpen] = useState(false);
  if (!summary || summary.visibility === "hidden") return null;

  const { attendees, counts } = summary;
  if (counts.going + counts.maybe === 0) return null;

  return (
    <section className={styles.attendeeCard} aria-labelledby="attendees-title">
      <h2 id="attendees-title">Guests</h2>
      <p className={styles.attending}>
        {counts.going} going
        {counts.maybe > 0 ? ` · ${counts.maybe} maybe` : ""}
      </p>
      {summary.visibility === "names" && attendees.length > 0 ? (
        <>
          <button
            aria-label={`Show ${attendees.length} guests`}
            className={styles.facepile}
            type="button"
            onClick={() => setOpen(true)}
          >
            {attendees.slice(0, 4).map((attendee) => (
              <Avatar
                image={attendee.avatarUrl}
                key={`${attendee.name}-${attendee.avatarUrl}`}
                name={attendee.name}
                size={32}
              />
            ))}
            {attendees.length > 4 ? (
              <span aria-hidden="true" className={styles.facepileMore}>
                +{attendees.length - 4}
              </span>
            ) : null}
          </button>
          <Dialog
            closeLabel="Close guests"
            description={`${counts.going} going${counts.maybe > 0 ? ` · ${counts.maybe} maybe` : ""}`}
            open={open}
            size="compact"
            title="Guests"
            onOpenChange={setOpen}
          >
            <ul className={styles.attendeeList}>
              {attendees.map((attendee) => (
                <li key={`${attendee.name}-${attendee.avatarUrl}`}>
                  <Avatar
                    image={attendee.avatarUrl}
                    name={attendee.name}
                    size={32}
                  />
                  <span>{attendee.name}</span>
                </li>
              ))}
            </ul>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}
