import { Check, ChevronDown } from "lucide-react";
import {
	forwardRef,
	type ButtonHTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
	useId,
	useRef,
	useState,
} from "react";
import { classNames } from "./class-names";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import styles from "./primitives.module.css";

export type SelectOption = {
	description?: ReactNode;
	disabled?: boolean;
	icon?: ReactNode;
	label: ReactNode;
	/** Plain text used for keyboard typeahead and the closed trigger. */
	textValue?: string;
	value: string;
};

export type SelectProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"children" | "defaultValue" | "onChange" | "value"
> & {
	label: string;
	onChange: (value: string) => void;
	options: readonly SelectOption[];
	placeholder?: string;
	size?: "compact" | "default";
	value: string;
};

function optionText(option: SelectOption) {
	if (option.textValue) return option.textValue;
	return typeof option.label === "string" ? option.label : option.value;
}

/**
 * A select-only combobox with one consistent Musubi surface on every platform.
 * Focus moves into the list while it is open, which keeps arrow navigation and
 * typeahead predictable for keyboard and screen-reader users.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(
	function Select(
		{
			className,
			disabled = false,
			label,
			onChange,
			options,
			placeholder = "Choose an option",
			size = "default",
			value,
			...triggerProps
		},
		forwardedRef,
	) {
		const generatedId = useId();
		const triggerRef = useRef<HTMLButtonElement | null>(null);
		const optionRefs = useRef(new Map<string, HTMLButtonElement>());
		const typeahead = useRef({ at: 0, query: "" });
		const [open, setOpen] = useState(false);
		const [activeValue, setActiveValue] = useState(value);
		const enabledOptions = options.filter((option) => !option.disabled);
		const selectedOption = options.find((option) => option.value === value);
		const initialValue =
			(selectedOption && !selectedOption.disabled
				? selectedOption.value
				: enabledOptions[0]?.value) ?? "";
		const listboxId = `${generatedId}-listbox`;
		const titleId = `${generatedId}-title`;

		function setTriggerRef(node: HTMLButtonElement | null) {
			triggerRef.current = node;
			if (typeof forwardedRef === "function") forwardedRef(node);
			else if (forwardedRef) forwardedRef.current = node;
		}

		function focusOption(nextValue: string) {
			setActiveValue(nextValue);
			requestAnimationFrame(() => {
				const option = optionRefs.current.get(nextValue);
				option?.focus();
				option?.scrollIntoView?.({ block: "nearest" });
			});
		}

		function beginOpen(nextValue = initialValue) {
			setActiveValue(nextValue);
			setOpen(true);
		}

		function choose(nextValue: string) {
			const option = options.find((item) => item.value === nextValue);
			if (!option || option.disabled) return;
			onChange(nextValue);
			setActiveValue(nextValue);
			setOpen(false);
			requestAnimationFrame(() => triggerRef.current?.focus());
		}

		function moveActive(key: "ArrowDown" | "ArrowUp" | "End" | "Home") {
			if (enabledOptions.length === 0) return;
			const currentIndex = enabledOptions.findIndex(
				(option) => option.value === activeValue,
			);
			const lastIndex = enabledOptions.length - 1;
			let nextIndex: number;

			if (key === "Home") nextIndex = 0;
			else if (key === "End") nextIndex = lastIndex;
			else if (key === "ArrowDown") {
				nextIndex =
					currentIndex < 0 ? 0 : Math.min(lastIndex, currentIndex + 1);
			} else {
				nextIndex =
					currentIndex < 0 ? lastIndex : Math.max(0, currentIndex - 1);
			}

			focusOption(enabledOptions[nextIndex]!.value);
		}

		function matchTypeahead(character: string) {
			const now = Date.now();
			const previous = typeahead.current;
			const query =
				now - previous.at < 700 ? `${previous.query}${character}` : character;
			typeahead.current = { at: now, query };

			const startIndex = Math.max(
				0,
				enabledOptions.findIndex((option) => option.value === activeValue) + 1,
			);
			const ordered = [
				...enabledOptions.slice(startIndex),
				...enabledOptions.slice(0, startIndex),
			];
			const normalized = query.toLocaleLowerCase();
			const match =
				ordered.find((option) =>
					optionText(option).toLocaleLowerCase().startsWith(normalized),
				) ??
				(query.length > 1 && new Set(query).size === 1
					? ordered.find((option) =>
							optionText(option)
								.toLocaleLowerCase()
								.startsWith(character.toLocaleLowerCase()),
						)
					: undefined);

			if (match) {
				if (!open) beginOpen(match.value);
				else focusOption(match.value);
			}
		}

		function handleTypeahead(event: KeyboardEvent) {
			if (
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.key.length !== 1 ||
				event.key === " "
			) {
				return false;
			}
			event.preventDefault();
			matchTypeahead(event.key);
			return true;
		}

		return (
			<Popover
				open={open}
				onOpenChange={(nextOpen) => {
					if (nextOpen) beginOpen();
					else setOpen(false);
				}}
			>
				<PopoverTrigger asChild>
					<button
						{...triggerProps}
						aria-controls={listboxId}
						aria-expanded={open}
						aria-haspopup="listbox"
						aria-label={triggerProps["aria-label"] ?? label}
						className={classNames(
							styles.select,
							size === "compact" && styles.select_compact,
							className,
						)}
						disabled={disabled}
						ref={setTriggerRef}
						role="combobox"
						type="button"
						onKeyDown={(event) => {
							triggerProps.onKeyDown?.(event);
							if (event.defaultPrevented) return;

							if (event.key === "ArrowDown" || event.key === "ArrowUp") {
								event.preventDefault();
								beginOpen();
							} else if (event.key === "Home" || event.key === "End") {
								event.preventDefault();
								beginOpen(
									event.key === "Home"
										? (enabledOptions[0]?.value ?? "")
										: (enabledOptions.at(-1)?.value ?? ""),
								);
							} else {
								handleTypeahead(event);
							}
						}}
					>
						<span className={styles.selectValue}>
							{selectedOption?.icon ? (
								<span aria-hidden="true" className={styles.selectValueIcon}>
									{selectedOption.icon}
								</span>
							) : null}
							<span>
								{selectedOption ? optionText(selectedOption) : placeholder}
							</span>
						</span>
						<ChevronDown
							aria-hidden="true"
							className={styles.selectChevron}
							size={16}
							strokeWidth={1.5}
						/>
					</button>
				</PopoverTrigger>
				{open ? (
					<PopoverContent
						align="start"
						aria-labelledby={titleId}
						className={styles.selectPopover}
						side="bottom"
						sideOffset={6}
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							requestAnimationFrame(() =>
								optionRefs.current.get(activeValue || initialValue)?.focus(),
							);
						}}
					>
						<h2 className={styles.selectSheetTitle} id={titleId}>
							{label}
						</h2>
						<div
							aria-label={`${label} options`}
							className={classNames(
								styles.selectList,
								options.length > 8 && styles.selectListScrollable,
							)}
							id={listboxId}
							role="listbox"
						>
							{options.map((option) => {
								const selected = option.value === value;
								const active = option.value === activeValue;

								return (
									<button
										aria-selected={selected}
										className={styles.selectOption}
										data-active={active ? "" : undefined}
										disabled={option.disabled}
										key={option.value}
										ref={(node) => {
											if (node) optionRefs.current.set(option.value, node);
											else optionRefs.current.delete(option.value);
										}}
										role="option"
										tabIndex={active ? 0 : -1}
										type="button"
										onClick={() => choose(option.value)}
										onFocus={() => setActiveValue(option.value)}
										onKeyDown={(event) => {
											if (
												event.key === "ArrowDown" ||
												event.key === "ArrowUp" ||
												event.key === "Home" ||
												event.key === "End"
											) {
												event.preventDefault();
												moveActive(event.key);
											} else if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												choose(option.value);
											} else {
												handleTypeahead(event);
											}
										}}
									>
										<span
											aria-hidden={!option.icon || undefined}
											className={styles.selectOptionIcon}
										>
											{option.icon}
										</span>
										<span className={styles.selectOptionCopy}>
											<span>{option.label}</span>
											{option.description ? (
												<small>{option.description}</small>
											) : null}
										</span>
										<Check
											aria-hidden="true"
											className={styles.selectOptionCheck}
											size={16}
											strokeWidth={1.8}
										/>
									</button>
								);
							})}
						</div>
					</PopoverContent>
				) : null}
			</Popover>
		);
	},
);
