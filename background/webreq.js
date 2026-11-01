// webreq.js — webRequest backend.
// Firefox (MV3 with webRequestBlocking): the FULL enforcement path —
//   block/allow via the parsed engine, URL cleaning redirects, DNT/GPC
//   request headers, Referer trimming, 3rd-party Set-Cookie stripping.
// Chromium (MV3): webRequest is observational only — the same listeners
//   run without "blocking", matching requests with the engine for the
//   per-site stats/badge (enforcement there is DNR, see dnr.js).
'use strict';
(function (global) {
  const STATS_KEY = 'spz:stats';   // { [tabId]: { n, cats, hosts } }
  const LOG_KEY = 'spz:log';

  const state = {
    engine: null,
    settings: null,
    isFirefox: false,
    onUpdate: null, // callback(tabId, host, cat, url)
    debug: { seen: 0, blocked: 0 },
  };

  function debugSeen() { return state.debug.seen; }
  function debugBlocked() { return state.debug.blocked; }
  function debugRecordError() { return state.debug.recordError || null; }

  function normType(t) {
    return global.SPZ.Engine.WR_TYPE_TO_AB[t] || 'other';
  }

  function hostOf(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  function isThirdParty(reqHost, docHost) {
    if (!reqHost || !docHost) return true;
    const E = global.SPZ.Engine;
    return E.baseDomain(reqHost) !== E.baseDomain(docHost);
  }

  // ---- stats ------------------------------------------------------------
  async function recordBlocked(tabId, url) {
    try {
      const cat = global.SPZ.Catalog.categorizeUrl(url);
      const host = hostOf(url);
      const o = await chrome.storage.local.get(STATS_KEY);
    const stats = o[STATS_KEY] || {};
    const s = stats[tabId] || { n: 0, cats: {}, hosts: {} };
    s.n++;
    s.cats[cat] = (s.cats[cat] || 0) + 1;
    s.hosts[host] = (s.hosts[host] || 0) + 1;
    const topHosts = Object.entries(s.hosts)
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    s.hosts = Object.fromEntries(topHosts);
    stats[tabId] = s;
    await chrome.storage.local.set({ [STATS_KEY]: stats });

    // Ephemeral log: session storage by default (wiped on browser exit),
    // storage.local when persistLog is on.
    const settings = state.settings || await global.SPZ.Settings.get();
    const store = (settings.persistLog || !chrome.storage.session)
      ? chrome.storage.local : chrome.storage.session;
    const lk = await store.get(LOG_KEY);
    const log = lk[LOG_KEY] || [];
    log.unshift({ ts: Date.now(), url, cat, host });
    if (log.length > 500) log.length = 500;
    await store.set({ [LOG_KEY]: log });

    if (state.onUpdate) state.onUpdate(tabId, host, cat, url);
    } catch (e) {
      state.debug.recordError = String(e && e.message || e);
    }
  }

  async function tabStats(tabId) {
    const o = await chrome.storage.local.get(STATS_KEY);
    return (o[STATS_KEY] || {})[tabId] || { n: 0, cats: {}, hosts: {} };
  }

  async function clearTab(tabId) {
    const o = await chrome.storage.local.get(STATS_KEY);
    const stats = o[STATS_KEY] || {};
    delete stats[tabId];
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }

  async function clearLog() {
    await chrome.storage.local.remove(LOG_KEY);
    if (chrome.storage.session) {
      try { await chrome.storage.session.remove(LOG_KEY); } catch (e) { /* old FF */ }
    }
  }

  async function getLog() {
    if (chrome.storage.session) {
      try {
        const s = await chrome.storage.session.get(LOG_KEY);
        if (s[LOG_KEY] && s[LOG_KEY].length) return s[LOG_KEY];
      } catch (e) { /* old FF */ }
    }
    const l = await chrome.storage.local.get(LOG_KEY);
    return l[LOG_KEY] || [];
  }

  // Session-wide totals (privacy panel in Settings).
  async function sessionTotals() {
    const o = await chrome.storage.local.get(STATS_KEY);
    const stats = o[STATS_KEY] || {};
    const totals = { n: 0, cats: {} };
    Object.keys(stats).forEach(function (tabId) {
      const s = stats[tabId];
      if (!s) return;
      totals.n += s.n || 0;
      const cats = s.cats || {};
      Object.keys(cats).forEach(function (c) {
        totals.cats[c] = (totals.cats[c] || 0) + cats[c];
      });
    });
    return totals;
  }

  // ---- enforcement (Firefox only; listeners are non-blocking on Chrome)
  function onBeforeRequest(details) {
    const st = state.settings;
    if (!st) return {};
    const url = details.url;
    if (!/^https?:/i.test(url)) return {};
    state.debug.seen++;

    const docUrl = details.documentUrl || details.originUrl ||
      (details.frameId === 0 ? url : '');
    const docHost = hostOf(docUrl);
    const reqHost = hostOf(url);
    const third = isThirdParty(reqHost, docHost);

    // Per-site exception
    if (docHost && global.SPZ.Settings.isSiteExcluded(st, docHost)) return {};
    if (st.adblockEnabled === false) {
      // Even with the ad blocker off, honour the standalone toggles below.
    }

    if (state.isFirefox) {
      // URL cleaning — main/frame + XHR only, like the browser's onBeforeRequest.
      if (st.urlClean &&
          ['main_frame', 'sub_frame', 'xmlhttprequest'].indexOf(normType(details.type)) !== -1) {
        const cleaned = global.SPZ.UrlCleaner.cleanTrackingParams(url);
        if (cleaned !== url) return { redirectUrl: cleaned };
      }
      // HTTPS-first
      if (st.httpsOnly && details.type === 'main_frame' &&
          /^http:\/\//i.test(url) && reqHost !== 'localhost' && reqHost !== '127.0.0.1') {
        return { redirectUrl: 'https://' + url.slice(7) };
      }
      // <a ping> / beacons
      if (st.blockAPing && (details.type === 'ping' || details.type === 'beacon')) {
        recordBlocked(details.tabId, url);
        return { cancel: true };
      }
      // Mixed content: http subresource from an https page
      if (st.blockMixedContent && /^http:\/\//i.test(url) &&
          /^https:/i.test(docUrl) &&
          ['script', 'image', 'stylesheet', 'xmlhttprequest', 'font', 'media',
            'sub_frame', 'object'].indexOf(normType(details.type)) !== -1) {
        recordBlocked(details.tabId, url);
        return { cancel: true };
      }
      // Engine match
      if (st.adblockEnabled) {
        const m = global.SPZ.Engine.matchRequest(state.engine, url,
          normType(details.type), third, docHost || reqHost);
        if (m && m.blocked) {
          state.debug.blocked++;
          recordBlocked(details.tabId, url);
          return { cancel: true };
        }
      }
    } else {
      // Chromium observational: engine stats only (DNR enforces).
      if (st.adblockEnabled && details.type !== 'main_frame' && state.engine) {
        const m = global.SPZ.Engine.matchRequest(state.engine, url,
          normType(details.type), third, docHost || reqHost);
        if (m && m.blocked) recordBlocked(details.tabId, url);
      }
      return {};
    }
    return {};
  }

  function onBeforeSendHeaders(details) {
    if (!state.isFirefox || !state.settings) return {};
    const st = state.settings;
    const headers = details.requestHeaders || [];
    const docUrl = details.documentUrl || details.originUrl || '';
    const docHost = hostOf(docUrl);
    if (docHost && global.SPZ.Settings.isSiteExcluded(st, docHost)) return {};

    let changed = false;
    const have = {};
    headers.forEach(function (h) { have[h.name.toLowerCase()] = h; });
    if (st.dnt && !have['dnt']) {
      headers.push({ name: 'DNT', value: '1' }); changed = true;
    } else if (st.dnt && have['dnt'] && have['dnt'].value !== '1') {
      have['dnt'].value = '1'; changed = true;
    }
    if (st.gpc && !have['sec-gpc']) {
      headers.push({ name: 'Sec-GPC', value: '1' }); changed = true;
    } else if (st.gpc && have['sec-gpc'] && have['sec-gpc'].value !== '1') {
      have['sec-gpc'].value = '1'; changed = true;
    }
    // Referer → origin only on cross-origin requests (like the browser).
    if (st.referrerPolicy && have['referer']) {
      try {
        const ref = new URL(have['referer'].value);
        const originOnly = ref.origin + '/';
        if (isThirdParty(hostOf(details.url), ref.hostname) &&
            have['referer'].value !== originOnly) {
          have['referer'].value = ref.origin + '/';
          changed = true;
        }
      } catch (e) { /* bad referer — leave */ }
    }
    return changed ? { requestHeaders: headers } : {};
  }

  function onHeadersReceived(details) {
    if (!state.isFirefox || !state.settings) return {};
    const st = state.settings;
    const docUrl = details.documentUrl || details.originUrl || '';
    const docHost = hostOf(docUrl);
    if (docHost && global.SPZ.Settings.isSiteExcluded(st, docHost)) return {};

    const reqHost = hostOf(details.url);
    const third = isThirdParty(reqHost, docHost);
    let headers = details.responseHeaders || [];
    let changed = false;

    if (st.blockThirdPartyCookies && third) {
      const filtered = headers.filter(function (h) {
        return h.name.toLowerCase() !== 'set-cookie';
      });
      if (filtered.length !== headers.length) {
        headers = filtered; changed = true;
      }
    }
    if (st.referrerPolicy) {
      let policy = null;
      headers.forEach(function (h) {
        if (h.name.toLowerCase() === 'referrer-policy') policy = h;
      });
      if (!policy) {
        headers.push({ name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' });
        changed = true;
      } else if (policy.value !== 'strict-origin-when-cross-origin' &&
                 policy.value !== 'same-origin' && policy.value !== 'no-referrer') {
        policy.value = 'strict-origin-when-cross-origin';
        changed = true;
      }
    }
    return changed ? { responseHeaders: headers } : {};
  }

  function install(engineRef, settingsRef, isFirefox, onUpdate) {
    state.engine = engineRef && engineRef.engine || null;
    state.settings = settingsRef;
    state.isFirefox = !!isFirefox;
    state.onUpdate = onUpdate || null;
    // Guard: без webRequest (экзотические Chromium-сборки) просто не ставим
    // слушателей — падение здесь убило бы весь background.
    if (!chrome.webRequest || !chrome.webRequest.onBeforeRequest) return;
    // onBeforeRequest accepts ONLY ['blocking'] — passing header enums here
    // THROWS and kills the whole background script (found by e2e test).
    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest,
      { urls: ['http://*/*', 'https://*/*'] }, isFirefox ? ['blocking'] : []);
    if (isFirefox) {
      chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders,
        { urls: ['http://*/*', 'https://*/*'] }, ['blocking', 'requestHeaders']);
      chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived,
        { urls: ['http://*/*', 'https://*/*'] }, ['blocking', 'responseHeaders']);
    }
  }

  function refresh(engine, settings) {
    state.engine = engine;
    state.settings = settings;
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.WebReq = {
    install, refresh, tabStats, clearTab, getLog, clearLog, recordBlocked,
    sessionTotals, debugSeen, debugBlocked, debugRecordError,
  };
})(typeof self !== 'undefined' ? self : this);
