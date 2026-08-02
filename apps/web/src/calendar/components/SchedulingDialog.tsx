import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, Plus, X } from "lucide-react";
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
import { Field } from "~/ui/Field";
import { PollDayPicker } from "./PollDayPicker";
import { RowAction } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import styles from "./styles/scheduling.module.css";

/** Sensible meeting lengths. A free number field invites 37-minute meetings. */
const DURATIONS = [15, 30, 45, 60, 90];

/**
 * Matches the API's cap. Beyond this a poll stops being a question and becomes a
 * survey — and the grid people have to answer stops fitting on a phone.
 */
const MAX_POLL_SLOTS = 60;

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
  weekStartsOn,
}: {
  calendars: Calendar[];
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement | null>;
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
      closeLabel="Close scheduling"
      description="Offer a few times, send the link, and see what suits everyone."
      onOpenChange={onOpenChange}
      open
      returnFocus={returnFocus}
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
  weekStartsOn,
}: {
  onCreated: (poll: PollSummary) => void;
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const [title, setTitle] = useState("");
  const [durationMinutes, setDuration] = useState(60);
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>(["18:00"]);
  const [newTime, setNewTime] = useState("");

  // Days × times. Written out because it is what the poll actually asks, and
  // because seeing "6 days × 2 times = 12 options" is what stops somebody
  // producing sixty by accident.
  const slots = days.flatMap((day) =>
    times.map((time) => ({ start: new Date(`${day}T${time}`).toISOString() })),
  );
  const tooMany = slots.length > MAX_POLL_SLOTS;

  const create = useMutation({
    mutationFn: () =>
      createPoll({ durationMinutes, slots, title: title.trim() }),
    onSuccess: onCreated,
  });

  const ready = title.trim().length > 0 && slots.length > 0 && !tooMany;

  return (
    <section className={styles.section}>
      <SectionLabel level={3}>New poll</SectionLabel>
      <div className={styles.form}>
        <Field label="What is it about">
          <input
            placeholder="Studio planning"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Which days</span>
          <PollDayPicker
            onChange={setDays}
            selected={days}
            weekStartsOn={weekStartsOn}
          />
          {days.length > 0 ? (
            <button
              className={styles.clear}
              type="button"
              onClick={() => setDays([])}
            >
              Clear {days.length} {days.length === 1 ? "day" : "days"}
            </button>
          ) : null}
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>At what time</span>
          {/* One set of times for every chosen day. That is the whole trick for
              a long horizon: three weeks of evenings is three weeks and one
              time, not twenty-one rows. */}
          <div className={styles.times}>
            {times.map((time) => (
              <Button
                aria-label={`Remove ${time}`}
                icon={<X size={13} strokeWidth={1.8} />}
                key={time}
                size="compact"
                variant="secondary"
                onClick={() =>
                  setTimes((current) => current.filter((item) => item !== time))
                }
              >
                {time}
              </Button>
            ))}
            <input
              aria-label="Add a time"
              className={styles.timeInput}
              type="time"
              value={newTime}
              onChange={(event) => setNewTime(event.target.value)}
            />
            <Button
              disabled={!newTime || times.includes(newTime)}
              icon={<Plus size={14} strokeWidth={1.8} />}
              size="compact"
              variant="secondary"
              onClick={() => {
                setTimes((current) => [...current, newTime].sort());
                setNewTime("");
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <fieldset className={styles.durations}>
          <legend>How long</legend>
          {DURATIONS.map((minutes) => (
            <Button
              aria-pressed={durationMinutes === minutes}
              key={minutes}
              size="compact"
              variant={durationMinutes === minutes ? "primary" : "secondary"}
              onClick={() => setDuration(minutes)}
            >
              {minutes} min
            </Button>
          ))}
        </fieldset>

        <p className={tooMany ? styles.error : styles.summary}>
          {slots.length === 0
            ? "Pick at least one day and one time."
            : `${days.length} ${days.length === 1 ? "day" : "days"} × ${times.length} ${
                times.length === 1 ? "time" : "times"
              } = ${slots.length} options${
                tooMany
                  ? ` — ${MAX_POLL_SLOTS} is the most a poll can ask about`
                  : ""
              }`}
        </p>

        {create.error ? (
          <p className={styles.error} role="alert">
            {create.error.message}
          </p>
        ) : null}

        <Button
          disabled={!ready}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Create the poll
        </Button>
      </div>
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
