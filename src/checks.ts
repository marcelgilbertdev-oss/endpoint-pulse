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

export function evaluate(
  config: EndpointConfig,
  response: FetchedResponse | { error: string },
  latencyMs: number,
  now: number,
): CheckResult {
  const base = { endpointId: config.id, latencyMs, checkedAt: now };

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
