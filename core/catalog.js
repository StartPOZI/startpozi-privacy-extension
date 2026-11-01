// catalog.js — FilterHub catalog + built-in protection data.
// Ported 1:1 from the StartPOZI Desktop Browser (adblocker.js):
// same lists, same presets, same custom filters, same categories.
// Shared by the background scripts (classic scripts, global namespace SPZ).
'use strict';
(function (global) {
  const FILTERHUB_RAW = 'https://raw.githubusercontent.com/StartPOZI/FilterHub/main/Sp/';

  // БАЗОВОЕ ЯДРО (14 списков): самые эффективные и лёгкие — EasyList,
  // EasyPrivacy, ядро uBlock, Peter Lowe, NoCoin, OISD, Disconnect,
  // TrackParam, URLhaus, Badware. Всё тяжёлое/региональное (AdGuard Base
  // 7.6MB, Phishing Army, HaGezi 44MB, EasyList RU/CN/DE/FR…) — в
  // StartPOZI Browser (https://startpozi.com/apps), не в расширении.
  const FILTERHUB_LISTS = [
    { num: 10, file: 'oisd-full.txt',                name: 'OISD Full',                cat: 'security',   rules: 716,     sizeKB: 16,    warn: 'slow' },
    { num: 15, file: 'ubo-annoyances.txt',           name: 'uBlock Annoyances',        cat: 'annoyances', rules: 9,       sizeKB: 1 },
    { num: 16, file: 'disconnect-tracking.txt',      name: 'Disconnect Tracking',      cat: 'privacy',    rules: 38,      sizeKB: 1 },
    { num: 17, file: 'nocoin.txt',                   name: 'NoCoin',                   cat: 'security',   rules: 357,     sizeKB: 15 },
    { num: 18, file: 'easylist.txt',                 name: 'EasyList',                 cat: 'ads',        rules: 86594,   sizeKB: 2200 },
    { num: 19, file: 'easyprivacy.txt',              name: 'EasyPrivacy',              cat: 'privacy',    rules: 56450,   sizeKB: 1450 },
    { num: 24, file: 'adguard-trackparam.txt',       name: 'AdGuard TrackParam',       cat: 'privacy',    rules: 3861,    sizeKB: 172 },
    { num: 29, file: 'ubo-filters.txt',              name: 'uBlock Filters',           cat: 'ads',        rules: 10914,   sizeKB: 460 },
    { num: 30, file: 'ubo-privacy.txt',              name: 'uBlock Privacy',           cat: 'privacy',    rules: 3230,    sizeKB: 172 },
    { num: 31, file: 'ubo-quick-fixes.txt',          name: 'uBlock Quick Fixes',       cat: 'fixes',      rules: 549,     sizeKB: 74 },
    { num: 32, file: 'ubo-unbreak.txt',              name: 'uBlock Unbreak',           cat: 'fixes',      rules: 6034,    sizeKB: 271 },
    { num: 33, file: 'ubo-badware.txt',              name: 'uBlock Badware',           cat: 'security',   rules: 6477,    sizeKB: 249 },
    { num: 36, file: 'urlhaus-filter.txt',           name: 'URLhaus Filter',           cat: 'security',   rules: 9688,    sizeKB: 837 },
    { num: 44, file: 'peter-lowe.txt',               name: 'Peter Lowe',               cat: 'ads',        rules: 3537,    sizeKB: 68 },
  ];

  // Protection levels — как в браузере, но на базовом ядре:
  //   light  — 5 маленьких списков, самый быстрый
  //   medium — 12 списков (EasyList + EasyPrivacy + ядро uBlock) — DEFAULT
  //   full   — все 14 списков каталога
  const FILTERHUB_LEVELS = {
    light: [10, 15, 17, 31, 32],
    medium: [10, 16, 17, 18, 19, 24, 29, 30, 31, 32, 33, 44],
    full: FILTERHUB_LISTS.map(function (l) { return l.num; }),
  };
  const FILTERHUB_DEFAULT_LEVEL = 'medium';

  function filterhubUrl(list) {
    return FILTERHUB_RAW + list.num + '/' + list.file;
  }

  // ---- Built-in custom filters (ported verbatim from the browser) ----
  const CUSTOM_FILTERS_TEXT = [
    '||doubleclick.net^', '||googlesyndication.com^', '||googleadservices.com^',
    '||adservice.google.com^', '||adservice.google.ca^', '||adservice.google.co.uk^',
    '||adservice.google.ru^', '||ads.youtube.com^', '||pagead2.googlesyndication.com^',
    '||tpc.googlesyndication.com^', '||ad.doubleclick.net^',
    '||adnxs.com^', '||adsrvr.org^', '||adroll.com^', '||moatads.com^',
    '||scorecardresearch.com^', '||adsafeprotected.com^', '||rubiconproject.com^',
    '||pubmatic.com^', '||openx.net^', '||casalemedia.com^', '||criteo.com^',
    '||criteo.net^', '||taboola.com^', '||outbrain.com^', '||zergnet.com^',
    '||sharethrough.com^', '||indexexchange.com^', '||bidswitch.com^',
    '||amazon-adsystem.com^', '||aax.amazon-adsystem.com^', '||advertising.amazon.com^',
    '||ads.js$script', '||pagead.js$script', '||ads.min.js$script', '||ads.min.css$stylesheet',
    '||prebid.js$script', '||prebid.min.js$script', '||gpt.js$script',
    '||googletagmanager.com/gtag/js$script',
    '/adserver/$script', '/ads.js$script', '/pagead/js/$script', '/pagead2/$script',
    '||ads-twitter.com^', '||analytics.twitter.com^', '||t.co/i/adsct$xmlhttprequest',
    '||facebook.net/signals/$script', '||connect.facebook.net/en_US/fbevents.js$script',
    '||graph.facebook.com/v*/$xmlhttprequest',
    '||ads.tiktok.com^', '||analytics.tiktok.com^', '||ads-api.tiktok.com^',
    '||ads-service.tiktok.com^', '||t.tiktok.com^', '||log.tiktokv.com^', '||mon.tiktokv.com^',
    '||api16-access-sg.tiktokv.com^', '||tiktokv.com/aweme/v1/event^',
    '/pagead/js/adsbygoogle^', '/pagead/managed/js/adsense^',
    '||adservice.google.com^$important', '||pagead2.googlesyndication.com^$important',
    '||doubleclick.net^$important', '||googlesyndication.com^$important',
    '||googleadservices.com^$important',
    '||google-analytics.com^', '||googletagmanager.com^', '||ssl.google-analytics.com^',
    '||www.google-analytics.com^', '/gtag/js^',
    '||ads.vk.com^', '||vk.com/js/al/ad_loader.js$script', '||ad.mail.ru^', '||ad.rambler.ru^',
    '||ads.mail.ru^', '||yandex.ru/analytics/$script', '||mc.yandex.ru/metrika/$script',
    '||an.yandex.ru^', '||adfox.yandex.ru^', '||ads.yandex.ru^',
    '||amazon-adsystem.com^', '||amazonads.com^', '||msn.com/ads^', '||bing.com/ads^',
  ].join('\n');

  // Cosmetic filters (YouTube ad containers — hidden by the cosmetic script).
  const CUSTOM_COSMETIC_SELECTORS = {
    'youtube.com': [
      '.ytp-ad-module', '.ytp-ad-overlay-container', '.ytp-ad-text-overlay',
      '.ytp-ad-player-overlay', '.ytp-ad-preview-container', '.video-ads',
      '.ytp-ad-skip-button-slot', '.ytp-ad-message-container',
      '.ytp-ad-persistent-progress-bar-container', '.ytp-ad-progress-bar',
      '.ytp-ad-player-overlay-layout', '.ytp-ad-overlay-close-button', '.ytp-ad-slot',
      '.ytp-ad-action-interstitial', 'ytd-ad-slot-renderer', 'ytd-banner-promo-renderer',
      'ytd-statement-banner-renderer', 'ytd-in-feed-ad-layout-renderer',
      'ytd-promoted-sparkles-web-renderer', 'ytd-display-ad-renderer',
      'ytd-promoted-video-renderer', 'ytd-action-companion-ad-renderer',
      '.ytd-mealbar-promo-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
      'ytd-video-masthead-ad-v3-renderer',
      'ytd-rich-item-renderer:has(.ytd-ad-slot-renderer)', 'ytd-search-pyv-renderer',
    ],
  };

  const HARDBLOCK_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adservice.google.com', 'adservice.google.ca', 'adservice.google.co.uk',
    'adservice.google.ru', 'ads.youtube.com', 'pagead2.googlesyndication.com',
    'tpc.googlesyndication.com', 'ad.doubleclick.net',
    'ads.tiktok.com', 'analytics.tiktok.com', 'ads-api.tiktok.com',
    'ads-service.tiktok.com', 't.tiktok.com', 'log.tiktokv.com', 'mon.tiktokv.com',
    'google-analytics.com', 'googletagmanager.com', 'ssl.google-analytics.com',
    'ads.twitter.com', 'analytics.twitter.com',
    'adnxs.com', 'adsrvr.org', 'adroll.com', 'moatads.com',
    'scorecardresearch.com', 'adsafeprotected.com',
    'rubiconproject.com', 'pubmatic.com', 'openx.net',
    'casalemedia.com', 'criteo.com', 'criteo.net',
    'taboola.com', 'outbrain.com', 'zergnet.com', 'sharethrough.com',
    'indexexchange.com', 'bidswitch.com',
    'amazon-adsystem.com', 'aax.amazon-adsystem.com', 'advertising.amazon.com',
    'adfox.yandex.ru', 'ads.yandex.ru', 'an.yandex.ru',
    'ad.mail.ru', 'ad.rambler.ru', 'ads.mail.ru',
    'connect.facebook.net', 'graph.facebook.com', 'ads.vk.com',
  ];

  // Never block these — critical for Google OAuth/2FA sign-in flows.
  const AUTH_WHITELIST = [
    'accounts.google.com', 'myaccount.google.com', 'signin.google.com',
    'accounts.youtube.com', 'oauth2.googleapis.com', 'securetoken.googleapis.com',
    'identitytoolkit.googleapis.com', 'ssl.gstatic.com',
    'www.recaptcha.net', 'recaptcha.net',
  ];

  // ---- Blocked-request categories (same as the browser's shield panel) ----
  const CAT_ORDER = ['trackers', 'ads', 'social', 'cdn'];
  const CAT_PATTERNS = {
    trackers: [
      /(^|\.)google-analytics\.com$/, /(^|\.)googletagmanager\.com$/, /(^|\.)analytics\./,
      /(^|\.)mc\.yandex\.ru$/, /(^|\.)top-fwz1\.mail\.ru$/, /(^|\.)metrika/,
      /(^|\.)hotjar\.com$/, /(^|\.)hotjar\.io$/, /(^|\.)mixpanel\.com$/, /(^|\.)segment\.(io|com)$/,
      /(^|\.)amplitude\.com$/, /(^|\.)chartbeat\.(com|net)$/, /(^|\.)newrelic\.com$/, /(^|\.)nr-data\.net$/,
      /(^|\.)fullstory\.com$/, /(^|\.)mouseflow\.com$/, /(^|\.)clicky\.com$/, /(^|\.)statcounter\.com$/,
      /(^|\.)quantserve\.com$/, /(^|\.)scorecardresearch\.com$/, /(^|\.)comscore\.com$/, /(^|\.)gemius\.com$/,
      /(^|\.)liveinternet\.ru$/, /(^|\.)criteo\.(com|net)$/, /(^|\.)matomo/, /(^|\.)plausible/,
      /(^|\.)telemetry\./, /(^|\.)beacon\./, /(^|\.)px\.gravatar\.com$/, /(^|\.)(track|tracking)\./i,
    ],
    ads: [
      /(^|\.)doubleclick\.net$/, /(^|\.)googlesyndication\.com$/, /(^|\.)googleadservices\.com$/,
      /(^|\.)adservice\.google\./, /(^|\.)amazon-adsystem\.com$/, /(^|\.)adnxs\.(com|net)$/,
      /(^|\.)taboola\.com$/, /(^|\.)outbrain\.com$/, /(^|\.)adfox\.ru$/, /(^|\.)an\.yandex\.(ru|com)$/,
      /(^|\.)pubmatic\.com$/, /(^|\.)rubiconproject\.com$/, /(^|\.)openx\.net$/, /(^|\.)smartadserver\.com$/,
      /(^|\.)mgid\.com$/, /(^|\.)propellerads\.com$/, /(^|\.)popads\.net$/, /(^|\.)moatads\.com$/,
      /(^|\.)adsrvr\.org$/, /(^|\.)adriver\.ru$/, /(^|\.)adform\.net$/, /(^|\.)betweendigital\.com$/,
      /adsystem|adserver|advertising|adservice|syndication|(^|\.)(ads?)\./i,
    ],
    social: [
      /(^|\.)facebook\.com$/, /(^|\.)facebook\.net$/, /(^|\.)fbcdn\.net$/, /(^|\.)connect\.facebook\.net$/,
      /(^|\.)platform\.twitter\.com$/, /(^|\.)twimg\.com$/, /(^|\.)vk\.com$/, /(^|\.)userapi\.com$/,
      /(^|\.)ok\.ru$/, /(^|\.)instagram\.com$/, /(^|\.)pinterest\./, /(^|\.)linkedin\.(com|net)$/,
      /(^|\.)t\.me$/, /(^|\.)telegram\./, /(^|\.)discord(app)?\.com$/, /(^|\.)tiktok\.com$/,
    ],
    cdn: [
      /(^|\.)cdnjs\.cloudflare\.com$/, /(^|\.)jsdelivr\.net$/, /(^|\.)unpkg\.com$/, /(^|\.)polyfill\.io$/,
      /(^|\.)ajax\.googleapis\.com$/, /(^|\.)fonts\.googleapis\.com$/, /(^|\.)storage\.googleapis\.com$/,
      /(^|\.)akamaihd\.net$/, /(^|\.)akamaized\.net$/, /(^|\.)cloudfront\.net$/, /(^|\.)fastly\.net$/,
      /(^|\.)kxcdn\.com$/, /(^|\.)statically\.io$/, /(^|\.)(cdn)[\.\-]/, /\.(cdn)\./,
    ],
  };

  function categorizeUrl(url) {
    let h = '';
    try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return 'other'; }
    if (!h) return 'other';
    for (let c = 0; c < CAT_ORDER.length; c++) {
      const cat = CAT_ORDER[c];
      const pats = CAT_PATTERNS[cat];
      for (let i = 0; i < pats.length; i++) {
        try { if (pats[i].test(h)) return cat; } catch (e) { /* skip */ }
      }
    }
    return 'other';
  }

  const SEARCH_URL = 'https://startpozi.com/search.html?q=';

  global.SPZ = global.SPZ || {};
  global.SPZ.Catalog = {
    FILTERHUB_RAW, FILTERHUB_LISTS, FILTERHUB_LEVELS, FILTERHUB_DEFAULT_LEVEL,
    filterhubUrl, CUSTOM_FILTERS_TEXT, CUSTOM_COSMETIC_SELECTORS,
    HARDBLOCK_DOMAINS, AUTH_WHITELIST, CAT_ORDER, CAT_PATTERNS,
    categorizeUrl, SEARCH_URL,
  };
})(typeof self !== 'undefined' ? self : this);
