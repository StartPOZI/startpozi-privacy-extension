// dnr.js — declarativeNetRequest backend (Chromium: Chrome / Edge / Opera).
// Converts the parsed engine into dynamic DNR rules: chunked
// requestDomains blocks, allowAllRequests site exceptions, header rules
// (DNT, Sec-GPC, Referrer-Policy), <a ping> blocking, URL-tracking-param
// stripping via regexSubstitution and opt-in HTTPS upgrades.
// Firefox does not use this module — it blocks via webRequest instead.
'use strict';
(function (global) {
  // Dynamic rule id ranges (static builtin.json uses 1..999).
  const ID = {
    lists: [1000, 4400],
    custom: [4401, 4600],
    urlclean: [4601, 4620],
    headers: [4621, 4660],
    siteAllow: [4661, 4700],
    misc: [4701, 4900],
  };
  const MAX_DYNAMIC = 4900;

  const SUBRES = ['sub_frame', 'script', 'image', 'stylesheet', 'xmlhttprequest',
    'font', 'media', 'websocket', 'object', 'other'];

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  // --- host-anchor extraction from the engine -------------------------
  function collectHostRules(engine) {
    const plain = new Set();
    const important = new Set();
    const third = new Set();
    const allowDoc = new Set();
    function take(rules) {
      rules.forEach(function (r) {
        if (!r.hostAnchor || r.regex || r.domains || r.notDomains) return;
        if (r.kind === 'allow') {
          // @@||host^ (с $document или без) — не блокировать на этом хосте
          allowDoc.add(r.hostAnchor);
          return;
        }
        if (r.types !== global.SPZ.Engine.ALL_TYPES) {
          if (r.party === 2) { third.add(r.hostAnchor); return; }
          return; // type-restricted → leave to matcher (stats only)
        }
        if (r.party === 2) third.add(r.hostAnchor);
        else if (r.important) important.add(r.hostAnchor);
        else plain.add(r.hostAnchor);
      });
    }
    take(engine.block);
    take(engine.blockImportant);
    take(engine.allow);
    return { plain, important, third, allowDoc };
  }

  function buildListRules(engine) {
    const rules = [];
    const sets = collectHostRules(engine);
    const [lo] = ID.lists;
    let id = lo;
    // Allows (exceptions) must outrank blocks.
    for (const part of chunk([...sets.allowDoc].sort(), 150)) {
      rules.push({
        id: id++, priority: 4, action: { type: 'allowAllRequests' },
        condition: { requestDomains: part, resourceTypes: ['main_frame'] },
      });
    }
    for (const part of chunk([...sets.important].sort(), 150)) {
      rules.push({
        id: id++, priority: 3, action: { type: 'block' },
        condition: { requestDomains: part, resourceTypes: SUBRES },
      });
    }
    for (const part of chunk([...sets.plain].sort(), 150)) {
      rules.push({
        id: id++, priority: 1, action: { type: 'block' },
        condition: { requestDomains: part, resourceTypes: SUBRES },
      });
    }
    for (const part of chunk([...sets.third].sort(), 150)) {
      rules.push({
        id: id++, priority: 1, action: { type: 'block' },
        condition: {
          requestDomains: part, domainType: 'thirdParty',
          resourceTypes: SUBRES,
        },
      });
    }
    return rules.slice(0, ID.custom[0] - lo);
  }

  // --- URL tracking-param stripping -----------------------------------
  function buildUrlCleanRules() {
    const params = global.SPZ.UrlCleaner.TRACKING_PARAMS
      .map(function (p) { return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
      .join('|');
    const types = ['main_frame', 'sub_frame', 'xmlhttprequest'];
    const mk = function (regex, sub) {
      return {
        condition: { regexFilter: regex, resourceTypes: types },
        action: { type: 'redirect', regexSubstitution: sub },
      };
    };
    const rules = [
      // only param:  path?param=…  →  path
      mk('^(https?://[^?#]*)\\?(?:' + params + ')=[^&#]*(#[^#]*)?$', '\\1\\2'),
      // first of many:  path?param=…&rest → path?rest
      mk('^(https?://[^?#]*)\\?(?:' + params + ')=[^&]*&(.*)$', '\\1?\\2'),
      // middle/last:  path?rest&param=… → path?rest
      mk('^(https?://[^?#]*\\?[^#]*?)&(?:' + params + ')=[^&#]*(#[^#]*)?$', '\\1\\2'),
    ];
    return rules.map(function (r, i) {
      return Object.assign({ id: ID.urlclean[0] + i, priority: 5 }, r);
    });
  }

  // --- Header / misc rules ---------------------------------------------
  function buildHeaderRules(settings) {
    const rules = [];
    let id = ID.headers[0];
    const allTypes = ['main_frame', 'sub_frame', 'script', 'image', 'stylesheet',
      'xmlhttprequest', 'font', 'media', 'websocket', 'object', 'ping', 'other'];
    if (settings.dnt) {
      rules.push({
        id: id++, priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'DNT', operation: 'set', value: '1' }],
        },
        condition: { resourceTypes: allTypes, excludedRequestDomains: ['startpozi.com'] },
      });
    }
    if (settings.gpc) {
      rules.push({
        id: id++,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }],
        },
        condition: { resourceTypes: allTypes, excludedRequestDomains: ['startpozi.com'] },
      });
    }
    if (settings.referrerPolicy) {
      // Force at least strict-origin-when-cross-origin even when the site
      // ships a laxer policy — the request Referer then carries origin only.
      rules.push({
        id: id++,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [{
            header: 'Referrer-Policy',
            operation: 'set',
            value: 'strict-origin-when-cross-origin',
          }],
        },
        condition: { resourceTypes: ['main_frame', 'sub_frame'] },
      });
    }
    if (settings.blockAPing) {
      rules.push({
        id: id++,
        priority: 2,
        action: { type: 'block' },
        condition: { resourceTypes: ['ping'] },
      });
    }
    return rules;
  }

  function buildSiteAllowRules(settings) {
    const rules = [];
    let id = ID.siteAllow[0];
    (settings.siteExceptions || []).forEach(function (d) {
      rules.push({
        id: id++, priority: 5,
        action: { type: 'allowAllRequests' },
        condition: {
          requestDomains: [d], resourceTypes: ['main_frame'],
        },
      });
    });
    return rules;
  }

  function buildMiscRules(settings, trackerHosts) {
    const rules = [];
    let id = ID.misc[0];
    if (settings.blockThirdPartyCookies && trackerHosts && trackerHosts.length) {
      // Strip Set-Cookie on known tracker domains (3rd-party requests).
      for (const part of chunk(trackerHosts.slice(0, 450).sort(), 150)) {
        rules.push({
          id: id++, priority: 2,
          action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }] },
          condition: { requestDomains: part, domainType: 'thirdParty' },
        });
      }
    }
    if (settings.blockMixedContent) {
      rules.push({
        id: id++, priority: 3,
        action: { type: 'block' },
        condition: {
          regexFilter: '^http://.*',
          resourceTypes: ['sub_frame', 'script', 'image', 'stylesheet',
            'xmlhttprequest', 'font', 'media', 'object'],
          excludedRequestDomains: ['localhost', '127.0.0.1', '[::1]'],
        },
      });
    }
    if (settings.httpsOnly) {
      rules.push({
        id: id++, priority: 6,
        action: { type: 'redirect', regexSubstitution: 'https://\\1' },
        condition: {
          regexFilter: '^http://(.*)$',
          resourceTypes: ['main_frame'],
          excludedRequestDomains: ['localhost', '127.0.0.1', '[::1]'],
        },
      });
    }
    return rules;
  }

  // --- apply ------------------------------------------------------------
  // Callback-толерантный вызов DNR: Chrome MV3 возвращает Promise, Electron
  // (StartPOZI Browser) — только callback; promise-стиль там молча возвращает
  // undefined и applyAll падал на .map → «правил 0, ничего не блокируется».
  function dnrCall(fn, arg) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      try {
        const maybe = fn(arg, function (res) {
          if (settled) return;
          settled = true;
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(function (res) { if (!settled) { settled = true; resolve(res); } },
            function (err) { if (!settled) { settled = true; reject(err); } });
        }
      } catch (e) { if (!settled) { settled = true; reject(e); } }
    });
  }

  async function applyAll(engine, settings) {
    if (!chrome.declarativeNetRequest ||
        typeof chrome.declarativeNetRequest.updateDynamicRules !== 'function') {
      return { applied: false, reason: 'DNR unavailable' };
    }
    const listRules = settings.adblockEnabled ? buildListRules(engine) : [];
    let all = listRules
      .concat(settings.urlClean ? buildUrlCleanRules() : [])
      .concat(buildHeaderRules(settings))
      .concat(buildSiteAllowRules(settings))
      .concat(buildMiscRules(settings, trackerHostsFrom(engine)));
    all = all.slice(0, MAX_DYNAMIC);

    // Remove every previous dynamic rule in our ranges, then add.
    const existing = await dnrCall(
      chrome.declarativeNetRequest.getDynamicRules.bind(chrome.declarativeNetRequest), {});
    const removeIds = (existing || []).map(function (r) { return r.id; })
      .filter(function (rid) { return rid >= 1000 && rid < 5000; });
    // keep ids unique if slices ever collide
    const seen = new Set();
    all = all.filter(function (r) {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    const res = await applyDnrRules(all, removeIds);
    return Object.assign({ applied: true, lists: listRules.length }, res);
  }

  // Адаптивное применение: не каждый Chromium знает все свойства DNR-схемы
  // (Electron/StartPOZI: «Unexpected property: 'regexSubstitution'») —
  // отклонённую ПАЧКУ правил браузер не применяет ЦЕЛИКОМ, из-за чего
  // блокировка отваливалась вся. Здесь: на «Unexpected property» выкидываем
  // правила с этим свойством и применяем остальные.
  async function applyDnrRules(rules, removeIds) {
    const update = chrome.declarativeNetRequest.updateDynamicRules
      .bind(chrome.declarativeNetRequest);
    const dropped = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const pass = rules.filter(function (r) {
        const j = JSON.stringify(r);
        return !dropped.some(function (p) { return j.indexOf('"' + p + '"') !== -1; });
      });
      try {
        await dnrCall(update, { removeRuleIds: removeIds, addRules: pass });
        return { count: pass.length, droppedProps: dropped };
      } catch (e) {
        const m = /Unexpected property: '([^']+)'/.exec(String(e && e.message));
        if (m && dropped.indexOf(m[1]) === -1) {
          dropped.push(m[1]);
          continue; // повторить без правил с этим свойством
        }
        throw e;
      }
    }
    throw new Error('DNR schema adaptation loop: ' + dropped.join(','));
  }

  function trackerHostsFrom(engine) {
    const hosts = [];
    const tracked = new Set(global.SPZ.Catalog.HARDBLOCK_DOMAINS);
    // a compact "tracker-ish" subset from the engine host set
    const re = /(analytic|metric|track|telemetry|beacon|stat|pixel|ads?[._-]|adserver|syndication|adnxs|doubleclick|criteo|taboola|outbrain|scorecard)/i;
    engine.hosts.forEach(function (h) {
      if (re.test(h)) tracked.add(h);
    });
    tracked.forEach(function (h) { hosts.push(h); });
    return hosts;
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.DNR = { ID, applyAll, buildListRules, buildUrlCleanRules, buildHeaderRules };
})(typeof self !== 'undefined' ? self : this);
