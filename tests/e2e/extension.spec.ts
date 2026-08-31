/**
 * The load test. Unit tests prove the logic; this proves the ARTIFACT — that
 * Chrome accepts the manifest, registers the service worker, and serves the
 * popup. An extension nobody has loaded is decoration.
 */
import path from "node:path";

import { chromium, expect, test, type BrowserContext } from "@playwright/test";

const dist = path.resolve(import.meta.dirname, "../../dist");

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
});

test.afterAll(async () => {
  await context.close();
});

async function extensionId(): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return new URL(worker.url()).host;
}

test("the service worker registers and creates its alarm", async () => {
  const id = await extensionId();
  expect(id).toMatch(/^[a-p]{32}$/);

  const [worker] = context.serviceWorkers();
  const alarm = await worker!.evaluate(() => chrome.alarms.get("pulse"));
  expect(alarm).toMatchObject({ name: "pulse", periodInMinutes: 1 });
});

test("the popup renders the seeded endpoint", async () => {
  const id = await extensionId();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);

  await expect(popup.getByRole("heading", { name: "Endpoint Pulse" })).toBeVisible();
  await expect(popup.getByText("ZEROFAYYZ Fintech API")).toBeVisible();
  await expect(popup.getByRole("link", { name: "Manage endpoints" })).toBeVisible();
});

test("the options page refuses a JSON field without an expected value", async () => {
  const id = await extensionId();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);

  await options.getByLabel("Name").fill("Broken");
  await options.getByLabel("Health URL").fill("https://example.com/health");
  await options.getByLabel("JSON field (optional)").fill("status");
  await options.getByRole("button", { name: "Add and grant access" }).click();

  await expect(options.getByRole("alert")).toContainText("needs an expected value");
});
