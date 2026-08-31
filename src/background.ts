/**
 * The service worker. Thin on purpose: alarms, fetch, storage, badge,
 * notifications — every decision lives in checks.ts where it is unit-tested.
 *
 * MV3 discipline this file demonstrates:
 *  - the worker is killed after ~30s idle, so ALL state lives in storage;
 *  - alarms are re-registered on install and on browser startup, because an
 *    alarm outliving its registration is not guaranteed;
 *  - host access is requested at runtime per-origin (optional_host_permissions),
 *    never as a blanket install-time grab.
 */
import { badge, evaluate, fold, isDue, transition, type FetchedResponse } from "./checks.js";
import { loadConfigs, loadStates, saveStates } from "./storage.js";
import type { CheckResult, EndpointConfig } from "./types.js";

const ALARM = "pulse";

chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) {
    // Tick every minute; per-endpoint intervals decide who actually runs.
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  }
  await poll(); // an install or a browser start deserves an immediate read
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void poll();
});

// The popup asks for an immediate check; sendResponse(true) after the run.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message === "check-now") {
    void poll(true).then(() => sendResponse(true));
    return true; // keep the channel open for the async response
  }
  return false;
});

async function fetchEndpoint(config: EndpointConfig): Promise<CheckResult> {
  const started = performance.now();
  const now = Date.now();
  try {
    const response = await fetch(config.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    const fetched: FetchedResponse = { status: response.status, json };
    return evaluate(config, fetched, Math.round(performance.now() - started), now);
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "timed out after 15s"
        : "network error — host unreachable or permission not granted";
    return evaluate(config, { error: reason }, Math.round(performance.now() - started), now);
  }
}

async function poll(force = false): Promise<void> {
  const configs = await loadConfigs();
  const states = await loadStates();
  const now = Date.now();

  for (const config of configs) {
    if (!force && !isDue(config, states[config.id], now)) continue;

    const previous = states[config.id]?.lastResult ?? null;
    const result = await fetchEndpoint(config);
    states[config.id] = fold(states[config.id], result);

    const change = transition(previous, result);
    if (change !== null) {
      // Notifications carry the reason, not just the fact — "HTTP 503,
      // expected 200" is actionable; "endpoint failed" is an anxiety ping.
      chrome.notifications.create(`${config.id}:${result.checkedAt}`, {
        type: "basic",
        iconUrl: "icons/pulse128.png",
        title:
          change === "went-down"
            ? `${config.name} is failing`
            : `${config.name} recovered`,
        message:
          change === "went-down"
            ? result.reason ?? "check failed"
            : `healthy again after ${result.latencyMs}ms`,
      });
    }
  }

  // Drop state for endpoints that no longer exist in config.
  const known = new Set(configs.map((c) => c.id));
  for (const id of Object.keys(states)) {
    if (!known.has(id)) delete states[id];
  }

  await saveStates(states);

  const summary = badge(Object.values(states));
  await chrome.action.setBadgeText({ text: summary.text });
  await chrome.action.setBadgeBackgroundColor({ color: summary.color });
}
