import type {
	PatchSettingsRequest,
	Settings,
	SettingsDocument,
	SettingsPatch,
} from "@musubi/types";
import { SettingsConflictError } from "@/services/api";
import { useSettingsStore } from "@/store/useSettingsStore";

type SettingsApi = {
	getSettingsDocument: () => Promise<SettingsDocument>;
	patchSettings: (request: PatchSettingsRequest) => Promise<SettingsDocument>;
};

type PendingPatch = { generation: number; patch: SettingsPatch };

let generation = 0;
let queue: Promise<void> = Promise.resolve();
const pending: PendingPatch[] = [];

function sameValue(left: unknown, right: unknown) {
	return Array.isArray(left) && Array.isArray(right)
		? left.length === right.length &&
				left.every((value, index) => value === right[index])
		: left === right;
}

function patchAlreadyApplied(current: Settings, patch: SettingsPatch) {
	return (Object.keys(patch) as Array<keyof Settings>).every((field) =>
		sameValue(current[field], patch[field]),
	);
}

function patchConflicts(
	base: Settings,
	current: Settings,
	patch: SettingsPatch,
) {
	return (Object.keys(patch) as Array<keyof Settings>).some(
		(field) =>
			!sameValue(base[field], current[field]) &&
			!sameValue(current[field], patch[field]),
	);
}

function pendingValues(
	entryGeneration: number,
	exclude?: PendingPatch,
): Partial<Settings> {
	return Object.assign(
		{},
		...pending
			.filter(
				(entry) => entry.generation === entryGeneration && entry !== exclude,
			)
			.map((entry) => entry.patch),
	);
}

function newest(document: SettingsDocument) {
	const tracked = useSettingsStore.getState().settingsDocument;
	return tracked && tracked.revision > document.revision ? tracked : document;
}

export async function refreshSettingsDocument(api: SettingsApi) {
	const started = generation;
	const response = await api.getSettingsDocument();
	if (started !== generation) return response;
	const document = newest(response);
	useSettingsStore
		.getState()
		.loadSettingsDocument(document, pendingValues(started));
	return document;
}

async function save(api: SettingsApi, entry: PendingPatch) {
	let base = useSettingsStore.getState().settingsDocument;
	if (!base) base = await refreshSettingsDocument(api);
	if (entry.generation !== generation) return;

	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const document = await api.patchSettings({
				baseRevision: base.revision,
				patch: entry.patch,
			});
			if (entry.generation !== generation) return;
			useSettingsStore
				.getState()
				.loadSettingsDocument(
					newest(document),
					pendingValues(entry.generation),
				);
			return;
		} catch (error) {
			if (entry.generation !== generation) return;
			if (!(error instanceof SettingsConflictError)) {
				const authoritative =
					useSettingsStore.getState().settingsDocument ?? base;
				useSettingsStore
					.getState()
					.loadSettingsDocument(
						authoritative,
						pendingValues(entry.generation, entry),
					);
				throw error;
			}

			const current = newest(await api.getSettingsDocument());
			if (entry.generation !== generation) return;
			if (patchAlreadyApplied(current.value, entry.patch)) {
				useSettingsStore
					.getState()
					.loadSettingsDocument(
						current,
						pendingValues(entry.generation, entry),
					);
				return;
			}
			if (
				patchConflicts(base.value, current.value, entry.patch) ||
				attempt === 2
			) {
				useSettingsStore
					.getState()
					.loadSettingsDocument(
						current,
						pendingValues(entry.generation, entry),
					);
				throw error;
			}

			useSettingsStore
				.getState()
				.loadSettingsDocument(current, pendingValues(entry.generation));
			base = current;
		}
	}
}

export function queueSettingsPatch(api: SettingsApi, patch: SettingsPatch) {
	const entry = { generation, patch };
	pending.push(entry);
	const result = queue.then(() => save(api, entry));
	const remove = () => {
		const index = pending.indexOf(entry);
		if (index >= 0) pending.splice(index, 1);
	};
	queue = result.then(remove, remove);
	return result;
}

export function resetSettingsSync() {
	generation += 1;
	queue = Promise.resolve();
	pending.length = 0;
	useSettingsStore.getState().clearSettingsDocument();
}
