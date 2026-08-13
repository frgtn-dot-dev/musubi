import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

async function main() {
	const { assertCaldavTarget, createGuardedCaldavFetch } = await import(
		"./caldav_client"
	);

	await assert.rejects(
		() =>
			assertCaldavTarget("http://calendar.example", { allowPrivate: false }),
		/must use HTTPS/,
	);
	await assert.rejects(
		() => assertCaldavTarget("https://127.0.0.1", { allowPrivate: false }),
		/internal address/,
	);
	await assertCaldavTarget("http://127.0.0.1", { allowPrivate: true });

	const calls: Array<{ authorization: string | null; url: string }> = [];
	const guarded = createGuardedCaldavFetch({
		allowPrivate: true,
		fetchImpl: (async (input, init) => {
			const url = String(input);
			calls.push({
				authorization: new Headers(init?.headers).get("authorization"),
				url,
			});
			return calls.length === 1
				? new Response(null, {
						status: 302,
						headers: { location: "http://second.example/calendar" },
					})
				: new Response("ok", { status: 200 });
		}) as typeof fetch,
	});
	await guarded("http://first.example", {
		headers: { authorization: "Basic secret" },
	});
	assert.deepEqual(calls, [
		{ authorization: "Basic secret", url: "http://first.example/" },
		{ authorization: null, url: "http://second.example/calendar" },
	]);

	const blockedRedirect = createGuardedCaldavFetch({
		allowPrivate: false,
		fetchImpl: (async () =>
			new Response(null, {
				status: 302,
				headers: { location: "https://127.0.0.1/metadata" },
			})) as typeof fetch,
	});
	await assert.rejects(
		() => blockedRedirect("https://example.com"),
		/internal address/,
	);

	console.log("CalDAV SSRF self-check: OK");
}

void main();
