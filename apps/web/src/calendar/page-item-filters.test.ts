import { describe, expect, it } from "vitest";
import { defaultPageConfig, PageConfigV1Schema, EventCreateRequestSchema, eventCreateRequest } from "@musubi/types";
import { fixtureEvents } from "./fixtures";
import { eventItemType, pageItemTypes } from "./page-item-filters";

describe("page item filters", () => {
  it("defaults old pages to all types and preserves an empty selection", () => {
    expect(pageItemTypes([])).toEqual(["events", "tasks", "meetings"]);
    const config = PageConfigV1Schema.parse({ ...defaultPageConfig("month"), filters: [{ type: "item-types", value: [] }] });
    expect(pageItemTypes(config.filters)).toEqual([]);
  });
  it("distinguishes local attendance and provider meetings from personal events", () => {
    const base = { ...fixtureEvents[0]!, hasAttendees: false };
    expect(eventItemType(base)).toBe("events");
    expect(eventItemType({ ...base, hasAttendees: true })).toBe("meetings");
    expect(eventItemType({ ...base, isMeeting: true })).toBe("meetings");
  });
  it("keeps classification out of event writes", () => {
    const event = { ...fixtureEvents[0]!, isMeeting: true };
    expect(eventCreateRequest(event)).not.toHaveProperty("isMeeting");
    expect(EventCreateRequestSchema.safeParse({ ...eventCreateRequest(event), isMeeting: true }).success).toBe(false);
  });
});
