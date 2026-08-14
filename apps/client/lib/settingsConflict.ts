export class SettingsConflictError extends Error {
	constructor() {
		super("Settings changed on another device.");
		this.name = "SettingsConflictError";
	}
}
