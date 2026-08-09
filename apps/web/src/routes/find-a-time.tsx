import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Info } from "lucide-react";
import { useState } from "react";
import type { PollSummary } from "~/api/contracts";
import { createPoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import type { PollDraft } from "~/calendar/components/PollForm";
import { PollForm } from "~/calendar/components/PollForm";
import { BrandMark } from "~/components/BrandMark";
import { EmailIdentity } from "~/components/EmailIdentity";
import { Button } from "~/ui/Button";
import styles from "~/components/public-page.module.css";

const TITLE = "Find a time everyone can make — Musubi";
const DESCRIPTION =
  "Offer a few days and times, send one link, and see who can make what. No app to install, no password to invent.";

export const Route = createFileRoute("/find-a-time")({
  component: FindATimeRoute,
  head: () => ({
    meta: [
      { title: TITLE },
      { content: DESCRIPTION, name: "description" },
      // Indexable on purpose, unlike a poll or an event page: this one is the
      // door, and the pages behind it are private coordination.
      { content: "index, follow", name: "robots" },
      { content: TITLE, property: "og:title" },
      { content: DESCRIPTION, property: "og:description" },
      { content: "website", property: "og:type" },
    ],
  }),
});

/**
 * Making a poll without having an account first.
 *
 * The order is what makes it worth having: the question is built, and only then
 * is an address asked for — a stranger sees the whole thing they are about to
 * make before being asked for anything. Confirming the code creates the account
 * on the way past, the same passwordless one that answering a poll creates.
 *
 * Signed in already? Then there is nothing to ask, and the poll is created on the
 * first press.
 */
function FindATimeRoute() {
  const session = authClient.useSession();
  const [draft, setDraft] = useState<PollDraft>();
  const [poll, setPoll] = useState<PollSummary>();
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: createPoll,
    onSuccess: setPoll,
  });

  function submit(next: PollDraft) {
    if (session.data) {
      create.mutate(next);
      return;
    }
    // Held here, not sent: nothing is created until an address is confirmed.
    setDraft(next);
  }

  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <div className={styles.themeRow}>
        <ThemeToggle />
      </div>

      <article className={styles.card}>
        <header className={styles.header}>
          <span aria-hidden="true" className={styles.brand}>
            <BrandMark focusable="false" />
          </span>
          <h1>Find a time everyone can make</h1>
          <p className={styles.lead}>
            Offer a few days, send one link, and watch the answers land in a
            grid. The people you ask need no account and never hand over
            their calendar — only the answers they type.
          </p>
        </header>

        {poll ? (
          <Created poll={poll} copied={copied} onCopied={setCopied} />
        ) : draft && !session.data ? (
          <section className={styles.step}>
            <h2>Last thing: who is asking?</h2>
            {/* What is about to be made, before an address is handed over. The
                draft was held on this page and could only be checked by going
                back to the form, which is a poor way to review a thing you are
                one press from creating. */}
            <DraftSummary draft={draft} />
            <EmailIdentity
              askName
              busy={create.isPending}
              confirmLabel="Confirm and create the poll"
              disclosure={
                <p className={styles.disclosure}>
                  <Info aria-hidden="true" size={14} strokeWidth={1.7} />
                  Confirming the code makes you a Musubi account with no password,
                  and creates the poll. Your name is shown to the people you
                  invite; your address is not.
                </p>
              }
              onIdentified={(name) =>
                create.mutate({ ...draft, name: name || undefined })
              }
            />
            <button
              className={styles.back}
              type="button"
              onClick={() => setDraft(undefined)}
            >
              Change the days
            </button>
          </section>
        ) : (
          <PollForm
            busy={create.isPending}
            error={create.error?.message}
            submitLabel={session.data ? "Create the poll" : "Continue"}
            /* A stranger has no settings yet, so this page states its own
               defaults rather than pretending to know them. */
            timeFormat="24h"
            weekStartsOn="monday"
            onSubmit={submit}
          />
        )}
      </article>

      <p className={styles.footer}>
        {/* "/" resolves the default page for whoever is signed in, so this one
            link works for a brand-new account and an old one alike. */}
        <a href="/">Open your calendar</a>{" "}
        · Musubi is open source and self-hostable
      </p>
    </main>
  );
}

/** The poll as it stands, read back in a sentence or two. */
function DraftSummary({ draft }: { draft: PollDraft }) {
  const starts = draft.slots.map((slot) => new Date(slot.start));
  const days = [...new Set(starts.map((start) => dayLabel(start)))];

  return (
    <dl className={styles.summary}>
      <dt>Asking about</dt>
      <dd>{draft.title}</dd>
      <dt>{days.length === 1 ? "Day" : "Days"}</dt>
      <dd>{days.join(", ")}</dd>
      {draft.approximateStartTime ? (
        <>
          <dt>Approximate start</dt>
          <dd>{draft.approximateStartTime}</dd>
        </>
      ) : null}
    </dl>
  );
}

function dayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);
}


/** The link, which is the whole product of this page. */
function Created({
  copied,
  onCopied,
  poll,
}: {
  copied: boolean;
  onCopied: (copied: boolean) => void;
  poll: PollSummary;
}) {
  return (
    <section className={styles.step}>
      <h2>
        <Check aria-hidden="true" size={17} strokeWidth={2} /> “{poll.title}” is
        ready
      </h2>
      <p className={styles.lead}>
        Send this link to the people you need. Answers appear as they arrive, and
        you pick the time when you have enough of them.
      </p>
      <div className={styles.linkRow}>
        <input
          aria-label="Poll link"
          className={styles.linkField}
          readOnly
          value={poll.url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          icon={<Copy size={14} strokeWidth={1.8} />}
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(poll.url);
            onCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className={styles.lead}>
        It is also in your calendar under “Find a time”, together with any other
        polls you make.
      </p>
    </section>
  );
}
