import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_EXPIRED_EVENT } from "~/auth/auth-client";
import { ApiError, ApiResponseError, apiRequest } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
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
