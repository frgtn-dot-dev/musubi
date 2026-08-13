import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "dev";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

async function main() {
  const { assertCaldavTarget, createGuardedCaldavFetch } =
    await import("./caldav_client");

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

  const calls: Array<{
    address: string;
    authorization: string | null;
    url: string;
  }> = [];
  const guarded = createGuardedCaldavFetch({
    allowPrivate: false,
    lookupImpl: async (host) => [
      {
        address: host === "first.example" ? "203.0.113.10" : "203.0.113.11",
        family: 4,
      },
    ],
    fetchPinnedImpl: async (url, init, address) => {
      calls.push({
        address: address.address,
        authorization: new Headers(init.headers).get("authorization"),
        url: String(url),
      });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://second.example/calendar" },
          })
        : new Response("ok", { status: 200 });
    },
  });
  await guarded("https://first.example", {
    headers: { authorization: "Basic secret" },
  });
  assert.deepEqual(calls, [
    {
      address: "203.0.113.10",
      authorization: "Basic secret",
      url: "https://first.example/",
    },
    {
      address: "203.0.113.11",
      authorization: null,
      url: "https://second.example/calendar",
    },
  ]);

  let transportCalled = false;
  const blockedRedirect = createGuardedCaldavFetch({
    allowPrivate: false,
    lookupImpl: async (host) => [
      {
        address: host === "example.com" ? "203.0.113.12" : "127.0.0.1",
        family: 4,
      },
    ],
    fetchPinnedImpl: async () => {
      transportCalled = true;
      return new Response(null, {
        status: 302,
        headers: { location: "https://private.example/metadata" },
      });
    },
  });
  await assert.rejects(
    () => blockedRedirect("https://example.com"),
    /internal address/,
  );
  assert.equal(transportCalled, true);

  const redirected: Array<{ body: unknown; method: string | undefined }> = [];
  const postRedirect = createGuardedCaldavFetch({
    allowPrivate: true,
    lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchPinnedImpl: async (_url, init) => {
      redirected.push({ body: init.body, method: init.method });
      return redirected.length === 1
        ? new Response("discard me", {
            status: 303,
            headers: { location: "http://127.0.0.1/destination" },
          })
        : new Response("ok");
    },
  });
  await postRedirect("http://127.0.0.1/source", {
    body: "secret body",
    headers: { "content-type": "text/plain" },
    method: "POST",
  });
  assert.deepEqual(redirected, [
    { body: "secret body", method: "POST" },
    { body: undefined, method: "GET" },
  ]);

  console.log("CalDAV SSRF self-check: OK");
}

void main();
