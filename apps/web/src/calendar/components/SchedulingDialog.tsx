import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Copy } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import type { Calendar, Settings } from "@musubi/types";
import type { PollSummary, VoteValue } from "~/api/contracts";
import { getServerOrigin } from "~/api/query-keys";
import {
  closePoll,
  createPoll,
  decidePoll,
  deletePoll,
  getPoll,
  getPolls,
  votePoll,
} from "~/api/resources";
import { Button } from "~/ui/Button";
import { ConfirmationDialog } from "~/ui/ConfirmationDialog";
import { Dialog } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";
import {
  formatDay,
  formatSlot,
  PollGrid,
  PollLegend,
} from "~/components/PollGrid";
import { PollForm } from "./PollForm";
import { RowAction } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import styles from "./styles/scheduling.module.css";

/**
 * Finding a time everyone can make — the organizer's half.
 *
 * A group poll, not a booking page: this asks a handful of people which of a few
 * times suits them. Handing out slots from the organizer's own free time is a
 * different product and the PRD (§19.2) is explicit that the two must not be
 * mixed in one screen.
 */
export function SchedulingDialog({
  calendars,
  onNotice,
  onOpenChange,
  returnFocus,
  timeFormat,
  weekStartsOn,
}: {
  calendars: Calendar[];
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement | null>;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const queryClient = useQueryClient();
  const pollsKey = ["polls", getServerOrigin()];
  const [openPoll, setOpenPoll] = useState<PollSummary>();

  const polls = useQuery({
    queryFn: ({ signal }) => getPolls(signal),
    queryKey: pollsKey,
  });

  return (
    <Dialog
      bodyLayout="flush"
      bodyScroll="panels"
      closeLabel="Close scheduling"
      description="Offer a few times, send the link, and see what suits everyone."
      onOpenChange={onOpenChange}
      open
      returnFocus={returnFocus}
      size="spacious"
      title={openPoll ? openPoll.title : "Find a time"}
    >
      {openPoll ? (
        <PollResults
          calendars={calendars}
          onChanged={(message) => {
            void queryClient.invalidateQueries({ queryKey: pollsKey });
            void queryClient.invalidateQueries({ queryKey: ["poll-calendar"] });
            // And the poll's own answers: closing it changes what the detail view
            // may offer, and this query outlives the trip back to the list — so
            // reopening it showed Pick buttons for a poll that no longer takes
            // answers.
            void queryClient.invalidateQueries({
              queryKey: ["poll", openPoll.token],
            });
            setOpenPoll(undefined);
            onNotice(message);
          }}
          onDecided={() => {
            void queryClient.invalidateQueries({ queryKey: pollsKey });
            void queryClient.invalidateQueries({ queryKey: ["poll-calendar"] });
            void queryClient.invalidateQueries({ queryKey: ["events"] });
            setOpenPoll(undefined);
            onNotice("Time picked. The event is in your calendar.");
          }}
          onNotice={onNotice}
          poll={openPoll}
        />
      ) : (
        <div className={styles.content}>
          <NewPoll
            calendars={calendars}
            onCreated={(poll) => {
              void queryClient.invalidateQueries({ queryKey: pollsKey });
              void queryClient.invalidateQueries({
                queryKey: ["poll-calendar"],
              });
              onNotice("Poll created. Send the link to the people you need.");
              setOpenPoll(poll);
            }}
            timeFormat={timeFormat}
            weekStartsOn={weekStartsOn}
          />

          <section className={styles.section}>
            <SectionLabel level={3}>Your polls</SectionLabel>
            {polls.data?.length ? (
              <div className={styles.list}>
                {polls.data.map((poll) => (
                  <RowAction
                    detail={pollDetail(poll)}
                    icon={<CalendarClock size={17} strokeWidth={1.7} />}
                    key={poll.id}
                    label={poll.title}
                    onClick={() => setOpenPoll(poll)}
                  />
                ))}
              </div>
            ) : (
              <Empty
                description="A poll offers a few times and collects who can make them."
                icon={<CalendarClock size={18} strokeWidth={1.7} />}
                title="No polls yet"
              />
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function NewPoll({
  calendars,
  onCreated,
  timeFormat,
  weekStartsOn,
}: {
  calendars: Calendar[];
  onCreated: (poll: PollSummary) => void;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const create = useMutation({
    mutationFn: createPoll,
    onSuccess: onCreated,
  });

  return (
    <section className={styles.section}>
      <PollForm
        busy={create.isPending}
        calendars={calendars}
        error={create.error?.message}
        timeFormat={timeFormat}
        weekStartsOn={weekStartsOn}
        onSubmit={(draft) => create.mutate(draft)}
      />
    </section>
  );
}

/**
 * What a poll in the list is doing, in one line.
 *
 * "Decided" was said of anything closed, including a poll shut without a time —
 * and a deadline was never mentioned at all, so the one fact that changes whether
 * you need to chase people was the one the row left out.
 */
function pollDetail(poll: PollSummary) {
  if (poll.closedAt) {
    return poll.chosenSlotID ? "Decided" : "Closed, no time picked";
  }
  // Closed without the organizer closing it: the deadline ran out.
  if (poll.closed) return "Answers have closed";

  return poll.deadline
    ? `Waiting for answers until ${formatDay(poll.deadline)}`
    : "Waiting for answers";
}

export function PollResults({
  calendars,
  onChanged,
  onDecided,
  onNotice,
  poll,
}: {
  calendars: Calendar[];
  /** A close or a delete: the list behind this view is now out of date. */
  onChanged: (message: string) => void;
  onDecided: () => void;
  onNotice: (message: string) => void;
  poll: PollSummary;
}) {
  const queryClient = useQueryClient();
  const gridScroller = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<Record<string, VoteValue | null>>();
  // Where the poll said it would land, when it said so. Older polls and ones made
  // without an account carry nothing, so the first writable calendar stands in —
  // the same choice the server would make.
  const calendarId =
    poll.calendarID ??
    calendars.find((calendar) => calendar.role !== "viewer")?.id ??
    "";

  const answers = useQuery({
    queryFn: ({ signal }) => getPoll(poll.token, signal),
    queryKey: ["poll", poll.token],
  });

  const decide = useMutation({
    mutationFn: (slotId: string) =>
      decidePoll({ calendarId, pollId: poll.id, slotId }),
    onSuccess: onDecided,
  });

  const close = useMutation({
    mutationFn: () => closePoll(poll.id),
    onSuccess: () => onChanged("Poll closed. The answers stay readable."),
  });

  const remove = useMutation({
    mutationFn: () => deletePoll(poll.id),
    onSuccess: () => onChanged("Poll deleted."),
  });

  const save = useMutation({
    mutationFn: () =>
      votePoll({
        token: poll.token,
        votes: Object.entries(draft ?? answers.data?.mine ?? {}).flatMap(
          ([slotID, value]) => (value ? [{ slotID, value }] : []),
        ),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(["poll", poll.token], result);
      void queryClient.invalidateQueries({ queryKey: ["poll-calendar"] });
      setDraft(undefined);
      onNotice("Answers saved.");
    },
  });

  const data = answers.data;
  const ownAnswers = draft ?? data?.mine ?? {};
  const ownName =
    data?.people.find((person) => person.id === data.mineID)?.name || "You";
  // The leaders are marked, never auto-picked: two times can tie, and the choice
  // is the organizer's to make.
  const best = data
    ? Math.max(0, ...data.slots.map((slot) => slot.yes.length))
    : 0;
  const leading =
    data && best > 0
      ? data.slots
          .filter((slot) => slot.yes.length === best)
          .map((slot) => slot.id)
      : [];
  const chosen = data?.slots.find((slot) => slot.id === data.chosenSlotID);

  return (
    <div className={styles.results}>
      {chosen ? (
        // What was decided, in words, at the top: the grid below is the evidence,
        // not the answer.
        <div className={styles.decidedPanel}>
          <p className={styles.decidedWhen}>
            <Check aria-hidden="true" size={16} strokeWidth={2} />
            {formatSlot(
              chosen,
              data?.approximateStartTime,
              Boolean(data && data.durationMinutes < 24 * 60),
            )}
          </p>
          <p className={styles.decidedWho}>
            {chosen.yes.length > 0
              ? `${chosen.yes.join(", ")} said yes`
              : "Nobody had said yes to this one"}
            {chosen.ifNeeded.length > 0
              ? ` · ${chosen.ifNeeded.join(", ")} if needed`
              : ""}
          </p>
          <p className={styles.decidedNote}>
            It is in your calendar, and the poll is closed to new answers.
          </p>
        </div>
      ) : data?.closed ? (
        // Shut with nothing picked — a deadline went by, or the organizer closed
        // it. Saying "decided" here would be a lie, and saying nothing leaves a
        // grid of Pick buttons that are simply gone.
        <p className={styles.summary}>
          {/* `closedAt` is what the organizer set; a deadline that ran out closes
              the poll without setting it, so this tells the two apart without
              reading the clock in a render. */}
          {poll.closedAt || !data.deadline
            ? "This poll is closed. Nothing was picked."
            : `Answers closed on ${formatDay(data.deadline)}. Nothing was picked.`}
        </p>
      ) : !data ? (
        <p className={styles.summary}>Loading answers…</p>
      ) : data.deadline ? (
        // The one fact the grid cannot show: when it stops taking answers.
        <p className={styles.summary}>
          Answers close on {formatDay(data.deadline)}.
        </p>
      ) : null}

      {data ? (
        <PollGrid
          action={
            data.closed
              ? undefined
              : (slot) => (
                  <Button
                    disabled={!calendarId}
                    loading={decide.isPending && decide.variables === slot.id}
                    size="compact"
                    title={`Pick ${formatSlot(
                      slot,
                      data.approximateStartTime,
                      data.durationMinutes < 24 * 60,
                    )}`}
                    variant={
                      leading.includes(slot.id) ? "primary" : "secondary"
                    }
                    onClick={() => decide.mutate(slot.id)}
                  >
                    Pick
                  </Button>
                )
          }
          answers={ownAnswers}
          approximateStartTime={data.approximateStartTime}
          chosenSlotID={data.chosenSlotID}
          leadingSlotIDs={leading}
          mineID={data.mineID}
          onAnswer={
            data.closed || save.isPending
              ? undefined
              : (slotID, value) =>
                  setDraft((current) => ({
                    ...(current ?? data.mine),
                    [slotID]: value,
                  }))
          }
          showSlotTimes={data.durationMinutes < 24 * 60}
          people={data.people}
          scrollerRef={gridScroller}
          slots={data.slots}
          yourRow={<span>{ownName}</span>}
        />
      ) : null}

      <PollLegend scrollerRef={gridScroller} />

      {/* Still worth sending once a time is picked — it is where everyone reads
          the answer — but a link labelled nothing on a closed poll looks like an
          invitation to answer a poll that no longer takes answers. */}
      <p className={styles.linkCaption}>
        {chosen
          ? "The same link now shows everyone the time you picked."
          : "Send this link to the people you need."}
      </p>
      <div className={styles.linkRow}>
        <input
          aria-label="Poll link"
          className={styles.linkField}
          readOnly
          value={poll.url}
        />
        <Button
          icon={<Copy size={15} strokeWidth={1.6} />}
          size="compact"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              .writeText(poll.url)
              .then(() => onNotice("Link copied."))
              .catch(() =>
                onNotice("Could not copy — select the link instead."),
              );
          }}
        >
          Copy
        </Button>
      </div>

      {decide.error ? (
        <p className={styles.error} role="alert">
          {decide.error.message}
        </p>
      ) : null}

      {(save.error ?? close.error ?? remove.error) ? (
        <p className={styles.error} role="alert">
          {(save.error ?? close.error ?? remove.error)!.message}
        </p>
      ) : null}

      {/* Managing the poll on the left, answering it on the right. Closing the
          dialog is the header's X — a Back button here was a third way out. */}
      <div className={styles.footer}>
        <div className={styles.footerGroup}>
          <Button
            loading={remove.isPending}
            variant="destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete poll
          </Button>
          {data && !data.closed ? (
            <Button
              loading={close.isPending}
              title="Stop taking answers without picking a time"
              variant="secondary"
              onClick={() => close.mutate()}
            >
              Stop taking answers
            </Button>
          ) : null}
        </div>
        {data && !data.closed ? (
          <Button
            disabled={!draft}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {draft ? "Save my answers" : "Answers saved"}
          </Button>
        ) : null}
      </div>

      <ConfirmationDialog
        closeLabel="Keep the poll"
        confirmLabel="Delete poll"
        description={
          data?.respondents
            ? `${data.respondents} ${
                data.respondents === 1 ? "person has" : "people have"
              } answered. Their answers go with it.`
            : "Nobody has answered it yet."
        }
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onOpenChange={setConfirmingDelete}
        open={confirmingDelete}
        title={`Delete “${poll.title}”?`}
      >
        <p>
          The link stops working and the answers are gone. This cannot be
          undone.
          {chosen
            ? " The event it created stays in the calendars it is in."
            : ""}
        </p>
      </ConfirmationDialog>
    </div>
  );
}
