// Dependency-free RRULE helpers shared by the web and mobile event editors.
// The editors deliberately support a small, predictable RFC 5545 subset; raw
// imported rules outside it must round-trip untouched until explicitly replaced.

export type RecurrenceOption =
	| "none"
	| "daily"
	| "weekly"
	| "weekdays"
	| "monthly"
	| "yearly"
	| "custom";
export type AdvancedFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type AdvancedEndType = "never" | "count";

export type AdvancedRRuleConfig = {
	freq: AdvancedFreq;
	interval: number;
	/** JavaScript weekday numbers: Sunday = 0, Saturday = 6. */
	days: Set<number>;
	endType: AdvancedEndType;
	count: number;
	/** Existing absolute end carried until Never/After is explicitly chosen. */
	until?: string;
};

const FREQS = new Set<AdvancedFreq>(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_MAP = new Map(RRULE_DAYS.map((day, index) => [day, index]));
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EDITABLE_KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL"]);

function clampInteger(value: number, minimum: number, maximum: number) {
	return Math.min(
		maximum,
		Math.max(minimum, Number.isFinite(value) ? Math.trunc(value) : minimum),
	);
}

function bareRRule(rrule: string) {
	return rrule.trim().replace(/^RRULE:/, "");
}

function ruleParts(rrule: string) {
	return bareRRule(rrule)
		.split(";")
		.map((part) => part.split("=", 2) as [string, string | undefined]);
}

/** True only when every clause can be represented by the shared editor UI. */
export function isEditableRRule(rrule: string | null | undefined): boolean {
	if (!rrule || rrule.includes("\n")) return false;
	const parts = ruleParts(rrule);
	const seen = new Set<string>();
	const values = new Map<string, string>();

	for (const [key, value] of parts) {
		if (!value || !EDITABLE_KEYS.has(key) || seen.has(key)) return false;
		seen.add(key);
		values.set(key, value);
	}

	const freq = values.get("FREQ") as AdvancedFreq | undefined;
	if (!freq || !FREQS.has(freq)) return false;
	if (values.has("COUNT") && values.has("UNTIL")) return false;
	const interval = values.get("INTERVAL");
	if (
		interval &&
		(!/^\d+$/.test(interval) || Number(interval) < 1 || Number(interval) > 99)
	)
		return false;
	const count = values.get("COUNT");
	if (
		count &&
		(!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 999)
	)
		return false;
	if (values.has("UNTIL") && !/^\d{8}T\d{6}Z$/.test(values.get("UNTIL")!))
		return false;

	const byDay = values.get("BYDAY");
	if (byDay) {
		if (freq !== "WEEKLY") return false;
		const days = byDay.split(",");
		if (days.length === 0 || new Set(days).size !== days.length) return false;
		if (days.some((day) => !DAY_MAP.has(day as (typeof RRULE_DAYS)[number])))
			return false;
	}

	return true;
}

export function buildRRule(
	option: RecurrenceOption,
	startDate: Date,
	advanced: AdvancedRRuleConfig,
): string | null {
	switch (option) {
		case "none":
			return null;
		case "daily":
			return "FREQ=DAILY";
		case "weekly":
			return `FREQ=WEEKLY;BYDAY=${RRULE_DAYS[startDate.getDay()]}`;
		case "weekdays":
			return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
		case "monthly":
			return "FREQ=MONTHLY";
		case "yearly":
			return "FREQ=YEARLY";
		case "custom": {
			const interval = clampInteger(advanced.interval, 1, 99);
			const count = clampInteger(advanced.count, 1, 999);
			let rule = `FREQ=${advanced.freq}`;
			if (interval > 1) rule += `;INTERVAL=${interval}`;
			if (advanced.freq === "WEEKLY") {
				const days = [...advanced.days]
					.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
					.sort((left, right) => left - right);
				rule += `;BYDAY=${days.length > 0 ? days.map((day) => RRULE_DAYS[day]).join(",") : RRULE_DAYS[startDate.getDay()]}`;
			}
			if (advanced.endType === "count") rule += `;COUNT=${count}`;
			else if (advanced.until) rule += `;UNTIL=${advanced.until}`;
			return rule;
		}
	}
}

export function parseRRule(rrule: string | null | undefined): RecurrenceOption {
	if (!rrule) return "none";
	const rule = bareRRule(rrule);
	if (rule === "FREQ=DAILY") return "daily";
	if (rule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
	if (
		rule === "FREQ=WEEKLY" ||
		/^FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$/.test(rule)
	)
		return "weekly";
	if (rule === "FREQ=MONTHLY") return "monthly";
	if (rule === "FREQ=YEARLY") return "yearly";
	return "custom";
}

export function parseAdvanced(
	rrule: string | null | undefined,
	defaultDay = 1,
): AdvancedRRuleConfig {
	const fallbackDay = clampInteger(defaultDay, 0, 6);
	const values = new Map(
		ruleParts(rrule ?? "").filter(([, value]) => value) as Array<
			[string, string]
		>,
	);
	const parsedFreq = values.get("FREQ") as AdvancedFreq | undefined;
	const parsedDays = values
		.get("BYDAY")
		?.split(",")
		.map((day) => DAY_MAP.get(day as (typeof RRULE_DAYS)[number]))
		.filter((day): day is number => day !== undefined);
	const interval = Number.parseInt(values.get("INTERVAL") ?? "1", 10);
	const count = Number.parseInt(values.get("COUNT") ?? "10", 10);

	return {
		freq: parsedFreq && FREQS.has(parsedFreq) ? parsedFreq : "WEEKLY",
		interval: clampInteger(interval, 1, 99),
		days: new Set(parsedDays?.length ? parsedDays : [fallbackDay]),
		endType: values.has("COUNT") ? "count" : "never",
		count: clampInteger(count, 1, 999),
		until: values.get("UNTIL"),
	};
}

export function describeAdvanced(config: AdvancedRRuleConfig): string {
	const labels: Record<AdvancedFreq, [string, string]> = {
		DAILY: ["day", "days"],
		WEEKLY: ["week", "weeks"],
		MONTHLY: ["month", "months"],
		YEARLY: ["year", "years"],
	};
	const [singular, plural] = labels[config.freq];
	let summary =
		config.interval === 1
			? `Every ${singular}`
			: `Every ${config.interval} ${plural}`;
	if (config.freq === "WEEKLY" && config.days.size > 0) {
		summary += ` on ${[...config.days]
			.sort((left, right) => left - right)
			.map((day) => DAY_NAMES[day])
			.join(", ")}`;
	}
	if (config.endType === "count") {
		summary += `, ${config.count} time${config.count === 1 ? "" : "s"}`;
	} else if (config.until) {
		summary += `, until ${config.until.slice(0, 4)}-${config.until.slice(4, 6)}-${config.until.slice(6, 8)}`;
	}
	return summary;
}

/** Split stored recurrence into the bare RRULE and any extra lines. */
export function splitRecurrence(recurrence: string | null | undefined): {
	rrule: string;
	extras: string[];
} {
	if (!recurrence) return { rrule: "", extras: [] };
	const lines = recurrence
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const rruleLine = lines.find((line) => /^(RRULE:)?FREQ=/.test(line)) ?? "";
	return {
		rrule: rruleLine.replace(/^RRULE:/, ""),
		extras: lines.filter((line) => line !== rruleLine),
	};
}

/** Rebuild stored recurrence; multiline output needs an explicit RRULE prefix. */
export function joinRecurrence(
	rrule: string | null,
	extras: string[],
): string | null {
	if (!rrule) return null;
	if (extras.length === 0) return rrule;
	return [`RRULE:${rrule}`, ...extras].join("\n");
}
