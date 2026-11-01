// welcome.js — страница «Спасибо за скачивание»: перевод, обои дня Bing
// (тот же кэш, что у настроек), версия, кнопка настроек.
'use strict';
(function () {
  // версия
  var ver = document.getElementById('ver');
  if (ver) {
    try { ver.textContent = 'v' + chrome.runtime.getManifest().version; }
    catch (e) { ver.textContent = ''; }
  }

  // настройки — открыть страницу настроек (в той же вкладке)
  var openSettings = document.getElementById('openSettings');
  if (openSettings) {
    openSettings.addEventListener('click', function (e) {
      e.preventDefault();
      chrome.tabs.create
        ? chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html#blocker') })
        : (location.href = chrome.runtime.getURL('ui/options.html#blocker'));
    });
  }

  // обои дня Bing за стеклом (как на странице настроек)
  function applyWallpaper() {
    try {
      var done = function (wp) {
        if (wp && wp.url) {
          document.body.classList.add('has-wallpaper');
          document.body.style.backgroundImage =
            'linear-gradient(rgba(8,8,14,.45), rgba(8,8,14,.72)), url("' + wp.url + '")';
        }
      };
      chrome.storage.local.get('spz:wallpaper', function (o) {
        var wp = o && o['spz:wallpaper'];
        var today = new Date().toISOString().slice(0, 10);
        if (wp && wp.day === today) { done(wp); return; }
        chrome.runtime.sendMessage({ type: 'getWallpaper' }, function (r) {
          if (chrome.runtime.lastError) return;
          if (r && r.ok && r.wallpaper) done(r.wallpaper);
        });
      });
    } catch (e) { /* тёмный фон по умолчанию */ }
  }

  // i18n-ext сам переводит EN-текстовые узлы по словарю браузера.
  applyWallpaper();
})();
