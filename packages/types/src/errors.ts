export type AppError =
  | BadRequestError
  | UnauthorizedError
  | ForbiddenError
  | NotFoundError;

export class BadRequestError extends Error {
  readonly kind: string = "BadRequest";
  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends Error {
  readonly kind: string = "Unauthorized";
  constructor(message: string) {
    super(message);
  }
}

export class ForbiddenError extends Error {
  readonly kind: string = "Forbidden";
  constructor(message: string) {
    super(message);
  }
}

export type EventWriteReason = "unsupported" | "denied" | "unknown";
export type EventWriteCapability = "event-write" | "recurrence" | "organizer";

/** Additive error detail; older clients still display the existing error message. */
export class EventWriteError extends ForbiddenError {
  constructor(
    readonly capability: EventWriteCapability,
    readonly reason: EventWriteReason,
    detail?: string,
  ) {
    const subject = capability === "organizer"
      ? "Organizer permission"
      : capability === "recurrence" ? "This recurrence operation" : "Event writing";
    super(detail ?? `${subject} is ${reason}. No changes were saved.`);
  }
}

export class NotFoundError extends Error {
  readonly kind: string = "NotFound";
  constructor(message: string) {
    super(message);
  }
}
