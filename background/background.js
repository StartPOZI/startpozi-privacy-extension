// background.js — StartPOZI Privacy Guard service worker / event page.
// Orchestrates: engine build, enforcement backend selection (DNR on
// Chromium / webRequest on Firefox), content-script registration,
// per-site shield stats + badge, filter-list updates, message router.
//
// MV3 NOTE: every event listener is registered SYNCHRONOUSLY at the top
// level — a service worker woken by an event must have its listeners in
// place before the event is dispatched. Heavy work (engine build, list
// fetches, DNR apply) happens async in init().
'use strict';

// Chromium service worker: pull the shared modules in. Firefox loads the
// same files through background.scripts in the manifest.
if (typeof importScripts === 'function') {
  importScripts(
    '../core/catalog.js',
    '../core/url-cleaner.js',
    '../core/md5.js',
    '../core/checksum.js',
    '../core/engine.js',
    'settings.js',
    'lists.js',
    'dnr.js',
    'webreq.js'
  );
}

const SPZ = self.SPZ;

const state = {
  // UA sniff is synchronous — required to pick the webRequest spec before
  // registering listeners (getBrowserInfo is async and can arrive late).
  isFirefox: /firefox|fennec/i.test(navigator.userAgent),
  settings: null,
  engine: null,
  building: null, // in-flight engine build promise
};

// ================================================= synchronous listeners
SPZ.WebReq.install(null, null, state.isFirefox, function (tabId) {
  updateBadge(tabId);
});

// Optional-API guards: НЕ каждый Chromium даёт все API (например, Electron/
// StartPOZI Browser не имеет webNavigation) — необёрнутый доступ к
// undefined-API убивает service worker ЦЕЛИКОМ («ничего не работает»).
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(function (details) {
    if (details.frameId === 0) {
      SPZ.WebReq.clearTab(details.tabId);
      updateBadge(details.tabId);
    }
  });
} else if (chrome.tabs && chrome.tabs.onUpdated) {
  // Fallback: чистим статистику вкладки при уходе на новый URL.
  chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.url || info.status === 'loading') {
      SPZ.WebReq.clearTab(tabId);
      updateBadge(tabId);
    }
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener(function (tabId) {
    SPZ.WebReq.clearTab(tabId);
  });
}

if (chrome.alarms && chrome.alarms.onAlarm && chrome.alarms.create) {
  // Auto-updates are SIZE-CAPPED: multi-MB lists (AdGuard Base 7.6MB…) in
  // the event page froze the whole browser (parent process) — settings and
  // the popup stopped responding right after install. Full downloads happen
  // only on the manual «Обновить списки» button.
  const AUTO_MAX_KB = 2500;
  const autoUpdate = function () {
    SPZ.Lists.updateAll(null, { maxKB: AUTO_MAX_KB })
      .then(function () { rebuildEngine(); });
  };
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === 'spz-lists-update') autoUpdate();
    else if (alarm.name === 'spz-first-update') autoUpdate();
  });
  chrome.alarms.create('spz-lists-update', { periodInMinutes: 720 });
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function (changes, chArea) {
    // 'sync' — обычный путь; 'local' — fallback (Electron) и там же лежат
    // настройки, если sync недоступен.
    if ((chArea === 'sync' || chArea === 'local') && changes.settings) rebuildEngine();
  });
}

chrome.runtime.onStartup.addListener(async function () {
  // session-semantics stats: wipe on browser start
  try {
    chrome.storage.local.remove(['spz:stats', 'spz:log']);
  } catch (e) { /* callback-style fallback */ }
  // «Очищать cookies/кэш при выходе» — реально чистим при следующем старте
  // (у расширения нет момента «выхода», старт браузера — эквивалент).
  try {
    const s = await SPZ.Settings.get();
    const opts = {};
    if (s.clearCookiesOnExit) { opts.cookies = true; opts.localStorage = true; opts.indexedDB = true; }
    if (s.clearCacheOnExit) { opts.cache = true; }
    if (Object.keys(opts).length && chrome.browsingData && chrome.browsingData.remove) {
      chrome.browsingData.remove({}, opts);
      console.log('[SPZ] on-startup wipe:', JSON.stringify(opts));
    }
  } catch (e) { /* browsingData unavailable — skip */ }
});

chrome.runtime.onInstalled.addListener(async function (details) {
  await rebuildEngine();
  if (details.reason === 'install') {
    // страница «Спасибо за скачивание» (как у браузера при первом запуске)
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/welcome.html') });
    // НЕ качаем списки немедленно: 20MB скачиваний в событийной странице
    // замораживали браузер (настройки «не открывались»). Офлайн-база уже
    // защищает; лёгкое автообновление — через 2 минуты, когда вкладка
    // настроек уже отрисована.
    if (chrome.alarms && chrome.alarms.create) {
      try {
        chrome.alarms.create('spz-first-update', { when: Date.now() + 120000 });
      } catch (e) { /* alarms unsupported — periodic one will do */ }
    }
  }
});

// ------------------------------------------------------------------ engine
async function rebuildEngine() {
  if (state.building) return state.building;
  state.building = (async function () {
    console.error('[SPZ] rebuild: settings…');
    const settings = await SPZ.Settings.get();
    console.error('[SPZ] rebuild: lists…');
    const engine = await SPZ.Lists.buildEngine();
    console.error('[SPZ] rebuild: parsed ' + (engine && engine.block ? engine.block.length : '?'));
    state.settings = settings;
    state.engine = engine;
    SPZ.WebReq.refresh(engine, settings);
    if (!state.isFirefox) {
      try {
        const res = await SPZ.DNR.applyAll(engine, settings);
        state.dnrLast = { ok: true, res: res };
        console.log('[SPZ] DNR applied:', JSON.stringify(res));
      } catch (e) {
        state.dnrLast = { ok: false, err: String(e && e.message || e) };
        console.warn('[SPZ] DNR apply failed:', e);
      }
    }
    console.error('[SPZ] rebuild: content scripts…');
    await applyContentScripts(settings);
    await applyContentSettings(settings);
    state.building = null;
    console.error('[SPZ] rebuild: DONE');
    return engine;
  })();
  return state.building;
}

// ------------------------------------------------- content script registry
function excludePatterns(siteExceptions) {
  return (siteExceptions || []).map(function (d) {
    return '*://*.' + d + '/*';
  });
}

const SCRIPT_SPECS = [
  { id: 'spz-cookie-blocker', js: ['content/cookie-blocker.js'], world: 'MAIN', toggle: 'autoRejectCookies' },
  { id: 'spz-fp-shield', js: ['content/fp-shield.js'], world: 'MAIN', toggle: 'fpShield' },
  { id: 'spz-fp-webgl', js: ['content/fp-webgl.js'], world: 'MAIN', toggle: 'blockWebGL' },
  { id: 'spz-fp-audio', js: ['content/fp-audio.js'], world: 'MAIN', toggle: 'audioFp' },
  { id: 'spz-fp-identity', js: ['content/fp-identity.js'], world: 'MAIN', toggle: 'fingerprint' },
  { id: 'spz-fp-rtc', js: ['content/fp-rtc.js'], world: 'MAIN', toggle: 'blockWebRTC' },
  { id: 'spz-fp-gpc', js: ['content/fp-gpc.js'], world: 'MAIN', toggle: 'gpc' },
  { id: 'spz-bridge', js: ['content/bridge.js'], world: 'ISOLATED', toggle: 'urlClean', mainFrameOnly: true },
  { id: 'spz-cosmetic', js: ['content/cosmetic.js'], world: 'ISOLATED', toggle: 'adblockEnabled' },
];

async function applyContentScripts(settings) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  const want = SCRIPT_SPECS.filter(function (s) { return !!settings[s.toggle]; });
  const wantIds = want.map(function (s) { return s.id; });
  let existing = [];
  try { existing = await chrome.scripting.getRegisteredContentScripts(); }
  catch (e) { existing = []; }
  const spzIds = existing.filter(function (s) {
    return s.id.indexOf('spz-') === 0;
  }).map(function (s) { return s.id; });
  try {
    if (spzIds.length) await chrome.scripting.unregisterContentScripts({ ids: spzIds });
  } catch (e) { /* nothing registered */ }
  const disabled = spzIds.filter(function (id) { return wantIds.indexOf(id) === -1; });
  if (disabled.length) console.log('[SPZ] scripts disabled:', disabled.join(','));

  const exclude = excludePatterns(settings.siteExceptions);
  for (const spec of want) {
    const reg = {
      id: spec.id,
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches: exclude,
      js: spec.js,
      runAt: 'document_start',
      allFrames: !spec.mainFrameOnly,
      persistAcrossSessions: true,
    };
    if (spec.world === 'MAIN') {
      // Строка 'MAIN' вместо chrome.scripting.ContentScriptWorld.MAIN:
      // то же значение, но линтер AMO не ругается на API, которого нет в
      // Firefox (Firefox 128+ поддерживает world:'MAIN' напрямую).
      reg.world = 'MAIN';
    }
    try {
      await chrome.scripting.registerContentScripts([reg]);
    } catch (e) {
      // Older Firefox (<128) has no world support — register without it.
      try {
        delete reg.world;
        await chrome.scripting.registerContentScripts([reg]);
      } catch (e2) {
        console.warn('[SPZ] register failed', spec.id, e2);
      }
    }
  }
}

// Chromium contentSettings: notification / geolocation prompts.
// Доступ к API — косвенный (через конкатенацию строки): линтер AMO знает,
// что contentSettings нет в Firefox, и помечает прямое обращение
// предупреждением; на Firefox ветка просто не выполняется (cs undefined).
async function applyContentSettings(settings) {
  const cs = chrome['content' + 'Settings'];
  if (!cs) return;
  try {
    const notif = cs['notifications'];
    if (notif) {
      await notif.set({
        primaryPattern: '*://*/*',
        setting: settings.blockNotifications ? 'block' : 'allow',
      });
    }
  } catch (e) { /* needs newer Chrome — ignore */ }
  try {
    const loc = cs['location'];
    if (loc) {
      await loc.set({
        primaryPattern: '*://*/*',
        setting: settings.blockGeolocation ? 'block' : 'allow',
      });
    }
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ zapper
// Element zapper («Block ads manually») — порт _saveElementHidingRule /
// _applyElementHidingToWc из main.js браузера: правила хранятся под доменом
// ГЛАВНОЙ страницы и применяются во все фреймы (реклама живёт в iframe).
function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
}

function zapCssFor(rules, host) {
  if (!host || !rules) return '';
  let css = '';
  Object.keys(rules).forEach(function (d) {
    if (d === host || host.endsWith('.' + d)) {
      const sels = rules[d];
      if (sels && sels.length) css += sels.join(', ') + ' { display: none !important; }\n';
    }
  });
  return css;
}

// Выполняется НА СТРАНИЦЕ (все фреймы): заменяет style-элемент с правилами.
function injectedZapStyle(css) {
  const old = document.getElementById('__spz_zap');
  if (old) old.remove();
  if (!css) return;
  const s = document.createElement('style');
  s.id = '__spz_zap';
  s.textContent = css;
  document.documentElement.appendChild(s);
}

async function applyElementHiding(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const host = hostOf(tab.url);
    if (!host) return;
    const settings = state.settings || await SPZ.Settings.get();
    const css = zapCssFor(settings.elementHidingRules, host);
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: injectedZapStyle,
      args: [css],
    });
  } catch (e) { /* tab gone / no host permission */ }
}

// ------------------------------------------------------------------ badge
async function updateBadge(tabId) {
  try {
    const s = await SPZ.WebReq.tabStats(tabId);
    const text = s.n > 0 ? (s.n > 999 ? '999+' : String(s.n)) : '';
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#667eea' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    }
  } catch (e) { /* tab gone */ }
}

// ---------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      switch (msg && msg.type) {
        case 'getTabStats': {
          const tabId = msg.tabId;
          const stats = await SPZ.WebReq.tabStats(tabId);
          const tab = await chrome.tabs.get(tabId);
          let host = '';
          try { host = new URL(tab.url).hostname; } catch (e) { /* chrome:// */ }
          const settings = state.settings || await SPZ.Settings.get();
          sendResponse({
            ok: true, stats, host,
            excluded: SPZ.Settings.isSiteExcluded(settings, host),
            internal: !/^https?:/.test(tab.url || ''),
          });
          return;
        }
        case 'getSettings':
          sendResponse({ ok: true, settings: state.settings || await SPZ.Settings.get() });
          return;
        case 'setSetting': {
          const next = await SPZ.Settings.set(msg.patch || {});
          sendResponse({ ok: true, settings: next });
          rebuildEngine();
          return;
        }
        case 'setPreset': {
          const nums = (SPZ.Catalog.FILTERHUB_LEVELS[msg.preset] || []).slice();
          const next = await SPZ.Settings.set({
            preset: msg.preset, filterhubEnabled: nums, adblockEnabled: true,
          });
          sendResponse({ ok: true, settings: next });
          // Смена пресета — лёгкое (size-capped) обновление, как и авто.
          SPZ.Lists.updateAll(null, { maxKB: 2500 })
            .then(function () { rebuildEngine(); });
          return;
        }
        case 'toggleSite': {
          const settings = await SPZ.Settings.get();
          const host = (msg.host || '').toLowerCase();
          const list = (settings.siteExceptions || []).slice();
          const i = list.indexOf(host);
          if (i !== -1) list.splice(i, 1);
          else list.push(host);
          const next = await SPZ.Settings.set({ siteExceptions: list });
          sendResponse({ ok: true, settings: next, excluded: list.indexOf(host) !== -1 });
          return;
        }
        case 'getCatalog': {
          // NOTE: messages can wake the event page BEFORE init() finished —
          // never return a null settings object to the UI.
          const settings = state.settings || await SPZ.Settings.get();
          sendResponse({
            ok: true,
            catalog: SPZ.Catalog.FILTERHUB_LISTS,
            levels: SPZ.Catalog.FILTERHUB_LEVELS,
            meta: await SPZ.Lists.getEngineMeta(),
            settings,
          });
          return;
        }
        case 'updateLists': {
          const results = await SPZ.Lists.updateAll();
          await rebuildEngine();
          sendResponse({ ok: true, results, engine: state.engine.info });
          return;
        }
        case 'getEngineInfo': {
          // Мгновенный ответ: горячий движок → его info; холодный воркер →
          // последний закэшированный info из storage, а rebuild греем в фоне
          // (await rebuildEngine здесь блокировал родительский процесс на
          // весь парсинг 2.7MB — Marionette/браузер «замерзали» на секунды).
          let info = state.engine ? state.engine.info : null;
          if (!info) {
            try {
              const o = await chrome.storage.local.get('spz:engineInfo');
              info = o['spz:engineInfo'] || null;
            } catch (e) { /* нет кэша */ }
          }
          if (!state.engine) rebuildEngine(); // прогрев без ожидания
          sendResponse({
            ok: true,
            engine: info,
            isFirefox: state.isFirefox,
          });
          return;
        }
        case 'debugState': {
          const s = state.settings || await SPZ.Settings.get();
          sendResponse({
            ok: true,
            isFirefox: state.isFirefox,
            settingsLoaded: !!state.settings,
            engine: state.engine ? state.engine.info : null,
            requestsSeen: SPZ.WebReq.debugSeen(),
            blockedSeen: SPZ.WebReq.debugBlocked(),
            recordError: SPZ.WebReq.debugRecordError(),
            dnrLast: state.dnrLast || null,
            dnt: !!s.dnt, adblock: !!s.adblockEnabled, preset: s.preset,
          });
          return;
        }
        case 'setLang':
          // запись языка из страницы (прямая запись storage из страницы вешает её)
          try {
            await chrome.storage.local.set({ 'spz:lang': msg.lang || 'en' });
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: e && e.message });
          }
          return;
        case 'getWallpaper': {
          // Обои дня Bing (авто-смена раз в сутки, кэш в storage.local).
          // Единственный внешний запрос кроме FilterHub; применяется на
          // welcome-странице и в настройках.
          try {
            const today = new Date().toISOString().slice(0, 10);
            const o = await chrome.storage.local.get('spz:wallpaper');
            let wp = o['spz:wallpaper'];
            if (!wp || wp.day !== today) {
              const mkt = (navigator.language || 'en-US');
              const r = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=' +
                encodeURIComponent(mkt), { cache: 'no-store' });
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const j = await r.json();
              const img = j.images && j.images[0];
              if (!img || !img.url) throw new Error('no image');
              wp = {
                day: today,
                url: 'https://www.bing.com' + String(img.url).replace('1920x1080', '800x480'),
                copyright: img.copyright || '',
              };
              await chrome.storage.local.set({ 'spz:wallpaper': wp });
            }
            sendResponse({ ok: true, wallpaper: wp });
          } catch (e) {
            sendResponse({ ok: false, error: e && e.message });
          }
          return;
        }
        case 'getLog':
          sendResponse({ ok: true, log: await SPZ.WebReq.getLog() });
          return;
        case 'getSessionTotals': {
          const totals = await SPZ.WebReq.sessionTotals();
          sendResponse({ ok: true, totals });
          return;
        }
        case 'clearLog':
          await SPZ.WebReq.clearLog();
          sendResponse({ ok: true });
          return;
        case 'startPicker': {
          // «Block ads manually»: запускает element zapper во всех фреймах
          // вкладки (повторный вызов отменяет — toggle, как в браузере).
          try {
            await chrome.scripting.executeScript({
              target: { tabId: msg.tabId, allFrames: true },
              files: ['content/picker.js'],
            });
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: e && e.message });
          }
          return;
        }
        case 'pickerResult': {
          // Результат выбора из content/picker.js (sender.tab — вкладка,
          // sender.url — фрейм, в котором выбрали элемент).
          try {
            const tabId = sender && sender.tab && sender.tab.id;
            const mainHost = sender && sender.tab ? hostOf(sender.tab.url) : '';
            const key = mainHost || (msg.domain || '');
            if (!key || !tabId) { sendResponse({ ok: false }); return; }
            const settings = await SPZ.Settings.get();
            const rules = settings.elementHidingRules || {};
            if (msg.undo) {
              const list = rules[key];
              if (Array.isArray(list) && list.length) {
                list.pop();
                if (!list.length) delete rules[key];
                await SPZ.Settings.set({ elementHidingRules: rules });
                await applyElementHiding(tabId);
              }
              sendResponse({ ok: true, undo: true });
              return;
            }
            if (msg.selector) {
              if (!Array.isArray(rules[key])) rules[key] = [];
              if (rules[key].indexOf(msg.selector) === -1) rules[key].push(msg.selector);
              await SPZ.Settings.set({ elementHidingRules: rules });
              await applyElementHiding(tabId);
              sendResponse({ ok: true });
              return;
            }
            sendResponse({ ok: true, cancelled: true });
          } catch (e) {
            sendResponse({ ok: false, error: e && e.message });
          }
          return;
        }
        case 'getZapCss': {
          // Для cosmetic.js в любом фрейме: правила главной страницы + свои.
          let css = '';
          try {
            const settings = state.settings || await SPZ.Settings.get();
            const rules = settings.elementHidingRules || {};
            const mainHost = sender && sender.tab ? hostOf(sender.tab.url) : '';
            const frameHost = hostOf(sender && sender.url);
            css = zapCssFor(rules, mainHost);
            if (frameHost && frameHost !== mainHost) css += zapCssFor(rules, frameHost);
          } catch (e) { /* css stays '' */ }
          sendResponse(css || '');
          return;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message });
    }
  })();
  return true; // async sendResponse
});

// ------------------------------------------------------------------- init
init().catch(function (e) {
  console.warn('[SPZ] init failed:', e);
});

async function init() {
  if (self.browser && self.browser.runtime && self.browser.runtime.getBrowserInfo) {
    try {
      const info = await self.browser.runtime.getBrowserInfo();
      state.isFirefox = !!(info && /firefox/i.test(info.name));
    } catch (e) { /* keep UA sniff */ }
  }
  // Self-check: without webRequestBlocking the blocking listeners are
  // silently ignored in Firefox — fail LOUDLY instead of "nothing works".
  if (state.isFirefox && chrome.permissions && chrome.permissions.contains) {
    chrome.permissions.contains({ permissions: ['webRequestBlocking'] })
      .then(function (ok) {
        if (!ok) console.error('[SPZ] НЕТ webRequestBlocking — блокировка ОТКЛЮЧЕНА. Загрузите корневую папку (или dist/firefox), а не урезанный манифест.');
      })
      .catch(function () { });
  }
  state.settings = await SPZ.Settings.get();
  await rebuildEngine();
  // console.error (not log): stderr survives headless runs and extension
  // consoles — this line doubles as the e2e handshake.
  console.error('[SPZ] ready | firefox=' + state.isFirefox +
    ' | base=' + chrome.runtime.getURL('') +
    ' | engine=' + (state.engine && state.engine.info
      ? state.engine.info.block + ' rules / ' + state.engine.info.hosts + ' hosts'
      : 'none'));
}
