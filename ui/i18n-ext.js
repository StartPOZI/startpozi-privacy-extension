// i18n-ext.js — the StartPOZI Browser's i18n runtime (i18n.js) ported to a
// WebExtension page: same EN→X text-node translation with a live revert
// map, plus the data-ru/data-en and data-ru-ph/data-en-ph attributes the
// browser's Settings markup uses. Dictionaries are the browser's own
// locales/ru.json / uk.json copied to ui/i18n/.
(function () {
  'use strict';
  if (window.i18n) return;

  var lang = 'en';
  var loadedLang = null;
  var byEn = null;   // EN -> X
  var byX = null;    // X -> EN (revert)
  var applying = false;
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  // Dictionaries live at ui/i18n/ (the page is at ui/), while
  // chrome.runtime.getURL resolves from the EXTENSION ROOT — full path!
  var DICTS = { ru: 'ui/i18n/ru.json', uk: 'ui/i18n/uk.json' };

  function buildReverse() {
    byX = {};
    if (!byEn) return;
    var keys = Object.keys(byEn);
    for (var i = 0; i < keys.length; i++) {
      var en = keys[i], x = byEn[en];
      if (x && byX[x] === undefined) byX[x] = en;
    }
  }
  function mapsEmpty() { return !byX || !Object.keys(byX).length; }
  function lookup(trimmed) {
    var key = trimmed.replace(/\s+/g, ' ');
    if (lang === 'en') return byX ? byX[key] : undefined;
    return byEn ? byEn[key] : undefined;
  }
  function translateText(node) {
    if (!node) return;
    var v = node.nodeValue;
    if (!v) return;
    var trimmed = v.trim();
    if (!trimmed || trimmed.length > 400) return;
    // NOTE: guard lastWritten УДАЛЁН. Он защищал от циклов MutationObserver,
    // которого здесь больше нет (см. startObserver) — но блокировал ОБРАТНЫЙ
    // перевод (ru→en): наши же переведённые узлы навсегда оставались
    // непереведёнными («язык не переключается»). walk() обходит каждый узел
    // один раз за проход — зацикливание невозможно.
    var rep = lookup(trimmed);
    if (rep && rep !== trimmed) {
      var lead = v.match(/^\s*/)[0];
      var trail = v.match(/\s*$/)[0];
      node.nodeValue = lead + rep + trail;
    }
  }
  function translateEl(el) {
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (el.hasAttribute && el.hasAttribute(a)) {
        var val = el.getAttribute(a);
        if (val && val.length <= 400) {
          var rep = lookup(val);
          if (rep && rep !== val) el.setAttribute(a, rep);
        }
      }
    }
    // data-ru / data-en (+ -ph для placeholder) из браузерного Settings.
    // Оригинал запоминаем: без data-en возврат на английский был невозможен
    // (элемент навсегда оставался русским).
    if (el.hasAttribute && el.hasAttribute('data-ru')) {
      var useRu = lang !== 'en';
      if (useRu && !el.__spzOrigTxt) el.__spzOrigTxt = el.textContent;
      var swap = useRu ? el.getAttribute('data-ru')
        : (el.getAttribute('data-en') || el.__spzOrigTxt);
      if (swap) el.textContent = swap;
    }
    if (el.hasAttribute && el.hasAttribute('data-ru-ph')) {
      var useRuPh = lang !== 'en';
      if (useRuPh && !el.__spzOrigPh) el.__spzOrigPh = el.getAttribute('placeholder');
      var swapPh = useRuPh ? el.getAttribute('data-ru-ph')
        : (el.getAttribute('data-en-ph') || el.__spzOrigPh);
      if (swapPh) el.setAttribute('placeholder', swapPh);
    }
  }
  function walk(root) {
    if (!root) return;
    if (lang === 'en' && mapsEmpty()) return;
    if (lang !== 'en' && (!byEn || !Object.keys(byEn).length)) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (tw.nextNode()) nodes.push(tw.currentNode);
    for (var i = 0; i < nodes.length; i++) translateText(nodes[i]);
    var withAttr = root.querySelectorAll
      ? root.querySelectorAll('[placeholder], [title], [aria-label], [alt], [data-ru], [data-ru-ph]')
      : [];
    for (var j = 0; j < withAttr.length; j++) translateEl(withAttr[j]);
  }
  function applyI18n(root) {
    if (applying) return;
    applying = true;
    try { walk(root || document.body); } finally { applying = false; }
  }
  function t(s) {
    if (s == null) return s;
    if (lang === 'en') return s;
    var rep = byEn ? byEn[s] : undefined;
    return rep ? rep : s;
  }

  // Dynamic content: NO MutationObserver. Empirically it wedges extension
  // pages in Firefox (e2e bisect: every variant without it is stable).
  // Instead, the page code calls i18n.apply(root) after rendering dynamic
  // sections (catalog rows, log entries) — deterministic and cheaper.
  function startObserver() { /* no-op — see comment above */ }
  function stopObserver() { /* no-op */ }

  var langRequestId = 0;
  // NOTE: dispatching the (internal) i18nlanguagechange CustomEvent while
  // the MutationObserver is active WEDGES extension pages (e2e bisect:
  // variant E without the dispatch is fine). The only consumer re-renders
  // itself directly after setLanguage() — see options-inline.js.
  function notify() { /* no-op */ }

  // Persist the language choice via the BACKGROUND (message → storage write
  // in the event page). Writing storage DIRECTLY from the extension page
  // wedges it (bisect in the original port; reproduced live: the page freezes
  // right after chrome.storage.local.set from page context).
  function persistLang(l) {
    setTimeout(function () {
      try {
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'setLang', lang: l }, function () {
            void chrome.runtime.lastError; // ответ не важен
          });
        }
      } catch (e) { /* ignore */ }
    }, 100);
  }

  function fetchDict(l) {
    var url = chrome.runtime.getURL(DICTS[l]);
    return fetch(url).then(function (r) { return r.json(); });
  }

  function setLanguage(l) {
    var next = (!l || l === 'en' || !DICTS[l]) ? 'en' : String(l);
    var prev = lang;
    var req = ++langRequestId;
    if (prev !== 'en' && prev !== next && !mapsEmpty()) {
      lang = 'en';
      applyI18n(document.body);
    }
    lang = next;
    persistLang(lang);
    if (lang === 'en') {
      if (!mapsEmpty()) applyI18n(document.body);
      startObserver();
      notify();
      return;
    }
    if (loadedLang === lang && byEn && Object.keys(byEn).length) {
      applyI18n(document.body);
      startObserver();
      notify();
      return;
    }
    stopObserver();
    fetchDict(lang).then(function (dict) {
      if (req !== langRequestId) return;
      byEn = dict || {};
      loadedLang = lang;
      buildReverse();
      applyI18n(document.body);
      startObserver();
      notify();
    }).catch(function () {
      if (req !== langRequestId) return;
      byEn = null; byX = null; loadedLang = null;
      startObserver();
    });
  }

  function loadAndApply() {
    // explicit ?lang=xx in the URL wins (deep-linking / e2e), then the
    // saved choice, then the browser UI language.
    // storage.LOCAL: storage.sync can stall on temporary/offline installs
    // and the language is a device-local preference anyway.
    var forced = (location.search || '').match(/lang=(\w{2})/);
    chrome.storage.local.get('spz:lang', function (o) {
      var saved = o && o['spz:lang'];
      var ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || 'en';
      var l = (forced && DICTS[forced[1]] && forced[1]) || saved ||
        (DICTS[ui.slice(0, 2)] ? ui.slice(0, 2) : 'en');
      setLanguage(l);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndApply);
  } else {
    loadAndApply();
  }

  window.i18n = {
    t: t,
    apply: applyI18n,
    setLanguage: setLanguage,
    getLanguage: function () { return lang; },
  };
})();
