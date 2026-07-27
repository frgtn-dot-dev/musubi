import { describe, expect, it } from "vitest";
import {
  createTimeGeometry,
  densityFromPageConfig,
  durationToHeight,
  gridHeight,
  minutesToY,
  yToMinutes,
  type Density,
} from "./time-geometry";

const DENSITIES: Density[] = ["compact", "comfortable", "spacious"];

describe("createTimeGeometry", () => {
  it("derives pxPerMinute from the hour height", () => {
    for (const density of DENSITIES) {
      const geometry = createTimeGeometry(density);
      expect(geometry.pxPerMinute).toBeCloseTo(geometry.hourHeight / 60);
    }
  });

  it("gets taller with each step", () => {
    const [compact, comfortable, spacious] = DENSITIES.map((density) =>
      createTimeGeometry(density).hourHeight,
    );
    expect(compact).toBeLessThan(comfortable!);
    expect(comfortable).toBeLessThan(spacious!);
  });

  it("defaults to comfortable", () => {
    expect(createTimeGeometry().hourHeight).toBe(
      createTimeGeometry("comfortable").hourHeight,
    );
  });
});

describe("minutesToY / yToMinutes", () => {
  // The bug this guards against: the grid drawing one scale while hit-testing
  // uses another, so the cursor drifts against the time it points at.
  it("round-trips snapped minutes at every density", () => {
    for (const density of DENSITIES) {
      const geometry = createTimeGeometry(density);
      for (const minutes of [0, 15, 60, 9 * 60 + 30, 23 * 60 + 45]) {
        expect(yToMinutes(minutesToY(minutes, geometry), geometry)).toBe(
          minutes,
        );
      }
    }
  });

  it("snaps to the nearest interval", () => {
    const geometry = createTimeGeometry("comfortable");
    const y = minutesToY(64, geometry); // 1:04
    expect(yToMinutes(y, geometry)).toBe(60);
    expect(yToMinutes(minutesToY(68, geometry), geometry)).toBe(75);
  });

  it("can report the unsnapped minute", () => {
    const geometry = createTimeGeometry("comfortable");
    expect(
      yToMinutes(minutesToY(64, geometry), geometry, { snap: false }),
    ).toBeCloseTo(64);
  });

  it("clamps past either edge, leaving room for one interval", () => {
    const geometry = createTimeGeometry("comfortable");
    expect(yToMinutes(-500, geometry)).toBe(0);
    // A pointer dragged below the grid must still yield a usable start.
    expect(yToMinutes(gridHeight(geometry) + 500, geometry)).toBe(
      24 * 60 - geometry.snapMinutes,
    );
  });
});

describe("durationToHeight", () => {
  it("keeps a very short event clickable", () => {
    const geometry = createTimeGeometry("compact");
    expect(durationToHeight(1, geometry)).toBe(geometry.minEventHeight);
  });

  it("scales with duration once past the minimum", () => {
    const geometry = createTimeGeometry("comfortable");
    expect(durationToHeight(120, geometry)).toBe(2 * geometry.hourHeight);
  });
});

describe("densityFromPageConfig", () => {
  const base = {
    calendarVisibility: { hiddenCalendarIds: [], mode: "all" as const },
    filters: [],
    schemaVersion: 1 as const,
  };

  it("reads the density a time-grid view carries", () => {
    expect(
      densityFromPageConfig({
        ...base,
        view: { configVersion: 1, density: "spacious", id: "week", weekend: true },
      }),
    ).toBe("spacious");
  });

  it("falls back to comfortable for views without the field", () => {
    expect(
      densityFromPageConfig({
        ...base,
        view: { configVersion: 1, id: "month", showAdjacentDays: true },
      }),
    ).toBe("comfortable");
    expect(densityFromPageConfig(undefined)).toBe("comfortable");
  });
});
