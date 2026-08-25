import assert from "node:assert/strict";
import { EventPageContentSchema } from "./event_page";

assert.deepEqual(EventPageContentSchema.parse({}), {
  agenda: [],
  cover: { focalX: 50, focalY: 50, source: "preset" },
  tags: [],
});

assert.deepEqual(
  EventPageContentSchema.parse({
    agenda: [
      { description: "Welcome", id: "doors", time: "18:00", title: "Doors" },
    ],
    cover: { focalX: 20, focalY: 75, source: "upload" },
    tags: ["Community"],
  }).tags,
  ["Community"],
);

assert.throws(() =>
  EventPageContentSchema.parse({
    agenda: [
      { id: "same", time: "18:00", title: "First" },
      { id: "same", time: "19:00", title: "Second" },
    ],
  }),
);
assert.throws(() => EventPageContentSchema.parse({ tags: ["Music", "Music"] }));
assert.throws(() =>
  EventPageContentSchema.parse({
    agenda: [{ id: "late", time: "25:00", title: "Impossible" }],
  }),
);

console.log("event page content contract ok");
