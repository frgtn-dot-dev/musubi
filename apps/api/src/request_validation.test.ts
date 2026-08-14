import assert from "node:assert/strict";
import { z } from "zod";
import { BadRequestError } from "@musubi/types";
import { httpErrorFor } from "./middleware/http_error";
import { optionalDateQuery, optionalDateRangeQuery, requireUUID } from "./request_validation";

const uuid = "018f3f7e-2b4a-7cc1-9a2e-8e8c44ad9130";

assert.equal(requireUUID(uuid, "eventId"), uuid);
assert.throws(
  () => requireUUID("not-a-uuid", "eventId"),
  (error: unknown) => error instanceof BadRequestError && error.message === "eventId must be a valid UUID.",
);

assert.equal(optionalDateQuery(undefined, "since"), undefined);
assert.equal(
  optionalDateQuery("2026-07-23T12:00:00.000Z", "since")?.toISOString(),
  "2026-07-23T12:00:00.000Z",
);
for (const malformed of ["not-a-date", "", ["2026-07-23T12:00:00.000Z"]]) {
  assert.throws(
    () => optionalDateQuery(malformed, "since"),
    (error: unknown) => error instanceof BadRequestError && error.message === "since must be a valid timestamp.",
  );
}

const day = 24 * 60 * 60 * 1000;
assert.deepEqual(
  optionalDateRangeQuery(
    "2026-07-01T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
    366 * day,
  ),
  {
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  },
);
for (const [start, end, message] of [
  ["2026-07-01T00:00:00.000Z", undefined, "start and end must be provided together."],
  ["2026-08-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "start must be before end."],
  ["2026-07-01T00:00:00.000Z", "2028-07-01T00:00:00.000Z", "Requested event range is too large."],
] as const) {
  assert.throws(
    () => optionalDateRangeQuery(start, end, 366 * day),
    (error: unknown) => error instanceof BadRequestError && error.message === message,
  );
}

const malformedBody = z.object({ id: z.string().uuid() }).safeParse({ id: "nope" });
assert.equal(malformedBody.success, false);
if (!malformedBody.success) {
  assert.deepEqual(httpErrorFor(malformedBody.error), {
    statusCode: 400,
    errorMessage: "Request contains invalid data.",
  });
}
assert.deepEqual(httpErrorFor(new BadRequestError("Invalid request.")), {
  statusCode: 400,
  errorMessage: "Invalid request.",
});
assert.deepEqual(httpErrorFor(new Error("boom")), {
  statusCode: 500,
  errorMessage: "500 - Internal Server Error",
});

console.log("request validation self-check: OK");
