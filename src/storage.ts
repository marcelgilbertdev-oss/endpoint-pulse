/**
 * Storage split, and why: configs go to storage.sync (small, user-authored,
 * worth carrying between machines); results go to storage.local (bulky,
 * machine-specific, regenerated within minutes anyway). Both APIs survive the
 * service worker being killed, which module-level variables do not — MV3
 * workers stop after ~30s idle, so anything worth keeping must be written out.
 */
import { DEFAULT_ENDPOINTS, type EndpointConfig, type EndpointState } from "./types.js";

const CONFIG_KEY = "endpoints";
const STATE_KEY = "states";

export async function loadConfigs(): Promise<EndpointConfig[]> {
  const found = await chrome.storage.sync.get(CONFIG_KEY);
  const list = found[CONFIG_KEY] as EndpointConfig[] | undefined;
  return list ?? DEFAULT_ENDPOINTS;
}

export async function saveConfigs(configs: EndpointConfig[]): Promise<void> {
  await chrome.storage.sync.set({ [CONFIG_KEY]: configs });
}

export async function loadStates(): Promise<Record<string, EndpointState>> {
  const found = await chrome.storage.local.get(STATE_KEY);
  return (found[STATE_KEY] as Record<string, EndpointState> | undefined) ?? {};
}

export async function saveStates(states: Record<string, EndpointState>): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: states });
}

/** True when the user has granted this endpoint's origin. */
export async function hasOriginPermission(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  if (pattern === null) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

/** Origin pattern for chrome.permissions, e.g. "https://api.example.com/*". */
export function originPattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}
