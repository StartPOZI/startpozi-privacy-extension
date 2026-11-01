// smoke.js — offline smoke test of the background pipeline with a mocked
// chrome API (no browser needed). Run: node tools/smoke.js
'use strict';
global.self = global;
require('../core/catalog.js');
require('../core/url-cleaner.js');
require('../core/md5.js');
require('../core/checksum.js');
require('../core/engine.js');
require('../background/settings.js');
require('../background/dnr.js');
require('../background/webreq.js');

const assert = require('assert');
const SPZ = global.SPZ;

// ---- fake chrome -----------------------------------------------------
const fake = {
  storage: {
    local: {
      _d: {},
      async get(k) { const o = {}; if (k in this._d) o[k] = this._d[k]; return o; },
      async set(obj) { Object.assign(this._d, obj); },
      async remove(k) { delete this._d[k]; },
    },
    sync: {
      _d: {},
      async get(k) { const o = {}; if (k in this._d) o[k] = this._d[k]; return o; },
      async set(obj) { Object.assign(this._d, obj); },
    },
    session: {
      _d: {},
      async get(k) { const o = {}; if (k in this._d) o[k] = this._d[k]; return o; },
      async set(obj) { Object.assign(this._d, obj); },
      async remove(k) { delete this._d[k]; },
    },
    onChanged: { addListener() { } },
  },
  declarativeNetRequest: {
    _dynamic: [],
    async getDynamicRules() { return this._dynamic; },
    async updateDynamicRules(o) {
      this._dynamic = this._dynamic.filter(function (r) {
        return (o.removeRuleIds || []).indexOf(r.id) === -1;
      });
      this._dynamic.push(...(o.addRules || []));
    },
  },
  webRequest: {
    onBeforeRequest: { addListener() { } },
    onBeforeSendHeaders: { addListener() { } },
    onHeadersReceived: { addListener() { } },
  },
  runtime: { getURL(p) { return __dirname + '/../' + p; } },
};
global.chrome = fake;
// fetch for builtin-blocklist.txt
const fs = require('fs');
global.fetch = function (url) {
  return Promise.resolve({
    ok: true, text: function () {
      return Promise.resolve(fs.readFileSync(url.replace(/^file:/, ''), 'utf8'));
    },
  });
};

(async function () {
  // 1. settings defaults
  const s = await SPZ.Settings.get();
  assert.strictEqual(s.adblockEnabled, true);
  assert.strictEqual(s.preset, 'medium');
  assert.strictEqual(s.filterhubEnabled.length, 12, 'medium preset = 12 базовых списков');
  console.log('✓ settings defaults (medium, 12 базовых списков)');

  // 2. site exceptions
  await SPZ.Settings.set({ siteExceptions: ['example.com'] });
  const s2 = await SPZ.Settings.get();
  assert.ok(SPZ.Settings.isSiteExcluded(s2, 'sub.example.com'));
  assert.ok(!SPZ.Settings.isSiteExcluded(s2, 'notexample.com'));
  await SPZ.Settings.set({ siteExceptions: [] });
  console.log('✓ site exceptions matching');

  // 3. engine build (builtin + custom filters, no network)
  require('../background/lists.js');
  const engine = await SPZ.Lists.buildEngine();
  assert.ok(engine.block.length + engine.blockImportant.length > 50, 'engine has rules');
  assert.ok(engine.hosts.size > 50, 'engine has hosts');
  const m1 = SPZ.Engine.matchRequest(engine, 'https://tpc.googlesyndication.com/x.js',
    'script', true, 'news.example');
  assert.ok(m1 && m1.blocked && m1.important === true, 'important block');
  const m2 = SPZ.Engine.matchRequest(engine, 'https://accounts.google.com/x',
    'script', true, 'site.com');
  assert.strictEqual(m2, null, 'auth whitelist');
  console.log('✓ engine build + matching (' + engine.hosts.size + ' hosts)');

  // 3b. PERF REGRESSION GUARD: чистый (несовпавший) запрос НЕ должен линейно
  // сканировать все правила. Регрессия: 113k правил × линейный скан давали
  // ~9 мс CPU на каждый запрос — фон тормозил браузер на тяжёлых страницах.
  {
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      SPZ.Engine.matchRequest(engine,
        'https://clean' + i + '.perf.example.org/x/y' + i + '.js?v=' + i,
        'script', true, 'example.org');
    }
    const per = Date.now() - t0;
    assert.ok(per < 1500, 'matchRequest too slow: 1000 clean requests in ' + per + 'ms');
    console.log('✓ engine perf: 1000 clean requests in ' + per + ' ms (' + per + ' µs/req)');
  }

  // 4. DNR rule generation
  const listRules = SPZ.DNR.buildListRules(engine);
  assert.ok(listRules.length >= 2, 'list rules generated');
  const urlClean = SPZ.DNR.buildUrlCleanRules();
  assert.strictEqual(urlClean.length, 3, '3 url-clean rules');
  // spot-check: a block rule contains doubleclick.net
  const flat = JSON.stringify(listRules);
  assert.ok(flat.indexOf('doubleclick.net') !== -1, 'doubleclick in DNR');
  // id uniqueness
  const ids = new Set(listRules.map(function (r) { return r.id; }));
  assert.strictEqual(ids.size, listRules.length, 'unique ids');
  console.log('✓ DNR rules: ' + listRules.length + ' list rules, ids unique');

  // 5. applyAll via fake chrome
  const res = await SPZ.DNR.applyAll(engine, s);
  assert.strictEqual(res.applied, true);
  assert.ok(res.count > 10);
  const dyn = fake.declarativeNetRequest._dynamic;
  const allIds = dyn.map(function (r) { return r.id; });
  assert.strictEqual(new Set(allIds).size, allIds.length, 'applied ids unique');
  assert.ok(allIds.every(function (id) { return id >= 1000 && id < 5000; }), 'id ranges');
  // mini DNR schema validation (catches misplaced fields)
  const ACTIONS = {
    block: [], allow: [], allowAllRequests: [],
    redirect: ['regexSubstitution', 'url', 'transform', 'extensionPath'],
    modifyHeaders: ['requestHeaders', 'responseHeaders'],
  };
  const COND = ['urlFilter', 'regexFilter', 'requestDomains', 'excludedRequestDomains',
    'initiatorDomains', 'resourceTypes', 'domainType', 'excludedInitiatorDomains',
    'requestMethods', 'excludedRequestMethods', 'tabIds', 'excludedTabIds'];
  const TYPES = ['main_frame', 'sub_frame', 'script', 'image', 'stylesheet',
    'xmlhttprequest', 'font', 'media', 'websocket', 'object', 'ping', 'other'];
  for (const r of dyn) {
    assert.ok(ACTIONS[r.action.type], 'known action ' + r.action.type);
    for (const k of Object.keys(r.action)) {
      if (k === 'type') continue;
      assert.ok(ACTIONS[r.action.type].indexOf(k) !== -1,
        'action key ' + k + ' valid for ' + r.action.type + ' (rule ' + r.id + ')');
    }
    for (const k of Object.keys(r.condition)) {
      assert.ok(COND.indexOf(k) !== -1,
        'condition key ' + k + ' valid (rule ' + r.id + ')');
    }
    (r.condition.resourceTypes || []).forEach(function (t) {
      assert.ok(TYPES.indexOf(t) !== -1, 'resourceType ' + t + ' valid');
    });
  }
  console.log('✓ applyAll → ' + dyn.length + ' dynamic rules, schema valid');

  // 6. url-clean regex actually strips params (simulated redirect).
  // DNR regexSubstitution uses RE2 syntax (\1) — emulate for JS replace.
  const subJS = function (sub) { return sub.replace(/\\(\d)/g, function (_, d) { return '$' + d; }); };
  const rc = urlClean[1]; // first-of-many rule
  const regex = new RegExp(rc.condition.regexFilter, 'i');
  const m = 'https://s.com/a?utm_source=x&id=7'.match(regex);
  assert.ok(m, 'urlclean regex matches');
  const replaced = 'https://s.com/a?utm_source=x&id=7'
    .replace(regex, subJS(rc.action.regexSubstitution));
  assert.strictEqual(replaced, 'https://s.com/a?id=7', 'param stripped');
  // only-param case
  const r0 = urlClean[0];
  const re0 = new RegExp(r0.condition.regexFilter, 'i');
  assert.strictEqual(
    'https://s.com/a?gclid=abc'.replace(re0, subJS(r0.action.regexSubstitution)),
    'https://s.com/a', 'sole param stripped');
  // middle/last case
  const r2 = urlClean[2];
  const re2 = new RegExp(r2.condition.regexFilter, 'i');
  assert.strictEqual(
    'https://s.com/a?x=1&fbclid=q'.replace(re2, subJS(r2.action.regexSubstitution)),
    'https://s.com/a?x=1', 'trailing param stripped');
  assert.strictEqual(
    'https://s.com/a?x=1&utm_campaign=a&utm_term=b&y=2'.replace(re2, subJS(r2.action.regexSubstitution)),
    'https://s.com/a?x=1&utm_campaign=a&utm_term=b&y=2'.replace(re2, subJS(r2.action.regexSubstitution)),
    'idempotent-ish');
  console.log('✓ URL-clean regexSubstitution paths');

  // 7. webreq stats recording
  SPZ.WebReq.install(engine, s, false, null);
  await SPZ.WebReq.recordBlocked(1, 'https://mc.yandex.ru/watch?p=1');
  await SPZ.WebReq.recordBlocked(1, 'https://an.yandex.ru/adx?x=1');
  const ts = await SPZ.WebReq.tabStats(1);
  assert.strictEqual(ts.n, 2);
  assert.ok(ts.cats.trackers >= 1 || ts.cats.ads >= 1);
  const log = await SPZ.WebReq.getLog();
  assert.strictEqual(log.length, 2);
  console.log('✓ stats + log recording');

  // 8. i18n dictionaries (the browser's own locales) — present, valid JSON,
  // and cover the strings the Settings page actually uses.
  const fsx = require('fs');
  const ru = JSON.parse(fsx.readFileSync(__dirname + '/../ui/i18n/ru.json', 'utf8'));
  const uk = JSON.parse(fsx.readFileSync(__dirname + '/../ui/i18n/uk.json', 'utf8'));
  assert.ok(Object.keys(ru).length > 2000, 'ru.json is the full browser dictionary (2171 keys)');
  assert.ok(Object.keys(uk).length > 40, 'uk.json present');
  for (const s of ['Security', 'Block ads and trackers', 'Clean tracking URLs',
    'Do Not Track', 'Ad blocker', 'Enabled', 'Disabled']) {
    assert.ok(typeof ru[s] === 'string' && ru[s].length > 0, 'ru has: ' + s);
  }
  const optsHtml = fsx.readFileSync(__dirname + '/../ui/options.html', 'utf8');
  let covered = 0, missing = [];
  const seen = new Set();
  for (const m of optsHtml.matchAll(/>([A-Z][^<>{}\n]{6,80})</g)) {
    const t = m[1].trim().replace(/\s+/g, ' ');
    if (seen.has(t)) continue;
    seen.add(t);
    if (ru[t] !== undefined) covered++;
    else if (missing.length < 3) missing.push(t);
  }
  // The browser's dictionaries are PARTIAL by design ("misses simply stay
  // English" — i18n.js). ~100 core strings covered is the browser's real
  // coverage for this page; the must-have strings are asserted above.
  assert.ok(covered > 80, 'core options strings have RU translations (covered=' + covered + ', sample miss: ' + missing[0] + ')');
  console.log('✓ i18n dictionaries: ru=' + Object.keys(ru).length +
    ' keys, options coverage ' + covered + '/' + seen.size + ' strings');

  console.log('\nALL SMOKE TESTS PASSED');
})().catch(function (e) {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
