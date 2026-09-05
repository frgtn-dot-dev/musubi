import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";

const entries: string[] = [];

function inputUrl(input: RequestInfo | URL) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function safeTarget(input: RequestInfo | URL | string) {
	try {
		const url = new URL(typeof input === "string" ? input : inputUrl(input));
		return `${url.origin}${url.pathname}`;
	} catch {
		return String(input);
	}
}

export function recordServerDiagnostic(message: string) {
	const entry = `${new Date().toISOString()} ${message}`;
	entries.push(entry);
	if (entries.length > 40) entries.shift();
	if (typeof __DEV__ !== "undefined" && __DEV__)
		console.info(`[server-debug] ${message}`);
}

export function diagnosticFetchFor(serverOrigin: string) {
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const requestedUrl = new URL(inputUrl(input), serverOrigin);
		if (requestedUrl.origin !== serverOrigin) {
			throw new Error(
				`Blocked request outside selected server: ${requestedUrl.origin}`,
			);
		}
		const requested = safeTarget(requestedUrl);
		recordServerDiagnostic(`→ ${init?.method ?? "GET"} ${requested}`);
		try {
			const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
			headers.set(CLIENT_VERSION_HEADER, PRODUCT_VERSION);
			const response = await fetch(requestedUrl, { ...init, headers });
			recordServerDiagnostic(
				`← ${response.status} ${requested} => ${safeTarget(response.url)}`,
			);
			return response;
		} catch (error) {
			recordServerDiagnostic(
				`× ${requested}: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	};
}

export function getServerDiagnostics() {
	return entries.join("\n") || "No requests recorded.";
}
