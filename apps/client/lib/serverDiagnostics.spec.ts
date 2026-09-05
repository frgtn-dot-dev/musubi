import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { diagnosticFetchFor, getServerDiagnostics } from "./serverDiagnostics";

describe("server diagnostics", () => {
	beforeEach(() => vi.stubGlobal("__DEV__", false));
	afterEach(() => vi.unstubAllGlobals());

	it("blocks auth requests that escape the selected server", async () => {
		await expect(
			diagnosticFetchFor("https://dev.musubi.pro")(
				"https://musubi.pro/api/v1/calendars",
			),
		).rejects.toThrow("outside selected server");
	});

	it("records the requested and final response URL", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				status: 200,
				url: "https://dev.musubi.pro/api/v1/calendars",
			})),
		);
		await diagnosticFetchFor("https://dev.musubi.pro")("/api/v1/calendars");
		const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers);
		expect(headers.get(CLIENT_VERSION_HEADER)).toBe(PRODUCT_VERSION);
		expect(getServerDiagnostics()).toContain(
			"https://dev.musubi.pro/api/v1/calendars",
		);
	});
});
