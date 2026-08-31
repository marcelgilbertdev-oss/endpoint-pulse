/** Popup: read-only view of stored state, plus a "check now" nudge. */
import { loadConfigs, loadStates } from "./storage.js";
import type { EndpointState } from "./types.js";

const list = document.getElementById("list") as HTMLUListElement;
const checkNow = document.getElementById("check-now") as HTMLButtonElement;

function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

async function render(): Promise<void> {
  const [configs, states] = await Promise.all([loadConfigs(), loadStates()]);
  list.replaceChildren();

  if (configs.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No endpoints yet — add one under Manage endpoints.";
    list.append(empty);
    return;
  }

  for (const config of configs) {
    const state: EndpointState | undefined = states[config.id];
    const result = state?.lastResult ?? null;

    const item = document.createElement("li");
    item.style.flexWrap = "wrap";

    const dot = document.createElement("span");
    dot.className = `dot ${result === null ? "unknown" : result.outcome}`;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = config.name;

    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent =
      result === null ? "not checked yet" : `${result.latencyMs}ms · ${timeAgo(result.checkedAt)}`;

    item.append(dot, name, detail);

    if (result?.outcome === "fail" && result.reason !== null) {
      const reason = document.createElement("span");
      reason.className = "reason";
      reason.textContent = result.reason;
      item.append(reason);
    }
    list.append(item);
  }
}

checkNow.addEventListener("click", async () => {
  checkNow.disabled = true;
  checkNow.textContent = "Checking…";
  try {
    await chrome.runtime.sendMessage("check-now");
  } finally {
    checkNow.disabled = false;
    checkNow.textContent = "Check now";
    await render();
  }
});

// Live update if a background poll lands while the popup is open.
chrome.storage.onChanged.addListener(() => void render());
void render();
