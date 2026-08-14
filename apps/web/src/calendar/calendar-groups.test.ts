import type { Calendar } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { groupCalendars } from "./calendar-groups";

function calendar(id: string, input: Partial<Calendar> = {}): Calendar {
  return {
    color: "#B3A48A",
    creatorID: "user-1",
    id,
    members: [],
    name: id,
    role: "owner",
    ...input,
  };
}

describe("groupCalendars", () => {
  it("pins the native group and personal calendar before connected accounts", () => {
    const groups = groupCalendars([
      calendar("work", {
        accountId: "google-1",
        accountLabel: "work@example.com",
        provider: "google",
      }),
      calendar("team"),
      calendar("personal", { isDefault: true }),
      calendar("holidays", {
        accountId: "google-1",
        provider: "google",
      }),
    ]);

    expect(groups.map((group) => group.title)).toEqual([
      "Musubi",
      "work@example.com",
    ]);
    expect(groups[0]?.calendars.map((item) => item.id)).toEqual([
      "personal",
      "team",
    ]);
    expect(groups[1]?.calendars.map((item) => item.id)).toEqual([
      "work",
      "holidays",
    ]);
  });

  it("keeps separate provider accounts and labels federated servers", () => {
    const groups = groupCalendars([
      calendar("google-a", {
        accountId: "a",
        accountLabel: "one@example.com",
        provider: "google",
      }),
      calendar("google-b", {
        accountId: "b",
        accountLabel: "two@example.com",
        provider: "google",
      }),
      calendar("remote", {
        accountId: "connection-1",
        accountLabel: "friends.example",
        provider: "musubi",
        serverUrl: "https://friends.example",
      }),
    ]);

    expect(groups.map((group) => group.title)).toEqual([
      "one@example.com",
      "two@example.com",
      "friends.example",
    ]);
    expect(groups[2]).toMatchObject({
      detail: "Shared from another Musubi server",
      flavor: "musubi",
    });
  });
});
