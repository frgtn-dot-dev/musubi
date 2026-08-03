import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy } from "lucide-react";
import { useState, type RefObject } from "react";
import type { Calendar, Settings } from "@musubi/types";
import type { PollSummary } from "~/api/contracts";
import { getServerOrigin } from "~/api/query-keys";
import {
  createPoll,
  decidePoll,
  getPoll,
  getPolls,
} from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";
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
          onBack={() => setOpenPoll(undefined)}
          onDecided={() => {
            void queryClient.invalidateQueries({ queryKey: pollsKey });
            setOpenPoll(undefined);
            onNotice("Time picked. The event is in your calendar.");
          }}
          onNotice={onNotice}
          poll={openPoll}
        />
      ) : (
        <div className={styles.content}>
          <NewPoll
            onCreated={(poll) => {
              void queryClient.invalidateQueries({ queryKey: pollsKey });
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
                    detail={
                      poll.closedAt
                        ? "Decided"
                        : `${poll.durationMinutes} minutes · waiting for answers`
                    }
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
  onCreated,
  timeFormat,
  weekStartsOn,
}: {
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
      <SectionLabel level={3}>New poll</SectionLabel>
      <PollForm
        busy={create.isPending}
        error={create.error?.message}
        timeFormat={timeFormat}
        weekStartsOn={weekStartsOn}
        onSubmit={(draft) => create.mutate(draft)}
      />
    </section>
  );
}

function PollResults({
  calendars,
  onBack,
  onDecided,
  onNotice,
  poll,
}: {
  calendars: Calendar[];
  onBack: () => void;
  onDecided: () => void;
  onNotice: (message: string) => void;
  poll: PollSummary;
}) {
  // The event lands in the first calendar the organizer can write to. Choosing
  // which one is a question for the day this poll grows a "create in…" row; a
  // select here would be a third thing to answer while picking a time.
  const calendarId =
    calendars.find((calendar) => calendar.role !== "viewer")?.id ?? "";

  const answers = useQuery({
    queryFn: ({ signal }) => getPoll(poll.token, signal),
    queryKey: ["poll", poll.token],
  });

  const decide = useMutation({
    mutationFn: (slotId: string) =>
      decidePoll({ calendarId, pollId: poll.id, slotId }),
    onSuccess: onDecided,
  });

  const data = answers.data;
  // The leader is highlighted, never auto-picked: two times can tie, and the
  // choice is the organizer's to make.
  const best = data
    ? Math.max(0, ...data.slots.map((slot) => slot.yes.length))
    : 0;

  return (
    <div className={styles.content}>
      <div className={styles.linkRow}>
        <input aria-label="Poll link" className={styles.linkField} readOnly value={poll.url} />
        <Button
          icon={<Copy size={15} strokeWidth={1.6} />}
          size="compact"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              .writeText(poll.url)
              .then(() => onNotice("Link copied."))
              .catch(() => onNotice("Could not copy — select the link instead."));
          }}
        >
          Copy
        </Button>
      </div>

      {data?.closed ? (
        <p className={styles.decided}>This poll is decided.</p>
      ) : null}

      <div className={styles.list}>
        {data?.slots.map((slot) => (
          <div
            className={styles.result}
            data-leading={
              !data.closed && best > 0 && slot.yes.length === best ? "" : undefined
            }
            key={slot.id}
          >
            <div>
              <p className={styles.resultWhen}>
                {new Intl.DateTimeFormat(undefined, {
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  month: "short",
                  weekday: "short",
                }).format(slot.start)}
              </p>
              <p className={styles.resultWho}>
                {slot.yes.length > 0 ? `Yes: ${slot.yes.join(", ")}` : "No yes yet"}
                {slot.ifNeeded.length > 0
                  ? ` · If needed: ${slot.ifNeeded.join(", ")}`
                  : ""}
              </p>
            </div>
            {data.closed ? null : (
              <Button
                disabled={!calendarId}
                loading={decide.isPending && decide.variables === slot.id}
                size="compact"
                variant="secondary"
                onClick={() => decide.mutate(slot.id)}
              >
                Pick this
              </Button>
            )}
          </div>
        ))}
      </div>

      {decide.error ? (
        <p className={styles.error} role="alert">
          {decide.error.message}
        </p>
      ) : null}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <DialogClose>
          <Button variant="secondary">Done</Button>
        </DialogClose>
      </div>
    </div>
  );
}
