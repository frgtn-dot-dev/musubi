import { describe, expect, it } from "vitest";
import {
  clientVersionVerdict,
  clockSkewVerdict,
  formatChecks,
  permissionVerdict,
  reachabilityVerdict,
  reminderRulesVerdict,
  scheduleDriftVerdict,
  summarise,
  type CheckResult,
} from "./healthChecks";

describe("clockSkewVerdict", () => {
  it("passes a clock that agrees with the server", () => {
    expect(clockSkewVerdict(400).status).toBe("pass");
  });

  it("warns before a human would notice, and fails once they would", () => {
    expect(clockSkewVerdict(45_000).status).toBe("warn");
    expect(clockSkewVerdict(180_000).status).toBe("fail");
  });

  // A phone behind the server is as broken as one ahead, and the sign is what
  // tells you which way the reminders land.
  it("judges a clock behind the server the same as one ahead", () => {
    expect(clockSkewVerdict(-180_000).status).toBe("fail");
    expect(clockSkewVerdict(-180_000).detail).toContain("behind");
    expect(clockSkewVerdict(180_000).detail).toContain("ahead of");
  });
});

describe("scheduleDriftVerdict", () => {
  it("passes when the system holds what this device recorded", () => {
    expect(scheduleDriftVerdict(12, 12).status).toBe("pass");
  });

  // The failure this check exists for: the app believes every reminder is
  // armed and the OS is holding none of them.
  it("fails when the system dropped everything", () => {
    const result = scheduleDriftVerdict(12, 0);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("dropped");
  });

  it("warns on a partial drop and counts it", () => {
    const result = scheduleDriftVerdict(12, 9);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("3 were dropped");
  });

  // Nothing scheduled is not proof of a fault — but it is never proof of
  // health either, so it must not read as a pass.
  it("does not pass an empty schedule", () => {
    expect(scheduleDriftVerdict(0, 0).status).toBe("warn");
  });

  it("passes when the system holds more than this device recorded", () => {
    expect(scheduleDriftVerdict(2, 3).status).toBe("pass");
  });
});

describe("clientVersionVerdict", () => {
  it("passes a build the server still accepts", () => {
    expect(clientVersionVerdict("0.1.6", "0.1.6").status).toBe("pass");
  });

  it("fails a build below the server's floor", () => {
    const result = clientVersionVerdict("0.1.5", "0.1.6");
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Update from the store");
  });

  // "0.1.10" sorts before "0.1.9" as a string, which would call a newer build
  // too old and send someone to the store for nothing.
  it("compares numerically, not as strings", () => {
    expect(clientVersionVerdict("0.1.10", "0.1.9").status).toBe("pass");
  });

  it("warns rather than passing when the server names no minimum", () => {
    expect(clientVersionVerdict("0.1.6", null).status).toBe("warn");
  });
});

describe("permissionVerdict", () => {
  it("passes only on granted", () => {
    expect(permissionVerdict("granted", false).status).toBe("pass");
  });

  // The two denials need different advice: one is fixable in the app, the
  // other only in system settings.
  it("separates never-asked from permanently refused", () => {
    expect(permissionVerdict("undetermined", true).detail).toContain(
      "Ask for permission",
    );
    expect(permissionVerdict("denied", false).detail).toContain(
      "system settings",
    );
  });
});

describe("reminderRulesVerdict", () => {
  it("fails when the rules the reconcile needs are missing", () => {
    const result = reminderRulesVerdict(false);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("no reminder is ever scheduled");
  });
});

describe("reachabilityVerdict", () => {
  it("warns on a slow but working server", () => {
    expect(reachabilityVerdict(true, 200, 120).status).toBe("pass");
    expect(reachabilityVerdict(true, 200, 4_000).status).toBe("warn");
  });

  it("carries the transport error when there was no answer at all", () => {
    const result = reachabilityVerdict(false, null, 0, "Network request failed");
    expect(result.status).toBe("fail");
    expect(result.detail).toBe("Network request failed");
  });
});

describe("the report", () => {
  const results: CheckResult[] = [
    { detail: "Granted.", id: "a", label: "Passing", status: "pass" },
    { detail: "Slow.", id: "b", label: "Warning", status: "warn" },
    { detail: "Gone.", id: "c", label: "Failing", status: "fail" },
  ];

  // Whoever reads a pasted report reads the top of it first.
  it("puts failures first", () => {
    const lines = formatChecks(results).split("\n");
    expect(lines[0]).toBe("[FAIL] Failing: Gone.");
    expect(lines[2]).toBe("[ok] Passing: Granted.");
  });

  it("summarises what the run found", () => {
    expect(summarise(results)).toBe("1 failing, 1 warning");
    expect(summarise([results[0]])).toBe("all passing");
    expect(summarise([results[0], results[1]])).toBe("all passing, 1 warning");
  });
});
