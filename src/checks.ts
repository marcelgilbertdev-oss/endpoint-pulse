/**
 * Pure logic: evaluating a response against an endpoint's expectation, and
 * folding a result into state. No chrome.* here — this file is where the
 * unit tests live, and the service worker stays a thin shell around it.
 */
import {
  HISTORY_LIMIT,
  type CheckResult,
  type EndpointConfig,
  type EndpointState,
} from "./types.js";

/** Walk a dot-path into parsed JSON. Returns undefined the moment it can't. */
export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export type FetchedResponse = {
  status: number;
  /** Parsed JSON body, or undefined when the body wasn't JSON. */
  json: unknown;
};

/** A response that arrived, with how long it took. */
export type Answered = FetchedResponse & { latencyMs: number };
/**
 * A request that never produced a response, whether the clock ran out, and how
 * long it took to fail — a fast failure is a reset, a slow one is a timeout,
 * and the difference is what told us this was transport and not permission.
 */
export type Unanswered = { error: string; timedOut: boolean; latencyMs?: number };

/**
 * Run a check, retrying ONCE when the request never completed.
 *
 * 2026-09-24: the popup reported the platform API down. The API was up — 12 of
 * 12 probes returned 200 — and one request had simply died in transport. A
 * single failed poll flipped the badge and fired a notification, which is how a
 * watcher teaches its owner to ignore it.
 *
 * What is NOT retried, and why:
 *  - a response that ARRIVED and was wrong (a 503, a missing JSON field). The
 *    service answered; asking twice does not make its answer truer.
 *  - a TIMEOUT. Fifteen seconds of silence from a dependency-free route is a
 *    real signal, and a second fifteen-second wait would delay the alarm
 *    rather than sharpen it.
 *
 * The attempt and the sleep are injected so this is testable without a network,
 * a browser, or a real delay — the retry is a decision, and decisions live here.
 */
export async function checkWithRetry(
  config: EndpointConfig,
  attempt: () => Promise<Answered | Unanswered>,
  sleep: (ms: number) => Promise<void>,
  now: number,
  retryDelayMs: number,
): Promise<CheckResult> {
  const first = await attempt();

  if (!("error" in first)) {
    const { latencyMs, ...fetched } = first;
    return evaluate(config, fetched, latencyMs, now);
  }

  if (first.timedOut) return evaluate(config, { error: first.error }, first.latencyMs ?? 0, now);

  await sleep(retryDelayMs);
  const second = await attempt();

  if (!("error" in second)) {
    const { latencyMs, ...fetched } = second;
    return evaluate(config, fetched, latencyMs, now, true);
  }
  return evaluate(config, { error: `${second.error} (two attempts)` }, 0, now, true);
}

export function evaluate(
  config: EndpointConfig,
  response: FetchedResponse | { error: string },
  latencyMs: number,
  now: number,
  retried = false,
): CheckResult {
  const base = { endpointId: config.id, latencyMs, checkedAt: now, retried };

  if ("error" in response) {
    return { ...base, outcome: "fail", reason: response.error };
  }
  if (response.status !== config.expect.status) {
    return {
      ...base,
      outcome: "fail",
      reason: `HTTP ${response.status}, expected ${config.expect.status}`,
    };
  }
  const path = config.expect.jsonPath;
  if (path !== undefined) {
    const found = readPath(response.json, path);
    if (found === undefined) {
      return { ...base, outcome: "fail", reason: `no "${path}" in response body` };
    }
    if (String(found) !== config.expect.equals) {
      return {
        ...base,
        outcome: "fail",
        reason: `${path} is "${String(found)}", expected "${config.expect.equals}"`,
      };
    }
  }
  return { ...base, outcome: "ok", reason: null };
}

export function fold(state: EndpointState | undefined, result: CheckResult): EndpointState {
  const history = [result, ...(state?.history ?? [])].slice(0, HISTORY_LIMIT);
  return { endpointId: result.endpointId, lastResult: result, history };
}

/**
 * A notification is a state TRANSITION, not a state. Repeating "still down"
 * every minute teaches people to disable notifications, which is worse than
 * not having them.
 */
export function transition(
  previous: CheckResult | null,
  current: CheckResult,
): "went-down" | "recovered" | null {
  if (previous === null) return current.outcome === "fail" ? "went-down" : null;
  if (previous.outcome === "ok" && current.outcome === "fail") return "went-down";
  if (previous.outcome === "fail" && current.outcome === "ok") return "recovered";
  return null;
}

/** Badge text summarising every endpoint: empty when all ok, else the fail count. */
export function badge(states: EndpointState[]): { text: string; color: string } {
  const failing = states.filter((s) => s.lastResult?.outcome === "fail").length;
  if (failing === 0) return { text: "", color: "#17714E" };
  return { text: String(failing), color: "#B3261E" };
}

/** An endpoint is due when its interval has elapsed since its last check. */
export function isDue(
  config: EndpointConfig,
  state: EndpointState | undefined,
  now: number,
): boolean {
  const last = state?.lastResult?.checkedAt;
  if (last === undefined) return true;
  return now - last >= config.intervalMinutes * 60_000 - 500; // half-second slack for alarm jitter
}
