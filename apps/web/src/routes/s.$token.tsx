import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VoteValue } from "~/api/contracts";
import { getPoll, votePoll } from "~/api/resources";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { BrandMark } from "~/components/BrandMark";
import {
	formatDay,
	formatSlot,
	PollGrid,
	PollLegend,
} from "~/components/PollGrid";
import { EmailIdentity } from "~/components/EmailIdentity";
import { Button } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";
import styles from "./event-page.module.css";
import pollStyles from "./poll-page.module.css";

export const Route = createFileRoute("/s/$token")({
	component: PollRoute,
	head: () => ({
		// A poll is a private coordination between named people. Never indexed,
		// whatever the link is pasted into.
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
	const pollKey = ["poll", token];

	// `null` is "answered, then cleared" — different from a slot never touched,
	// which is what lets withdrawing one answer be sent rather than ignored.
	const gridScroller = useRef<HTMLDivElement>(null);
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
		mutationFn: (input: {
			email?: string;
			name?: string;
			votes: Array<{ slotID: string; value: VoteValue }>;
		}) => votePoll({ ...input, token }),
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
				/* Somewhere to go: without this the page is a wall. Whoever sent the link
           is the only one who can restore it, so the offer is the thing this
           reader can do on their own. */
				actions={
					<Link className={styles.secondaryLink} to="/find-a-time">
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
	const chosen = data.slots.find((slot) => slot.id === data.chosenSlotID);
	// What is on screen: their saved answers, with anything they have just clicked
	// laid over the top.
	const answers: Record<string, VoteValue | null> = { ...data.mine, ...draft };
	// What their own row is called. The projection wins over the session because it
	// is what everybody else sees, and it is already right the moment a name is
	// sent. "Guest" is the projection's placeholder for an empty name, so it counts
	// as no name at all — which is what puts the field back.
	const myRow = data.people.find((person) => person.id === data.mineID);
	const myName =
		(myRow && myRow.name !== "Guest" ? myRow.name : "") ||
		session.data?.user.name?.trim() ||
		"";
	const unsaved = Object.keys(draft).length > 0;


	function pick(slotID: string, value: null | VoteValue) {
		setDraft((current) => ({ ...current, [slotID]: value }));
	}

	function send() {
		vote.mutate({
			votes: Object.entries(answers)
				.filter(([, value]) => value !== null)
				.map(([slotID, value]) => ({ slotID, value: value! })),
		});
	}

	return (
		<main className={pollStyles.page} id="main-content" tabIndex={-1}>
			{/* A poll is a working page, not a poster: it follows the reader's system
          setting and lets them override it, like the app does. */}
			<div className={pollStyles.themeRow}>
				<ThemeToggle />
			</div>

			<article className={`${styles.card} ${pollStyles.card}`}>
				<header className={`${styles.header} ${pollStyles.hero}`}>
					<span aria-hidden="true" className={styles.brand}>
						<BrandMark focusable="false" />
					</span>
					<h1>{data.title}</h1>
					<p className={styles.organizer}>
						{data.respondents === 1
							? "1 person has answered"
							: `${data.respondents} people have answered`}
					</p>
					{data.viewerRole === "organizer" ? (
						<p className={styles.organizer}>You created this poll.</p>
					) : null}
				</header>

				{data.description ? (
					<p className={`${styles.description} ${pollStyles.description}`}>
						{data.description}
					</p>
				) : null}

				{chosen ? (
					<p className={pollStyles.decided}>
						<Check aria-hidden="true" size={15} strokeWidth={2} />
						Decided:{" "}
						{formatSlot(
							chosen,
							data.approximateStartTime,
							data.durationMinutes < 24 * 60,
						)}
					</p>
				) : data.closed ? (
					// Shut with nothing picked. Without this the grid is simply read-only
					// and a person clicks their row wondering why nothing happens.
					<p className={pollStyles.closedNote}>
						{data.deadline
							? `Answers closed on ${formatDay(data.deadline)}. Nothing has been picked yet.`
							: "This poll is closed to new answers. Nothing has been picked yet."}
					</p>
				) : data.deadline ? (
					<p className={pollStyles.closedNote}>
						Answers close on {formatDay(data.deadline)}.
					</p>
				) : null}

				{/* People down, days across — the same grid the organizer reads, so the
            person deciding and the people answering see one picture. */}
				<div className={pollStyles.answers}>
					<PollGrid
						answers={answers}
						approximateStartTime={data.approximateStartTime}
						/* Only the instruction survives: describing the grid to someone
						   looking straight at it is furniture. Somebody who has not answered
						   yet does need telling which row is theirs. */
						caption={
							data.closed || authenticatedViewer
								? undefined
								: "Confirm your email below to answer."
						}
						chosenSlotID={data.chosenSlotID}
						mineID={data.mineID}
						people={data.people}
						scrollerRef={gridScroller}
						personAction={undefined}
						showSlotTimes={data.durationMinutes < 24 * 60}
						slots={data.slots}
						yourRow={myName || "Your answers"}
						onAnswer={data.closed || !authenticatedViewer ? undefined : pick}
					/>

					<PollLegend scrollerRef={gridScroller} />

					{data.closed ? null : authenticatedViewer && !identifying ? (
						<div className={pollStyles.send}>
							<Button
								disabled={!unsaved}
								loading={vote.isPending}
								onClick={send}
							>
								{unsaved ? "Send my answers" : "Answers saved"}
							</Button>
							{vote.error ? (
								<p className={pollStyles.error} role="alert">
									{vote.error.message}
								</p>
							) : null}
						</div>
					) : (
						<EmailIdentity
							disclosure={
								<p className={pollStyles.disclosure}>
									<Info aria-hidden="true" size={14} strokeWidth={1.7} />
									Confirm your email to add your answers. Your email stays private
									and your calendar is never read.
								</p>
							}
							onIdentified={() => {
								setIdentifying(false);
								void getPoll(token).then((result) =>
									queryClient.setQueryData(pollKey, result),
								);
							}}
							onStart={() => setIdentifying(true)}
						/>
					)}
				</div>
			</article>

			<p className={styles.footer}>
				Published with <Link to="/">Musubi</Link>
			</p>
		</main>
	);
}
