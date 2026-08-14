import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { getInvitePreview, joinCalendar } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { useSessionUser } from "~/auth/use-session-user";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { toDateKey } from "~/calendar/date-key";
import { AuthMessage, AuthShell, AuthSubmit, AuthSwitch } from "~/ui/AuthShell";
import { Avatar } from "~/ui/Avatar";
import { RouteState } from "~/ui/RouteState";
import styles from "./invite.module.css";

// Same shape the API's own invite page accepts, so a link that opens here is a
// link that would have opened there.
const TOKEN_PATTERN = /^[0-9a-f-]{16,64}$/i;

/** How far ahead the "what's on it" glance looks, matching the phone app. */
const PREVIEW_WINDOW_DAYS = 30;
const PREVIEW_EVENT_LIMIT = 4;

export const Route = createFileRoute("/invite/$token")({
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const { user } = useSessionUser();
  const valid = TOKEN_PATTERN.test(token);

  const preview = useQuery({
    enabled: valid,
    queryFn: ({ signal }) => getInvitePreview(token, signal),
    // The token is the credential, so this is the same answer for everyone who
    // holds the link — including someone not signed in yet.
    queryKey: ["invite", token],
    retry: false,
  });

  const join = useMutation({
    mutationFn: (calendarId: string) => joinCalendar(calendarId, token),
    onSuccess: () => {
      const origin = getServerOrigin();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.calendars(origin, user?.id ?? "anonymous"),
      });
      void navigate({
        params: { pageId: "default", view: "month" },
        search: { date: toDateKey(new Date()) },
        to: "/app/p/$pageId/$view",
      });
    },
  });

  if (!valid) {
    return (
      <AuthShell
        eyebrow="Invitation"
        introduction="Check that you copied the whole link, or ask for a new one."
        title="That link is not an invitation."
        utility={<ThemeToggle />}
      >
        <AuthMessage>
          An invitation link ends in a long code, like /invite/8f14e45f…
        </AuthMessage>
      </AuthShell>
    );
  }

  if (preview.isPending) {
    return (
      <RouteState
        busy
        description="Reading who shared it and what is on it."
        eyebrow="Invitation"
        title="Opening the invitation…"
      />
    );
  }

  if (preview.isError) {
    return (
      <AuthShell
        eyebrow="Invitation"
        footer={
          <AuthSwitch action="Try again" onAction={() => void preview.refetch()}>
            Was that a hiccup?
          </AuthSwitch>
        }
        // An invite is single-use and expires, so "gone" is the likeliest reason
        // and worth saying before blaming the network.
        introduction="It may have already been used, or it has expired. Ask whoever shared the calendar for a fresh link."
        title="This invitation is no longer open."
        utility={<ThemeToggle />}
      >
        <AuthMessage>{preview.error.message}</AuthMessage>
      </AuthShell>
    );
  }

  const calendar = preview.data;
  // Anchored to when the preview was fetched, not to render time: `Date.now()`
  // during render is impure, and a list that re-filters on every keystroke of a
  // parent re-render would flicker for no reason.
  const now = preview.dataUpdatedAt;
  const upcoming = calendar.events
    .filter(
      (event) =>
        event.end.getTime() >= now &&
        event.start.getTime() <= now + PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    )
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const sharedBy = calendar.members.at(0);

  return (
    <AuthShell
      eyebrow="Invitation"
      footer={
        session.data ? (
          <AuthSwitch
            action="Not now"
            onAction={() =>
              void navigate({
                params: { pageId: "default", view: "month" },
                search: { date: toDateKey(new Date()) },
                to: "/app/p/$pageId/$view",
              })
            }
          >
            Rather decide later?
          </AuthSwitch>
        ) : (
          <AuthSwitch
            action="Sign in"
            onAction={() =>
              void navigate({
                search: { redirect: `/invite/${token}` },
                to: "/login",
              })
            }
          >
            Already have an account on this server?
          </AuthSwitch>
        )
      }
      introduction={
        sharedBy
          ? `${sharedBy.name} shared a calendar with you.`
          : "Someone shared a calendar with you."
      }
      title={calendar.name}
      utility={<ThemeToggle />}
    >
      <div className={styles.card}>
        <div className={styles.identity}>
          <span
            aria-hidden="true"
            className={styles.swatch}
            style={{ background: calendar.color }}
          />
          <div>
            <p className={styles.name}>{calendar.name}</p>
            <p className={styles.detail}>
              {calendar.members.length === 1
                ? "1 person"
                : `${calendar.members.length} people`}
            </p>
          </div>
        </div>

        {calendar.members.length > 0 ? (
          <ul aria-label="People on this calendar" className={styles.people}>
            {calendar.members.slice(0, 6).map((member) => (
              <li className={styles.person} key={member.id}>
                <Avatar image={member.image} name={member.name} size={26} />
                <span>{member.name}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {upcoming.length > 0 ? (
          <div>
            <p className={styles.sectionLabel}>Next up</p>
            <ul className={styles.events}>
              {upcoming.slice(0, PREVIEW_EVENT_LIMIT).map((event) => (
                <li key={event.id}>
                  <span className={styles.eventDate}>
                    {event.start.toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                  <span className={styles.eventTitle}>{event.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={styles.detail}>Nothing scheduled in the next month.</p>
        )}
      </div>

      {session.data ? (
        <>
          <AuthSubmit
            loading={join.isPending}
            onClick={() => join.mutate(calendar.id)}
            type="button"
          >
            {join.isPending ? "Joining…" : "Join this calendar"}
          </AuthSubmit>
          <AuthMessage>
            {join.error
              ? `${join.error.message} The invitation is still open — try again.`
              : ""}
          </AuthMessage>
        </>
      ) : (
        <>
          {/* Accepting writes membership, so it needs an account on THIS server.
              Sending them to sign up with the token in hand means they come
              straight back here rather than to an empty calendar. */}
          <AuthSubmit
            onClick={() =>
              void navigate({
                search: { redirect: `/invite/${token}` },
                to: "/login",
              })
            }
            type="button"
          >
            Create an account to join
          </AuthSubmit>
          {/* A note, not a failure — AuthMessage is the error colour. */}
          <p className={styles.hint}>
            Already using Musubi on another server? Paste this link into
            Connections there, and the calendar joins your own account instead.
          </p>
        </>
      )}
    </AuthShell>
  );
}
