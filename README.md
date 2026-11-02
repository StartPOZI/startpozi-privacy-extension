# StartPOZI Privacy Guard

**StartPOZI Browser privacy — in any browser.** This extension brings the protection of
[StartPOZI Browser](https://startpozi.com) to Chrome, Thorium, Opera, Microsoft Edge and other
Chromium-based browsers, as well as Firefox: the same blocking logic, the same FilterHub lists,
the same look & feel.

- Version: 1.0.0
- License: [GPL-3.0](LICENSE) (protection code ported from StartPOZI Browser)
- Website: [startpozi.com](https://startpozi.com) · [Support the project](https://startpozi.com/s/donate.html) ❤️

## What's inside (everything from StartPOZI Browser)

| Protection | Details |
|---|---|
| **Ad & tracker blocker** | 14 base FilterHub lists (EasyList, EasyPrivacy, uBlock core, Peter Lowe, NoCoin, OISD, URLhaus…), Light / Medium (default) / Maximum presets, custom filters in EasyList format. Heavy and regional lists live in StartPOZI Browser — the extension stays light |
| **Works offline out of the box** | A built-in offline base of **113,000 rules** (EasyList + EasyPrivacy core) ships inside the package — blocking works from the very first second, before any list is downloaded |
| **Automatic cookie-banner rejection** | The same payload as the browser: ~70 CMP providers, shadow DOM, multilingual heuristics. The "Accept" button is never clicked |
| **URL tracking cleanup** | The same parameter list (`utm_*`, `fbclid`, `gclid`, `msclkid`…): at the network level + the visible address via `history.replaceState` |
| **DNT + Sec-GPC** | Headers on every request + `navigator.globalPrivacyControl` — full GPC opt-out, exactly like the browser |
| **Referrer → origin only** | Cross-origin requests never leak the full path |
| **Third-party cookies** | `Set-Cookie` is stripped from tracker responses |
| **`<a ping>` / beacons** | Click-tracking pings are blocked |
| **Anti-fingerprinting** | Shield (Canvas noise, CPU/RAM, Battery, sendBeacon, media devices, fonts), audio farbling, WebGL masking, WebRTC blocking, optional "identity" mode — all ported from the browser's `preload-webview.js` |
| **Element zapper** | "Block ads manually": pick any element on a page and it's hidden forever (Esc cancels, U undoes) — the browser's picker, adapted |
| **Authorization whitelist** | accounts.google.com and OAuth domains are never blocked |
| **StartPOZI search** | `https://startpozi.com/search.html?q=` is registered as a search engine (in Firefox — default right away) |

The interface is copied from the browser: the popup is a **verbatim copy of the browser's shield
panel** (`#adblockPanel`), translated into English / Russian / Ukrainian; the settings page is
generated from the browser's own Settings.html — same cards, same toggles, dark theme,
`#667eea → #764ba2` accent. A "Thank you for downloading" welcome page opens on install,
with a button to download the full StartPOZI Browser. The settings page and welcome page feature
the Bing picture of the day as their background (auto-changing daily, cached).

## Installation

> **IMPORTANT (Chrome / Thorium / Edge / Opera):** load the **`dist/chromium`** folder — the root
> `manifest.json` is the Firefox build (`background.scripts` + `webRequestBlocking`), which real
> Chrome will reject.

### Chrome / Thorium / Edge / Opera / Vivaldi (Chromium, MV3)

1. Run `node tools/build.js` once (or grab a ready `dist` zip from
   [Releases](https://github.com/StartPOZI/startpozi-privacy-extension/releases) —
   there are dedicated packages for Chromium, Opera and Edge).
2. Open `chrome://extensions` (Edge: `edge://extensions`, Opera: `opera://extensions`).
3. Enable **Developer mode** → **Load unpacked** → select the **`dist/chromium`** folder
   (Opera/Edge upload packages ship without the search-provider override that
   their store validators reject).
4. Verified on real Chromium (Thorium 138): all 13 test trackers blocked, 688 DNR rules applied.
5. Edge/Opera users can also install from the Chrome Web Store once listed there
   (enable "Allow extensions from other stores").

### Firefox (128+)

1. Open `about:debugging#/runtime/this-firefox`.
2. "Load Temporary Add-on" → pick **`manifest.json` in the project root** (or `dist/firefox/manifest.json`).
3. StartPOZI becomes the default search engine automatically (changeable in Settings → Search).
   For a permanent install — [publish on AMO](https://addons.mozilla.org/developers/) from
   `dist/startpozi-privacy-guard-firefox-v1.0.0.zip`.

## How it works inside

```
manifest.json            Firefox MV3: event page + webRequestBlocking (root = Firefox build)
                          Chromium flavor is generated into dist/chromium (service worker + DNR)
core/catalog.js          FilterHub catalog (14 base lists), CUSTOM_FILTERS, HARDBLOCK, categories
core/engine.js           EasyList-subset parser + matcher with a HOST INDEX
                          (113k rules matched in ~190 µs per request — no linear scans)
core/url-cleaner.js      Tracking-parameter stripping — from the browser's lib/url-cleaner.js
core/md5.js, checksum.js ABP `! Checksum:` verification on list updates
background/lists.js      List download/cache (size-based timeouts, like the browser)
background/dnr.js        Chromium: dynamic rules (block, urlclean, headers, pings) with
                          adaptive schema handling for any Chromium fork
background/webreq.js     Firefox: full blocking; Chromium: stats/badge
background/background.js Orchestrator: engine build, content-script registration, shield badge,
                          message router, Bing wallpaper of the day (daily cache)
content/cookie-blocker.js  cookie-banner payload from the browser (MAIN world, all frames)
content/fp-*.js            anti-fingerprinting from preload-webview.js (MAIN world)
content/picker.js          element zapper ("Block ads manually")
content/bridge.js          visible URL cleaning (ISOLATED)
content/cosmetic.js        element hiding (generic + the browser's YouTube set + zapper rules)
ui/welcome.html          "Thank you for downloading" page (opens on install)
ui/popup.*               the browser's shield panel, verbatim markup + styles
ui/options.html          extension settings — generated from the browser's Settings.html
                          (node tools/make-options.js): same markup and styles 1:1
ui/i18n-ext.js           the browser's i18n runtime, ported to chrome.storage
ui/i18n/ru.json, uk.json the browser's dictionaries (locales/) — a copy
rules/builtin.json       built-in static DNR ruleset (96k domains, offline base)
_locales/en|ru|uk        WebExtension localization
```

**Engine differences (honest):** in Firefox blocking is complete (webRequest + the full filter
syntax); on Chromium enforcement goes through `declarativeNetRequest` — domain rules are converted
into chunked `requestDomains` (limit ~4900 dynamic rules + a static ruleset), while complex
regex/cosmetic rules are counted by the full engine for stats but not enforced. Mixed content and
Referer on Chromium follow platform limits; on Firefox they are complete.

StartPOZI Browser (Tor with bridges, proxies, DoH, site isolation, letterboxing, encrypted
password vault) remains the full experience — the extension covers everything an extension
API can do, nothing more, nothing less.

## Build and tests

### Building the package from source (reproducible)

**Requirements:** Node.js ≥ 18 (any OS — Linux / macOS / Windows; only the
bundled `node` runtime is used, there are **no npm dependencies** — do not run
`npm install`). Internet access is needed once to download the FilterHub base
lists; if unavailable, the committed generated files are used as-is.

```bash
# 1) (Optional — already committed) Offline base: downloads the base lists
#    from FilterHub and generates rules/builtin.json (96k domains, static DNR
#    ruleset) + data/builtin-blocklist.txt (113k rules for the engine).
node tools/gen-builtin-rules.js

# 2) (Optional — already committed) Settings page: generates ui/options.html
#    from ui/Settings.html (the browser's original settings page, kept in the
#    repo as the source; only re-run if that file changes).
node tools/make-options.js

# 3) Build the store packages: dist/chromium/ + dist/firefox/ + the two zips
#    (the exact file submitted to AMO is dist/startpozi-privacy-guard-firefox-*.zip).
node tools/build.js
```

What is machine-generated and by which tool (everything else ships as
hand-written source, unminified, unbundled):

| Generated artifact | Generator | Input |
|---|---|---|
| `ui/options.html` | `tools/make-options.js` | `ui/Settings.html` (browser's settings page) |
| `rules/builtin.json` | `tools/gen-builtin-rules.js` | FilterHub lists + `core/catalog.js` sets |
| `data/builtin-blocklist.txt` | `tools/gen-builtin-rules.js` | same |
| `dist/*` flavors + zips | `tools/build.js` | the whole tree + `manifest.json` |

### Tests

```bash
node tools/gen-builtin-rules.js   # rebuild the offline base (downloads EasyList/EasyPrivacy/
                                  # NoCoin/OISD/uBO from FilterHub, cached in
                                  # tools/.filterhub-cache/) → rules/builtin.json (96k domains)
                                  # + data/builtin-blocklist.txt (113k rules)
node tools/make-options.js        # rebuild ui/options.html from the browser's ui/Settings.html
node tools/smoke.js               # offline tests: engine, DNR schema, stats, perf guard, i18n
node tools/e2e.js                 # FULL e2e: headless Firefox + Marionette — install, engine,
                                  # real blocking, settings, popup, language, toggles
node tools/build.js               # dist/chromium + dist/firefox + dist/opera + store
                                  # zips: chromium / firefox / opera / edge (no deps;
                                  # edge shares the opera flavor — no search override)
```

`tools/e2e.js` launches a real Firefox (`--headless -marionette`), installs the extension as
temporary, opens a local test page with ad domains and verifies: install → engine → actual
blocking → settings rendering → popup → Russian/Ukrainian localization → settings toggles.

## Filter list updates

Automatic every 12 hours (a light pack — lists over 2.5 MB are skipped in auto-updates so the
event page never freezes the browser); the manual **"Update lists"** button in settings downloads
everything. Lists come from [FilterHub](https://github.com/StartPOZI/FilterHub)
(`raw.githubusercontent.com`) and are verified against ABP checksums: a mismatch keeps the cached
copy. The first two minutes after install nothing is downloaded — the offline base already
protects you.

## Privacy

No telemetry whatsoever. All data (settings — storage.sync, lists — storage.local, stats —
storage.session) stays in your browser. The only external requests are FilterHub list updates,
the Bing picture of the day, and startpozi.com search.

© 2026 StartPOZI. All rights reserved.
