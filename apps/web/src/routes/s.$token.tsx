import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Ellipsis, Info } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { VoteValue } from "~/api/contracts";
import { getServerOrigin } from "~/api/query-keys";
import { getPoll, getServerCapabilities, votePoll } from "~/api/resources";
import { ApiError } from "~/api/http";
import { authClient } from "~/auth/auth-client";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { BrandMark } from "~/components/BrandMark";
import {
	formatDay,
	formatSlot,
	PollGrid,
	PollLegend,
	PollNameField,
} from "~/components/PollGrid";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
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
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [sent, setSent] = useState(false);
	const [message, setMessage] = useState("");
	const [needsVerification, setNeedsVerification] = useState(false);
	const [editingName, setEditingName] = useState("");

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

	const capabilities = useQuery({
		enabled: needsVerification && !poll.data?.viewerRole,
		queryFn: ({ signal }) => getServerCapabilities(signal),
		queryKey: ["server-capabilities", getServerOrigin()],
		staleTime: 5 * 60_000,
	});

	const vote = useMutation({
		mutationFn: (input: {
			email?: string;
			name?: string;
			votes: Array<{ slotID: string; value: VoteValue }>;
		}) => votePoll({ ...input, token }),
		onError: (error) => {
			if (error instanceof ApiError && error.status === 403 && !poll.data?.viewerRole) {
				setNeedsVerification(true);
			}
		},
		onSuccess: (result) => {
			queryClient.setQueryData(pollKey, result);
			setDraft({});
			setNeedsVerification(false);
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

	async function requestCode(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setMessage("");
		const result = await authClient.emailOtp.sendVerificationOtp({
			email: email.trim().toLowerCase(),
			type: "sign-in",
		});
		if (result.error) {
			setMessage(result.error.message ?? "That code could not be sent.");
			return;
		}
		setSent(true);
	}

	async function confirmCode(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setMessage("");
		const result = await authClient.signIn.emailOtp({
			email: email.trim().toLowerCase(),
			otp: code.trim(),
		});
		if (result.error) {
			setMessage(result.error.message ?? "That code did not work.");
			return;
		}
		if (editingName) {
			queryClient.setQueryData(pollKey, await getPoll(token));
			setEditingName("");
			setNeedsVerification(false);
			setSent(false);
			return;
		}
		send();
	}

	function pick(slotID: string, value: null | VoteValue) {
		setDraft((current) => ({ ...current, [slotID]: value }));
	}

	function send() {
		vote.mutate({
			email: email.trim().toLowerCase() || undefined,
			// Sent with the answers so a link-only participant stops being "Guest" to
			// everyone else in the grid. A signed-in account keeps the name it has.
			name: name.trim() || myName || undefined,
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
							data.closed || Object.keys(answers).length > 0
								? undefined
								: "Fill in your own row — the last one — then send."
						}
						chosenSlotID={data.chosenSlotID}
						mineID={data.mineID}
						people={data.people}
						scrollerRef={gridScroller}
						personAction={
							authenticatedViewer
								? undefined
								: (person) => (
										<button
											aria-label={`Edit answers for ${person.name}`}
											className={pollStyles.editAnswers}
											title="Edit your answers"
											type="button"
											onClick={() => {
												setEditingName(person.name);
												setNeedsVerification(true);
												setMessage("");
											}}
										>
											<Ellipsis aria-hidden="true" size={17} />
										</button>
									)
						}
						showSlotTimes={data.durationMinutes < 24 * 60}
						slots={data.slots}
						yourRow={
							myName ? (
								myName
							) : (
								// Typed in the row it names, so it is obvious whose row it is.
								// Confirming the address still happens below — this only says who
								// to call you.
								<PollNameField onChange={setName} value={name} />
							)
						}
						onAnswer={data.closed ? undefined : pick}
					/>

					<PollLegend scrollerRef={gridScroller} />

					{data.closed ? null : authenticatedViewer ? (
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
					) : unsaved || editingName ? (
						<form
							className={styles.rsvpForm}
							onSubmit={(event) => {
								event.preventDefault();
								if (!needsVerification) send();
								else void (sent ? confirmCode(event) : requestCode(event));
							}}
						>
							{/* What leaves this browser, said before it does (PRD §19.1). */}
							<p className={pollStyles.disclosure}>
								<Info aria-hidden="true" size={14} strokeWidth={1.7} />
								{editingName
									? `Verify the email you used when answering as ${editingName}.`
									: needsVerification
										? "This email already has answers. Verify the inbox before changing them."
										: "You are sending your answers, name and email. Your email stays private and your calendar is never read."}
							</p>

							{needsVerification && capabilities.isPending ? (
								<p className={pollStyles.disclosure}>
									Checking email availability…
								</p>
							) : needsVerification && !capabilities.data?.email ? (
								<p className={pollStyles.error} role="alert">
									These answers already belong to this email. This server cannot
									send the verification code needed to edit them because SMTP is
									not configured.
								</p>
							) : sent ? (
								<Field label="Code from your email">
									<input
										autoComplete="one-time-code"
										inputMode="numeric"
										name="code"
										placeholder="123456"
										value={code}
										onChange={(event) => setCode(event.target.value)}
									/>
								</Field>
							) : (
								<Field label="Email">
									<input
										autoCapitalize="none"
										autoComplete="email"
										autoFocus={Boolean(editingName)}
										inputMode="email"
										name="email"
										placeholder="you@example.com"
										type="email"
										value={email}
										onChange={(event) => setEmail(event.target.value)}
									/>
								</Field>
							)}

							{message ? (
								<p className={pollStyles.error} role="alert">
									{message}
								</p>
							) : null}

							{needsVerification && !capabilities.data?.email ? null : (
								<Button loading={vote.isPending} type="submit">
									{needsVerification
										? sent
											? editingName
												? "Confirm and edit"
												: "Confirm and send"
											: "Send me a code"
										: "Send my answers"}
								</Button>
							)}
						</form>
					) : null}
				</div>
			</article>

			<p className={styles.footer}>
				Published with <Link to="/">Musubi</Link>
			</p>
		</main>
	);
}
