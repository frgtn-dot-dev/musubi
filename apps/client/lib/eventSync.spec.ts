import type { Calendar, Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { mergeHomeEventSnapshot, serializeEventRefresh } from "./eventSync";

const event = (id: string, calendars: string[]) => ({ id, calendars }) as Event;

const calendars = [
  { id: "home" },
  { id: "remote", provider: "musubi", serverUrl: "https://remote.example" },
  { id: "caldav", provider: "caldav", serverUrl: "https://dav.example" },
] as Calendar[];

describe("event sync", () => {
  it("drops stale home events while retaining events from offline federated servers", () => {
    const merged = mergeHomeEventSnapshot(
      [event("fresh-home", ["home"])],
      [event("stale-home", ["home"]), event("cached-remote", ["remote"])],
      calendars,
    );

    expect(merged.map(({ id }) => id)).toEqual(["cached-remote", "fresh-home"]);
  });

  it("evicts a removed CalDAV copy on full catch-up without evicting offline federation", () => {
    const merged = mergeHomeEventSnapshot(
      [],
      [
        event("removed-caldav-copy", ["caldav"]),
        event("cached-remote", ["remote"]),
      ],
      calendars,
    );
    expect(merged.map(({ id }) => id)).toEqual(["cached-remote"]);
  });

  it("runs refreshes in request order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = serializeEventRefresh(async () => {
      order.push("first:start");
      await blocked;
      order.push("first:end");
    });
    const second = serializeEventRefresh(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});
