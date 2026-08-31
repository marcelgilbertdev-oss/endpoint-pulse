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
};

export type EndpointState = {
  endpointId: string;
  lastResult: CheckResult | null;
  /** Ring buffer of recent results, newest first. */
  history: CheckResult[];
};

export const HISTORY_LIMIT = 50;

export const DEFAULT_ENDPOINTS: EndpointConfig[] = [
  {
    id: "zerofayyz-fintech-api",
    name: "ZEROFAYYZ Fintech API",
    url: "https://zerofayyz-fintech-api.onrender.com/api/v1/health",
    intervalMinutes: 5,
    expect: { status: 200, jsonPath: "status", equals: "operational" },
  },
];
