// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PollCalendar } from "~/api/contracts";
import {
  PollCalendarChip,
  pollAvailability,
  pollCalendarItems,
  pollDayContinues,
} from "./PollCalendarChip";

function poll(overrides: Partial<PollCalendar> = {}): PollCalendar {
  return {
    approximateStartTime: null,
    chosenSlotID: null,
    closed: false,
    closedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    days: [],
    deadline: null,
    durationMinutes: 1440,
    id: "poll-1",
    respondents: 2,
    role: "participant",
    title: "Studio planning",
    token: "token",
    url: "https://musubi.test/s/token",
    ...overrides,
  };
}

const day = {
  date: "2026-08-18",
  end: new Date("2026-08-19T00:00:00.000Z"),
  id: "day-1",
  ifNeeded: 0,
  no: 0,
  start: new Date("2026-08-18T00:00:00.000Z"),
  yes: 2,
};

describe("poll calendar items", () => {
  it("makes one all-day item per proposed day", () => {
    const items = pollCalendarItems([poll({ days: [day] })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.date).toBe("2026-08-18");
  });

  it("connects only consecutive days from the same poll", () => {
    const nextDay = {
      ...day,
      date: "2026-08-19",
      id: "day-2",
    };
    const items = pollCalendarItems([poll({ days: [day, nextDay] })]);
    expect(pollDayContinues(items[0]!, 1)).toBe(true);
    expect(pollDayContinues(items[0]!, -1)).toBe(false);
    expect(pollDayContinues(items[1]!, -1)).toBe(true);
  });

  it("keeps continuation pills visually blank but fully named", () => {
    const item = pollCalendarItems([poll({ days: [day] })])[0]!;
    const { container } = render(
      <PollCalendarChip item={item} onOpen={() => undefined} showLabel={false} />,
    );
    expect(screen.queryByText("Studio planning")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Studio planning, scheduling poll/ }),
    ).not.toBeNull();
  });

  it("uses consensus, mixed, unavailable and unanswered tones", () => {
    const item = pollCalendarItems([poll({ days: [day] })])[0]!;
    expect(pollAvailability(item).label).toBe("Everyone is available");
    expect(
      pollAvailability({ ...item, poll: poll({ chosenSlotID: "day-1" }) }).label,
    ).toBe("Time picked");
    expect(
      pollAvailability({ ...item, day: { ...day, ifNeeded: 1, yes: 1 } }).label,
    ).toBe("Availability is mixed");
    expect(
      pollAvailability({ ...item, day: { ...day, no: 1, yes: 1 } }).label,
    ).toBe("1 unavailable");
    expect(
      pollAvailability({
        ...item,
        day: { ...day, yes: 0 },
        poll: poll({ respondents: 0 }),
      }).label,
    ).toBe("No answers yet");
  });
});
