import { expect, it } from "vitest";
import { outlookMoveFormat } from "./outlookMoveFormat";
it.each([["dmy", "2 Jan 2027"], ["mdy", "Jan 2, 2027"], ["ymd", "2027 Jan 2"]] as const)("uses the series civil date in %s order, not the phone zone", (order, expected) => {
  expect(outlookMoveFormat("Pacific/Kiritimati", order, "24h").date("2027-01-01T12:00:00Z")).toBe(expected);
});
it("honors clock preference in a fractional-offset zone", () => {
  expect(outlookMoveFormat("Asia/Kathmandu", "dmy", "24h").range("2026-10-01T12:00:00Z", "2026-10-01T13:00:00Z")).toBe("17:45–18:45");
  expect(outlookMoveFormat("Asia/Kathmandu", "dmy", "12h").range("2026-10-01T12:00:00Z", "2026-10-01T13:00:00Z").replace(/\s/g, " ")).toBe("5:45 PM–6:45 PM");
});
it("follows DST separately for each occurrence", () => {
  const format = outlookMoveFormat("America/New_York", "dmy", "24h");
  expect(format.range("2026-10-31T14:00:00Z", "2026-10-31T15:00:00Z")).toBe("10:00–11:00");
  expect(format.range("2026-11-01T14:00:00Z", "2026-11-01T15:00:00Z")).toBe("09:00–10:00");
});

it("makes an overnight end date explicit", () => {
  expect(outlookMoveFormat("UTC", "dmy", "24h").range("2026-12-31T23:00:00Z", "2027-01-01T01:00:00Z")).toBe("23:00–1 Jan 2027, 01:00");
});
