import { CalendarClock, Check, Clock3, UsersRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrandMark } from "~/components/BrandMark";
import { PageThemeToggle } from "~/calendar/components/ThemeToggle";
import { Avatar } from "~/ui/Avatar";
import { AvatarStack, type AvatarStackPerson } from "~/ui/AvatarStack";
import { Button, buttonClassName } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import styles from "./public-poll-page.module.css";

export type PublicPollVote = "yes" | "if-needed" | "no";

export type PublicPollOption = {
  counts: Record<PublicPollVote, number>;
  dateLabel: string;
  id: string;
  note?: string;
  start: string;
  timeLabel: string;
};

export type PublicPollParticipant = AvatarStackPerson & {
  responseLabel: string;
};

export type PublicPollPageProps = {
  answers: Record<string, PublicPollVote | null>;
  deadlineLabel: string;
  description: string;
  durationLabel: string;
  identityPrompt?: ReactNode;
  leadingOptionIds?: readonly string[];
  onAnswer: (optionId: string, answer: PublicPollVote | null) => void;
  onSubmit: () => void;
  options: PublicPollOption[];
  organizer: AvatarStackPerson;
  organizerNote?: string | null;
  participants: PublicPollParticipant[];
  selectedOptionId?: string;
  state: "open" | "answered" | "closed";
  submitDisabled?: boolean;
  submitError?: string | null;
  submitting?: boolean;
  title: string;
};

const VOTE_CHOICES: { label: string; value: PublicPollVote }[] = [
  { label: "Yes", value: "yes" },
  { label: "If needed", value: "if-needed" },
  { label: "No", value: "no" },
];

export function PublicPollPage({
  answers,
  deadlineLabel,
  description,
  durationLabel,
  identityPrompt,
  leadingOptionIds,
  onAnswer,
  onSubmit,
  options,
  organizer,
  organizerNote,
  participants,
  selectedOptionId,
  state,
  submitDisabled = false,
  submitError,
  submitting = false,
  title,
}: PublicPollPageProps) {
  const resultsVisible = state !== "open";
  const closed = state === "closed";
  const hasAnswer = Object.values(answers).some((answer) => answer !== null);
  const statusLabel = closed ? "Decided" : "Open for answers";
  const actionLabel = closed
    ? "View chosen time"
    : state === "answered"
      ? "Review your availability"
      : "Add availability";

  return (
    <div className={styles.page}>
      <header className={styles.siteHeader}>
        <a className={styles.brand} href="/" aria-label="Musubi home">
          <BrandMark className={styles.brandMark} />
          <span>Musubi</span>
        </a>
        <PageThemeToggle />
      </header>

      <main className={styles.main} id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="poll-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <CalendarClock aria-hidden="true" size={15} strokeWidth={1.7} />
              Scheduling poll
              <span aria-hidden="true">·</span>
              <span>{statusLabel}</span>
            </p>
            <h1 id="poll-title">{title}</h1>
            <p className={styles.description}>{description}</p>

            <dl className={styles.metadata}>
              <div>
                <dt>{closed ? "Status" : "Vote by"}</dt>
                <dd>{closed ? "Voting closed" : deadlineLabel}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 aria-hidden="true" size={14} /> Duration
                </dt>
                <dd>{durationLabel}</dd>
              </div>
              <div>
                <dt>
                  <UsersRound aria-hidden="true" size={14} /> Responses
                </dt>
                <dd>{participants.length}</dd>
              </div>
            </dl>
          </div>

          <aside className={styles.heroAside} aria-label="Poll summary">
            <div className={styles.organizer}>
              <Avatar
                image={organizer.image}
                name={organizer.name}
                size="default"
              />
              <span>
                <small>Organized by</small>
                <strong>{organizer.name}</strong>
              </span>
            </div>

            <p className={styles.noResponses}>
              {participants.length > 0
                ? `${participants.length} people have answered.`
                : "Be first to answer."}
            </p>

            <a
              className={buttonClassName({ className: styles.heroAction })}
              href={
                closed && selectedOptionId
                  ? `#option-${selectedOptionId}`
                  : "#availability"
              }
            >
              {actionLabel}
            </a>
          </aside>
        </section>

        <PollDetails
          organizerNote={organizerNote}
          participants={participants}
          resultsVisible={resultsVisible}
        />

        <section
          className={styles.availabilityCard}
          id="availability"
          aria-labelledby="availability-title"
        >
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionKicker}>Your response</p>
              <h2 id="availability-title">Which times work for you?</h2>
            </div>
            <p>
              {closed
                ? "Voting is closed. Your answers are shown below."
                : "Choose yes, if needed, or no for each useful option."}
            </p>
          </div>

          <div className={styles.optionList}>
            {options.map((option) => (
              <PollOptionRow
                answer={answers[option.id]}
                closed={closed}
                key={option.id}
                marker={
                  closed && option.id === selectedOptionId
                    ? "Chosen time"
                    : resultsVisible && leadingOptionIds?.includes(option.id)
                      ? "Best match"
                      : null
                }
                onAnswer={onAnswer}
                option={option}
                resultsVisible={resultsVisible}
              />
            ))}
          </div>

          {!closed ? (
            <div className={styles.submitRow}>
              <p>
                {state === "answered"
                  ? "Your saved response can be changed until voting closes."
                  : "Results appear after you send your availability."}
              </p>
              <Button
                disabled={!hasAnswer || submitDisabled}
                loading={submitting}
                onClick={onSubmit}
                type="button"
              >
                {state === "answered" ? "Save changes" : "Send availability"}
              </Button>
            </div>
          ) : null}

          {submitError ? (
            <p className={styles.submitError} role="alert">
              {submitError}
            </p>
          ) : null}
          {identityPrompt ? (
            <div className={styles.identityPrompt}>{identityPrompt}</div>
          ) : null}
        </section>
      </main>

      <footer className={styles.footer}>
        Published with <a href="/">Musubi</a>
      </footer>
    </div>
  );
}

function PollOptionRow({
  answer,
  closed,
  marker,
  onAnswer,
  option,
  resultsVisible,
}: {
  answer: PublicPollVote | null;
  closed: boolean;
  marker: "Best match" | "Chosen time" | null;
  onAnswer: (optionId: string, answer: PublicPollVote | null) => void;
  option: PublicPollOption;
  resultsVisible: boolean;
}) {
  return (
    <article
      className={styles.option}
      data-highlighted={marker ? "true" : undefined}
      id={`option-${option.id}`}
    >
      <div className={styles.optionTime}>
        <time dateTime={option.start}>
          <strong>{option.dateLabel}</strong>
          <span>{option.timeLabel}</span>
        </time>
        {option.note ? <small>{option.note}</small> : null}
      </div>

      <div className={styles.resultArea}>
        {marker ? (
          <span className={styles.bestMatch}>
            <Check aria-hidden="true" size={14} strokeWidth={2} />
            {marker}
          </span>
        ) : null}
        {resultsVisible ? <PollResult counts={option.counts} /> : null}
      </div>

      <fieldset className={styles.voteChoices} disabled={closed}>
        <legend className={styles.srOnly}>
          Availability for {option.dateLabel}, {option.timeLabel}
        </legend>
        {VOTE_CHOICES.map((choice) => (
          <Button
            aria-pressed={answer === choice.value}
            className={styles.voteChoice}
            key={choice.value}
            onClick={() =>
              onAnswer(option.id, answer === choice.value ? null : choice.value)
            }
            size="compact"
            type="button"
            variant="secondary"
          >
            {choice.label}
          </Button>
        ))}
      </fieldset>
    </article>
  );
}

function PollDetails({
  organizerNote,
  participants,
  resultsVisible,
}: {
  organizerNote?: string | null;
  participants: PublicPollParticipant[];
  resultsVisible: boolean;
}) {
  return (
    <div className={styles.detailsGrid}>
      {resultsVisible ? (
        <ParticipantSummary participants={participants} />
      ) : (
        <section
          className={styles.detailCard}
          aria-labelledby="private-results-title"
        >
          <div className={styles.detailHeading}>
            <h2 id="private-results-title">Results stay private for now</h2>
          </div>
          <p className={styles.detailCopy}>
            Send your availability first. You will then see the current best
            match and who has answered.
          </p>
        </section>
      )}

      <section
        className={styles.detailCard}
        aria-labelledby="organizer-note-title"
      >
        <div className={styles.detailHeading}>
          <h2 id="organizer-note-title">Note from organizer</h2>
        </div>
        <p className={styles.detailCopy}>
          {organizerNote?.trim() || "No additional note from the organizer."}
        </p>
      </section>
    </div>
  );
}

function ParticipantSummary({
  participants,
}: {
  participants: PublicPollParticipant[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section
        className={styles.detailCard}
        id="participants"
        aria-labelledby="participants-title"
      >
        <div className={styles.detailHeading}>
          <h2 id="participants-title">Participants</h2>
          <span>{participants.length}</span>
        </div>
        <p className={styles.participantSummary}>
          {participants.length} people have answered.
        </p>
        <AvatarStack
          className={styles.participantStack}
          label={`View ${participants.length} participants`}
          onClick={() => setOpen(true)}
          people={participants}
        />
      </section>

      <Dialog
        closeLabel="Close participants"
        description={`${participants.length} people have answered this poll.`}
        onOpenChange={setOpen}
        open={open}
        size="compact"
        title="Participants"
      >
        <ul className={styles.participantDialogList}>
          {participants.map((participant) => (
            <li key={participant.id}>
              <Avatar
                image={participant.image}
                name={participant.name}
                size="default"
              />
              <span>{participant.name}</span>
              <small>{participant.responseLabel}</small>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

function PollResult({ counts }: { counts: Record<PublicPollVote, number> }) {
  const total = counts.yes + counts["if-needed"] + counts.no;

  return (
    <div className={styles.pollResult}>
      <p>
        <span>{counts.yes} yes</span>
        <span>{counts["if-needed"]} if needed</span>
        <span>{counts.no} no</span>
      </p>
      <svg
        aria-hidden="true"
        className={styles.resultBar}
        preserveAspectRatio="none"
        viewBox={`0 0 ${Math.max(total, 1)} 1`}
      >
        <rect className={styles.yesBar} height="1" width={counts.yes} x="0" />
        <rect
          className={styles.maybeBar}
          height="1"
          width={counts["if-needed"]}
          x={counts.yes}
        />
        <rect
          className={styles.noBar}
          height="1"
          width={counts.no}
          x={counts.yes + counts["if-needed"]}
        />
      </svg>
    </div>
  );
}
