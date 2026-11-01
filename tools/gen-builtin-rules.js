// gen-builtin-rules.js — generates the always-on builtin protection:
//   rules/builtin.json        — declarativeNetRequest static ruleset
//   data/builtin-blocklist.txt — offline base for the engine
//
// База собирается из CUSTOM_FILTERS + HARDBLOCK (как раньше) ПЛЮС
// загруженные списки FilterHub (EasyList, EasyPrivacy, NoCoin, OISD,
// uBO Quick Fixes/Unbreak) — чтобы блокировка работала СРАЗУ после
// установки, ещё до первого обновления списков по сети. Скачанные списки
// кэшируются в tools/.filterhub-cache/ (офлайн-перегенерация работает).
// Run: node tools/gen-builtin-rules.js
'use strict';
global.self = global;
require('../core/catalog.js');
require('../core/engine.js');
const fs = require('fs');
const path = require('path');
const { Catalog, Engine } = global.SPZ;

// Какие списки вшиваем в офлайн-базу (лёгкое ядро пресета medium:
// максимальный эффект при разумном размере; гигантские AdGuard Base/Spyware
// и HaGezi не вшиваем — они подтянутся первым обновлением по сети).
const BUILTIN_LIST_NUMS = [17, 10, 18, 19, 31, 32]; // NoCoin, OISD, EasyList, EasyPrivacy, uBO quick, uBO unbreak
const CACHE_DIR = path.join(__dirname, '.filterhub-cache');

async function fetchList(list) {
  const url = Catalog.filterhubUrl(list);
  const cacheFile = path.join(CACHE_DIR, list.num + '-' + list.file);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 7 * 24 * 3600 * 1000) {
      console.log('  cache:', list.num, list.file);
      return fs.readFileSync(cacheFile, 'utf8');
    }
  }
  console.log('  fetch:', url);
  const ctl = new AbortController();
  const t = setTimeout(function () { ctl.abort(); }, 120000);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    fs.writeFileSync(cacheFile, text);
    return text;
  } finally { clearTimeout(t); }
}

// --- Collect host-anchor network rules from the built-in custom filters ---
const lines = Catalog.CUSTOM_FILTERS_TEXT.split('\n');
const blockDomains = new Set();
const importantDomains = new Set();
const extraTextLines = new Set(); // engine-usable rules from downloaded lists
let skipped = 0;

function takeRule(raw) {
  const rule = Engine.parseRule(raw);
  if (!rule) return null;
  if (rule.hostAnchor && !rule.regex && !rule.domains && !rule.notDomains &&
      rule.types === Engine.ALL_TYPES && rule.party === 0) {
    if (rule.kind === 'allow') return { allow: rule.hostAnchor };
    if (rule.important) return { important: rule.hostAnchor };
    return { block: rule.hostAnchor };
  }
  return { text: raw }; // остаётся движку (Firefox), в DNR не конвертируется
}

for (const raw of lines) {
  const r = takeRule(raw);
  if (!r) { skipped++; continue; }
  if (r.important) importantDomains.add(r.important);
  else if (r.block) blockDomains.add(r.block);
  else if (r.allow) {} // auth whitelist ниже
  else if (r.text) extraTextLines.add(r.text);
}
// Hardblock list as plain host anchors too.
Catalog.HARDBLOCK_DOMAINS.forEach(function (d) {
  if (!importantDomains.has(d)) blockDomains.add(d);
});

const allowDomains = new Set(Catalog.AUTH_WHITELIST);

(async function () {
  const lists = Catalog.FILTERHUB_LISTS.filter(function (l) {
    return BUILTIN_LIST_NUMS.indexOf(l.num) !== -1;
  });
  console.log('merging FilterHub lists into the offline base:');
  let onlineOk = true;
  for (const l of lists) {
    try {
      const text = await fetchList(l);
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line[0] === '!' || line[0] === '[') continue; // comments/meta
        const r = takeRule(line);
        if (!r) continue; // cosmetic/unsupported — не вшиваем
        if (r.important) importantDomains.add(r.important);
        else if (r.block) blockDomains.add(r.block);
        else if (r.allow) allowDomains.add(r.allow);
        else if (r.text) extraTextLines.add(r.text);
      }
    } catch (e) {
      onlineOk = false;
      console.log('  ⚠ failed (' + e.message + ') — продолжаем без', l.file);
    }
  }

  const SUBRESOURCE_TYPES = ['sub_frame', 'script', 'image', 'stylesheet',
    'xmlhttprequest', 'font', 'media', 'websocket', 'object', 'ping', 'other'];

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  const rules = [];
  let nextId = 1;

  // Auth whitelist allows — highest priority, never break Google sign-in.
  for (const d of Catalog.AUTH_WHITELIST) {
    rules.push({
      id: nextId++,
      priority: 3,
      action: { type: 'allow' },
      condition: { requestDomains: [d] },
    });
  }
  // List @@allows (exceptions from merged lists).
  for (const part of chunk([...allowDomains].sort(), 150)) {
    rules.push({
      id: nextId++,
      priority: 3,
      action: { type: 'allow' },
      condition: { requestDomains: part },
    });
  }
  // $important blocks.
  for (const part of chunk([...importantDomains].sort(), 150)) {
    rules.push({
      id: nextId++,
      priority: 2,
      action: { type: 'block' },
      condition: { requestDomains: part, resourceTypes: SUBRESOURCE_TYPES },
    });
  }
  // Plain blocks.
  for (const part of chunk([...blockDomains].sort(), 150)) {
    rules.push({
      id: nextId++,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: part, resourceTypes: SUBRESOURCE_TYPES },
    });
  }

  const outDir = path.join(__dirname, '..');
  fs.writeFileSync(path.join(outDir, 'rules', 'builtin.json'),
    JSON.stringify(rules, null, 1));

  // Offline engine base: custom + hardblock anchors + merged text rules.
  const txt = [
    '! StartPOZI Privacy Guard — builtin blocklist.',
    '! Base: browser CUSTOM_FILTERS + HARDBLOCK' +
      (onlineOk ? ' + FilterHub ' + lists.map(function (l) { return l.num; }).join(',')
        : ' (FilterHub merge FAILED — cached/offline run)' ) + '.',
    ...[...importantDomains].sort().map(function (d) { return '||' + d + '^$important'; }),
    ...[...blockDomains].sort().map(function (d) { return '||' + d + '^'; }),
    ...[...extraTextLines].sort(),
    ...Catalog.AUTH_WHITELIST.map(function (d) { return '@@||' + d + '^$document'; }),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'data', 'builtin-blocklist.txt'), txt);

  console.log('builtin.json:', rules.length, 'DNR rules',
    '(' + blockDomains.size + ' domains +' , importantDomains.size + ' important,',
    allowDomains.size + ' allows,', extraTextLines.size + ' engine-only rules;',
    skipped + ' skipped from custom set)');
  console.log('builtin-blocklist.txt:', (txt.length / 1024 / 1024).toFixed(1) + ' MB');
})();
