import type { DehydratedState } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { EventsResponseSchema, TasksResponseSchema } from "~/api/contracts";

import { CACHE_BUSTER, cacheNamespace, hashOrigin } from "./cache-version";
import {
  capEventRanges,
  isSnapshotUsable,
  reviveQueries,
  shouldPersistQuery,
} from "./snapshot";

type DehydratedQuery = DehydratedState["queries"][number];

function query(
  queryKey: readonly unknown[],
  data: unknown,
  overrides: { dataUpdatedAt?: number; status?: string } = {},
): DehydratedQuery {
  return {
    queryHash: JSON.stringify(queryKey),
    queryKey,
    state: {
      data,
      dataUpdatedAt: overrides.dataUpdatedAt ?? 1,
      status: overrides.status ?? "success",
    },
  } as unknown as DehydratedQuery;
}

const eventsPayload = {
  deletedIds: [],
  events: [
    {
      calendars: ["work"],
      color: "#b3492f",
      creatorID: "user-1",
      end: "2026-07-20T10:00:00.000Z",
      hasAttendees: false,
      id: "standup",
      isAllDay: false,
      isCanceled: false,
      organizer: "a@b.c",
      recurrence: null,
      start: "2026-07-20T09:00:00.000Z",
      title: "Standup",
    },
  ],
  serverTime: "2026-07-20T09:00:00.000Z",
};

const tasksPayload = {
  tasks: [
    {
      calendarID: "work",
      completedAt: null,
      creatorID: "user-1",
      description: null,
      due: "2026-07-21T16:00:00.000Z",
      id: "release",
      isAllDay: false,
      percentComplete: 0,
      priority: 3,
      recurrence: null,
      relatedTo: null,
      sequence: 0,
      start: "2026-07-21T14:00:00.000Z",
      status: "needs-action",
      title: "Prepare release",
      url: null,
    },
  ],
};

describe("shouldPersistQuery", () => {
  it("keeps the queries a cold start needs", () => {
    for (const name of [
      "calendars",
      "events",
      "federated",
      "pages",
      "settings",
      "tasks",
    ]) {
      expect(shouldPersistQuery(query([name, "origin", "user"], {}))).toBe(
        true,
      );
    }
  });

  it("leaves out what nobody needs offline or must not be stored", () => {
    // Per-dialog detail, a handshake, and Better Auth's own session.
    for (const name of [
      "attendees",
      "members",
      "invites",
      "server-capabilities",
      "session",
    ]) {
      expect(shouldPersistQuery(query([name, "origin", "user"], {}))).toBe(
        false,
      );
    }
  });

  it("leaves out failures and empties", () => {
    expect(
      shouldPersistQuery(
        query(["events", "o", "u"], undefined, { status: "error" }),
      ),
    ).toBe(false);
    // A success with no data would restore as a query that never has to fetch.
    expect(shouldPersistQuery(query(["events", "o", "u"], undefined))).toBe(
      false,
    );
  });
});

describe("reviveQueries", () => {
  it("makes dates dates again", () => {
    const [revived] = reviveQueries([
      query(["events", "o", "u"], eventsPayload),
    ]);

    const data = revived!.state.data as { events: { start: Date }[] };
    expect(data.events[0]!.start).toBeInstanceOf(Date);
    expect(data.events[0]!.start.toISOString()).toBe(
      "2026-07-20T09:00:00.000Z",
    );
    // And the result satisfies the contract the app reads everywhere else.
    expect(EventsResponseSchema.safeParse(data).success).toBe(true);
  });

  it("revives cached task dates", () => {
    const [revived] = reviveQueries([query(["tasks", "o", "u"], tasksPayload)]);

    const data = revived!.state.data as {
      tasks: { due: Date; start: Date }[];
    };
    expect(data.tasks[0]!.start).toBeInstanceOf(Date);
    expect(data.tasks[0]!.due).toBeInstanceOf(Date);
    expect(TasksResponseSchema.safeParse(data).success).toBe(true);
  });

  it("drops an entry the current build cannot parse, and keeps the rest", () => {
    const revived = reviveQueries([
      query(["events", "o", "u"], { events: "not an array" }),
      query(["pages", "o", "u"], []),
    ]);

    expect(revived).toHaveLength(1);
    expect(revived[0]!.queryKey[0]).toBe("pages");
  });

  it("drops an entry whose key it does not recognise", () => {
    expect(reviveQueries([query(["attendees", "o", "u"], [])])).toHaveLength(0);
  });
});

describe("capEventRanges", () => {
  it("keeps the most recently loaded windows and nothing else", () => {
    const queries = [
      query(["calendars", "o", "u"], []),
      ...[10, 40, 20, 30].map((dataUpdatedAt) =>
        query(
          ["events", "o", "u", [], `range-${dataUpdatedAt}`],
          eventsPayload,
          {
            dataUpdatedAt,
          },
        ),
      ),
    ];

    const capped = capEventRanges(queries, 2);

    // The other cached queries are untouched by the cap.
    expect(
      capped.filter((item) => item.queryKey[0] === "calendars"),
    ).toHaveLength(1);
    const kept = capped
      .filter((item) => item.queryKey[0] === "events")
      .map((item) => item.state.dataUpdatedAt);
    expect(kept.sort()).toEqual([30, 40]);
  });

  it("leaves a snapshot under the limit alone", () => {
    const queries = [query(["events", "o", "u"], eventsPayload)];
    expect(capEventRanges(queries, 8)).toBe(queries);
  });
});

describe("isSnapshotUsable", () => {
  const snapshot = {
    buster: CACHE_BUSTER,
    savedAt: 1_000,
    state: { mutations: [], queries: [] },
  };

  it("accepts its own build inside the age window", () => {
    expect(isSnapshotUsable(snapshot, 500, 1_400)).toBe(true);
  });

  it("refuses another build's snapshot", () => {
    expect(isSnapshotUsable({ ...snapshot, buster: "999.9" }, 500, 1_400)).toBe(
      false,
    );
  });

  it("refuses one that is too old", () => {
    expect(isSnapshotUsable(snapshot, 500, 2_000)).toBe(false);
  });

  it("refuses one from the future, which means the clock moved", () => {
    expect(isSnapshotUsable(snapshot, 500, 900)).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isSnapshotUsable(undefined, 500)).toBe(false);
  });
});

describe("cacheNamespace", () => {
  it("separates accounts and servers", () => {
    const mine = cacheNamespace("https://musubi.pro", "user-1");
    expect(mine).not.toBe(cacheNamespace("https://musubi.pro", "user-2"));
    expect(mine).not.toBe(cacheNamespace("https://other.example", "user-1"));
    expect(mine).toBe(cacheNamespace("https://musubi.pro", "user-1"));
  });

  it("carries the buster, so a bump cannot resurrect an old shape", () => {
    expect(cacheNamespace("https://musubi.pro", "user-1")).toContain(
      CACHE_BUSTER,
    );
  });

  it("keeps the origin readable as a short hash rather than a URL", () => {
    expect(hashOrigin("https://musubi.pro")).toMatch(/^[a-z0-9]+$/);
  });
});
