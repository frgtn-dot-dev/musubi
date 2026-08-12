import type { Calendar } from "@musubi/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type RefObject } from "react";
import type { PollCalendar, VoteValue } from "~/api/contracts";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { getPoll, votePoll } from "~/api/resources";
import { PollGrid, PollLegend } from "~/components/PollGrid";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { PollResults } from "./SchedulingDialog";
import styles from "./styles/scheduling.module.css";

export function PollCalendarDialog({
  calendars,
  onClose,
  onNotice,
  poll,
  returnFocus,
  userId,
}: {
  calendars: Calendar[];
  onClose: () => void;
  onNotice: (message: string) => void;
  poll: PollCalendar;
  returnFocus: RefObject<HTMLElement | null>;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const pollCalendarKey = queryKeys.pollCalendar(getServerOrigin(), userId);

  function changed(message: string) {
    void queryClient.invalidateQueries({ queryKey: pollCalendarKey });
    void queryClient.invalidateQueries({ queryKey: ["poll", poll.token] });
    onClose();
    onNotice(message);
  }

  return (
    <Dialog
      bodyLayout="flush"
      bodyScroll="panels"
      closeLabel="Close poll"
      description="Current availability for this scheduling poll."
      onOpenChange={(open) => open || onClose()}
      open
      returnFocus={returnFocus}
      size="spacious"
      title={poll.title}
    >
      {poll.role === "organizer" ? (
        <PollResults
          calendars={calendars}
          onChanged={changed}
          onDecided={() => {
            void queryClient.invalidateQueries({ queryKey: pollCalendarKey });
            void queryClient.invalidateQueries({ queryKey: ["events"] });
            onClose();
            onNotice("Time picked. The event is in your calendar.");
          }}
          onNotice={onNotice}
          poll={poll}
        />
      ) : (
        <ParticipantPollResults
          onClose={onClose}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: pollCalendarKey });
            onNotice("Answers saved.");
          }}
          poll={poll}
        />
      )}
    </Dialog>
  );
}

function ParticipantPollResults({
  onClose,
  onSaved,
  poll,
}: {
  onClose: () => void;
  onSaved: () => void;
  poll: PollCalendar;
}) {
  const queryClient = useQueryClient();
  const answers = useQuery({
    queryFn: ({ signal }) => getPoll(poll.token, signal),
    queryKey: ["poll", poll.token],
  });
  const [draftOverride, setDraft] = useState<
    Record<string, VoteValue | null> | undefined
  >();
  const draft = draftOverride ?? answers.data?.mine ?? {};

  const save = useMutation({
    mutationFn: () =>
      votePoll({
        token: poll.token,
        votes: Object.entries(draft).flatMap(([slotID, value]) =>
          value ? [{ slotID, value }] : [],
        ),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["poll", poll.token], data);
      setDraft(data.mine);
      onSaved();
    },
  });
  const data = answers.data;

  return (
    <div className={styles.results}>
      <p className={styles.summary}>
        {data?.closed
          ? "This poll is closed."
          : "Your verified account can update its answers here."}
      </p>
      {data ? (
        <PollGrid
          answers={draft}
          approximateStartTime={data.approximateStartTime}
          caption="Who can make which day. Your row is editable."
          chosenSlotID={data.chosenSlotID}
          mineID={data.mineID}
          onAnswer={
            data.closed
              ? undefined
              : (slotID, value) =>
                  setDraft((current) => ({ ...current, [slotID]: value }))
          }
          people={data.people}
          showSlotTimes={data.durationMinutes < 24 * 60}
          slots={data.slots}
          yourRow={<span>You</span>}
        />
      ) : answers.error ? (
        <div>
          <p className={styles.error} role="alert">
            {answers.error.message}
          </p>
          <Button size="compact" variant="secondary" onClick={() => answers.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <p className={styles.summary}>Loading answers…</p>
      )}
      {data ? <PollLegend /> : null}
      {save.error ? (
        <p className={styles.error} role="alert">
          {save.error.message}
        </p>
      ) : null}
      <div className={styles.footer}>
        {data && !data.closed ? (
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save answers
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
