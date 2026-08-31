/**
 * Options: manage the endpoint list. The notable MV3 pattern is permission
 * flow — chrome.permissions.request per origin, inside the submit gesture,
 * so the user grants exactly the hosts they watch and nothing else.
 */
import { loadConfigs, originPattern, saveConfigs } from "./storage.js";
import type { EndpointConfig } from "./types.js";

const list = document.getElementById("list") as HTMLUListElement;
const form = document.getElementById("add") as HTMLFormElement;
const errorOut = document.getElementById("error") as HTMLParagraphElement;

async function render(): Promise<void> {
  const configs = await loadConfigs();
  list.replaceChildren();

  for (const config of configs) {
    const item = document.createElement("li");

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = config.name;

    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = `${config.url} · every ${config.intervalMinutes}m`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await saveConfigs((await loadConfigs()).filter((c) => c.id !== config.id));
      await render();
    });

    item.append(name, detail, remove);
    list.append(item);
  }
}

function showError(message: string): void {
  errorOut.textContent = message;
  errorOut.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorOut.hidden = true;

  const data = new FormData(form);
  const url = String(data.get("url") ?? "").trim();
  const jsonPath = String(data.get("jsonPath") ?? "").trim();
  const equals = String(data.get("equals") ?? "").trim();

  const pattern = originPattern(url);
  if (pattern === null) {
    showError("The URL must be http(s).");
    return;
  }
  if (jsonPath !== "" && equals === "") {
    showError("A JSON field needs an expected value to compare against.");
    return;
  }

  // Runtime permission request — must happen inside the user gesture.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    showError(`Access to ${pattern} was declined, so this endpoint can't be checked.`);
    return;
  }

  const config: EndpointConfig = {
    id: crypto.randomUUID(),
    name: String(data.get("name") ?? "").trim(),
    url,
    intervalMinutes: Number(data.get("interval") ?? 5),
    expect: {
      status: Number(data.get("status") ?? 200),
      ...(jsonPath !== "" ? { jsonPath, equals } : {}),
    },
  };

  await saveConfigs([...(await loadConfigs()), config]);
  form.reset();
  await render();
});

void render();
