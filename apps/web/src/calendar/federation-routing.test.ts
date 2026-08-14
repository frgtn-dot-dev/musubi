import type { Calendar, Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import {
  connectionForCalendar,
  connectionForEvent,
  connectionOfCalendar,
  federatedConnectionMap,
  spansMultipleServers,
} from "./federation-routing";

function calendar(input: Partial<Calendar> & { id: string }): Calendar {
  return {
    color: "#7a9e7e",
    creatorID: "alex",
    members: [],
    name: input.id,
    ...input,
  };
}

const home = calendar({ id: "home-cal" });
const federated = calendar({
  accountId: "conn-1",
  id: "remote-cal",
  provider: "musubi",
  serverUrl: "https://friends.example",
});
// Provider mirrors carry an accountId too — they must not be treated as remote
// Musubi servers.
const google = calendar({
  accountId: "google-acc",
  id: "google-cal",
  provider: "google",
});

describe("connectionOfCalendar", () => {
  it("returns the connection id only for federated calendars", () => {
    expect(connectionOfCalendar(federated)).toBe("conn-1");
    expect(connectionOfCalendar(home)).toBeUndefined();
    expect(connectionOfCalendar(google)).toBeUndefined();
    expect(connectionOfCalendar(undefined)).toBeUndefined();
  });
});

describe("federatedConnectionMap", () => {
  it("maps federated calendars and ignores home and provider mirrors", () => {
    const map = federatedConnectionMap([home, federated, google]);
    expect(map.get("remote-cal")).toBe("conn-1");
    expect(map.has("home-cal")).toBe(false);
    expect(map.has("google-cal")).toBe(false);
  });
});

describe("connectionForEvent", () => {
  const map = federatedConnectionMap([home, federated, google]);

  function event(input: Partial<Event>): Event {
    return {
      calendars: [],
      color: "#7a9e7e",
      creatorID: "alex",
      end: new Date("2026-07-26T11:00:00Z"),
      hasAttendees: false,
      id: "e1",
      isAllDay: false,
      isCanceled: false,
      organizer: "alex@example.com",
      start: new Date("2026-07-26T10:00:00Z"),
      title: "Test",
      ...input,
    } as Event;
  }

  it("routes by the event's home calendar", () => {
    expect(
      connectionForEvent(
        map,
        event({ calendars: ["remote-cal"], originCalendarID: "remote-cal" }),
      ),
    ).toBe("conn-1");
    expect(
      connectionForEvent(
        map,
        event({ calendars: ["home-cal"], originCalendarID: "home-cal" }),
      ),
    ).toBeUndefined();
  });

  it("falls back to the first linked calendar when there is no origin", () => {
    expect(
      connectionForEvent(map, event({ calendars: ["remote-cal"] })),
    ).toBe("conn-1");
  });

  it("prefers the origin over other links", () => {
    // A home event also linked into a remote calendar must still write home.
    expect(
      connectionForEvent(
        map,
        event({
          calendars: ["home-cal", "remote-cal"],
          originCalendarID: "home-cal",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("connectionForCalendar", () => {
  const map = federatedConnectionMap([federated]);

  it("handles missing ids", () => {
    expect(connectionForCalendar(map, undefined)).toBeUndefined();
    expect(connectionForCalendar(map, null)).toBeUndefined();
    expect(connectionForCalendar(map, "unknown")).toBeUndefined();
  });
});

describe("spansMultipleServers", () => {
  const map = federatedConnectionMap([
    federated,
    calendar({ accountId: "conn-2", id: "other-remote", provider: "musubi" }),
  ]);

  it("accepts calendars from one origin", () => {
    expect(spansMultipleServers(map, ["home-cal", "google-cal"])).toBe(false);
    expect(spansMultipleServers(map, ["remote-cal"])).toBe(false);
    expect(spansMultipleServers(map, [])).toBe(false);
  });

  it("rejects mixing home with a federated calendar", () => {
    expect(spansMultipleServers(map, ["home-cal", "remote-cal"])).toBe(true);
  });

  it("rejects mixing two federated servers", () => {
    expect(spansMultipleServers(map, ["remote-cal", "other-remote"])).toBe(
      true,
    );
  });
});
