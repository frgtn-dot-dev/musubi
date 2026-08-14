export function normalizeServerUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("Enter a valid server URL.");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Server URL must use HTTP or HTTPS.");
	}
	return url.origin.toLowerCase();
}

export function serverStoragePrefix(value: string) {
	const origin = normalizeServerUrl(value);
	return `musubi_${origin.slice(origin.indexOf("://") + 3).replace(/[^a-z0-9]/gi, "_")}`;
}
