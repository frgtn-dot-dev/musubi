import { z } from "zod";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_EXPIRED_EVENT } from "~/auth/auth-client";
import { ApiError, ApiResponseError, apiRawBodyRequest, apiRequest, apiTextRequest } from "./http";
import { getEventMutationError } from "~/calendar/event-permissions";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it.each(["unsupported", "denied", "unknown"] as const)("preserves the server capability reason %s through event feedback", async (reason) => {
    const message = `Event writing is ${reason}. No changes were saved.`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: message, reason, capability: "event-write", requestId: "k04-request",
    }), { status: 403 })));
    try {
      await apiRequest("/api/v1/events", { method: "PUT", body: {}, responseSchema: z.unknown() });
      throw new Error("Expected refusal");
    } catch (error) {
      expect(error).toMatchObject({ reason, message });
      expect(getEventMutationError(error, "update")).toEqual({ message, requestId: "k04-request" });
    }
  });

  it("sends first-party credentials and validates successful data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 3 }), {
        headers: { "x-request-id": "request-success" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest("/api/v1/test", {
        responseSchema: z.object({ value: z.number() }),
      }),
    ).resolves.toEqual({ value: 3 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({ credentials: "include" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]![1].headers);
    expect(headers.get("x-request-id")).toBeTruthy();
    expect(headers.get(CLIENT_VERSION_HEADER)).toBe(PRODUCT_VERSION);
  });

  it("versions raw uploads and ICS exports without changing their bodies", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await apiRawBodyRequest("/api/v1/calendars/import", { body: "BEGIN:VCALENDAR", contentType: "text/calendar", responseSchema: z.object({}) });
    await apiTextRequest("/api/v1/calendars/home/export");
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get(CLIENT_VERSION_HEADER)).toBe(PRODUCT_VERSION);
    }
    expect(fetchMock.mock.calls[0]?.[1].body).toBe("BEGIN:VCALENDAR");
  });

  it("preserves upgrade refusal without expiring a session or discarding a draft", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "ClientUpgradeRequired", message: "Update Musubi. Your open draft has not been submitted.",
    }), { status: 426 })));
    await expect(apiRequest("/api/v1/events", { responseSchema: z.unknown() })).rejects.toMatchObject({ status: 426, message: "Update Musubi. Your open draft has not been submitted." });
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it("preserves the server request ID and emits the auth transition on 401", async () => {
    const onExpired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Unauthorized",
            requestId: "request-401",
          }),
          { status: 401 },
        ),
      ),
    );

    const promise = apiRequest("/api/v1/test", {
      responseSchema: z.unknown(),
    });

    await expect(promise).rejects.toMatchObject({
      requestId: "request-401",
      status: 401,
    });
    expect(onExpired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  });

  it("distinguishes an invalid success payload from an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: "wrong" }), {
          headers: { "x-request-id": "request-schema" },
          status: 200,
        }),
      ),
    );

    await expect(
      apiRequest("/api/v1/test", {
        responseSchema: z.object({ value: z.number() }),
      }),
    ).rejects.toBeInstanceOf(ApiResponseError);
  });

  it("uses the current API error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "No access", requestId: "request-403" }),
          { status: 403 },
        ),
      ),
    );

    await expect(
      apiRequest("/api/v1/test", { responseSchema: z.unknown() }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
