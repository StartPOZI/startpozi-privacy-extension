// settings.js — settings schema + storage wrapper.
// Keys mirror the StartPOZI Desktop Browser security settings so the
// extension behaves (and is labelled) exactly like the browser's
// Settings → Security section.
'use strict';
(function (global) {
  const DEFAULTS = {
    // Blocker
    adblockEnabled: true,
    preset: 'medium',
    filterhubEnabled: null, // null = follow preset; array of list numbers once customized
    filterLists: [],        // extra custom list URLs (EasyList format)
    customFilters: '',
    customStyles: '',
    persistLog: false,
    // Security (names follow the browser's Settings → Security)
    urlClean: true,               // Clean tracking URLs
    autoRejectCookies: true,      // Auto-decline cookie banners
    dnt: true,                    // Do Not Track
    gpc: true,                    // Global Privacy Control (Sec-GPC)
    referrerPolicy: true,         // Referrer → origin only
    blockThirdPartyCookies: true, // Block 3rd-party cookies
    blockMixedContent: false,     // Block mixed content
    httpsOnly: false,             // HTTPS-first upgrades
    blockAPing: true,             // Block <a ping> / beacon pings
    fingerprint: false,           // Fingerprinting protection (opt-in, like browser)
    fpShield: true,               // Fingerprint shield (default ON)
    audioFp: true,                // Audio fingerprint protection
    blockWebGL: true,             // Block WebGL fingerprint
    blockWebRTC: true,            // WebRTC IP leak protection
    blockNotifications: true,     // Block notification prompts
    blockGeolocation: true,       // Block geolocation prompts
    siteExceptions: [],           // per-site "protection off" domains
    elementHidingRules: {},       // element zapper: { domain: [selectors] }
    clearCookiesOnExit: false,    // wipe cookies on browser start (browsingData)
    clearCacheOnExit: false,      // wipe cache on browser start (browsingData)
    firstRunDone: false,
  };

  const LS_PREFIX = 'spz:';

  // Область настроек: storage.sync, а если он недоступен (Electron/StartPOZI
  // Browser: '"sync" is not available in this instance of Chrome') —
  // storage.local. Без этого fallback Settings.get() бросал, init фона
  // падал и расширение целиком «не работало».
  let AREA = null;
  async function area() {
    if (AREA) return AREA;
    AREA = chrome.storage.local; // пессимистичный дефолт
    try {
      const sync = chrome.storage && chrome.storage.sync;
      if (sync && typeof sync.get === 'function') {
        await new Promise(function (resolve, reject) {
          let settled = false;
          const timer = setTimeout(function () {
            if (!settled) { settled = true; reject(new Error('sync probe timeout')); }
          }, 100);
          try {
            sync.get('_', function () {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              if (chrome.runtime.lastError) reject(new Error('sync lastError'));
              else resolve();
            });
          } catch (e) {
            if (!settled) { settled = true; clearTimeout(timer); reject(e); }
          }
        });
        AREA = sync; // проверка прошла
      }
    } catch (e) { AREA = chrome.storage.local; }
    return AREA;
  }

  async function get() {
    const store = await area();
    const stored = await store.get('settings');
    const s = Object.assign({}, DEFAULTS, stored.settings || {});
    // Migrate: preset → filterhubEnabled
    if (!s.filterhubEnabled) {
      const C = global.SPZ.Catalog;
      s.filterhubEnabled = (C.FILTERHUB_LEVELS[s.preset] ||
        C.FILTERHUB_LEVELS[C.FILTERHUB_DEFAULT_LEVEL]).slice();
    }
    return s;
  }

  async function set(patch) {
    const s = await get();
    const next = Object.assign({}, s, patch);
    const store = await area();
    await store.set({ settings: next });
    return next;
  }

  function isSiteExcluded(settings, host) {
    if (!host || !settings.siteExceptions || !settings.siteExceptions.length) return false;
    const h = host.toLowerCase();
    return settings.siteExceptions.some(function (d) {
      return h === d || h.endsWith('.' + d);
    });
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.Settings = { DEFAULTS, get, set, isSiteExcluded, LS_PREFIX };
})(typeof self !== 'undefined' ? self : this);
