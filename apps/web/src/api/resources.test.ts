import { afterEach, expect, it, vi } from "vitest";
import { getEvents, importCalendar } from "./resources";

afterEach(() => vi.unstubAllGlobals());

function response() {
	return new Response(
		JSON.stringify({
			deletedIds: [],
			events: [],
			serverTime: "2026-07-01T00:00:00.000Z",
		}),
		{
			headers: { "content-type": "application/json" },
			status: 200,
		},
	);
}

it("requests only the active event range", async () => {
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		void input;
		return response();
	});
	vi.stubGlobal("fetch", fetch);

	await getEvents({
		start: new Date("2026-07-01T00:00:00.000Z"),
		end: new Date("2026-08-01T00:00:00.000Z"),
	});

	expect(fetch.mock.calls[0]?.[0]).toBe(
		"/api/v1/events?start=2026-07-01T00%3A00%3A00.000Z&end=2026-08-01T00%3A00%3A00.000Z",
	);
});

it("sends a connected account as the calendar import destination", async () => {
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		void input;
		return new Response(
			JSON.stringify({
				accountId: "google-work",
				color: "#7A8BA3",
				creatorID: "alex",
				id: "imported",
				imported: 1,
				members: [],
				name: "Imported",
				provider: "google",
			}),
			{ headers: { "content-type": "application/json" }, status: 201 },
		);
	});
	vi.stubGlobal("fetch", fetch);

	await importCalendar(
		"BEGIN:VCALENDAR\nEND:VCALENDAR",
		"Imported",
		"#7A8BA3",
		"google",
		"google-work",
	);

	expect(fetch.mock.calls[0]?.[0]).toBe(
		"/api/v1/calendars/import?color=%237A8BA3&name=Imported&provider=google&accountId=google-work",
	);
});

it("keeps the compatibility full event read available", async () => {
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		void input;
		return response();
	});
	vi.stubGlobal("fetch", fetch);

	await getEvents();

	expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/events");
});
