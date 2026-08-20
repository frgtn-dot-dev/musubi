import type { Settings, SettingsDocument } from "@musubi/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const base: Settings = {
	calendarOrder: ["home"],
	dateFormat: "dmy",
	defaultCalendarView: "month",
	notificationsOnByDefault: true,
	onboarded: true,
	tabBarLabels: true,
	theme: "system",
	timeFormat: "24h",
	weekStartsOn: "monday",
};

const fake = vi.hoisted(() => {
	class Conflict extends Error {}
	let state: any;
	const loadSettingsDocument = (
		document: SettingsDocument,
		optimistic: Partial<Settings> = {},
	) => {
		if (state.settingsDocument?.revision > document.revision) return;
		state = {
			...state,
			...document.value,
			...optimistic,
			settingsDocument: document,
		};
	};
	return {
		Conflict,
		getState: () => state,
		reset(document: SettingsDocument) {
			state = {
				...document.value,
				clearSettingsDocument: () => {
					state = { ...state, settingsDocument: null };
				},
				loadSettingsDocument,
				settingsDocument: document,
			};
		},
		set(patch: Partial<Settings>) {
			state = { ...state, ...patch };
		},
	};
});

vi.mock("@/lib/settingsConflict", () => ({ SettingsConflictError: fake.Conflict }));
vi.mock("@/store/useSettingsStore", () => ({
	useSettingsStore: { getState: fake.getState },
}));

const { queueSettingsPatch, refreshSettingsDocument, resetSettingsSync } =
	await import("./settingsSync");

function document(revision: number, value: Settings = base): SettingsDocument {
	return { revision, updatedAt: new Date(revision), value };
}

describe("mobile settings sync", () => {
	beforeEach(() => {
		fake.reset(document(1));
		resetSettingsSync();
		fake.reset(document(1));
	});

	it("preserves an optimistic patch when a refresh finishes during its request", async () => {
		let finish!: (value: SettingsDocument) => void;
		const patchResponse = new Promise<SettingsDocument>((resolve) => {
			finish = resolve;
		});
		const api = {
			getSettingsDocument: vi.fn(async () => document(1)),
			patchSettings: vi.fn(() => patchResponse),
		};

		fake.set({ theme: "dark" });
		const saving = queueSettingsPatch(api, { theme: "dark" });
		await refreshSettingsDocument(api);
		expect(fake.getState().theme).toBe("dark");

		finish(document(2, { ...base, theme: "dark" }));
		await saving;
	});

	it("does not let an older conflict rollback clobber a newer queued edit", async () => {
		const remote = document(2, { ...base, theme: "light" });
		const api = {
			getSettingsDocument: vi.fn(async () => remote),
			patchSettings: vi
				.fn()
				.mockRejectedValueOnce(new fake.Conflict())
				.mockResolvedValueOnce(
					document(3, { ...remote.value, theme: "system" }),
				),
		};

		fake.set({ theme: "dark" });
		const first = queueSettingsPatch(api, { theme: "dark" });
		fake.set({ theme: "system" });
		const second = queueSettingsPatch(api, { theme: "system" });

		await expect(first).rejects.toBeInstanceOf(fake.Conflict);
		await second;
		expect(fake.getState().theme).toBe("system");
	});

	it("retries consecutive conflicts when remote changes are unrelated", async () => {
		const remoteTheme = document(2, { ...base, theme: "dark" });
		const remoteFormat = document(3, { ...remoteTheme.value, dateFormat: "ymd" });
		const api = {
			getSettingsDocument: vi
				.fn()
				.mockResolvedValueOnce(remoteTheme)
				.mockResolvedValueOnce(remoteFormat),
			patchSettings: vi
				.fn()
				.mockRejectedValueOnce(new fake.Conflict())
				.mockRejectedValueOnce(new fake.Conflict())
				.mockResolvedValueOnce(
					document(4, {
						...remoteFormat.value,
						weekStartsOn: "sunday",
					}),
				),
		};

		fake.set({ weekStartsOn: "sunday" });
		await queueSettingsPatch(api, { weekStartsOn: "sunday" });

		expect(api.patchSettings).toHaveBeenCalledTimes(3);
		expect(fake.getState().weekStartsOn).toBe("sunday");
	});

	it("accepts a lower revision after account reset", async () => {
		fake.reset(document(10, { ...base, theme: "dark" }));
		resetSettingsSync();
		const api = {
			getSettingsDocument: vi.fn(async () =>
				document(1, { ...base, theme: "light" }),
			),
			patchSettings: vi.fn(),
		};

		await refreshSettingsDocument(api);

		expect(fake.getState().settingsDocument.revision).toBe(1);
		expect(fake.getState().theme).toBe("light");
	});
});
