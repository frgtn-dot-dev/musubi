import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { PollSlot, VoteValue } from "~/api/contracts";
import { getPoll, votePoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { EmailIdentity } from "~/components/EmailIdentity";
import {
  PublicPollPage,
  type PublicPollOption,
  type PublicPollParticipant,
} from "./-PublicPollPage";
import { buttonClassName } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";

export const Route = createFileRoute("/s/$token")({
  component: PollRoute,
  head: () => ({
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
  const pollKey = useMemo(() => ["poll", token], [token]);
  const [draft, setDraft] = useState<Record<string, VoteValue | null>>({});
  const [identifying, setIdentifying] = useState(false);

  const poll = useQuery({
    queryFn: ({ signal }) => getPoll(token, signal),
    queryKey: pollKey,
    retry: false,
  });
  const sessionUserID = session.data?.user.id;
  const refetchPoll = poll.refetch;

  useEffect(() => {
    // SSR cannot forward the browser's session cookie through the generic API
    // client. Refresh once the browser has resolved its session so the server can
    // return the viewer's row and organizer role instead of the anonymous view.
    if (sessionUserID) void refetchPoll();
  }, [refetchPoll, sessionUserID]);

  const vote = useMutation({
    mutationFn: (votes: { slotID: string; value: VoteValue }[]) =>
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
        actions={
          <Link
            className={buttonClassName({ variant: "secondary" })}
            to="/find-a-time"
          >
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
  const authenticatedViewer =
    data.viewerRole === undefined
      ? Boolean(session.data)
      : data.viewerRole !== null;
  const answers: Record<string, VoteValue | null> = { ...data.mine, ...draft };
  const unsaved = Object.keys(draft).length > 0;
  const answered = Object.keys(data.mine).length > 0;
  const resultsVisible =
    data.closed || data.viewerRole === "organizer" || answered;
  const state = data.closed ? "closed" : resultsVisible ? "answered" : "open";
  const participants: PublicPollParticipant[] = data.people.map((person) => ({
    id: person.id,
    image: null,
    name: person.id === data.mineID ? "You" : person.name,
    responseLabel: person.id === data.mineID ? "Your response" : "Answered",
  }));
  const options = data.slots.map((slot) =>
    toPublicPollOption(slot, {
      approximateStartTime: data.approximateStartTime ?? null,
      durationMinutes: data.durationMinutes,
    }),
  );
  const leadingOptionIds = findLeadingOptionIds(data.slots);
  const organizerName =
    data.viewerRole === "organizer"
      ? session.data?.user.name?.trim() || "You"
      : "Poll organizer";

  function pick(slotID: string, value: VoteValue | null) {
    setDraft((current) => ({ ...current, [slotID]: value }));
  }

  function send() {
    vote.mutate(
      Object.entries(answers)
        .filter((entry): entry is [string, VoteValue] => entry[1] !== null)
        .map(([slotID, value]) => ({ slotID, value })),
    );
  }

  return (
    <PublicPollPage
      answers={answers}
      deadlineLabel={formatDeadline(data.deadline ?? null)}
      description="Choose every time that could work. You can update your answer until voting closes."
      durationLabel={formatDuration(data.durationMinutes)}
      identityPrompt={
        identifying && !authenticatedViewer ? (
          <EmailIdentity
            busy={vote.isPending}
            confirmLabel="Confirm and send"
            disclosure={
              <p>
                Confirm your email to save these answers. Your email stays
                private and your calendar is never read.
              </p>
            }
            onIdentified={() => {
              setIdentifying(false);
              send();
            }}
            onStart={() => setIdentifying(true)}
          />
        ) : undefined
      }
      leadingOptionIds={leadingOptionIds}
      onAnswer={pick}
      onSubmit={() => {
        if (authenticatedViewer) send();
        else setIdentifying(true);
      }}
      options={options}
      organizer={{
        id: "organizer",
        image:
          data.viewerRole === "organizer"
            ? (session.data?.user.image ?? null)
            : null,
        name: organizerName,
      }}
      organizerNote={data.description}
      participants={participants}
      selectedOptionId={data.chosenSlotID ?? undefined}
      state={state}
      submitDisabled={!unsaved || identifying}
      submitError={vote.error?.message}
      submitting={vote.isPending}
      title={data.title}
    />
  );
}

function toPublicPollOption(
  slot: PollSlot,
  poll: {
    approximateStartTime: string | null;
    durationMinutes: number;
  },
): PublicPollOption {
  return {
    counts: {
      "if-needed": slot.ifNeeded.length,
      no: slot.no.length,
      yes: slot.yes.length,
    },
    dateLabel: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      weekday: "long",
    }).format(slot.start),
    id: slot.id,
    start: slot.start.toISOString(),
    timeLabel: formatOptionTime(slot, poll),
  };
}

function formatOptionTime(
  slot: Pick<PollSlot, "end" | "start">,
  poll: { approximateStartTime: string | null; durationMinutes: number },
): string {
  if (poll.durationMinutes >= 24 * 60) {
    return poll.approximateStartTime
      ? `Around ${poll.approximateStartTime}`
      : "All day";
  }

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${time.format(slot.start)}–${time.format(slot.end)}`;
}

function formatDuration(minutes: number): string {
  if (minutes >= 24 * 60) return "All day";
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function formatDeadline(deadline: Date | null): string {
  if (!deadline) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(deadline);
}

function findLeadingOptionIds(slots: PollSlot[]): string[] {
  const best = Math.max(0, ...slots.map((slot) => slot.yes.length));
  return best > 0
    ? slots.filter((slot) => slot.yes.length === best).map((slot) => slot.id)
    : [];
}
