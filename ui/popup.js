// popup.js — панель щита StartPOZI: логика, портированная 1:1 из
// StartPOZI Browser renderer.js (#adblockPanel): глобальный тумблер,
// статус-строка, диагностика движка (Lists: N + ↻), счётчик страницы,
// белый список сайта (с перезагрузкой вкладки — как в браузере),
// сессионная статистика, полная статистика по категориям + cookies,
// «Block ads manually» (element zapper), «Report a problem»,
// «Check this site», «Open in settings».
'use strict';

var $ = function (id) { return document.getElementById(id); };

function send(type, payload) {
  return new Promise(function (resolve) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), resolve);
    } catch (e) { resolve(null); }
  });
}

async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

// getActiveDomain() из браузера: хост активной вкладки без www,
// пустой для внутренних страниц (about:/chrome:/file:).
function tabDomain(tab) {
  try {
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.hostname.replace(/^www\./, '');
  } catch (e) { return ''; }
}

// ---- состояние (аналог setAbBtnState в renderer.js) ----------------------
function t(s) { return window.i18n ? window.i18n.t(s) : s; }

function setAbBtnState(on) {
  $('abToggle').checked = !!on;
  $('abStatusText').textContent = on ? t('Enabled') : t('Disabled');
  $('abStatusStrip').classList.toggle('off', !on);
}

// ---- «This page»: домен + счётчик + кнопка белого списка ------------------
async function updateAbStats() {
  const s = await send('getSettings');
  if (s && s.ok) setAbBtnState(s.settings.adblockEnabled);

  const tab = await currentTab();
  if (!tab) { $('abSiteName').textContent = '—'; return; }
  const domain = tabDomain(tab);
  $('abSiteName').textContent = domain || '—';

  const resp = await send('getTabStats', { tabId: tab.id });
  const stats = (resp && resp.ok && resp.stats) || { n: 0, cats: {} };
  $('abPageBlocked').textContent = String(stats.n || 0);

  const excluded = !!(resp && resp.ok && resp.excluded);
  const btn = $('abSiteToggle');
  if (excluded) {
    btn.textContent = t('Whitelisted');
    btn.classList.add('whitelisted');
  } else {
    btn.textContent = t('Disable for this site');
    btn.classList.remove('whitelisted');
  }
  btn.disabled = !domain;
}

// ---- «This session»: Ads / Trackers / Total (как adblockerGetStats) -------
async function updateAbSession() {
  const r = await send('getSessionTotals');
  if (!r || !r.ok) return;
  const t = r.totals || { n: 0, cats: {} };
  $('abBlocked').textContent = String((t.cats && t.cats.ads) || 0);
  $('abTrackers').textContent = String((t.cats && t.cats.trackers) || 0);
  $('abTotal').textContent = String(t.n || 0);
}

// ---- диагностика движка: Lists: N · cache/FALLBACK (как в браузере) -------
async function updateAbEngineInfo() {
  const row = $('abEngineRow');
  const info = $('abEngineInfo');
  const r = await send('getEngineInfo');
  if (!r || !r.ok || !r.engine) { row.style.display = 'none'; return; }
  const inf = r.engine;
  // Без сетевых списков движок собран из builtin+custom — слабый «fallback».
  const src = inf.lists > 2 ? '' : ' · ' + t('FALLBACK');
  info.textContent = t('Lists') + ': ' + (inf.lists || 0) + src;
  row.classList.toggle('ab-engine-warn', src !== '');
  row.style.display = 'flex';
}

// ---- полная статистика: категории страницы + cookies сайта ----------------
async function updateAbFullStats() {
  const box = $('abFullStats');
  if (!box || box.style.display === 'none') return;
  const tab = await currentTab();
  const set = function (id, v) { $(id).textContent = String(v || 0); };
  let cats = {};
  if (tab) {
    const resp = await send('getTabStats', { tabId: tab.id });
    cats = (resp && resp.ok && resp.stats && resp.stats.cats) || {};
  }
  set('abFsAds', cats.ads); set('abFsTrackers', cats.trackers);
  set('abFsSocial', cats.social); set('abFsCdn', cats.cdn);
  set('abFsOther', cats.other);
  // Cookies stored (this site) — как getCookieCount браузера.
  set('abFsCookies', 0);
  const domain = tab ? tabDomain(tab) : '';
  if (domain && chrome.cookies && chrome.cookies.getAll) {
    try {
      const cookies = await chrome.cookies.getAll({ url: 'https://' + domain + '/' });
      set('abFsCookies', cookies.length);
    } catch (e) { /* stay 0 */ }
  }
}

// ---- init ------------------------------------------------------------------
async function init() {
  await updateAbStats();
  await updateAbSession();
  await updateAbEngineInfo();

  // Глобальный тумблер: adblockEnabled.
  $('abToggle').addEventListener('change', async function () {
    const on = this.checked;
    setAbBtnState(on);
    const resp = await send('setSetting', { patch: { adblockEnabled: on } });
    if (resp && resp.ok) setAbBtnState(resp.settings.adblockEnabled);
  });

  // Белый список сайта — с перезагрузкой вкладки (как в браузере).
  $('abSiteToggle').addEventListener('click', async function () {
    const tab = await currentTab();
    const domain = tab ? tabDomain(tab) : '';
    if (!domain) return;
    const resp = await send('toggleSite', { host: domain });
    if (resp && resp.ok) {
      if (resp.excluded) {
        this.textContent = t('Whitelisted');
        this.classList.add('whitelisted');
      } else {
        this.textContent = t('Disable for this site');
        this.classList.remove('whitelisted');
      }
      try { await chrome.tabs.reload(tab.id); } catch (e) { /* tab gone */ }
    }
  });

  // Обновление списков: кнопка крутится, пока идёт загрузка.
  $('abReloadLists').addEventListener('click', async function () {
    this.classList.add('spinning');
    try {
      await send('updateLists');
      await updateAbEngineInfo();
    } finally {
      this.classList.remove('spinning');
    }
  });

  // Раскрывающаяся полная статистика.
  $('abFullStatsToggle').addEventListener('click', function () {
    const box = $('abFullStats');
    const open = box.style.display === 'none';
    box.style.display = open ? 'block' : 'none';
    this.classList.toggle('open', open);
    if (open) updateAbFullStats();
  });

  // Block ads manually — element zapper (как startElementPicker браузера).
  $('abBlockManually').addEventListener('click', async function () {
    const tab = await currentTab();
    if (tab) await send('startPicker', { tabId: tab.id });
    window.close();
  });

  // Report a problem — внешняя форма обратной связи (как в браузере).
  $('abReportIssue').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://startpoziblog.wordpress.com/feedback/' });
    window.close();
  });

  // Check this site — сервис проверки, с ?url= текущей страницы.
  $('abCheckSite').addEventListener('click', async function () {
    const tab = await currentTab();
    let checkUrl = 'https://startpozi.com/VirInfoTest';
    if (tab && /^https?:\/\//i.test(tab.url || '')) {
      checkUrl += '?url=' + encodeURIComponent(tab.url);
    }
    chrome.tabs.create({ url: checkUrl });
    window.close();
  });

  // Open in settings — браузер открывает Settings.html#blocker.
  $('abPanelSettings').addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html#blocker') });
    window.close();
  });

  // Живое обновление, как в браузере: страницу — раз в 1.5 с,
  // сессию/полную статистику — раз в 2 с.
  setInterval(function () { updateAbStats(); }, 1500);
  setInterval(function () { updateAbSession(); updateAbFullStats(); }, 2000);
}

document.addEventListener('DOMContentLoaded', function () {
  init().catch(function (e) {
    console.error('[SPZ popup] init failed:', e);
  });
});
