import { describe, expect, test } from "vitest";

import { badge, evaluate, fold, isDue, readPath, transition } from "../src/checks.js";
import { HISTORY_LIMIT, type CheckResult, type EndpointConfig } from "../src/types.js";

const config: EndpointConfig = {
  id: "api",
  name: "API",
  url: "https://example.com/health",
  intervalMinutes: 5,
  expect: { status: 200, jsonPath: "checks.database.status", equals: "operational" },
};

const result = (outcome: "ok" | "fail", checkedAt = 0): CheckResult => ({
  endpointId: "api",
  outcome,
  reason: outcome === "fail" ? "boom" : null,
  latencyMs: 10,
  checkedAt,
});

describe("readPath", () => {
  test("walks nested objects", () => {
    expect(readPath({ a: { b: { c: "yes" } } }, "a.b.c")).toBe("yes");
  });
  test("returns undefined for a missing leg, not a throw", () => {
    expect(readPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(readPath(null, "a")).toBeUndefined();
    expect(readPath("string", "length")).toBeUndefined(); // objects only, no prototype walks
  });
});

describe("evaluate", () => {
  test("healthy: status and JSON field both match", () => {
    const outcome = evaluate(
      config,
      { status: 200, json: { checks: { database: { status: "operational" } } } },
      12,
      1000,
    );
    expect(outcome).toEqual({
      endpointId: "api", outcome: "ok", reason: null, latencyMs: 12, checkedAt: 1000,
    });
  });

  test("wrong status names both numbers in the reason", () => {
    const outcome = evaluate(config, { status: 503, json: {} }, 12, 0);
    expect(outcome.outcome).toBe("fail");
    expect(outcome.reason).toBe("HTTP 503, expected 200");
  });

  test("right status, wrong field value — the degraded-but-200 case", () => {
    const outcome = evaluate(
      config,
      { status: 200, json: { checks: { database: { status: "down" } } } },
      12,
      0,
    );
    expect(outcome.reason).toBe('checks.database.status is "down", expected "operational"');
  });

  test("missing field is a fail, not an ok — absence of evidence is failure", () => {
    const outcome = evaluate(config, { status: 200, json: {} }, 12, 0);
    expect(outcome.outcome).toBe("fail");
    expect(outcome.reason).toContain("no \"checks.database.status\"");
  });

  test("a network error carries its reason through", () => {
    const outcome = evaluate(config, { error: "timed out after 15s" }, 15000, 0);
    expect(outcome).toMatchObject({ outcome: "fail", reason: "timed out after 15s" });
  });

  test("no jsonPath: status alone decides", () => {
    const statusOnly: EndpointConfig = { ...config, expect: { status: 204 } };
    expect(evaluate(statusOnly, { status: 204, json: undefined }, 1, 0).outcome).toBe("ok");
  });
});

describe("fold", () => {
  test("caps history and keeps newest first", () => {
    let state = undefined as ReturnType<typeof fold> | undefined;
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) state = fold(state, result("ok", i));
    expect(state?.history).toHaveLength(HISTORY_LIMIT);
    expect(state?.history[0]?.checkedAt).toBe(HISTORY_LIMIT + 9);
    expect(state?.lastResult?.checkedAt).toBe(HISTORY_LIMIT + 9);
  });
});

describe("transition", () => {
  test("first-ever failure notifies; first-ever success does not", () => {
    expect(transition(null, result("fail"))).toBe("went-down");
    expect(transition(null, result("ok"))).toBeNull();
  });
  test("only edges notify — a steady state never repeats itself", () => {
    expect(transition(result("ok"), result("fail"))).toBe("went-down");
    expect(transition(result("fail"), result("ok"))).toBe("recovered");
    expect(transition(result("fail"), result("fail"))).toBeNull();
    expect(transition(result("ok"), result("ok"))).toBeNull();
  });
});

describe("badge", () => {
  test("empty text when everything is healthy", () => {
    expect(badge([{ endpointId: "a", lastResult: result("ok"), history: [] }]).text).toBe("");
  });
  test("counts failing endpoints", () => {
    const failing = { endpointId: "a", lastResult: result("fail"), history: [] };
    const fine = { endpointId: "b", lastResult: result("ok"), history: [] };
    expect(badge([failing, fine, { ...failing, endpointId: "c" }]).text).toBe("2");
  });
  test("an unchecked endpoint is not a failing endpoint", () => {
    expect(badge([{ endpointId: "a", lastResult: null, history: [] }]).text).toBe("");
  });
});

describe("isDue", () => {
  test("never-checked is always due", () => {
    expect(isDue(config, undefined, 0)).toBe(true);
  });
  test("due exactly at the interval, with jitter slack", () => {
    const state = { endpointId: "api", lastResult: result("ok", 0), history: [] };
    expect(isDue(config, state, 4 * 60_000)).toBe(false);
    expect(isDue(config, state, 5 * 60_000 - 400)).toBe(true); // alarm fired 400ms early
    expect(isDue(config, state, 5 * 60_000)).toBe(true);
  });
});
