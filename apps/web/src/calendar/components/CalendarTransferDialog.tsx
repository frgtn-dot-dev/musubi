import {
	can,
	DEFAULT_CALENDAR_COLOR,
	providerDisplayName,
	providerFlavor,
	type Calendar,
} from "@musubi/types";
import {
	Download,
	FileUp,
	Pencil,
	Plus,
	Trash2,
	Unlink,
	Users,
} from "lucide-react";
import {
	type ChangeEvent,
	type FormEvent,
	type RefObject,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ImportedCalendar } from "~/api/contracts";
import { ApiError, ApiResponseError } from "~/api/http";
import {
	groupCalendars,
	type CalendarSourceGroup,
} from "~/calendar/calendar-groups";
import { Button, IconButton } from "~/ui/Button";
import { ColorPicker } from "~/ui/ColorPicker";
import {
	ConfirmationDialog,
	ConfirmationNotice,
	DialogError,
} from "~/ui/ConfirmationDialog";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { Row } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { Select } from "~/ui/Select";
import { connectionOfCalendar } from "../federation-routing";
import { AccountMark } from "./ProviderIcon";
import styles from "./styles/calendars.module.css";

type ImportInput = {
	color: string;
	ics: string;
	name: string;
};

export type CalendarTransferDialogProps = {
	calendars: Calendar[];
	onCreate: (input: {
		accountId?: string;
		color: string;
		name: string;
		provider?: string;
	}) => Promise<Calendar>;
	onDisconnect: (calendar: Calendar) => Promise<unknown>;
	onExport: (calendarId: string, connectionId?: string) => Promise<string>;
	onImport: (input: ImportInput) => Promise<ImportedCalendar>;
	onManageMembers: (calendar: Calendar) => void;
	onNotice: (message: string) => void;
	onOpenChange: (open: boolean) => void;
	onRemove: (calendar: Calendar) => Promise<Calendar>;
	onUpdate: (calendar: Calendar) => Promise<Calendar>;
	open: boolean;
};

type TransferError = {
	message: string;
	requestId?: string;
};

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function transferError(error: unknown, fallback: string): TransferError {
	return {
		message: error instanceof Error ? error.message : fallback,
		requestId:
			error instanceof ApiError || error instanceof ApiResponseError
				? error.requestId
				: undefined,
	};
}

function exportFilename(calendar: Calendar) {
	return `${calendar.name.replace(/[^\w.-]+/g, "_") || "calendar"}.ics`;
}

function calendarDetail(calendar: Calendar, external: boolean) {
	if (calendar.syncStatus === "reconnect_required") {
		return "Reconnect this account in Connections";
	}
	if (external) {
		return `Managed in ${providerDisplayName(calendar)}`;
	}

	const access =
		calendar.role === "owner"
			? "You own this calendar"
			: calendar.role === "editor"
				? // Not "edit this calendar": an editor can add and change events but not
					// rename or recolour the calendar itself (`packages/types/permissions`),
					// and the row shows no rename button to match.
					"You can add and change events"
				: "View only";
	return calendar.isDefault ? `Personal calendar · ${access}` : access;
}

export function CalendarTransferDialog({
	calendars,
	onCreate,
	onDisconnect,
	onExport,
	onImport,
	onManageMembers,
	onNotice,
	onOpenChange,
	onRemove,
	onUpdate,
	open,
}: CalendarTransferDialogProps) {
	const [exportCalendarId, setExportCalendarId] = useState(
		calendars[0]?.id ?? "",
	);
	const [importName, setImportName] = useState("");
	const [importColor, setImportColor] = useState<string>(
		DEFAULT_CALENDAR_COLOR,
	);
	const [importFileName, setImportFileName] = useState("");
	const [ics, setIcs] = useState("");
	const [newName, setNewName] = useState("");
	const [newColor, setNewColor] = useState<string>(DEFAULT_CALENDAR_COLOR);
	// "" is this server. Anything else is `provider:accountId`.
	const [destinationKey, setDestinationKey] = useState("");
	const [editCalendar, setEditCalendar] = useState<Calendar>();
	const [deleteCalendar, setDeleteCalendar] = useState<Calendar>();
	const [disconnectCalendar, setDisconnectCalendar] = useState<Calendar>();
	const [deleteError, setDeleteError] = useState<TransferError>();
	const [disconnectError, setDisconnectError] = useState<TransferError>();
	const [busy, setBusy] = useState<
		"export" | "import" | "create" | "delete" | "disconnect"
	>();
	const [error, setError] = useState<TransferError>();
	const editReturnFocusRef = useRef<HTMLButtonElement>(null);
	const deleteReturnFocusRef = useRef<HTMLButtonElement>(null);
	const disconnectReturnFocusRef = useRef<HTMLButtonElement>(null);
	const groups = groupCalendars(calendars);
	/**
	 * The accounts a new calendar can be made in.
	 *
	 * Read off the calendars already synced, the same way the phone does it: an
	 * account with no calendar in it has nothing to hang a label on, and the sync
	 * engine gives every connected account at least its default one.
	 */
	const accounts = useMemo(() => {
		const seen = new Map<
			string,
			{ accountId: string; flavor: string | null; label: string; provider: string }
		>();
		for (const calendar of calendars) {
			if (!calendar.provider || !calendar.accountId) continue;
			if (connectionOfCalendar(calendar)) continue; // another Musubi server
			const key = `${calendar.provider}:${calendar.accountId}`;
			if (seen.has(key)) continue;
			seen.set(key, {
				accountId: calendar.accountId,
				flavor: providerFlavor(calendar),
				label: calendar.accountLabel?.trim() || providerDisplayName(calendar),
				provider: calendar.provider,
			});
		}

		return [...seen.values()];
	}, [calendars]);
	const destination = accounts.find(
		(account) => `${account.provider}:${account.accountId}` === destinationKey,
	);
	const selectedExportId = calendars.some(
		(calendar) => calendar.id === exportCalendarId,
	)
		? exportCalendarId
		: (calendars[0]?.id ?? "");

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			setEditCalendar(undefined);
			setDeleteCalendar(undefined);
			setDisconnectCalendar(undefined);
			setError(undefined);
			setDeleteError(undefined);
			setDisconnectError(undefined);
		}
		onOpenChange(nextOpen);
	}

	async function handleFile(changeEvent: ChangeEvent<HTMLInputElement>) {
		const file = changeEvent.target.files?.[0];
		setError(undefined);

		if (!file) {
			setIcs("");
			setImportFileName("");
			return;
		}

		if (file.size > MAX_IMPORT_BYTES) {
			setError({ message: "Choose an .ics file smaller than 10 MB." });
			changeEvent.target.value = "";
			return;
		}

		const text = await file.text();
		setIcs(text);
		setImportFileName(file.name);
		if (!importName) {
			setImportName(file.name.replace(/\.ics$/i, ""));
		}
	}

	async function handleCreate(submitEvent: FormEvent<HTMLFormElement>) {
		submitEvent.preventDefault();
		if (!newName.trim()) {
			setError({ message: "Name the new calendar." });
			return;
		}
		setBusy("create");
		setError(undefined);
		try {
			const calendar = await onCreate({
				accountId: destination?.accountId,
				color: newColor,
				name: newName.trim(),
				provider: destination?.provider,
			});
			onNotice(
				destination
					? `${calendar.name} created in ${destination.label}.`
					: `${calendar.name} created.`,
			);
			setNewName("");
			setNewColor(DEFAULT_CALENDAR_COLOR);
		} catch (createError) {
			setError(transferError(createError, "Could not create the calendar."));
		} finally {
			setBusy(undefined);
		}
	}

	async function handleDelete() {
		if (!deleteCalendar) return;
		setBusy("delete");
		setDeleteError(undefined);
		try {
			await onRemove(deleteCalendar);
			onNotice(`${deleteCalendar.name} deleted.`);
			if (exportCalendarId === deleteCalendar.id) {
				setExportCalendarId("");
			}
			setDeleteCalendar(undefined);
		} catch (removeError) {
			setDeleteError(
				transferError(removeError, "Could not delete the calendar."),
			);
		} finally {
			setBusy(undefined);
		}
	}

	async function handleDisconnect() {
		if (!disconnectCalendar) return;
		setBusy("disconnect");
		setDisconnectError(undefined);
		try {
			await onDisconnect(disconnectCalendar);
			onNotice(`Stopped syncing ${disconnectCalendar.name}.`);
			if (exportCalendarId === disconnectCalendar.id) {
				setExportCalendarId("");
			}
			setDisconnectCalendar(undefined);
		} catch (disconnectFailure) {
			setDisconnectError(
				transferError(
					disconnectFailure,
					"Could not stop syncing this calendar.",
				),
			);
		} finally {
			setBusy(undefined);
		}
	}

	async function handleImport(submitEvent: FormEvent<HTMLFormElement>) {
		submitEvent.preventDefault();
		if (!ics.trim() || !importName.trim()) {
			setError({ message: "Choose an .ics file and calendar name." });
			return;
		}

		setBusy("import");
		setError(undefined);
		try {
			const calendar = await onImport({
				color: importColor,
				ics,
				name: importName.trim(),
			});
			onNotice(
				`Imported ${calendar.imported} event${
					calendar.imported === 1 ? "" : "s"
				} into ${calendar.name}.`,
			);
			handleOpenChange(false);
		} catch (importError) {
			setError(transferError(importError, "Could not import this calendar."));
		} finally {
			setBusy(undefined);
		}
	}

	async function handleExport() {
		const calendar = calendars.find((item) => item.id === selectedExportId);
		if (!calendar) return;

		setBusy("export");
		setError(undefined);
		try {
			const text = await onExport(calendar.id, connectionOfCalendar(calendar));
			const url = URL.createObjectURL(
				new Blob([text], { type: "text/calendar;charset=utf-8" }),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = exportFilename(calendar);
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
			onNotice(`${calendar.name} exported.`);
		} catch (exportError) {
			setError(transferError(exportError, "Could not export this calendar."));
		} finally {
			setBusy(undefined);
		}
	}

	return (
		<>
			<Dialog
				bodyClassName={styles.body}
				bodyLayout="flush"
				bodyScroll="panels"
				closeLabel="Close calendars"
				description="Create and organize calendars from Musubi and your connected accounts."
				onOpenChange={handleOpenChange}
				open={open}
				size="spacious"
				title="Calendars"
			>
				<section className={styles.calendarSection}>
					<div className={styles.sectionHeading}>
						<div>
							<SectionLabel level={2}>Your calendars</SectionLabel>
							<p>Musubi calendars come first, followed by each account.</p>
						</div>
					</div>

					<form className={styles.createBar} onSubmit={handleCreate}>
						<label
							className={styles.visuallyHidden}
							htmlFor="new-calendar-name"
						>
							New calendar name
						</label>
						<input
							disabled={busy === "create"}
							id="new-calendar-name"
							placeholder="New calendar"
							value={newName}
							onChange={(event) => setNewName(event.target.value)}
						/>
						<Select
							className={styles.destination}
							disabled={busy === "create"}
							label="Account"
							options={[
								{
									description: "This Musubi server",
									icon: <AccountMark flavor={null} />,
									label: "Musubi",
									value: "",
								},
								...accounts.map((account) => ({
									description: providerDisplayName({ provider: account.provider }),
									icon: <AccountMark flavor={account.flavor} />,
									label: account.label,
									value: `${account.provider}:${account.accountId}`,
								})),
							]}
							value={destinationKey}
							onChange={setDestinationKey}
						/>
						<ColorPicker
							className={styles.formColorPicker}
							disabled={busy === "create"}
							label="New calendar color"
							/* Outlook accepts nine preset colours and nothing else, so the
                 picker follows the destination rather than offering a colour the
                 provider will refuse. */
							provider={destination?.provider ?? null}
							value={newColor}
							onChange={setNewColor}
						/>
						<Button
							icon={<Plus size={16} strokeWidth={1.8} />}
							loading={busy === "create"}
							type="submit"
						>
							Add
						</Button>
					</form>

					<div className={styles.groups}>
						{groups.map((group) => (
							<CalendarGroup
								busy={Boolean(busy)}
								disconnectingCalendarId={disconnectCalendar?.id}
								disconnectReturnFocus={disconnectReturnFocusRef}
								group={group}
								key={group.key}
								onDelete={(calendar, button) => {
									deleteReturnFocusRef.current = button;
									setDeleteError(undefined);
									setDeleteCalendar(calendar);
								}}
								onEdit={(calendar, button) => {
									editReturnFocusRef.current = button;
									setEditCalendar(calendar);
								}}
								onDisconnect={(calendar, button) => {
									disconnectReturnFocusRef.current = button;
									setDisconnectError(undefined);
									setDisconnectCalendar(calendar);
								}}
								onManageMembers={onManageMembers}
							/>
						))}
					</div>
				</section>

				<section className={styles.transferSection}>
					<div className={styles.sectionHeading}>
						<div>
							<SectionLabel level={2}>Move calendars</SectionLabel>
							<p>Use standard .ics files to take events in or out of Musubi.</p>
						</div>
					</div>

					<div className={styles.transferGrid}>
						<form
							className={styles.transferCard}
							onSubmit={(event) => {
								event.preventDefault();
								void handleExport();
							}}
						>
							<div className={styles.cardHeading}>
								<Download aria-hidden="true" size={18} strokeWidth={1.7} />
								<div>
									<h3>Export</h3>
									<p>Download one calendar and all its events.</p>
								</div>
							</div>
							<Field className={styles.cardField} label="Calendar to export">
								<Select
									disabled={Boolean(busy)}
									label="Calendar to export"
									options={calendars.map((calendar) => ({
											icon: (
												<span
													className={styles.calendarDot}
													style={{ backgroundColor: calendar.color }}
												/>
											),
											label: calendar.name,
											value: calendar.id,
										}))}
									value={selectedExportId}
									onChange={setExportCalendarId}
								/>
							</Field>
							<Button
								className={styles.cardAction}
								disabled={!selectedExportId}
								loading={busy === "export"}
								type="submit"
								variant="secondary"
							>
								Export .ics
							</Button>
						</form>

						<form className={styles.transferCard} onSubmit={handleImport}>
							<div className={styles.cardHeading}>
								<FileUp aria-hidden="true" size={18} strokeWidth={1.7} />
								<div>
									<h3>Import</h3>
									<p>Create a Musubi calendar from an .ics file.</p>
								</div>
							</div>
							<div className={styles.cardFieldGroup}>
								<span className={styles.cardControlLabel}>Calendar file</span>
								<label
									className={styles.fileControl}
									data-calendar-file-control=""
								>
									<span className={styles.fileCopy}>
										{importFileName || "No file selected"}
									</span>
									<span className={styles.fileButton}>Choose file</span>
									<input
										accept=".ics,text/calendar"
										aria-label="Choose .ics file"
										disabled={Boolean(busy)}
										required
										type="file"
										onChange={(event) => void handleFile(event)}
									/>
								</label>
							</div>
							<div className={styles.importControls}>
								<Field
									className={styles.cardField}
									label="Imported calendar name"
									labelHidden
								>
									<input
										disabled={Boolean(busy)}
										placeholder="Calendar name"
										required
										value={importName}
										onChange={(event) => setImportName(event.target.value)}
									/>
								</Field>
								<ColorPicker
									className={styles.formColorPicker}
									disabled={Boolean(busy)}
									label="Imported calendar color"
									value={importColor}
									onChange={setImportColor}
								/>
								<Button loading={busy === "import"} type="submit">
									Import
								</Button>
							</div>
						</form>
					</div>
				</section>

				{error ? <ErrorMessage error={error} /> : null}
			</Dialog>

			{editCalendar ? (
				<EditCalendarDialog
					calendar={editCalendar}
					onNotice={onNotice}
					onOpenChange={(nextOpen) => {
						if (!nextOpen) setEditCalendar(undefined);
					}}
					onUpdate={onUpdate}
					returnFocus={editReturnFocusRef}
				/>
			) : null}

			{deleteCalendar ? (
				<DeleteCalendarDialog
					busy={busy === "delete"}
					calendar={deleteCalendar}
					error={deleteError}
					onDelete={() => void handleDelete()}
					onOpenChange={(nextOpen) => {
						if (!nextOpen && busy !== "delete") {
							setDeleteCalendar(undefined);
							setDeleteError(undefined);
						}
					}}
					returnFocus={deleteReturnFocusRef}
				/>
			) : null}

			{disconnectCalendar ? (
				<DisconnectExternalCalendarDialog
					busy={busy === "disconnect"}
					calendar={disconnectCalendar}
					error={disconnectError}
					onDisconnect={() => void handleDisconnect()}
					onOpenChange={(nextOpen) => {
						if (!nextOpen && busy !== "disconnect") {
							setDisconnectCalendar(undefined);
							setDisconnectError(undefined);
						}
					}}
					returnFocus={disconnectReturnFocusRef}
				/>
			) : null}
		</>
	);
}

function CalendarGroup({
	busy,
	disconnectingCalendarId,
	disconnectReturnFocus,
	group,
	onDelete,
	onDisconnect,
	onEdit,
	onManageMembers,
}: {
	busy: boolean;
	disconnectingCalendarId?: string;
	disconnectReturnFocus: RefObject<HTMLButtonElement | null>;
	group: CalendarSourceGroup;
	onDelete: (calendar: Calendar, button: HTMLButtonElement) => void;
	onDisconnect: (calendar: Calendar, button: HTMLButtonElement) => void;
	onEdit: (calendar: Calendar, button: HTMLButtonElement) => void;
	onManageMembers: (calendar: Calendar) => void;
}) {
	return (
		<section
			aria-labelledby={`calendar-group-${group.key}`}
			className={styles.group}
		>
			<header className={styles.groupHeader}>
				<AccountMark flavor={group.flavor} />
				<div>
					<h3 id={`calendar-group-${group.key}`}>{group.title}</h3>
					<p>{group.detail}</p>
				</div>
			</header>
			<ul aria-label={`${group.title} calendars`} className={styles.list}>
				{group.calendars.map((calendar) => {
					const federatedId = connectionOfCalendar(calendar);
					const external = Boolean(calendar.provider) && !federatedId;
					// A synced calendar is editable and shareable like any other: the
					// server renames it on the provider first and refuses if the account
					// is not yours, so the rule lives there rather than being guessed here.
					const editable = can(calendar.role, "editCalendar");
					// Deleting a synced calendar deletes it on the provider. "Stop
					// syncing" is the reversible thing to offer, and it is right there.
					const deletable =
						editable &&
						!external &&
						!calendar.isDefault &&
						can(calendar.role, "deleteCalendar");

					return (
						<li key={calendar.id}>
							<Row
								className={styles.calendarRow}
								detail={calendarDetail(calendar, external)}
								icon={
									<span
										className={styles.calendarSwatch}
										data-calendar-swatch=""
										style={{ backgroundColor: calendar.color }}
									/>
								}
								label={
									<span className={styles.calendarName}>
										<span>{calendar.name}</span>
										{calendar.isDefault ? (
											<span className={styles.badge}>Personal</span>
										) : null}
									</span>
								}
								/* Three fixed slots — share, rename, remove — kept even when a
                   row has nothing to put in one. Right-aligning whatever a row
                   happened to have moved the same action to a different place on
                   every line, so "where do I share this?" had to be answered per
                   row instead of once per column. */
								trailing={
									<span className={styles.rowActions}>
										<span className={styles.rowActionSlot}>
											{federatedId ? null : (
												<IconButton
													disabled={busy}
													label={`Share ${calendar.name}`}
													size="compact"
													title="Members and sharing"
													onClick={() => onManageMembers(calendar)}
												>
													<Users size={16} strokeWidth={1.7} />
												</IconButton>
											)}
										</span>
										<span className={styles.rowActionSlot}>
											{editable ? (
												<IconButton
													disabled={busy}
													label={`Rename ${calendar.name}`}
													size="compact"
													title="Edit calendar"
													onClick={(event) =>
														onEdit(calendar, event.currentTarget)
													}
												>
													<Pencil size={15} strokeWidth={1.7} />
												</IconButton>
											) : null}
										</span>
										{/* Taking the calendar away, whichever form that takes here:
                        a synced one stops syncing, one of ours is deleted. */}
										<span className={styles.rowActionSlot}>
											{external ? (
												<IconButton
													disabled={busy}
													label={`Stop syncing ${calendar.name}`}
													ref={
														disconnectingCalendarId === calendar.id
															? disconnectReturnFocus
															: undefined
													}
													size="compact"
													title="Stop syncing calendar"
													variant="ghost"
													onClick={(event) =>
														onDisconnect(calendar, event.currentTarget)
													}
												>
													<Unlink size={15} strokeWidth={1.7} />
												</IconButton>
											) : deletable ? (
												<IconButton
													disabled={busy}
													label={`Delete ${calendar.name}`}
													size="compact"
													title="Delete calendar"
													variant="ghost"
													onClick={(event) =>
														onDelete(calendar, event.currentTarget)
													}
												>
													<Trash2 size={15} strokeWidth={1.7} />
												</IconButton>
											) : null}
										</span>
									</span>
								}
							/>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function EditCalendarDialog({
	calendar,
	onNotice,
	onOpenChange,
	onUpdate,
	returnFocus,
}: {
	calendar: Calendar;
	onNotice: (message: string) => void;
	onOpenChange: (open: boolean) => void;
	onUpdate: (calendar: Calendar) => Promise<Calendar>;
	returnFocus: RefObject<HTMLElement | null>;
}) {
	const [name, setName] = useState(calendar.name);
	const [color, setColor] = useState(calendar.color);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<TransferError>();
	const inputRef = useRef<HTMLInputElement>(null);
	const canSave =
		Boolean(name.trim()) &&
		(name.trim() !== calendar.name || color !== calendar.color);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSave) return;
		setBusy(true);
		setError(undefined);
		try {
			await onUpdate({ ...calendar, color, name: name.trim() });
			onNotice("Calendar updated.");
			onOpenChange(false);
		} catch (saveError) {
			setError(transferError(saveError, "Could not update the calendar."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			bodyLayout="flush"
			closeLabel="Close calendar editor"
			description="Change how this calendar is named and identified across Musubi."
			footer={
				<>
					<DialogClose>
						<Button disabled={busy} variant="secondary">
							Cancel
						</Button>
					</DialogClose>
					<Button
						disabled={!canSave}
						form="edit-calendar-form"
						loading={busy}
						type="submit"
					>
						Save
					</Button>
				</>
			}
			initialFocus={inputRef}
			onOpenChange={onOpenChange}
			open
			returnFocus={returnFocus}
			size="compact"
			title="Edit calendar"
		>
			<form
				id="edit-calendar-form"
				onSubmit={(event) => void handleSubmit(event)}
			>
				<Field label="Calendar name" variant="section">
					<input
						aria-label={`Rename ${calendar.name}`}
						disabled={busy}
						maxLength={80}
						ref={inputRef}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
				<Row
					className={styles.editColorRow}
					label="Color"
					trailing={
						<ColorPicker
							disabled={busy}
							label={`${calendar.name} color`}
							provider={calendar.provider}
							value={color}
							onChange={setColor}
						/>
					}
				/>
				{error ? <ErrorMessage error={error} compact /> : null}
			</form>
		</Dialog>
	);
}

function DeleteCalendarDialog({
	busy,
	calendar,
	error,
	onDelete,
	onOpenChange,
	returnFocus,
}: {
	busy: boolean;
	calendar: Calendar;
	error?: TransferError;
	onDelete: () => void;
	onOpenChange: (open: boolean) => void;
	returnFocus: RefObject<HTMLElement | null>;
}) {
	return (
		<ConfirmationDialog
			closeLabel="Close calendar deletion"
			confirmLabel="Delete calendar"
			description="The calendar and every event in it will be permanently removed."
			loading={busy}
			onConfirm={onDelete}
			onOpenChange={onOpenChange}
			open
			returnFocus={returnFocus}
			title={`Delete “${calendar.name}”?`}
		>
			<ConfirmationNotice icon={<Trash2 size={19} strokeWidth={1.7} />}>
				<p>
					This can’t be undone. Shared members will also lose access to{" "}
					<strong>{calendar.name}</strong>.
				</p>
			</ConfirmationNotice>
			{error ? (
				<DialogError requestId={error.requestId}>{error.message}</DialogError>
			) : null}
		</ConfirmationDialog>
	);
}

function DisconnectExternalCalendarDialog({
	busy,
	calendar,
	error,
	onDisconnect,
	onOpenChange,
	returnFocus,
}: {
	busy: boolean;
	calendar: Calendar;
	error?: TransferError;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
	returnFocus: RefObject<HTMLElement | null>;
}) {
	const provider = providerDisplayName(calendar);

	return (
		<ConfirmationDialog
			closeLabel="Close stop syncing confirmation"
			confirmLabel="Stop syncing"
			description="Its Musubi mirror and synced events will be removed."
			loading={busy}
			onConfirm={onDisconnect}
			onOpenChange={onOpenChange}
			open
			returnFocus={returnFocus}
			title={`Stop syncing “${calendar.name}”?`}
		>
			<ConfirmationNotice icon={<Unlink size={19} strokeWidth={1.7} />}>
				<strong>Your {provider} account stays connected.</strong>
				<p>
					{calendar.name} stays unchanged in {provider}. Other calendars from
					this account will continue syncing.
				</p>
			</ConfirmationNotice>
			{error ? (
				<DialogError requestId={error.requestId}>{error.message}</DialogError>
			) : null}
		</ConfirmationDialog>
	);
}

function ErrorMessage({
	compact = false,
	error,
}: {
	compact?: boolean;
	error: TransferError;
}) {
	return (
		<div className={compact ? styles.compactError : styles.error} role="alert">
			<p>{error.message}</p>
			{error.requestId ? <span>Request ID: {error.requestId}</span> : null}
		</div>
	);
}
