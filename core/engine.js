// engine.js — EasyList/ABP-subset parser + request matcher.
// Ported from the StartPOZI Desktop Browser's blocking logic to run in a
// service worker / event page. Supports the network-filter subset that
// covers the overwhelming majority of FilterHub rules:
//   ||domain^  host anchors, path globs, /regex/, plain URLs,
//   $third-party, $~third-party, $script/image/stylesheet/xmlhttprequest/
//   sub_frame/main_frame/font/media/websocket/ping/object/other,
//   $domain=a|~b, $important, @@ exceptions, $document allows.
// Rules that cannot be represented are skipped (and counted) — the
// browser's full engine is @cliqz/adblocker; here we keep the same
// behaviour for the common cases.
'use strict';
(function (global) {
  const TYPE_MAP = {
    script: 1 << 0, image: 1 << 1, stylesheet: 1 << 2,
    xmlhttprequest: 1 << 3, sub_frame: 1 << 4, main_frame: 1 << 5,
    font: 1 << 6, media: 1 << 7, websocket: 1 << 8, ping: 1 << 9,
    object: 1 << 10, other: 1 << 11, document: 1 << 5,
  };
  const ALL_TYPES = (1 << 12) - 1;
  const WR_TYPE_TO_AB = {
    script: 'script', image: 'image', stylesheet: 'stylesheet',
    xmlhttprequest: 'xmlhttprequest', sub_frame: 'sub_frame',
    main_frame: 'main_frame', font: 'font', media: 'media',
    websocket: 'websocket', ping: 'ping', object: 'object', other: 'other',
    speculative: 'other', beacon: 'ping', csp_report: 'other',
    webbundle: 'other', webtransport: 'websocket', websocket: 'websocket',
  };

  function globToRegExp(s) {
    // Adblock pattern → RegExp. '^' is the separator token, '*' any run.
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '*') out += '.*';
      else if (ch === '^') out += '(?:[\\x00-\\x24\\x26-\\x2c\\x2f\\x3a-\\x40\\x5b-\\x5e\\x60\\x7b-\\x7f]|$)';
      else out += ch.replace(/[.+?${}()|[\]\\]/g, '\\$&');
    }
    return out;
  }

  // Heuristic registrable domain (last two labels; common multi-part SLDs).
  const MULTI_SLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp',
    'or.jp', 'ne.jp', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br',
    'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'co.in', 'co.kr',
    'com.mx', 'com.ar', 'com.tr', 'com.ua', 'com.ru', 'net.ru', 'org.ru']);
  function baseDomain(host) {
    if (!host) return '';
    const parts = host.toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const last2 = parts.slice(-2).join('.');
    if (MULTI_SLD.has(last2) && parts.length >= 3) return parts.slice(-3).join('.');
    return last2;
  }

  function parseRule(rawLine) {
    let line = rawLine;
    // Strip comments / empty / metadata
    if (!line || line.charAt(0) === '!' || line.charAt(0) === '[') return null;
    if (/^\s*$/.test(line)) return null;

    let kind = 'block';
    if (line.charAt(0) === '@' && line.charAt(1) === '@') {
      kind = 'allow';
      line = line.slice(2);
    }

    // Split options
    let opts = '';
    const dollar = line.lastIndexOf('$');
    if (dollar !== -1) {
      const tail = line.slice(dollar + 1);
      // Heuristic: options if tail has no '/' and no '*' beyond short tokens
      if (!/\s/.test(tail)) {
        line = line.slice(0, dollar);
        opts = tail;
      }
    }
    if (!line) return null;

    // Cosmetic rules are handled by the cosmetic path, not here.
    if (line.indexOf('##') !== -1 || line.indexOf('#@#') !== -1 ||
        line.indexOf('#?#') !== -1) return null;

    const rule = {
      kind, important: false, party: 0, types: ALL_TYPES,
      domains: null, notDomains: null, hostAnchor: null,
      hostPrefix: null, regex: null, matchStr: null, raw: rawLine,
    };

    if (opts) {
      const parts = opts.split(',');
      for (let i = 0; i < parts.length; i++) {
        const o = parts[i];
        let neg = false;
        let name = o;
        if (name.charAt(0) === '~') { neg = true; name = name.slice(1); }
        if (name === 'third-party') rule.party = neg ? 1 : 2;
        else if (name === 'first-party' || name === '1p') rule.party = neg ? 2 : 1;
        else if (name === 'important') rule.important = true;
        else if (name === 'domain') { /* handled below */ }
        else if (TYPE_MAP[name] !== undefined) {
          if (neg) rule.types &= ~TYPE_MAP[name];
          else {
            if (rule.types === ALL_TYPES) rule.types = 0;
            rule.types |= TYPE_MAP[name];
          }
        } else if (['popup', 'csp', 'rewrite', 'permissions', 'removeparam',
          'redirect', 'redirect-rule', 'dns_type', 'header', 'genericblock',
          'generichide', 'elemhide', 'specifichide', 'badfilter', 'ping',
          'websocket', 'webrtc', 'media'].indexOf(name) !== -1) {
          // unsupported or already covered → elemhide/generichide only apply
          // to allow rules' cosmetic meaning; popup/csp/… cannot be enforced
          // here. Drop these rules rather than mis-blocking.
          if (name === 'generichide' || name === 'elemhide' ||
              name === 'specifichide' || name === 'genericblock') {
            // allow-rule cosmetic marker → keep as a plain allow for hosts
            continue;
          }
          return null;
        } else if (name === 'match-case') { /* regex flag, ignore */ }
        else if (name === 'network') { /* uBO synonym */ }
        else {
          // unknown option → skip rule (safe)
          return null;
        }
      }
      const dom = parts.find(function (p) {
        return p === 'domain' || p.startsWith('domain=');
      });
      if (dom && dom.startsWith('domain=')) {
        rule.domains = [];
        rule.notDomains = [];
        dom.slice(7).split('|').forEach(function (d) {
          if (!d) return;
          if (d.charAt(0) === '~') rule.notDomains.push(d.slice(1).toLowerCase());
          else rule.domains.push(d.toLowerCase());
        });
        if (!rule.domains.length) rule.domains = null;
        if (!rule.notDomains.length) rule.notDomains = null;
      }
    }

    // Pattern forms
    if (line.charAt(0) === '|' && line.charAt(1) === '|') {
      // ||host.anchor…
      const rest = line.slice(2);
      const sep = rest.indexOf('^');
      let host, path = '';
      if (sep !== -1) {
        host = rest.slice(0, sep);
        path = rest.slice(sep); // keep the '^' for glob conversion
      } else {
        const slash = rest.indexOf('/');
        if (slash !== -1) { host = rest.slice(0, slash); path = rest.slice(slash); }
        else host = rest;
      }
      if (!host || /[^a-z0-9.*_-]/i.test(host)) {
        // fall back to a full regex on the raw pattern
        try {
          rule.regex = new RegExp('^[a-z][a-z0-9+.-]*:\\/\\/([^\\/?#]*\\.)?' +
            globToRegExp(rest).replace(/^\^\\\/\^/, ''), 'i');
          rule.matchStr = line;
          return rule;
        } catch (e) { return null; }
      }
      rule.hostAnchor = host.toLowerCase();
      if (path && path !== '^') {
        try { rule.regex = new RegExp(globToRegExp(path), 'i'); }
        catch (e) { return null; }
      }
      return rule;
    }
    if (line.charAt(0) === '|' || /^https?:\/\//i.test(line) ||
        /^[a-z]+:\/\//i.test(line)) {
      // anchored / plain URL match (match anywhere per ABP for unanchored)
      try {
        rule.regex = new RegExp(globToRegExp(line).replace(/^\|/, '^'), 'i');
        rule.matchStr = line;
        return rule;
      } catch (e) { return null; }
    }
    if (line.length > 1 && line.charAt(0) === '/' && line.slice(-1) === '/') {
      try {
        rule.regex = new RegExp(line.slice(1, -1), 'i');
        rule.matchStr = line;
        return rule;
      } catch (e) { return null; }
    }
    if (line === '*') {
      rule.matchStr = '*';
      return rule;
    }
    // unanchored plain pattern → substring-ish regex
    try {
      rule.regex = new RegExp(globToRegExp(line), 'i');
      rule.matchStr = line;
      return rule;
    } catch (e) { return null; }
  }

  function hostMatches(host, anchor, rule) {
    if (!anchor) return false;
    // прекомпилированный wildcard-regex (индекс строится один раз —
    // компилировать RegExp на каждый вызов стоило ~9мс/запрос)
    if (rule && rule._hostRe) return rule._hostRe.test(host);
    if (anchor.indexOf('*') !== -1) {
      try {
        return new RegExp('(^|\\.)' + anchor.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9-]+') + '$', 'i').test(host);
      } catch (e) { return false; }
    }
    return host === anchor || host.endsWith('.' + anchor);
  }

  // Does `rule` apply to a request? type is the webRequest type name.
  function ruleMatches(rule, url, host, type, isThird, siteHost) {
    const abType = WR_TYPE_TO_AB[type] || 'other';
    const bit = TYPE_MAP[abType] || 0;
    if (rule.types !== ALL_TYPES && !(rule.types & bit)) return false;
    if (rule.party === 2 && !isThird) return false;
    if (rule.party === 1 && isThird) return false;
    if (rule.domains) {
      // $domain= — это домен СТРАНИЦЫ (документа) по семантике ABP;
      // сопоставление с хостом самого запроса делало опцию бессмысленной
      // (хост всегда совпадает с шаблоном правила) и слишком широкой.
      let ok = false;
      for (let i = 0; i < rule.domains.length; i++) {
        const d = rule.domains[i];
        if (siteHost === d || siteHost.endsWith('.' + d)) { ok = true; break; }
      }
      if (!ok) return false;
    }
    if (rule.notDomains) {
      for (let i = 0; i < rule.notDomains.length; i++) {
        const d = rule.notDomains[i];
        if (siteHost === d || siteHost.endsWith('.' + d)) return false;
      }
    }
    if (rule.hostAnchor) {
      if (!hostMatches(host, rule.hostAnchor, rule)) return false;
      if (rule.regex && !rule.regex.test(url)) return false;
      return true;
    }
    if (rule.regex) return rule.regex.test(url);
    if (rule.matchStr === '*') return true;
    return false;
  }

  function parseLists(listTexts) {
    const engine = {
      block: [], allow: [], blockImportant: [],
      hosts: new Set(), allowHosts: new Set(),
      cosmeticGeneric: [], cosmeticHosted: {},
      skipped: 0, total: 0,
    };
    (listTexts || []).forEach(function (entry) {
      const text = entry && entry.text ? entry.text : '';
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        engine.total++;
        if (!line || line.charAt(0) === '!' || line.charAt(0) === '[') continue;

        // Cosmetic: domain##sel / ##sel / #@# exceptions (exceptions dropped)
        const cHash = line.indexOf('##');
        if (cHash !== -1) {
          if (line.indexOf('#@#') !== -1 || line.indexOf('#?#') !== -1) continue;
          const hostPart = line.slice(0, cHash).trim();
          const sel = line.slice(cHash + 2).trim();
          if (!sel || sel.length > 400) continue;
          if (!hostPart) {
            if (engine.cosmeticGeneric.length < 4000) engine.cosmeticGeneric.push(sel);
          } else {
            hostPart.split(',').forEach(function (h) {
              h = h.replace(/^~/, '').toLowerCase();
              if (!h) return;
              if (!engine.cosmeticHosted[h]) engine.cosmeticHosted[h] = [];
              if (engine.cosmeticHosted[h].length < 500) engine.cosmeticHosted[h].push(sel);
            });
          }
          continue;
        }

        const rule = parseRule(line);
        if (!rule) { engine.skipped++; continue; }
        if (rule.kind === 'allow') {
          engine.allow.push(rule);
          if (rule.hostAnchor) engine.allowHosts.add(rule.hostAnchor);
        } else {
          if (rule.important) engine.blockImportant.push(rule);
          else engine.block.push(rule);
          if (rule.hostAnchor) engine.hosts.add(rule.hostAnchor);
        }
      }
    });
    return engine;
  }

  // ---- host index --------------------------------------------------------
  // Индекс по hostAnchor: матчинг становится O(метки хоста) вместо полного
  // перебора всех правил (с офлайн-базой на 113k правил линейный скан стоил
  // ~9 мс CPU на КАЖДЫЙ запрос — фон притормаживал браузер на тяжёлых
  // страницах). Правила без якоря (path-based, wildcard-якоря) остаются в
  // линейных списках — их единицы процентов.
  // Самый длинный «грубый» литерал в исходнике regex (без метасимволов):
  // он ОБЯЗАН присутствовать в совпавшем URL — дешёвый префильтр indexOf
  // перед дорогим regex-тестом.
  function longestLiteral(src) {
    let best = '';
    let cur = '';
    const plain = /[a-z0-9%\/_.=&?;:,-]/;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (plain.test(ch)) cur += ch;
      else {
        if (cur.length > best.length) best = cur;
        cur = '';
        if (ch === '\\') i++; // пропустить экранированный символ
      }
    }
    if (cur.length > best.length) best = cur;
    return best.length >= 3 ? best.toLowerCase() : null;
  }

  function buildIndex(engine) {
    engine.byHost = new Map(); // anchor → [rules]
    const noHost = { important: [], allow: [], block: [] };
    function place(rule, kind) {
      const a = rule.hostAnchor;
      if (a && a.indexOf('*') === -1) {
        let b = engine.byHost.get(a);
        if (!b) { b = []; engine.byHost.set(a, b); }
        b.push(rule);
      } else {
        if (a) {
          try {
            rule._hostRe = new RegExp('(^|\\.)' +
              a.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9-]+') + '$', 'i');
          } catch (e) { /* битый якорь — правило не сработает */ }
        }
        // Префильтр для regex-правил: обязательный литерал из исходника
        // regex. Если его нет в URL — regex можно не гонять. Без этого
        // ~4.3k path-правил EasyList тестировались на каждый запрос.
        if (rule.regex) rule._lit = longestLiteral(rule.regex.source);
        noHost[kind].push(rule);
      }
    }
    for (let i = 0; i < engine.blockImportant.length; i++) place(engine.blockImportant[i], 'important');
    for (let i = 0; i < engine.allow.length; i++) place(engine.allow[i], 'allow');
    for (let i = 0; i < engine.block.length; i++) place(engine.block[i], 'block');
    engine.noHost = noHost;

    // Типизированный вид безякорных правил: тип запроса → вид → (any/third/
    // first). Без этого каждый запрос линейно гонял ~4.7k regex-правил всех
    // типов; с разбиением скан падает до «своих» типов и видов.
    const typeNames = Object.keys(TYPE_MAP).filter(function (n) { return n !== 'document'; });
    engine.typed = {};
    for (let t = 0; t < typeNames.length; t++) {
      engine.typed[typeNames[t]] = {
        imp: { any: [], third: [], first: [] },
        allow: { any: [], third: [], first: [] },
        block: { any: [], third: [], first: [] },
      };
    }
    function spread(rules, kind) {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        for (let t = 0; t < typeNames.length; t++) {
          const n = typeNames[t];
          if (r.types !== ALL_TYPES && !(r.types & TYPE_MAP[n])) continue;
          const slot = r.important ? engine.typed[n].imp : engine.typed[n][kind === 'allow' ? 'allow' : 'block'];
          if (r.party === 2) slot.third.push(r);
          else if (r.party === 1) slot.first.push(r);
          else slot.any.push(r);
        }
      }
    }
    spread(noHost.important, 'block');
    spread(noHost.allow, 'allow');
    spread(noHost.block, 'block');
    return engine;
  }

  function hostBucketsFor(engine, host) {
    // a.b.example.com → [a.b.example.com, b.example.com, example.com, com]
    const out = [];
    const parts = host.split('.');
    for (let i = 0; i < parts.length; i++) {
      const b = engine.byHost.get(parts.slice(i).join('.'));
      if (b) out.push(b);
    }
    return out;
  }

  // Один проход: правила нужного вида (kind/important) из типизированных
  // списков (тип запроса + партия) и из хост-корзин. Приоритет ABP
  // соблюдается порядком проходов в matchRequest: $important → allow →
  // plain block.
  function passMatch(engine, kind, importantWanted, buckets, url, host, type, isThird, siteHost) {
    const abType = WR_TYPE_TO_AB[type] || 'other';
    const groups = engine.typed[abType] || engine.typed.other;
    // свой вид правила (imp/allow/block) — без повторного скана чужих
    const slot = kind === 'allow' ? groups.allow
      : (importantWanted ? groups.imp : groups.block);
    const lists = isThird ? [slot.any, slot.third] : [slot.any, slot.first];
    const urlLower = url.toLowerCase();
    function ok(r) {
      if (r._lit && urlLower.indexOf(r._lit) === -1) return false;
      return ruleMatches(r, url, host, type, isThird, siteHost);
    }
    for (let L = 0; L < lists.length; L++) {
      const list = lists[L];
      for (let i = 0; i < list.length; i++) {
        if (ok(list[i])) return list[i];
      }
    }
    for (let b = 0; b < buckets.length; b++) {
      const list = buckets[b];
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.kind !== kind) continue;
        if (kind === 'block' && !!r.important !== importantWanted) continue;
        if (ok(r)) return r;
      }
    }
    return null;
  }

  // Returns { blocked:bool, important:bool, rule:string } or null.
  function matchRequest(engine, url, type, isThird, siteHost) {
    if (!engine) return null;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
    if (!engine.byHost) buildIndex(engine);

    // Auth whitelist — OAuth/2FA flows must never break (same as browser).
    const auth = global.SPZ.Catalog.AUTH_WHITELIST;
    for (let i = 0; i < auth.length; i++) {
      if (host === auth[i] || host.endsWith('.' + auth[i])) return null;
    }

    const buckets = hostBucketsFor(engine, host);
    let r = passMatch(engine, 'block', true, buckets, url, host, type, isThird, siteHost);
    if (r) return { blocked: true, important: true, rule: r.raw };
    r = passMatch(engine, 'allow', false, buckets, url, host, type, isThird, siteHost);
    if (r) return null;
    r = passMatch(engine, 'block', false, buckets, url, host, type, isThird, siteHost);
    if (r) return { blocked: true, important: false, rule: r.raw };
    return null;
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.Engine = {
    TYPE_MAP, ALL_TYPES, WR_TYPE_TO_AB, baseDomain,
    parseRule, parseLists, matchRequest, hostMatches, ruleMatches, globToRegExp,
  };
})(typeof self !== 'undefined' ? self : this);
