// lists.js — FilterHub list fetching, caching and engine (re)building.
// Mirrors the browser's adblocker.js downloader: timeout scales with the
// declared list size, ABP `! Checksum:` headers are verified (mismatch →
// keep the cached copy), everything is cached in storage.local.
'use strict';
(function (global) {
  const CACHE_KEY = 'spz:listCache';   // { [url]: { text, ts, verified } }
  const META_KEY = 'spz:listMeta';     // { [url]: { ts, ok, verified, error } }
  const COSMETIC_KEY = 'spz:cosmeticCache';

  function catalogByUrl(url) {
    return global.SPZ.Catalog.FILTERHUB_LISTS.find(function (l) {
      return global.SPZ.Catalog.filterhubUrl(l) === url;
    });
  }

  function downloadTimeoutMs(url) {
    const l = catalogByUrl(url);
    return Math.max(30000, (l && l.sizeKB || 0) * 10);
  }

  async function fetchWithTimeout(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, ms);
    try {
      const resp = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.text();
    } finally {
      clearTimeout(t);
    }
  }

  async function readCache() {
    const o = await chrome.storage.local.get(CACHE_KEY);
    return o[CACHE_KEY] || {};
  }

  async function writeCache(cache) {
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  }

  async function updateList(url, progressCb) {
    const cache = await readCache();
    let meta = { url, ts: Date.now(), ok: false, verified: null, error: '' };
    try {
      const text = await fetchWithTimeout(url, downloadTimeoutMs(url));
      const verified = global.SPZ.Checksum.verifyListChecksum(text);
      // null = no checksum header (accept, count as unverified);
      // false = MISMATCH → reject, keep old copy.
      if (verified === false) {
        meta.error = 'checksum mismatch';
      } else {
        cache[url] = { text, ts: Date.now(), verified: !!verified };
        meta.ok = true;
        meta.verified = !!verified;
      }
    } catch (e) {
      meta.error = e && e.message ? e.message : String(e);
    }
    if (cache[url]) meta.ok = cache[url] ? meta.ok || false : false;
    const m = await chrome.storage.local.get(META_KEY);
    const metas = m[META_KEY] || {};
    metas[url] = meta;
    await chrome.storage.local.set({ [META_KEY]: metas });
    if (cache[url]) await writeCache(cache);
    if (progressCb) progressCb(meta);
    return meta;
  }

  async function updateAll(progressCb, opts) {
    const o = opts || {};
    const settings = await global.SPZ.Settings.get();
    const urls = enabledListUrls(settings);
    const results = [];
    for (const url of urls) {
      // Auto-updates skip heavyweight lists (multi-MB): downloading them in
      // the event page FREEZES the browser (extension pages share the
      // parent process in Firefox — settings/popup stopped responding).
      // The offline builtin base already covers them; a MANUAL update
      // ("Обновить списки") fetches everything without limits.
      if (o.maxKB) {
        const l = catalogByUrl(url);
        if (l && l.sizeKB > o.maxKB) {
          results.push({
            url, ts: Date.now(), ok: false,
            skipped: 'size ' + l.sizeKB + 'KB > auto-limit ' + o.maxKB + 'KB',
          });
          continue;
        }
      }
      results.push(await updateList(url, progressCb)); // sequential: be gentle
    }
    return results;
  }

  function enabledListUrls(settings) {
    const C = global.SPZ.Catalog;
    const nums = settings.filterhubEnabled || [];
    const urls = [];
    nums.forEach(function (n) {
      const l = C.FILTERHUB_LISTS.find(function (x) { return x.num === n; });
      if (l) urls.push(C.filterhubUrl(l));
    });
    (settings.filterLists || []).forEach(function (u) {
      if (typeof u === 'string' && /^https?:\/\//i.test(u) && urls.indexOf(u) === -1) urls.push(u);
    });
    return urls;
  }

  async function loadBuiltinText() {
    // Offline base — always present, ships with the extension.
    const resp = await fetch(chrome.runtime.getURL('data/builtin-blocklist.txt'));
    return resp.text();
  }

  // Build the in-memory engine from cached lists + builtin + custom rules.
  async function buildEngine() {
    const settings = await global.SPZ.Settings.get();
    const cache = await readCache();
    const urls = enabledListUrls(settings);
    const texts = [{ text: global.SPZ.Catalog.CUSTOM_FILTERS_TEXT, url: 'builtin:custom' }];
    try {
      texts.push({ text: await loadBuiltinText(), url: 'builtin:hardblock' });
    } catch (e) { /* packaged file missing — skip */ }
    urls.forEach(function (u) {
      if (cache[u] && cache[u].text) texts.push({ text: cache[u].text, url: u });
    });
    if (settings.customFilters && settings.customFilters.trim()) {
      texts.push({ text: settings.customFilters, url: 'user:custom' });
    }
    const engine = global.SPZ.Engine.parseLists(texts);

    // Cosmetic cache for the content script.
    const cosmetic = {
      generic: engine.cosmeticGeneric.slice(0, 3000),
      hosted: Object.assign({}, engine.cosmeticHosted, global.SPZ.Catalog.CUSTOM_COSMETIC_SELECTORS),
      customStyles: settings.customStyles || '',
    };
    await chrome.storage.local.set({ [COSMETIC_KEY]: cosmetic });

    engine.info = {
      // ЧЕСТНЫЙ счётчик: сколько источников реально собрало движок
      // (builtin×2 + скачанные списки + пользовательские). Раньше писалось
      // urls+2 — строка «Lists: 18» показывалась даже без единого списка.
      lists: texts.length,
      rules: engine.total,
      skipped: engine.skipped,
      block: engine.block.length + engine.blockImportant.length,
      allow: engine.allow.length,
      hosts: engine.hosts.size,
      builtAt: Date.now(),
    };
    // Кэш последнего состояния: холодный воркер отвечает на getEngineInfo
    // мгновенно, вместо ожидания парсинга 2.7MB (который блокировал
    // родительский процесс Firefox на секунды).
    try {
      await chrome.storage.local.set({ 'spz:engineInfo': engine.info });
    } catch (e) { /* storage недоступен — не критично */ }
    return engine;
  }

  async function getEngineMeta() {
    const m = await chrome.storage.local.get(META_KEY);
    return m[META_KEY] || {};
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.Lists = {
    CACHE_KEY, META_KEY, COSMETIC_KEY,
    updateList, updateAll, enabledListUrls, buildEngine, getEngineMeta,
    catalogByUrl,
  };
})(typeof self !== 'undefined' ? self : this);
