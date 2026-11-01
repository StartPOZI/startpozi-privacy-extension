// cosmetic.js — element hiding (ISOLATED world).
// Injects a <style> built from the cosmetic cache the background keeps in
// storage.local: generic cosmetic selectors from the enabled lists,
// per-domain selectors (incl. the YouTube set from the browser) and the
// user's custom hide styles.
(function () {
  'use strict';
  var STYLE_ID = '__spz_cosmetic';
  if (document.getElementById(STYLE_ID)) return;

  function baseDomain(host) {
    var parts = host.toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    var last2 = parts.slice(-2).join('.');
    var multi = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au',
      'co.nz', 'com.br', 'com.cn', 'com.ua', 'co.jp', 'com.mx'];
    if (multi.indexOf(last2) !== -1 && parts.length >= 3) return parts.slice(-3).join('.');
    return last2;
  }

  chrome.storage.local.get('spz:cosmeticCache', function (o) {
    var cache = o && o['spz:cosmeticCache'];
    if (!cache) return;
    var host = location.hostname.toLowerCase();
    var base = baseDomain(host);
    var css = [];

    (cache.generic || []).forEach(function (sel) {
      css.push(sel + '{display:none!important}');
    });

    var hosted = cache.hosted || {};
    [host, base].forEach(function (h) {
      (hosted[h] || []).forEach(function (sel) {
        try {
          document.querySelector(sel); // validate selector syntax
          css.push(sel + '{display:none!important}');
        } catch (e) { /* invalid selector — skip */ }
      });
    });

    var custom = (cache.customStyles || '').trim();
    if (custom) css.push(custom);

    if (!css.length) return;
    try {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css.join('\n');
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* page blocks — ignore */ }
  });

  // Element zapper («Block ads manually»): правила, выбранные пикером,
  // применяются и при следующих загрузках. Запрашиваем у background CSS
  // для ГЛАВНОЙ страницы (sender.tab) и своего фрейма — реклама живёт
  // в iframe, а хранится правило под доменом главной страницы (как в
  // браузере: insertCSS применяется ко всем фреймам).
  try {
    chrome.runtime.sendMessage({ type: 'getZapCss', url: location.href }, function (zapCss) {
      if (chrome.runtime.lastError || !zapCss) return;
      try {
        var s = document.createElement('style');
        s.id = '__spz_zap';
        s.textContent = zapCss;
        (document.head || document.documentElement).appendChild(s);
      } catch (e) { /* page blocks — ignore */ }
    });
  } catch (e) { /* extension context gone */ }
})();
