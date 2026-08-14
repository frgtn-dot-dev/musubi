import { BadRequestError } from "@musubi/types";

// PostgreSQL's uuid input accepts all UUID versions; require the canonical
// hyphenated representation before a value reaches a query.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUUID(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new BadRequestError(`${field} must be a valid UUID.`);
  }
  return value;
}

export function optionalDateQuery(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`${field} must be a valid timestamp.`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`${field} must be a valid timestamp.`);
  }
  return parsed;
}

export function optionalDateRangeQuery(
  startValue: unknown,
  endValue: unknown,
  maxMilliseconds: number,
): { start: Date; end: Date } | undefined {
  if (startValue === undefined && endValue === undefined) return undefined;
  if (startValue === undefined || endValue === undefined) {
    throw new BadRequestError("start and end must be provided together.");
  }

  const start = optionalDateQuery(startValue, "start");
  const end = optionalDateQuery(endValue, "end");
  if (!start || !end) {
    throw new BadRequestError("start and end must be provided together.");
  }
  if (start >= end) {
    throw new BadRequestError("start must be before end.");
  }
  if (end.getTime() - start.getTime() > maxMilliseconds) {
    throw new BadRequestError("Requested event range is too large.");
  }
  return { start, end };
}
