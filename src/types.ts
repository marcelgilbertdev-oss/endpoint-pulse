/**
 * An endpoint the user watches. Lives in chrome.storage.sync so a signed-in
 * Chrome carries the list across machines; results live in storage.local
 * because history is bulky, per-machine, and worthless to sync.
 */
export type EndpointConfig = {
  id: string;
  name: string;
  url: string;
  /** Minutes between checks. The alarm ticks every minute; endpoints run when due. */
  intervalMinutes: number;
  expect: {
    /** HTTP status that counts as healthy. */
    status: number;
    /** Optional: dot-path into the JSON body, e.g. "checks.database.status". */
    jsonPath?: string;
    /** Required when jsonPath is set: the value that counts as healthy. */
    equals?: string;
  };
};

export type CheckOutcome = "ok" | "fail";

export type CheckResult = {
  endpointId: string;
  outcome: CheckOutcome;
  /** Why a fail failed — shown in the popup, worded for the person reading it. */
  reason: string | null;
  latencyMs: number;
  checkedAt: number;
  /**
   * True when the first attempt failed to complete and a second one answered.
   * The check counts as ok — one dropped request is the network, not the
   * service — but a watcher that hides the retry cannot show a path that is
   * quietly degrading, so it is recorded and surfaced.
   */
  retried: boolean;
};

export type EndpointState = {
  endpointId: string;
  lastResult: CheckResult | null;
  /** Ring buffer of recent results, newest first. */
  history: CheckResult[];
};

export const HISTORY_LIMIT = 50;

/**
 * The seeded platform endpoint before 2026-09-14. A stored copy of it is
 * rewritten to the liveness route on startup (see background.ts), so an
 * installed extension heals itself on reload instead of waiting for the
 * user to notice the database bill.
 */
export const RETIRED_PLATFORM_HEALTH_URL =
  "https://zerofayyz-fintech-api.onrender.com/api/v1/health";

export const DEFAULT_ENDPOINTS: EndpointConfig[] = [
  {
    id: "zerofayyz-fintech-api",
    name: "ZEROFAYYZ Fintech API",
    // The dependency-free liveness route, not /health. /health asks the
    // platform's database for its latency, and a poll every five minutes is
    // exactly enough to stop a scale-to-zero database from ever sleeping —
    // found on 2026-09-14 when this extension, open in a browser all day,
    // turned out to be what was burning the free tier's monthly compute
    // (platform ADR 20). A watcher must not cost the thing it watches.
    url: "https://zerofayyz-fintech-api.onrender.com/api/v1/live",
    intervalMinutes: 5,
    expect: { status: 200, jsonPath: "live", equals: "true" },
  },
];
