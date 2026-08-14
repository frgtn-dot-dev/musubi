import { describe, expect, it } from "vitest";
import { answerLabel, groupAttendees } from "./attendance";

const attendee = (id: string, status: "declined" | "going" | "maybe") => ({
  id,
  image: null,
  name: id,
  status,
});

describe("groupAttendees", () => {
  it("keeps the order the server sent and drops empty groups", () => {
    const groups = groupAttendees([
      attendee("a", "going"),
      attendee("b", "declined"),
      attendee("c", "going"),
    ]);

    expect(groups.map((group) => group.status)).toEqual(["going", "declined"]);
    expect(groups[0]!.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(groups[0]!.title).toBe("Going");
  });

  it("has nothing to show for nobody", () => {
    expect(groupAttendees([])).toEqual([]);
  });
});

describe("answerLabel", () => {
  it("names the answer for the menu's trigger, and nothing without one", () => {
    expect(answerLabel("going")).toBe("Going");
    expect(answerLabel("declined")).toBe("Can’t go");
    expect(answerLabel(undefined)).toBeUndefined();
  });
});
