# Endpoint Pulse

A Manifest V3 browser extension that watches your health endpoints. Add any
JSON health URL; the toolbar badge shows how many are failing, the popup shows
latency and the last error in plain words, and you get one notification when
an endpoint goes down and one when it recovers — never a repeat.

Built as a companion to my [payments platform](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech):
the extension ships watching that platform's public liveness endpoint, which
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
npm run check        # typecheck + 29 unit tests + build
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

## One dropped request is the network, not the service (24 Sep 2026)

The popup reported the platform API down: *"network error — host unreachable or
permission not granted"*, 313ms. The API was up — twelve consecutive probes of
that exact URL returned 200 — and permission was granted. Two things in the
code proved it without guessing:

- the **no-permission path returns before fetching, with latency hardcoded to
  `0`**. A reading of 313ms therefore *cannot* be the permission path, so the
  message was naming a cause the code had already ruled out twenty lines
  earlier. It sent two people hunting in the wrong half of the system.
- a **313ms failure is a reset, not a timeout** — a timeout takes fifteen
  seconds and says so.

One request had died in transport, and a single failed poll flipped the badge
red and fired a notification. A watcher that cries wolf teaches its owner to
ignore it, which is worse than not watching at all.

So a request that **never completed** is now retried once. A request that
**arrived and was wrong** — a 503, a missing JSON field — is not: the service
answered, and asking twice does not make its answer truer. A **timeout** is not
retried either: fifteen seconds of silence from a dependency-free route is
already the signal, and a second fifteen-second wait would delay the alarm
rather than sharpen it.

The retry is **recorded and shown**, never swallowed — the popup says *"answered
on the second attempt — the path dropped one request"*. A silent retry would
hide exactly the thing worth seeing, which is a path that starts needing one
every time.

The decision lives in `checks.ts` with the attempt and the sleep injected, so
seven unit tests prove which failures earn a second attempt, which do not, that
one blip no longer notifies, and that two consecutive failures still do — with
no network, no browser, and no real delay.

## The lesson the extension taught its own platform (14 Sep 2026)

The seeded endpoint used to be the platform's `/health`, which reports the
database's latency and therefore queries it. Polled every five minutes from a
browser that is open all day, that was exactly enough to stop the platform's
scale-to-zero database from ever sleeping, and it burned most of the free
tier's monthly compute before `pg_stat_activity` named the caller. The seed now
points at `/api/v1/live`, a route that touches nothing, and an installed copy
rewrites its stored `/health` entry on the next startup. A watcher must not
cost the thing it watches; the platform's ADR 20 tells the whole story.
