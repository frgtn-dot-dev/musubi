import { config } from "@musubi/config";
import { createDAVClient } from "tsdav";
import { assertPublicOrigin } from "../federation_origin";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function assertCaldavTarget(
	value: string,
	{ allowPrivate = config.security.federationAllowPrivateHosts } = {},
) {
	let target: URL;
	try {
		target = new URL(value);
	} catch {
		throw new Error("CalDAV server URL must be an absolute HTTP(S) URL.");
	}
	if (target.protocol !== "https:" && target.protocol !== "http:") {
		throw new Error("CalDAV server URL must use HTTP or HTTPS.");
	}
	if (!allowPrivate && target.protocol !== "https:") {
		throw new Error("CalDAV server URL must use HTTPS outside development.");
	}
	await assertPublicOrigin(target.origin, { allowPrivate });
}

export function createGuardedCaldavFetch({
	allowPrivate = config.security.federationAllowPrivateHosts,
	fetchImpl = globalThis.fetch,
}: {
	allowPrivate?: boolean;
	fetchImpl?: typeof globalThis.fetch;
} = {}): typeof globalThis.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		let url = new URL(input instanceof Request ? input.url : String(input));
		let requestInit: RequestInit =
			input instanceof Request
				? {
						headers: new Headers(input.headers),
						method: input.method,
						signal: input.signal,
						...init,
					}
				: { ...init };

		for (let redirects = 0; ; redirects += 1) {
			await assertCaldavTarget(url.href, { allowPrivate });
			const response = await fetchImpl(url, {
				...requestInit,
				redirect: "manual",
			});
			if (!REDIRECT_STATUSES.has(response.status)) return response;
			if (redirects >= 5) throw new Error("Too many CalDAV redirects.");

			const location = response.headers.get("location");
			if (!location) throw new Error("CalDAV redirect has no destination.");
			const next = new URL(location, url);
			if (next.origin !== url.origin) {
				const headers = new Headers(requestInit?.headers);
				headers.delete("authorization");
				requestInit = { ...requestInit, headers };
			}
			url = next;
		}
	}) as typeof globalThis.fetch;
}

// Builds a CalDAV client (Basic auth). Every initial, discovered, and redirected
// request goes through the same SSRF/TLS boundary before credentials can leave.
export function createCaldavClient(
	serverUrl: string,
	username: string,
	password: string,
) {
	return createDAVClient({
		serverUrl,
		credentials: { username, password },
		authMethod: "Basic",
		defaultAccountType: "caldav",
		fetch: createGuardedCaldavFetch(),
	});
}
