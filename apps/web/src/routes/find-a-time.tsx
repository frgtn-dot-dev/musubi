import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import type { PollSummary } from "~/api/contracts";
import { createPoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { PollForm } from "~/calendar/components/PollForm";
import { BrandMark } from "~/components/BrandMark";
import { EmailIdentity } from "~/components/EmailIdentity";
import { CopyField } from "~/ui/CopyField";
import styles from "~/components/public-page.module.css";

const TITLE = "Find a time everyone can make — Musubi";
const DESCRIPTION =
  "Offer a few days, send one link, and see who can make what. No app to install; email keeps every answer yours.";

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

/** Making a poll after a passwordless email check. */
function FindATimeRoute() {
  const session = authClient.useSession();
  const [poll, setPoll] = useState<PollSummary>();
  const [identified, setIdentified] = useState(false);
  const [identifying, setIdentifying] = useState(false);

  const create = useMutation({
    mutationFn: createPoll,
    onSuccess: setPoll,
  });

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
            grid. The people you ask confirm an email and never hand over their
            calendar — only the answers they type.
          </p>
        </header>

        {poll ? (
          <Created poll={poll} />
        ) : (!session.data && !identified) || identifying ? (
          <EmailIdentity
            disclosure={
              <p className={styles.lead}>
                Confirm your email first. Existing accounts keep their saved
                name; new accounts need one name for the people you invite.
              </p>
            }
            onIdentified={() => {
              setIdentifying(false);
              setIdentified(true);
            }}
            onStart={() => setIdentifying(true)}
          />
        ) : (
          <PollForm
            busy={create.isPending}
            error={create.error?.message}
            submitLabel="Create the poll"
            /* A stranger has no settings yet, so this page states its own
               defaults rather than pretending to know them. */
            timeFormat="24h"
            weekStartsOn="monday"
            onSubmit={(draft) => create.mutate(draft)}
          />
        )}
      </article>

      <p className={styles.footer}>
        {/* "/" resolves the default page for whoever is signed in, so this one
            link works for a brand-new account and an old one alike. */}
        <Link to="/">Open your calendar</Link> · Musubi is open source and
        self-hostable
      </p>
    </main>
  );
}

/** The link, which is the whole product of this page. */
function Created({ poll }: { poll: PollSummary }) {
  return (
    <section className={styles.step}>
      <h2>
        <Check aria-hidden="true" size={17} strokeWidth={2} /> “{poll.title}” is
        ready
      </h2>
      <p className={styles.lead}>
        Send this link to the people you need. Answers appear as they arrive,
        and you pick the time when you have enough of them.
      </p>
      <CopyField label="Poll link" value={poll.url} />
      <p className={styles.lead}>
        It is also in your calendar under “Find a time”, together with any other
        polls you make.
      </p>
    </section>
  );
}
