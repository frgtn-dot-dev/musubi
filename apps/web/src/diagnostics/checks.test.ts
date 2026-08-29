import { describe, expect, it } from "vitest";
import {
  bundleVersionVerdict,
  clockSkewVerdict,
  formatChecks,
  permissionVerdict,
  pushVerdict,
  reachabilityVerdict,
  reminderRulesVerdict,
  serviceWorkerVerdict,
  summarise,
  worstStatus,
  type CheckResult,
} from "./checks";

describe("reachabilityVerdict", () => {
  it("warns on a slow but working server", () => {
    expect(reachabilityVerdict(true, 200, 120).status).toBe("pass");
    expect(reachabilityVerdict(true, 200, 4_000).status).toBe("warn");
  });

  it("carries the transport error when there was no answer at all", () => {
    const result = reachabilityVerdict(false, null, 0, "Failed to fetch");
    expect(result.status).toBe("fail");
    expect(result.detail).toBe("Failed to fetch");
  });
});

describe("clockSkewVerdict", () => {
  it("passes a clock that agrees with the server", () => {
    expect(clockSkewVerdict(400).status).toBe("pass");
  });

  it("warns before a person would notice, and fails once they would", () => {
    expect(clockSkewVerdict(45_000).status).toBe("warn");
    expect(clockSkewVerdict(180_000).status).toBe("fail");
  });

  it("judges a clock behind the server the same as one ahead", () => {
    expect(clockSkewVerdict(-180_000).status).toBe("fail");
    expect(clockSkewVerdict(-180_000).detail).toContain("behind");
    expect(clockSkewVerdict(180_000).detail).toContain("ahead of");
  });
});

describe("bundleVersionVerdict", () => {
  it("passes a tab level with its server", () => {
    expect(bundleVersionVerdict("0.1.6", "0.1.6").status).toBe("pass");
  });

  it("warns when the server has moved ahead of this tab", () => {
    const result = bundleVersionVerdict("0.1.6", "0.1.7");
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Reload");
  });

  // A self-hosted server behind the app it serves is ordinary, and there is no
  // newer bundle to reload into — saying anything here would be a nag.
  it("says nothing about a server behind the tab", () => {
    expect(bundleVersionVerdict("0.1.7", "0.1.6").status).toBe("pass");
  });

  // "0.1.10" sorts before "0.1.9" as a string, which would hide a real update.
  it("compares numerically, not as strings", () => {
    expect(bundleVersionVerdict("0.1.9", "0.1.10").status).toBe("warn");
  });

  it("warns rather than passing when the server names no version", () => {
    expect(bundleVersionVerdict("0.1.6", null).status).toBe("warn");
  });
});

describe("permissionVerdict", () => {
  it("passes only on granted", () => {
    expect(permissionVerdict("granted").status).toBe("pass");
  });

  // The two refusals need different advice: one is a click away, the other is
  // only reachable through the browser's own site settings.
  it("separates never-asked from refused", () => {
    expect(permissionVerdict("default").detail).toContain("Never asked");
    expect(permissionVerdict("denied").detail).toContain("browser settings");
    expect(permissionVerdict("default").status).toBe("fail");
  });

  it("reports a browser with no Notification API at all", () => {
    expect(permissionVerdict("unsupported").status).toBe("fail");
  });
});

describe("pushVerdict", () => {
  const state = { serverCapable: true, subscribed: true, supported: true };

  it("passes when this browser is on the server's list", () => {
    expect(pushVerdict(state).status).toBe("pass");
  });

  // None of these is a fault — in-tab reminders are the documented fallback —
  // but each is a reason somebody says reminders never arrive.
  it("names which part is missing", () => {
    expect(pushVerdict({ ...state, supported: false }).detail).toContain(
      "cannot receive push",
    );
    expect(pushVerdict({ ...state, serverCapable: false }).detail).toContain(
      "no push keys",
    );
    expect(pushVerdict({ ...state, subscribed: false }).detail).toContain(
      "Not subscribed",
    );
  });

  it("warns rather than failing on every one of them", () => {
    for (const missing of ["serverCapable", "subscribed", "supported"] as const) {
      expect(pushVerdict({ ...state, [missing]: false }).status).toBe("warn");
    }
  });
});

describe("serviceWorkerVerdict", () => {
  it("passes a registered worker and names its scope", () => {
    const result = serviceWorkerVerdict("https://musubi.pro/app/", true);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("/app/");
  });

  // The gateway routes only /app/* to this app, so a misroute answers the
  // worker's URL with the marketing site and registration throws.
  it("points at the worker URL when nothing is registered", () => {
    const result = serviceWorkerVerdict(null, true);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("/app/sw.js");
  });
});

describe("reminderRulesVerdict", () => {
  it("fails when the rules everything resolves from are missing", () => {
    expect(reminderRulesVerdict(false).status).toBe("fail");
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

  it("takes its colour from the worst result", () => {
    expect(worstStatus(results)).toBe("fail");
    expect(worstStatus([results[0], results[1]])).toBe("warn");
    expect(worstStatus([results[0]])).toBe("pass");
    expect(worstStatus([])).toBe("pass");
  });
});
