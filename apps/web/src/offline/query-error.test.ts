import { describe, expect, it } from "vitest";
import { ApiError, ApiResponseError } from "~/api/http";
import { CalendarTimeError } from "~/calendar/calendar-time-error";
import { canKeepOfflineQueryData } from "./query-error";

describe("offline refresh failures", () => {
  it("retains cached content only for transport failures while offline", () => {
    for (const error of [new TypeError("Failed to fetch"), new DOMException("Timed out", "TimeoutError"), new ApiError("Unreachable", 0)]) {
      expect(canKeepOfflineQueryData({ data: [], error }, true)).toBe(true);
      expect(canKeepOfflineQueryData({ data: undefined, error }, true)).toBe(false);
      expect(canKeepOfflineQueryData({ data: [], error }, false)).toBe(false);
    }
  });

  it("never treats revoked access or invalid content as an offline transport failure", () => {
    for (const error of [new ApiError("Sign in", 401), new ApiError("Denied", 403), new ApiError("Server failure", 503), new ApiResponseError(), new CalendarTimeError("calendar", new Error("Invalid time")), new DOMException("Denied", "SecurityError")]) {
      expect(canKeepOfflineQueryData({ data: [{}], error }, true)).toBe(false);
    }
  });
});
