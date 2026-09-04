# Endpoint Pulse

A Manifest V3 browser extension that watches your health endpoints. Add any
JSON health URL; the toolbar badge shows how many are failing, the popup shows
latency and the last error in plain words, and you get one notification when
an endpoint goes down and one when it recovers — never a repeat.

Built as a companion to my [payments platform](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech):
the extension ships watching that platform's public `/health` endpoint, which
makes it the fourth independent consumer of the same API (after the React,
Vue and Svelte clients; a fifth, a Supabase
[receipt portal](https://github.com/marcelgilbertdev-oss/receipt-portal), followed).

## What it demonstrates

The extension is small on purpose — the point is doing MV3 correctly:

- **The service worker owns nothing.** MV3 kills the worker after ~30 seconds
  idle, so every piece of state lives in `chrome.storage`, and the alarm is
  re-registered on install and on browser startup. Module-level variables are
  treated as what they are: cache that can vanish mid-thought.
- **Host access is requested at runtime, per origin.** The manifest declares
  `optional_host_permissions` only; adding an endpoint triggers
  `chrome.permissions.request` for exactly that origin, inside the user's
  submit gesture. No blanket `https://*/*` grant at install.
- **Storage is split by what deserves to sync.** Endpoint configs go to
  `storage.sync` (small, user-authored, worth carrying between machines);
  results and history go to `storage.local` (bulky, per-machine, regenerated
  within minutes).
- **Notifications are transitions, not states.** `ok → fail` notifies once,
  `fail → ok` notifies once, `fail → fail` says nothing. A monitor that
  repeats "still down" every minute teaches people to mute it.
- **Failures carry reasons.** "HTTP 503, expected 200" and
  `status is "degraded", expected "operational"` are actionable;
  "check failed" is an anxiety ping.

## Architecture

```
src/checks.ts     pure logic: evaluate, fold, transition, badge, isDue — all unit-tested
src/storage.ts    the storage split and the origin-pattern helper
src/background.ts thin service worker: alarms, fetch, notifications, badge
src/popup.ts      read-only view of stored state + "check now"
src/options.ts    endpoint management + the runtime permission flow
```

Every decision lives in `checks.ts`, which imports nothing from `chrome.*` —
that is where the unit tests are, and the service worker stays a shell.

## Tests

```
npm run check        # typecheck + 16 unit tests + build
npx playwright test  # loads the built extension into Chromium and proves it
```

The Playwright suite is the part most extension repos skip: it launches a
persistent Chromium context with `--load-extension`, asserts the service
worker registers and its alarm exists, opens the real popup and options pages,
and exercises the validation. Unit tests prove the logic; this proves the
artifact. An extension nobody has loaded is decoration.

## Install (unpacked)

```
npm ci && npm run build
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.

## Honest limits

- Chromium-only for now. Firefox needs a `browser_specific_settings` block and
  an event-page fallback; it's on the roadmap, not claimed.
- Minimum check interval is one minute — `chrome.alarms` won't go faster, and
  a monitor inside a browser shouldn't pretend to be Pingdom.
- No auth headers yet. Watching an endpoint that needs credentials means
  storing credentials, and that deserves a real design pass, not a v0.1 field.
