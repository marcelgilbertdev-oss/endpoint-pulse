import { describe, expect, test } from "vitest";

import {
  badge,
  checkWithRetry,
  evaluate,
  fold,
  isDue,
  readPath,
  transition,
} from "../src/checks.js";
import { HISTORY_LIMIT, type CheckResult, type EndpointConfig } from "../src/types.js";
import { DEFAULT_ENDPOINTS, RETIRED_PLATFORM_HEALTH_URL } from "../src/types.js";

const config: EndpointConfig = {
  id: "api",
  name: "API",
  url: "https://example.com/health",
  intervalMinutes: 5,
  expect: { status: 200, jsonPath: "checks.database.status", equals: "operational" },
};

const result = (outcome: "ok" | "fail", checkedAt = 0, retried = false): CheckResult => ({
  endpointId: "api",
  outcome,
  reason: outcome === "fail" ? "boom" : null,
  latencyMs: 10,
  checkedAt,
  retried,
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
      retried: false,
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

describe("migrateRetiredPlatformUrl", () => {
  test("rewrites the retired /health seed to the liveness route and leaves user URLs alone", async () => {
    const sync: Record<string, unknown> = {
      endpoints: [
        { id: "a", name: "platform", url: RETIRED_PLATFORM_HEALTH_URL, intervalMinutes: 5,
          expect: { status: 200, jsonPath: "status", equals: "operational" } },
        { id: "b", name: "mine", url: "https://example.com/health", intervalMinutes: 5,
          expect: { status: 200 } },
      ],
    };
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: async (key: string) => ({ [key]: sync[key] }),
          set: async (obj: Record<string, unknown>) => { Object.assign(sync, obj); },
        },
        local: { get: async () => ({}), set: async () => {} },
      },
      alarms: { get: async () => undefined, create: () => {}, onAlarm: { addListener() {} } },
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
      permissions: { contains: async () => true },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      notifications: { create: () => {} },
    };
    const { migrateRetiredPlatformUrl } = await import("../src/background.js");
    expect(await migrateRetiredPlatformUrl()).toBe(true);
    const after = sync.endpoints as Array<{ url: string; expect: { jsonPath?: string; equals?: string } }>;
    expect(after[0]?.url).toBe(DEFAULT_ENDPOINTS[0]?.url);
    expect(after[0]?.expect).toEqual({ status: 200, jsonPath: "live", equals: "true" });
    expect(after[1]?.url).toBe("https://example.com/health");
    expect(await migrateRetiredPlatformUrl()).toBe(false); // idempotent
  });
});

describe("a retry is recorded, not hidden", () => {
  // 2026-09-24: the popup reported the platform API down with "network error —
  // host unreachable or permission not granted". The API was up — 12/12 probes
  // returned 200 — and permission was granted; the give-away was the 313ms
  // latency, because the no-permission path returns 0ms without fetching. One
  // request had died in transport and a single failed poll flipped the badge.
  test("a check that succeeded on the second attempt is ok, and says so", () => {
    const outcome = evaluate(
      config,
      { status: 200, json: { checks: { database: { status: "operational" } } } },
      12,
      1000,
      true,
    );
    expect(outcome.outcome).toBe("ok");
    expect(outcome.retried).toBe(true);
    expect(outcome.reason).toBeNull();
  });

  test("an ordinary check is not marked as retried", () => {
    const outcome = evaluate(
      config,
      { status: 200, json: { checks: { database: { status: "operational" } } } },
      12,
      1000,
    );
    expect(outcome.retried).toBe(false);
  });

  test("a failure that survived both attempts is still a failure", () => {
    const outcome = evaluate(
      config,
      { error: "the request did not complete (two attempts)" },
      30,
      1000,
      true,
    );
    expect(outcome.outcome).toBe("fail");
    expect(outcome.retried).toBe(true);
    expect(outcome.reason).toContain("two attempts");
  });

  test("a retried success does not fire a went-down notification", () => {
    // The whole point: one dropped request must not notify. A transition is
    // computed from outcomes, so a retried ok has to read as ok.
    const previous = result("ok", 0);
    const current = result("ok", 60_000, true);
    expect(transition(previous, current)).toBeNull();
  });

  test("a reason never blames permission once permission has been checked", () => {
    // background.ts settles permission before fetching, so the transport
    // failure message must not offer it as a possible cause.
    const outcome = evaluate(config, { error: "the request did not complete" }, 313, 1000);
    expect(outcome.reason).not.toContain("permission");
  });
});

describe("checkWithRetry — which failures earn a second attempt", () => {
  const healthy = {
    status: 200,
    json: { checks: { database: { status: "operational" } } },
    latencyMs: 12,
  };
  // No real delay: the sleep is injected precisely so the suite stays instant.
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);

  const attemptsOf = (...answers: unknown[]) => {
    let i = 0;
    const calls = { count: 0 };
    const attempt = async () => {
      calls.count += 1;
      return answers[Math.min(i++, answers.length - 1)] as never;
    };
    return { attempt, calls };
  };

  test("a request that never completed is retried, and a good second answer is ok", async () => {
    const { attempt, calls } = attemptsOf(
      { error: "the request did not complete", timedOut: false, latencyMs: 313 },
      healthy,
    );
    const outcome = await checkWithRetry(config, attempt, sleep, 1000, 400);
    expect(calls.count).toBe(2);
    expect(outcome.outcome).toBe("ok");
    expect(outcome.retried).toBe(true);
    // The latency shown is the attempt that actually answered, not the blip.
    expect(outcome.latencyMs).toBe(12);
  });

  test("a healthy first attempt is never retried", async () => {
    const { attempt, calls } = attemptsOf(healthy);
    const outcome = await checkWithRetry(config, attempt, sleep, 1000, 400);
    expect(calls.count).toBe(1);
    expect(outcome.retried).toBe(false);
    expect(outcome.outcome).toBe("ok");
  });

  test("a response that ARRIVED and was wrong is not retried — the service answered", async () => {
    // A 503 is the service speaking. Asking again does not make it truer, and
    // retrying would halve the speed at which a real outage is reported.
    const { attempt, calls } = attemptsOf({ status: 503, json: {}, latencyMs: 20 });
    const outcome = await checkWithRetry(config, attempt, sleep, 1000, 400);
    expect(calls.count).toBe(1);
    expect(outcome.outcome).toBe("fail");
    expect(outcome.retried).toBe(false);
    expect(outcome.reason).toContain("503");
  });

  test("a timeout is not retried — 15s of silence is already the signal", async () => {
    const { attempt, calls } = attemptsOf({
      error: "timed out after 15s",
      timedOut: true,
      latencyMs: 15_000,
    });
    const outcome = await checkWithRetry(config, attempt, sleep, 1000, 400);
    expect(calls.count).toBe(1);
    expect(outcome.outcome).toBe("fail");
    expect(outcome.reason).toBe("timed out after 15s");
  });

  test("failing twice is a real failure, and the reason says both attempts went", async () => {
    const { attempt, calls } = attemptsOf({
      error: "the request did not complete",
      timedOut: false,
      latencyMs: 300,
    });
    const outcome = await checkWithRetry(config, attempt, sleep, 1000, 400);
    expect(calls.count).toBe(2);
    expect(outcome.outcome).toBe("fail");
    expect(outcome.retried).toBe(true);
    expect(outcome.reason).toBe("the request did not complete (two attempts)");
  });

  test("one blip does not fire a went-down notification", async () => {
    // The defect this whole change exists for: a single dropped request used
    // to flip the badge red and notify.
    const { attempt } = attemptsOf(
      { error: "the request did not complete", timedOut: false, latencyMs: 313 },
      healthy,
    );
    const previouslyOk = evaluate(config, { status: 200, json: healthy.json }, 10, 0);
    const now = await checkWithRetry(config, attempt, sleep, 60_000, 400);
    expect(transition(previouslyOk, now)).toBeNull();
  });

  test("two failed attempts still fire went-down", async () => {
    const { attempt } = attemptsOf({ error: "the request did not complete", timedOut: false });
    const previouslyOk = evaluate(config, { status: 200, json: healthy.json }, 10, 0);
    const now = await checkWithRetry(config, attempt, sleep, 60_000, 400);
    expect(transition(previouslyOk, now)).toBe("went-down");
  });
});
