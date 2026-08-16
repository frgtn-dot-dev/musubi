import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { ForbiddenError } from "@musubi/types";
import { createReminderHandlers } from "./reminders";

// The handlers are thin, but two things here are worth pinning: a reminder is a
// READ-level privilege (wanting a nudge about something you cannot edit is
// normal), and a rule for a calendar you are not in is a 403 rather than a
// silent no-op that would let somebody probe for calendar ids.

const RULE = { allDay: null, minutesBefore: 10 };
const CALENDAR = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";

function responseRecorder() {
  let statusCode = 0;
  let payload: unknown;
  let ended = false;
  const response = {
    end() {
      ended = true;
      return response;
    },
    json(body: unknown) {
      payload = body;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;

  return { ended: () => ended, response, result: () => ({ payload, statusCode }) };
}

function request(over: Partial<Request> = {}) {
  return {
    body: { rule: RULE },
    params: { calendarId: CALENDAR, eventId: EVENT },
    user: { id: "user-1" },
    ...over,
  } as unknown as Request;
}

async function run() {
  {
    const notifications: unknown[][] = [];
    const writes: unknown[][] = [];
    const handlers = createReminderHandlers({
      notify: (...args) => void notifications.push(args),
      setCalendar: async (...args) => {
        writes.push(args);
        return true;
      },
    });

    const { ended, response } = responseRecorder();
    await handlers.putCalendarReminder(request(), response);

    assert.ok(ended(), "a stored rule answers 204");
    assert.deepEqual(writes[0], ["user-1", CALENDAR, RULE]);
    // Only the caller: nobody else needs to know when this person's phone rings.
    assert.deepEqual(notifications[0]?.[0], ["user-1"]);
    assert.equal(notifications[0]?.[1], "reminders_updated");
  }

  {
    const notifications: unknown[][] = [];
    const handlers = createReminderHandlers({
      notify: (...args) => void notifications.push(args),
      setCalendar: async () => false, // no membership row
    });

    await assert.rejects(
      handlers.putCalendarReminder(request(), responseRecorder().response),
      ForbiddenError,
    );
    assert.equal(notifications.length, 0, "a rejected write announces nothing");
  }

  {
    // Read-level, not edit-level: the gate is `assertCanViewEvent`.
    const gates: string[] = [];
    const writes: unknown[][] = [];
    const handlers = createReminderHandlers({
      assertCanView: async (_userID, eventID) => {
        gates.push(eventID);
        return [CALENDAR];
      },
      notify: () => undefined,
      setEvent: async (...args) => void writes.push(args),
    });

    await handlers.putEventReminder(request(), responseRecorder().response);
    assert.deepEqual(gates, [EVENT]);
    assert.deepEqual(writes[0], ["user-1", EVENT, RULE]);

    // DELETE is the same write with no rule — back to inheriting.
    await handlers.deleteEventReminder(request(), responseRecorder().response);
    assert.deepEqual(writes[1], ["user-1", EVENT, null]);
  }

  {
    // `rule: null` is a legitimate body, not a missing one.
    const writes: unknown[][] = [];
    const handlers = createReminderHandlers({
      assertCanView: async () => [CALENDAR],
      notify: () => undefined,
      setEvent: async (...args) => void writes.push(args),
    });

    await handlers.putEventReminder(
      request({ body: { rule: null } } as Partial<Request>),
      responseRecorder().response,
    );
    assert.deepEqual(writes[0], ["user-1", EVENT, null]);

    for (const body of [{}, { rule: { minutesBefore: 10 } }, { rule: 10 }]) {
      await assert.rejects(
        handlers.putEventReminder(
          request({ body } as Partial<Request>),
          responseRecorder().response,
        ),
        /rule/i,
        `rejected: ${JSON.stringify(body)}`,
      );
    }
  }

  console.log("handlers/reminders.test.ts ok");
}

void run();
