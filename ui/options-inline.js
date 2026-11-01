// options-inline.js — wires the browser's real Settings.html markup
// (ui/options.html, generated from the browser Settings page) to the
// extension's background engine. Element IDs are the BROWSER's own
// (abSettingsToggle, fhCatalog, secUrlClean, privBlockedCount, …) so the
// page looks and behaves exactly like StartPOZI Browser's settings.
'use strict';
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const send = function (type, payload) {
    return new Promise(function (res) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), res);
    });
  };

  // What the extension actually implements (browser-only toggles are
  // hidden, not left dead): input id → extension setting key.
  const SEC_MAP = {
    secUrlClean: 'urlClean',
    secAutoRejectCookies: 'autoRejectCookies',
    secDnt: 'dnt',
    secGpc: 'gpc',
    secReferrerPolicy: 'referrerPolicy',
    secBlockThirdPartyCookies: 'blockThirdPartyCookies',
    secBlockMixedContent: 'blockMixedContent',
    secHttpsOnly: 'httpsOnly',
    secFpShield: 'fpShield',
    secAudioFp: 'audioFp',
    secBlockWebGL: 'blockWebGL',
    secWebRTC: 'blockWebRTC',
    secFingerprint: 'fingerprint',
    secBlockNotifications: 'blockNotifications',
    secBlockGeolocation: 'blockGeolocation',
    secClearCookiesOnExit: 'clearCookiesOnExit',
    secClearCacheOnExit: 'clearCacheOnExit',
  };

  const state = { settings: null, catalog: null, levels: null, meta: {} };

  // ------------------------------------------------------------ helpers
  function hideEl(el) { if (el) el.style.display = 'none'; }
  function rowOf(cb) { // toggle row wrapper: label → row div
    const label = cb.closest('label');
    return label && label.parentElement ? label.parentElement : cb.parentElement;
  }
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function fmtKB(kb) { return kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'; }

  // ------------------------------------------------------------ i18n selector
  function installLangSelector() {
    const nav = document.querySelector('.sidebar nav');
    if (!nav || !window.i18n) return;
    const box = document.createElement('div');
    box.style.cssText = 'padding:12px 14px;border-top:1px solid var(--sidebar-border,rgba(255,255,255,.08));';
    const label = document.createElement('div');
    label.textContent = window.i18n.t('Language') || 'Language';
    label.style.cssText = 'font-size:11px;color:var(--link-color,rgba(255,255,255,.75));margin-bottom:6px;';
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border-color);background:var(--input-bg,rgba(0,0,0,.3));color:var(--input-color,#fff);font-size:12px;';
    [['en', 'English'], ['ru', 'Русский'], ['uk', 'Українська']].forEach(function (p) {
      const o = document.createElement('option');
      o.value = p[0]; o.textContent = p[1];
      sel.appendChild(o);
    });
    sel.value = window.i18n.getLanguage();
    // language выбирается асинхронно (storage) — селектор должен показать
    // фактический язык ПОСЛЕ загрузки, иначе виден 'English' на русской странице
    setTimeout(function () { sel.value = window.i18n.getLanguage(); }, 600);
    sel.addEventListener('change', function () {
      window.i18n.setLanguage(sel.value);
      // direct re-render (the i18nlanguagechange event was removed —
      // dispatching it with the observer active wedges the page)
      renderAbStatus();
      markPresets();
      refreshPrivacyPanel();
      renderSiteExceptions();
    });
    box.appendChild(label); box.appendChild(sel);

    // Кнопка «StartPOZI Browser» в самом низу сайдбара (под сменой языка):
    // скачивание полноценного браузера с полным набором списков.
    const dl = document.createElement('a');
    dl.id = 'spzBrowserLink';
    dl.href = 'https://startpozi.com/apps';
    dl.target = '_blank';
    dl.rel = 'noopener';
    dl.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;' +
      'margin-top:12px;padding:11px 14px;border-radius:10px;' +
      'background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;' +
      'font-size:12.5px;font-weight:600;text-decoration:none;' +
      'box-shadow:0 4px 14px rgba(102,126,234,.35);';
    dl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>StartPOZI Browser';
    box.appendChild(dl);

    nav.parentElement.insertBefore(box, nav.nextSibling);
  }

  // ------------------------------------------------------------ nav + search
  function installNav() {
    const links = document.querySelectorAll('.sidebar nav a[href^="#"]');
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        const id = a.getAttribute('href').slice(1);
        document.querySelectorAll('.content .section').forEach(function (s) {
          s.classList.toggle('active', s.id === id);
        });
        links.forEach(function (x) { x.classList.toggle('active', x === a); });
      });
    });
    // default section
    const hash = (location.hash || '').slice(1);
    if (hash && document.getElementById(hash)) {
      const a = document.querySelector('.sidebar nav a[href="#' + hash + '"]');
      if (a) a.click();
    }
  }

  function installSearch() {
    const input = $('settingsSearchInput');
    const box = $('settingsSearchResults');
    if (!input || !box) return;
    input.addEventListener('input', function () {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        box.style.display = 'none';
        document.querySelectorAll('.content .card').forEach(function (c) { c.style.display = ''; });
        return;
      }
      let hits = 0;
      document.querySelectorAll('.content .card').forEach(function (c) {
        const match = c.textContent.toLowerCase().indexOf(q) !== -1;
        c.style.display = match ? '' : 'none';
        if (match) hits++;
      });
      box.style.display = 'block';
      box.textContent = hits ? ('✓ ' + hits) : '…';
    });
  }

  // ------------------------------------------------------------ blocker
  function renderFilterHub() {
    const wrap = $('fhCatalog');
    if (!wrap || !state.catalog) return;
    wrap.innerHTML = '';
    const enabled = (state.settings.filterhubEnabled || []);
    state.catalog.forEach(function (l) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:6px;padding:8px 10px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:8px;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = enabled.indexOf(l.num) !== -1;
      cb.style.accentColor = 'var(--accent-color,#667eea)';
      cb.addEventListener('change', async function () {
        const cur = (state.settings.filterhubEnabled || []).slice();
        const i = cur.indexOf(l.num);
        if (this.checked && i === -1) cur.push(l.num);
        if (!this.checked && i !== -1) cur.splice(i, 1);
        const r = await send('setSetting', { patch: { filterhubEnabled: cur, preset: detectPreset(cur) } });
        if (r.ok) { state.settings = r.settings; markPresets(); toast('✓'); }
      });
      const name = document.createElement('div');
      name.style.cssText = 'flex:1;font-size:13px;font-weight:500;color:var(--text-color);';
      name.textContent = l.name;
      if (l.warn) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.style.cssText = 'margin-left:8px;font-size:9.5px;padding:2px 7px;border-radius:8px;background:rgba(255,152,0,.2);color:#ffb74d;text-transform:uppercase;';
        b.textContent = l.warn;
        name.appendChild(b);
      }
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:10.5px;color:var(--secondary-text);text-align:right;';
      const url = 'https://raw.githubusercontent.com/StartPOZI/FilterHub/main/Sp/' + l.num + '/' + l.file;
      const m = state.meta[url];
      const bits = [fmtKB(l.sizeKB), l.rules ? Math.round(l.rules / 1000) + 'K' : '—'];
      if (m) bits.push(m.ok ? '✓ ' + new Date(m.ts).toLocaleDateString() : '✗');
      meta.textContent = bits.join(' · ');
      row.appendChild(cb); row.appendChild(name); row.appendChild(meta);
      wrap.appendChild(row);
    });
    if (window.i18n) window.i18n.apply(wrap); // dynamic rows need translating
  }

  function detectPreset(nums) {
    const sorted = nums.slice().sort(function (a, b) { return a - b; });
    const eq = function (arr) {
      return arr.length === sorted.length &&
        arr.slice().sort(function (a, b) { return a - b; }).every(function (v, i) { return v === sorted[i]; });
    };
    if (!state.levels) return 'custom';
    if (eq(state.levels.light)) return 'light';
    if (eq(state.levels.medium)) return 'medium';
    if (eq(state.levels.full)) return 'full';
    return 'custom';
  }

  function markPresets() {
    const p = state.settings ? state.settings.preset : '';
    ['fhPresetLight', 'fhPresetMedium', 'fhPresetFull'].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      const active = (id === 'fhPresetLight' && p === 'light') ||
        (id === 'fhPresetMedium' && p === 'medium') ||
        (id === 'fhPresetFull' && p === 'full');
      btn.style.background = active ? 'var(--accent-gradient,linear-gradient(135deg,#667eea,#764ba2))' : '';
      btn.style.color = active ? '#fff' : '';
      btn.style.fontWeight = active ? '600' : '';
    });
    const st = $('fhStatus');
    if (st && state.settings) {
      st.textContent = (window.i18n && window.i18n.t('Active preset')) + ': ' + p +
        (p === 'custom' ? '' : ' (' + (state.settings.filterhubEnabled || []).length + ')');
    }
  }

  function renderCustomLists() {
    const wrap = $('abFilterLists');
    if (!wrap) return;
    wrap.innerHTML = '';
    (state.settings.filterLists || []).forEach(function (url, idx) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:8px 10px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:8px;';
      const span = document.createElement('div');
      span.style.cssText = 'flex:1;font-size:11.5px;font-family:monospace;color:var(--text-color);word-break:break-all;';
      span.textContent = url;
      const rm = document.createElement('button');
      rm.className = 'refresh-button';
      rm.style.cssText = 'font-size:11px;padding:4px 10px;';
      rm.textContent = '×';
      rm.addEventListener('click', async function () {
        const cur = (state.settings.filterLists || []).slice();
        cur.splice(idx, 1);
        const r = await send('setSetting', { patch: { filterLists: cur } });
        if (r.ok) { state.settings = r.settings; renderCustomLists(); }
      });
      row.appendChild(span); row.appendChild(rm);
      wrap.appendChild(row);
    });
  }

  async function renderLog() {
    const box = $('abLogList');
    if (!box) return;
    const r = await send('getLog');
    const log = (r.log || []).slice(0, 300);
    const q = ($('abLogSearch').value || '').trim().toLowerCase();
    box.innerHTML = '';
    const frag = document.createDocumentFragment();
    log.forEach(function (e) {
      if (q && e.url.toLowerCase().indexOf(q) === -1 && e.host.indexOf(q) === -1) return;
      const div = document.createElement('div');
      div.style.cssText = 'font-size:11px;font-family:monospace;padding:5px 8px;border-radius:6px;';
      div.innerHTML = '<span style="color:var(--accent-color,#667eea);font-weight:600;">' +
        (window.i18n && window.i18n.t(e.cat) ? window.i18n.t(e.cat) : e.cat) +
        '</span> <span style="color:var(--secondary-text);">' + e.host + '</span>' +
        ' <span style="word-break:break-all;">' + e.url.replace(/</g, '&lt;') + '</span>';
      frag.appendChild(div);
    });
    box.appendChild(frag);
    if (window.i18n) window.i18n.apply(box);
    const cnt = $('abLogCount');
    if (cnt) cnt.textContent = log.length + ' / 500';
  }

  async function initBlocker() {
    if (!state.settings) return;
    const t = $('abSettingsToggle');
    if (t) {
      t.checked = !!state.settings.adblockEnabled;
      t.addEventListener('change', async function () {
        const r = await send('setSetting', { patch: { adblockEnabled: t.checked } });
        if (r.ok) { state.settings = r.settings; renderAbStatus(); }
      });
    }
    renderAbStatus();

    const saveF = $('abSaveFilters');
    if (saveF) saveF.addEventListener('click', async function () {
      await send('setSetting', { patch: { customFilters: $('abCustomFilters').value } });
      toast('✓'); saveF.textContent = '✓';
      setTimeout(function () { saveF.textContent = window.i18n ? window.i18n.t('Save filters') : 'Save filters'; }, 1200);
    });
    const saveS = $('abSaveStyles');
    if (saveS) saveS.addEventListener('click', async function () {
      await send('setSetting', { patch: { customStyles: $('abCustomStyles').value } });
      toast('✓'); saveS.textContent = '✓';
      setTimeout(function () { saveS.textContent = window.i18n ? window.i18n.t('Save styles') : 'Save styles'; }, 1200);
    });

    ['fhPresetLight', 'fhPresetMedium', 'fhPresetFull'].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      btn.addEventListener('click', async function () {
        const preset = id === 'fhPresetLight' ? 'light'
          : id === 'fhPresetMedium' ? 'medium' : 'full';
        const r = await send('setPreset', { preset: preset });
        if (r.ok) {
          state.settings = r.settings;
          markPresets(); renderFilterHub();
          const st = $('fhStatus');
          if (st) st.textContent = '…';
          await send('updateLists');
          await refreshMeta();
          markPresets(); renderFilterHub();
          toast('✓');
        }
      });
    });

    const add = $('abAddList');
    if (add) add.addEventListener('click', async function () {
      const url = ($('abNewListUrl').value || '').trim();
      if (!/^https?:\/\//i.test(url)) return;
      const cur = (state.settings.filterLists || []).slice();
      if (cur.indexOf(url) === -1) cur.push(url);
      const r = await send('setSetting', { patch: { filterLists: cur } });
      if (r.ok) { state.settings = r.settings; $('abNewListUrl').value = ''; renderCustomLists(); }
    });

    const upd = $('abUpdateLists');
    if (upd) upd.addEventListener('click', async function () {
      upd.textContent = '…';
      await send('updateLists');
      await refreshMeta();
      renderFilterHub();
      upd.textContent = window.i18n ? window.i18n.t('Update all lists') : 'Update all lists';
      toast('✓');
    });

    const repo = $('fhRepoLink');
    if (repo) { repo.href = 'https://github.com/StartPOZI/FilterHub'; repo.target = '_blank'; }
    const doc = $('fhDocLink');
    if (doc) doc.addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://github.com/StartPOZI/FilterHub/tree/main/Doc' });
    });

    const pl = $('abPersistLog');
    if (pl) {
      pl.checked = !!state.settings.persistLog;
      pl.addEventListener('change', async function () {
        const r = await send('setSetting', { patch: { persistLog: pl.checked } });
        if (r.ok) state.settings = r.settings;
      });
    }
    const cl = $('abClearLog');
    if (cl) cl.addEventListener('click', async function () { await send('clearLog'); renderLog(); });
    const ls = $('abLogSearch');
    if (ls) ls.addEventListener('input', renderLog);

    if ($('abCustomFilters')) $('abCustomFilters').value = state.settings.customFilters || '';
    if ($('abCustomStyles')) $('abCustomStyles').value = state.settings.customStyles || '';
    renderCustomLists();
    renderLog();
    markPresets();
    renderFilterHub();

    // SponsorBlock is browser-only (needs page-level integration) — hide.
    const sb = $('sbToggle');
    if (sb) {
      let card = sb;
      while (card && card !== document.body && !(card.classList && card.classList.contains('card'))) {
        card = card.parentElement;
      }
      hideEl(card);
    }
  }

  function renderAbStatus() {
    const el = $('abStatusText');
    if (el && state.settings) {
      el.textContent = state.settings.adblockEnabled
        ? (window.i18n ? window.i18n.t('Enabled') : 'Enabled')
        : (window.i18n ? window.i18n.t('Disabled') : 'Disabled');
    }
  }

  async function refreshMeta() {
    const cat = await send('getCatalog');
    if (cat.ok) {
      state.meta = cat.meta || {};
      state.settings = cat.settings || state.settings;
    }
  }

  // ------------------------------------------------------------ security
  function initSecurity() {
    const sec = $('security');
    if (!sec) return;
    // Hide toggles the extension does not implement (keep the page honest).
    sec.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (!SEC_MAP[cb.id]) hideEl(rowOf(cb));
      else {
        cb.checked = !!state.settings[SEC_MAP[cb.id]];
        cb.addEventListener('change', async function () {
          const patch = {};
          patch[SEC_MAP[cb.id]] = cb.checked;
          const r = await send('setSetting', { patch: patch });
          if (r.ok) state.settings = r.settings;
        });
      }
    });
    // "External services" sub-block — all its rows are browser-only.
    sec.querySelectorAll('h3').forEach(function (h) {
      if (/external services/i.test(h.textContent)) {
        hideEl(h);
        if (h.nextElementSibling) hideEl(h.nextElementSibling);
      }
    });
    // Privacy panel: cookies card is browser-only (vault stats).
    const ck = $('privCookiesCount');
    if (ck) hideEl(ck.parentElement);

    renderSiteExceptions();
    refreshPrivacyPanel();
  }

  // ------------------------------------------------------------ sites
  // Менеджер белого списка («сайты с приостановленной защитой»): показать
  // все домены из siteExceptions, добавить/убрать вручную.
  function renderSiteExceptions() {
    const sec = $('security');
    if (!sec) return;
    let card = document.getElementById('spzSitesCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'spzSitesCard';
      card.className = 'card';
      card.style.marginTop = '24px';
      sec.appendChild(card);
    }
    const list = (state.settings && state.settings.siteExceptions) || [];
    const h = document.createElement('h2');
    h.style.cssText = 'font-size:18px;font-weight:600;margin:0 0 14px;color:var(--text-color);';
    h.textContent = window.i18n ? window.i18n.t('Sites with protection paused') : 'Sites with protection paused';
    card.innerHTML = '';
    card.appendChild(h);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = window.i18n ? window.i18n.t('example.com') : 'example.com';
    inp.style.cssText = 'flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--border-color);background:var(--input-bg,rgba(0,0,0,.3));color:var(--input-color,#fff);font-size:13px;';
    const btn = document.createElement('button');
    btn.className = 'refresh-button';
    btn.textContent = window.i18n ? window.i18n.t('Add') : 'Add';
    btn.addEventListener('click', async function () {
      let host = (inp.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (!host || !/\./.test(host)) { toast('…'); return; }
      const cur = (state.settings.siteExceptions || []).slice();
      if (cur.indexOf(host) === -1) cur.push(host);
      const r = await send('setSetting', { patch: { siteExceptions: cur } });
      if (r.ok) { state.settings = r.settings; renderSiteExceptions(); refreshPrivacyPanel(); toast('✓'); }
    });
    addRow.appendChild(inp); addRow.appendChild(btn);
    card.appendChild(addRow);

    if (!list.length) {
      const none = document.createElement('div');
      none.style.cssText = 'font-size:12.5px;color:var(--secondary-text);';
      none.textContent = window.i18n ? window.i18n.t('No sites — protection is active everywhere') : 'No sites — protection is active everywhere';
      card.appendChild(none);
    } else {
      list.forEach(function (host) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:6px;padding:8px 10px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:8px;';
        const span = document.createElement('div');
        span.style.cssText = 'flex:1;font-size:12.5px;font-family:monospace;color:var(--text-color);';
        span.textContent = host;
        const rm = document.createElement('button');
        rm.className = 'refresh-button';
        rm.style.cssText = 'font-size:11px;padding:4px 10px;';
        rm.textContent = '×';
        rm.addEventListener('click', async function () {
          const cur = (state.settings.siteExceptions || []).filter(function (d) { return d !== host; });
          const r = await send('setSetting', { patch: { siteExceptions: cur } });
          if (r.ok) { state.settings = r.settings; renderSiteExceptions(); refreshPrivacyPanel(); }
        });
        row.appendChild(span); row.appendChild(rm);
        card.appendChild(row);
      });
    }
    if (window.i18n) window.i18n.apply(card);
  }

  async function refreshPrivacyPanel() {
    const r = await send('getSessionTotals');
    if (!r.ok) return;
    const set = function (id, v) {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set('privBlockedCount', r.totals.n);
    set('privCatAds', r.totals.cats.ads || 0);
    set('privCatTrackers', r.totals.cats.trackers || 0);
    set('privCatSocial', r.totals.cats.social || 0);
    set('privCatCdn', r.totals.cats.cdn || 0);
    set('privCatOther', r.totals.cats.other || 0);
    set('privCatTotal', r.totals.n);
    const score = { light: 'Standard', medium: 'Private', full: 'Maximum', custom: 'Custom' };
    set('privSecurityScore', window.i18n && window.i18n.t(score[state.settings.preset]) || score[state.settings.preset] || '—');

    const rec = $('privRecList');
    if (rec) {
      const recs = [];
      if (state.settings.preset === 'light') recs.push('▸ ' + (window.i18n ? window.i18n.t('Medium protection is recommended — 16 FilterHub lists') : 'Medium protection is recommended — 16 FilterHub lists'));
      if (!state.settings.fingerprint) recs.push('▸ ' + (window.i18n ? window.i18n.t('Identity fingerprinting protection is opt-in (like in the browser)') : 'Identity fingerprinting protection is opt-in (like in the browser)'));
      if ((state.settings.siteExceptions || []).length) recs.push('▸ ' + ((state.settings.siteExceptions || []).length) + ' ' + (window.i18n ? window.i18n.t('sites with protection paused') : 'sites with protection paused'));
      if (!recs.length) recs.push('✓ ' + (window.i18n ? window.i18n.t('Everything is configured') : 'Everything is configured'));
      rec.innerHTML = recs.join('<br>');
    }
  }

  // ------------------------------------------------------------ appearance
  // Обои дня Bing на фоне страницы настроек (авто-смена раз в сутки).
  // Настройки-тумблера НЕТ (по просьбе пользователя): просто работают.
  async function applyWallpaper() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const o = await new Promise(function (res) {
        chrome.storage.local.get('spz:wallpaper', res);
      });
      let wp = o && o['spz:wallpaper'];
      if (!wp || wp.day !== today) {
        const r = await send('getWallpaper');
        if (r && r.ok) wp = r.wallpaper;
      }
      if (wp && wp.url) {
        document.body.style.backgroundImage =
          'linear-gradient(rgba(8,8,14,.45), rgba(8,8,14,.72)), url("' + wp.url + '")';
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
      }
    } catch (e) { /* нет сети — фон браузера по умолчанию */ }
  }

  // ------------------------------------------------------------ about
  function initAbout() {
    const v = chrome.runtime.getManifest().version;
    if ($('aboutVersionNum')) $('aboutVersionNum').textContent = v;
    const title = document.querySelector('.about-title');
    if (title) title.textContent = 'StartPOZI Privacy Guard';
    if ($('aboutBuildLine')) $('aboutBuildLine').textContent = 'Extension for Chrome / Firefox / Edge / Opera';
    send('getEngineInfo').then(function (r) {
      if (r.ok && $('aboutDrmStatus')) {
        $('aboutDrmStatus').textContent = r.isFirefox
          ? 'Engine: webRequest (Firefox)'
          : 'Engine: declarativeNetRequest (Chromium)';
      }
    });
    applyWallpaper();

    const help = $('aboutHelpPage');
    if (help) help.addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://startpozi.com/spi-help-page' });
    });
    const don = $('aboutDonate');
    if (don) don.addEventListener('click', function () {
      chrome.tabs.create({ url: 'https://startpozi.com/s/donate.html' });
    });
  }

  // ------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', async function () {
    const s = await send('getSettings');
    if (s.ok) state.settings = s.settings;
    const cat = await send('getCatalog');
    if (cat.ok) {
      state.catalog = cat.catalog;
      state.levels = cat.levels;
      state.meta = cat.meta || {};
      if (cat.settings) state.settings = cat.settings;
    }
    installNav();
    // Belt-and-braces: the browser's CSS hides every .section without
    // .active — make sure one is always visible on load.
    if (!document.querySelector('.content .section.active')) {
      const first = document.querySelector('.content .section');
      if (first) first.classList.add('active');
      const firstLink = document.querySelector('.sidebar nav a');
      if (firstLink) firstLink.classList.add('active');
    }
    installSearch();
    installLangSelector();
    // Each section boots independently — one failure must not kill the page.
    if (state.settings) { try { initBlocker(); } catch (e) { console.error('[SPZ] blocker:', e); } }
    try { initSecurity(); } catch (e) { console.error('[SPZ] security:', e); }
    try { initAbout(); } catch (e) { console.error('[SPZ] about:', e); }
    // re-render language-dependent bits happens directly in the language
    // selector handler (the i18nlanguagechange event is gone by design)
  });
})();
