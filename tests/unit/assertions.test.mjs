// The assertion evaluator is what stands between a build and a portal rejection, so it is
// tested for what it REJECTS at least as hard as for what it accepts. An evaluator that
// always passes is worse than none: it produces a record saying the rules were checked.

import { describe, expect, it } from "vitest";
import { evaluate, evaluateProfile } from "../../scripts/verify/evaluate-assertions.mjs";

const facts = {
  package: {
    size_mb: 4.9,
    locales: ["en", "ru"],
    platform_sdk: "none",
    calls_loading_api: true,
    insecure_requests: 0,
    uses_rewarded_ads: false,
    perf: { time_to_interactive_s: 1.2 },
  },
  metadata: { screenshots: 3 },
};

const holds = (expression) => evaluate(expression, facts).holds;

describe("ordering operators", () => {
  it("compares numbers", () => {
    expect(holds({ left: "package.size_mb", op: "lte", right: 50 })).toBe(true);
    expect(holds({ left: "package.size_mb", op: "lte", right: 1 })).toBe(false);
    expect(holds({ left: "metadata.screenshots", op: "gte", right: 3 })).toBe(true);
    expect(holds({ left: "metadata.screenshots", op: "gte", right: 4 })).toBe(false);
  });

  it("reads a nested path", () => {
    expect(holds({ left: "package.perf.time_to_interactive_s", op: "lte", right: 5 })).toBe(true);
  });

  it("refuses to compare a non-number rather than quietly returning false", () => {
    expect(() => evaluate({ left: "package.platform_sdk", op: "lte", right: 5 }, facts)).toThrow(
      /needs numbers/,
    );
  });
});

describe("equality", () => {
  it("handles scalars and booleans", () => {
    expect(holds({ left: "package.platform_sdk", op: "eq", right: "none" })).toBe(true);
    expect(holds({ left: "package.platform_sdk", op: "eq", right: "yandex" })).toBe(false);
    expect(holds({ left: "package.calls_loading_api", op: "eq", right: true })).toBe(true);
    expect(holds({ left: "package.uses_rewarded_ads", op: "eq", right: false })).toBe(true);
    expect(holds({ left: "package.insecure_requests", op: "neq", right: 0 })).toBe(false);
  });
});

describe("containment", () => {
  // This is the case that decides whether locale assertions mean anything. Read the other
  // way round, `{left: package.locales, op: in, right: [ru]}` would pass for any package
  // that ships no locales at all — and it is blocking on three platforms.
  it("asks whether an array measurement contains every wanted element", () => {
    expect(holds({ left: "package.locales", op: "in", right: ["ru"] })).toBe(true);
    expect(holds({ left: "package.locales", op: "in", right: ["en", "ru"] })).toBe(true);
    expect(holds({ left: "package.locales", op: "in", right: ["vi"] })).toBe(false);
  });

  it("fails when the package ships no locales", () => {
    const empty = { package: { locales: [] } };
    expect(evaluate({ left: "package.locales", op: "in", right: ["ru"] }, empty).holds).toBe(false);
  });

  it("asks whether a scalar measurement appears in the list", () => {
    expect(holds({ left: "package.platform_sdk", op: "in", right: ["none", "poki"] })).toBe(true);
    expect(holds({ left: "package.platform_sdk", op: "in", right: ["poki"] })).toBe(false);
  });

  it("negates with not_in", () => {
    expect(holds({ left: "package.locales", op: "not_in", right: ["vi"] })).toBe(true);
    expect(holds({ left: "package.locales", op: "not_in", right: ["ru"] })).toBe(false);
  });
});

describe("right_path", () => {
  const two = {
    package: { size_mb: 4.9, budget_mb: 50, locales: ["en"], required_locales: ["en", "ru"] },
  };

  it("compares two measured values", () => {
    expect(
      evaluate({ left: "package.size_mb", op: "lte", right_path: "package.budget_mb" }, two).holds,
    ).toBe(true);
    expect(
      evaluate({ left: "package.budget_mb", op: "lte", right_path: "package.size_mb" }, two).holds,
    ).toBe(false);
  });

  it("applies containment against a resolved path too", () => {
    expect(
      evaluate({ left: "package.required_locales", op: "in", right_path: "package.locales" }, two)
        .holds,
    ).toBe(true);
    expect(
      evaluate({ left: "package.locales", op: "in", right_path: "package.required_locales" }, two)
        .holds,
    ).toBe(false);
  });

  it("refuses a comparison that gives both sides", () => {
    expect(() =>
      evaluate(
        { left: "package.size_mb", op: "lte", right: 1, right_path: "package.budget_mb" },
        two,
      ),
    ).toThrow(/both right and right_path/);
  });

  it("treats an unmeasured right_path as unevaluable, not as false", () => {
    expect(() =>
      evaluate({ left: "package.size_mb", op: "lte", right_path: "package.missing" }, two),
    ).toThrow(/was not measured/);
  });
});

describe("presence", () => {
  it("distinguishes measured from unmeasured", () => {
    expect(holds({ left: "package.size_mb", op: "exists" })).toBe(true);
    expect(holds({ left: "package.nothing_here", op: "exists" })).toBe(false);
    expect(holds({ left: "package.nothing_here", op: "absent" })).toBe(true);
  });
});

describe("composites", () => {
  const small = { left: "package.size_mb", op: "lte", right: 50 };
  const huge = { left: "package.size_mb", op: "gte", right: 999 };

  it("combines with all_of, any_of and not", () => {
    expect(
      holds({ all_of: [small, { left: "package.insecure_requests", op: "eq", right: 0 }] }),
    ).toBe(true);
    expect(holds({ all_of: [small, huge] })).toBe(false);
    expect(holds({ any_of: [small, huge] })).toBe(true);
    expect(holds({ any_of: [huge] })).toBe(false);
    expect(holds({ not: huge })).toBe(true);
    expect(holds({ not: small })).toBe(false);
  });
});

describe("evaluateProfile", () => {
  const profile = {
    version: "1.0.0",
    assertions: [
      {
        id: "size",
        check: { left: "package.size_mb", op: "lte", right: 50 },
        severity: "blocking",
      },
      {
        id: "too_big",
        check: { left: "package.size_mb", op: "lte", right: 1 },
        severity: "blocking",
      },
      {
        id: "shots",
        check: { left: "metadata.screenshots", op: "gte", right: 9 },
        severity: "warning",
      },
      {
        id: "unmeasured",
        check: { left: "package.never_measured", op: "eq", right: 1 },
        severity: "blocking",
      },
    ],
  };

  const results = evaluateProfile(profile, facts, "2026-01-01T00:00:00.000Z");
  const byId = Object.fromEntries(results.map((result) => [result.criterion_id, result]));

  it("records passes as well as failures", () => {
    expect(results).toHaveLength(4);
    expect(byId["size"].breached).toBe(false);
    expect(byId["size"].measured).toBe(4.9);
  });

  it("marks a breach and keeps the measured value", () => {
    expect(byId["too_big"].breached).toBe(true);
    expect(byId["too_big"].measured).toBe(4.9);
  });

  it("keeps severity so warnings do not read as failures", () => {
    expect(byId["shots"].breached).toBe(true);
    expect(byId["shots"].severity).toBe("warning");
  });

  it("treats an unmeasurable fact as a breach, not as a pass", () => {
    // A fact nobody measured must never satisfy a blocking rule by omission.
    expect(byId["unmeasured"].breached).toBe(true);
    expect(byId["unmeasured"].note).toMatch(/not evaluable/);
  });

  it("emits the criterionResult shape platform-publication expects", () => {
    expect(Object.keys(byId["size"]).sort()).toEqual(
      ["breached", "criterion_id", "evaluated_at", "measured", "severity"].sort(),
    );
  });
});
