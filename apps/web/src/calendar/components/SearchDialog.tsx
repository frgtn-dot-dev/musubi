import type { Event } from "@musubi/types";
import { ArrowRight, CalendarDays, Search } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { Dialog } from "~/ui/Dialog";
import { offeredViews, type CalendarViewId } from "../view-registry";
import styles from "./styles/search-dialog.module.css";

const eventDate = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
	weekday: "short",
});

type SearchDialogProps = {
	activeView: CalendarViewId;
	canCreateEvents: boolean;
	events: Event[];
	inputRef: RefObject<HTMLInputElement | null>;
	onCreateEvent: () => void;
	onEventSelect: (event: Event) => void;
	onOpenChange: (open: boolean) => void;
	onToday: () => void;
	onViewChange: (view: CalendarViewId) => void;
	open: boolean;
	query: string;
	returnFocus: RefObject<HTMLElement | null>;
	setQuery: (query: string) => void;
};

/** One fast place for finding an event or running a calendar action. */
export function SearchDialog({
	activeView,
	canCreateEvents,
	events,
	inputRef,
	onCreateEvent,
	onEventSelect,
	onOpenChange,
	onToday,
	onViewChange,
	open,
	query,
	returnFocus,
	setQuery,
}: SearchDialogProps) {
	const normalized = query.trim().toLocaleLowerCase();
	const actions = [
		...(canCreateEvents
			? [{ label: "New event", onSelect: onCreateEvent }]
			: []),
		{ label: "Go to today", onSelect: onToday },
		...offeredViews().map((view) => ({
			label: `Switch to ${view.label}`,
			onSelect: () => onViewChange(view.id as CalendarViewId),
		})),
	].filter((action) =>
		action.label.toLocaleLowerCase().includes(normalized),
	);
	const matches = normalized
		? events
				.filter((event) =>
					[event.title, event.location]
						.filter(Boolean)
						.some((value) => value!.toLocaleLowerCase().includes(normalized)),
				)
				.slice(0, 8)
		: [];

	function run(action: () => void) {
		onOpenChange(false);
		action();
	}

	function moveResultFocus(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const results = Array.from(
			event.currentTarget.querySelectorAll<HTMLButtonElement>(
				"[data-search-result]",
			),
		);
		if (results.length === 0) return;
		const current = results.indexOf(document.activeElement as HTMLButtonElement);
		const offset = event.key === "ArrowDown" ? 1 : -1;
		const next = (current + offset + results.length) % results.length;
		event.preventDefault();
		results[next]?.focus();
	}

	return (
		<Dialog
			bodyClassName={styles.body}
			closeLabel="Close search"
			description="Find an event or run a calendar action."
			initialFocus={inputRef}
			onOpenChange={onOpenChange}
			open={open}
			returnFocus={returnFocus}
			title="Search Musubi"
		>
			<label className={styles.searchBox}>
				<Search aria-hidden="true" size={18} strokeWidth={1.6} />
				<span className={styles.visuallyHidden}>Search events and actions</span>
				<input
					aria-label="Search events and actions"
					placeholder="Search events and actions"
					ref={inputRef}
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
						const results = event.currentTarget
							.closest('[role="dialog"]')
							?.querySelectorAll<HTMLButtonElement>("[data-search-result]");
						const target =
							event.key === "ArrowDown" ? results?.[0] : results?.[results.length - 1];
						if (!target) return;
						event.preventDefault();
						target.focus();
					}}
				/>
				<kbd>/</kbd>
			</label>

			<div className={styles.results} onKeyDown={moveResultFocus}>
				{actions.length > 0 ? (
					<section aria-labelledby="search-actions-title">
						<h2 id="search-actions-title">Actions</h2>
						<div className={styles.resultList}>
							{actions.map((action) => (
								<button
									className={styles.result}
									data-search-result
									key={action.label}
									type="button"
									onClick={() => run(action.onSelect)}
								>
									<ArrowRight aria-hidden="true" size={16} />
									<span>{action.label}</span>
									{action.label === `Switch to ${offeredViews().find((view) => view.id === activeView)?.label}` ? (
										<small>Current</small>
									) : null}
								</button>
							))}
						</div>
					</section>
				) : null}

				{normalized ? (
					<section aria-labelledby="search-events-title">
						<h2 id="search-events-title">Events</h2>
						{matches.length > 0 ? (
							<div className={styles.resultList}>
								{matches.map((event) => (
									<button
										className={styles.result}
										data-search-result
										key={event.id}
										type="button"
										onClick={() => run(() => onEventSelect(event))}
									>
										<CalendarDays aria-hidden="true" size={16} />
										<span>{event.title}</span>
										<small>{eventDate.format(event.start)}</small>
									</button>
								))}
							</div>
						) : (
							<p className={styles.empty}>No matching events in this view.</p>
						)}
					</section>
				) : (
					<p className={styles.hint}>Type to find events in the loaded calendar range.</p>
				)}
			</div>
		</Dialog>
	);
}
