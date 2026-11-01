// cookie-blocker.js — auto-declining cookie banners.
// Ported VERBATIM from the StartPOZI Desktop Browser
// (cookie-blocker-payload.js): ~70 CMP providers, shadow DOM support,
// multi-language text heuristics, "Accept" is NEVER clicked.
// Runs in the MAIN world at document_start in every frame — same as the
// browser, which injects this exact payload into every frame.
(function () {
  if (window.__spzCookieBlocker) return 0;
  try { Object.defineProperty(window, '__spzCookieBlocker', { value: true, enumerable: false, configurable: true }); } catch (e) { window.__spzCookieBlocker = true; }
  var LOG = function () { try { var a = ['[SPZ-Cookie]']; for (var i = 0; i < arguments.length; i++) a.push(arguments[i]); console.log.apply(console, a); } catch (e) { } };
  LOG('blocker armed on', location.href);

  // ---- 1. Provider-specific reject selectors. ----
  var REJECT_SELECTORS = [
    '#onetrust-reject-all-handler', 'button#onetrust-reject-all-handler',
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '.didomi-continue-without-agreeing', '.didomi-dismiss-button',
    'button.didomi-button-highlight',
    '#sp_reject_optional',
    '.sp_choice_type_REJECT_ALL',
    '.sp_choice_type_13',
    'button[title*="Reject" i]', 'button[title*="Refuse" i]',
    'button[title*="Decline" i]', 'button[title^="Refuser" i]',
    'button[title*="Ablehnen"]', 'button[aria-label*="Ablehnen"]',
    'button[title*="Rifiuta"]', 'button[title*="Rechazar"]',
    '#truste-consent-required', '#truste-consent-button3',
    '.reject-all', '.rejectAll',
    '#pubtech-cmp #pt-close', '.pt-k2L',
    'button.reject-all-cookies',
    '#cookie-banner .cta__decline',
    '[data-action="reject"]', '[data-testid="reject-Cta"]',
    '[data-testid="cookie-reject"]', '[data-testid="banner-cookie-reject"]',
    '[data-testid*="reject" i]', '[data-testid*="deny-all" i]',
    '.iubenda-cs-reject-btn', '#iubenda-cs-btn-2',
    '.cc-deny', '.cc-btn.cc-deny',
    '#cookiescript_reject', 'button#cookiescript_reject',
    '#axs .reject', '.axs-reject',
    '#uc-btn-deny-all', 'button[data-testid="uc-deny-all-button"]',
    'button[data-testid="uc-all-denied-button"]', '.uc-deny-all',
    '#uc-center-container button[title*="Ablehnen"]',
    '.osano-cm-denyAll', '.osano-cm-deny',
    '#CookieBox ._brlbs-btn-refuse', '._brlbs-btn-refuse',
    '#CookieBox .Cookie__button--reject',
    '.cmplz-deny',
    '.cky-btn-reject', 'button[data-cky-tag="reject-button"]',
    '#cookie_action_close_header_reject', '#wt-cli-reject-btn',
    '#tarteaucitronAllDeny', '.ot-pc-refuse-all-handler', '.cmpboxbtnno',
    '.sp_choice_type_REJECT_ALL',
    'ytd-consent-bump-v2-lightbox button[aria-label*="Reject" i]',
    'ytd-consent-bump-v2-lightbox button[aria-label*="Отклонить" i]',
    'button[aria-label*="Reject all" i]', 'button[aria-label*="Reject the use" i]',
    'button[class*="reject" i]', 'button[class*="reject-all" i]',
    '.cm-btn-accept[aria-label*="Reject" i]',
    'button[name="reject"]', 'button[value="reject"]',
  ];

  // "Manage preferences" buttons.
  var PREFS_PROVIDERS = [
    '#onetrust-pc-btn', '.sp_choice_type_12',
    '.didomi-notice-show-settings-button',
    '#CybotCookiebotDialogBodyLevelButtonCustomize',
    '#uc-btn-customize', 'button[data-testid="uc-customize-button"]',
    '.cc-btn.cc-settings',
  ];
  var PREFS_GENERIC = [
    'button[title*="Manage" i]', 'button[title*="Preferences" i]',
    'button[title*="Customize" i]', 'button[title*="Settings" i]',
    '.qc-cmp2-summary-buttons button[mode="secondary"]',
    '[data-testid="cookie-manage-settings"]',
    '#uc-btn-more-info', 'button[data-testid="uc-more-info-button"]',
    'button[title*="Einstellungen"]', 'button[title*="Optionen"]',
  ];

  var REJECT_PHRASES = [
    'reject all', 'reject optional', 'reject', 'decline all', 'decline',
    'refuse all', 'refuse', 'deny all', 'deny', 'opt out', 'opt-out',
    'do not allow', 'don\'t allow', 'not allow', 'disagree', 'i do not agree',
    'necessary only', 'only necessary', 'essential only', 'only essential',
    'continue without', 'without accepting', 'no thanks', 'no, thanks',
    'отклонить все', 'отклонить всё', 'отклонить', 'отказаться', 'отказ от', 'отказ', 'не принимать', 'не разрешать', 'только необходимые', 'не соглашаться',
    'alle ablehnen', 'ablehnen', 'verweigern', 'nicht zustimmen', 'nicht erlauben', 'keine cookies', 'nur notwendige', 'nur erforderliche',
    'refuser', 'rejeter', 'tout refuser', 'refuser tout', 'continuer sans',
    'rifiuta', 'rifiutare', 'rifiuta tutti', 'non accetto', 'solo necessari',
    'rechazar', 'rechazar todo', 'solo las necesarias', 'no acepto', 'rejeitar', 'recusar', 'recusar tudo', 'só necessários',
    'odmów', 'odmawiam', 'nie zgadzam', 'tylko niezbędne', 'weigeren', 'weiger',
    'avvisa', 'avvisa alla', 'endast nödvändiga', 'afvis', 'afvis alle', 'kun nødvendige',
    'hylká', 'hylká kaikki', 'vaidle', 'keeldu', 'tagasi lükkamine', 'atsisakyti', 'atmest', 'zamítnout',
  ];
  var ACCEPT_RE = /^(accept|agree|allow all|allow|agree to all|got it|okay|ok$|i agree|consent|accept all|alles akzeptieren|tout accepter|accetta|accetto|aceptar|aceptar todo|acepto|godkänn|godkänna|acceptér|hyväksy|hyväksyn|nõustu|prisustti|sutinku|piekrītu|souhlasím|zustimmen|akzeptieren|erlauben|einverstanden|j’accepte|согласен|согласиться|принять|принять все|принять всё|разрешить|разрешить все|дозволить|принять всё)/i;

  var BANNER_SELECTORS = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBody',
    '#consent', '#consent-banner', '#consent-popup', '#consent-container',
    '#cookie-consent', '#cookieConsent', '#cookieBanner', '#cookie-banner',
    '#cookie-notice', '#cookieNotice', '#cookie-bar', '#cookieBar',
    '.cookie-banner', '.cookie-consent', '.cookie-notice', '.cookie-bar',
    '.cookies-banner', '.cc-banner', '.cc-window', '.cc-dialog',
    '.didomi-popup-container', '.didomi-popup', '#didomi-host',
    '.qc-cmp2-container',
    '[id^="sp_message_container"]', '[id^="sp_message_iframe"]',
    '[id^="sp_privacy_manager_container"]', '.sp_veil',
    '#truste-consent-content', '.iubenda-cs-container',
    '#uc-center-container', '#uc-banner-modal', '.uc-banner-modal', '#usercentrics-root',
    '#CookieBox', '#cmplz-cookiebanner-container',
    '.cky-banner', '.cky-consent-container', '#osano-cm', '#osano-cm-window',
    '#tarteaucitronRoot', '#cookiefirst-root', '#klaro', '#cmpwrapper',
    '#coiOverlay',
    '[role="dialog"][aria-label*="cookie" i]',
    '[role="dialog"][aria-label*="einwilligung" i]',
    '[role="dialog"][aria-label*="consent" i]',
    '[data-testid="cookie-policy-dialog"]',
  ];
  var CONSENT_TEXT_RE = /(we use cookies|we use technical cookies|this (site|website) uses cookies|use of cookies|cookies to (improve|personalize|enhance)|by (clicking|using|continuing).*accept|einwilligung|wir verwenden|nutzung von cookies|datenschutz-einstellungen| Werbe-?Cookies| zu unseren cookies|consent to|your consent|privacy choices|nous utilisons (des )?cookies|utilizamos cookies|usa i cookie|используем cookie|мы используем)/i;

  function visTxt(el) {
    var t = (el.textContent || el.innerText || '').trim().toLowerCase();
    return t.length > 120 ? '' : t;
  }
  var _lastClickAt = 0;
  function clickEl(el) {
    if (!el) return false;
    try { LOG('click', (el.id && ('#' + el.id)) || el.className || el.tagName, JSON.stringify(visTxt(el))); _lastClickAt = Date.now(); el.click(); setTimeout(unlockScroll, 600); return true; } catch (e) { return false; }
  }
  function isVisible(el) {
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
      return true;
    } catch (e) { return false; }
  }
  function isOverlay(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'absolute') return true;
      var z = parseInt(cs.zIndex, 10);
      if (!isNaN(z) && z >= 100) return true;
    } catch (e) { }
    return false;
  }

  // ---- Shadow DOM support (hook attachShadow + periodic deep scan) ----
  var _shadowRoots = [];
  var _lastShadowScan = 0;
  function registerShadowRoot(sr) {
    if (!sr || _shadowRoots.indexOf(sr) !== -1) return;
    _shadowRoots.push(sr);
    try {
      new MutationObserver(function () { scheduleHandle(); })
        .observe(sr, { childList: true, subtree: true });
    } catch (e) { }
  }
  function scanForShadowRoots(root, depth) {
    try {
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) registerShadowRoot(all[i].shadowRoot);
      }
    } catch (e) { }
    if (depth > 0) {
      for (var j = 0; j < _shadowRoots.length; j++) {
        scanForShadowRoots(_shadowRoots[j], depth - 1);
      }
    }
  }
  try {
    var _origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      var sr = _origAttachShadow.call(this, init);
      try { registerShadowRoot(sr); } catch (e) { }
      return sr;
    };
  } catch (e) { }

  function getRoots() {
    if ((Date.now() - _lastShadowScan) > 1000) {
      _lastShadowScan = Date.now();
      scanForShadowRoots(document, 2);
    }
    var roots = [document];
    for (var s = 0; s < _shadowRoots.length; s++) {
      try { if (_shadowRoots[s]) roots.push(_shadowRoots[s]); } catch (e) { }
    }
    try {
      var fs = document.querySelectorAll('iframe');
      for (var i = 0; i < fs.length; i++) {
        try {
          var d = fs[i].contentDocument;
          if (d && d.body) roots.push(d);
        } catch (e) { } // SecurityError for cross-origin — skip
      }
    } catch (e) { }
    return roots;
  }

  function findBannerContainersIn(root) {
    var out = [];
    if (!root) return out;
    var seen = Object.create(null);
    function add(el) {
      if (!el) return;
      var key = el === root ? '@root' : (el.uniqueID || (function () { try { return el.uniqueID = 'spz' + Math.random(); } catch (e) { return Math.random(); } })());
      if (!seen[key]) { seen[key] = true; out.push(el); }
    }
    for (var i = 0; i < BANNER_SELECTORS.length; i++) {
      try {
        var list = root.querySelectorAll(BANNER_SELECTORS[i]);
        for (var k = 0; k < list.length; k++) add(list[k]);
      } catch (e) { }
    }
    try {
      var cands = root.querySelectorAll('[role="dialog"],[aria-modal="true"],div[id],section[id],div[class],section[class],aside,footer');
      for (var j = 0; j < cands.length; j++) {
        var el = cands[j];
        var sig = ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
        if (sig.indexOf('cookie') !== -1 || sig.indexOf('consent') !== -1 || sig.indexOf('einwilligung') !== -1 || sig.indexOf('cmp') !== -1 || sig.indexOf('rgpd') !== -1) {
          if (isOverlay(el) && isVisible(el)) {
            try {
              var r = el.getBoundingClientRect();
              if (r.width >= 240 && r.height >= 70) add(el);
            } catch (e) { }
          }
          continue;
        }
        var txt = (el.textContent || '').trim();
        if (txt.length < 30 || txt.length > 3000) continue;
        if (!CONSENT_TEXT_RE.test(txt)) continue;
        if (!isOverlay(el) || !isVisible(el)) continue;
        try {
          var r2 = el.getBoundingClientRect();
          if (r2.width < 240 || r2.height < 70) continue;
        } catch (e) { continue; }
        add(el);
      }
    } catch (e) { }
    return out;
  }
  function findAllBannerContainers() {
    var roots = getRoots();
    var all = [];
    for (var r = 0; r < roots.length; r++) {
      var c = findBannerContainersIn(roots[r]);
      for (var i = 0; i < c.length; i++) all.push(c[i]);
    }
    return all;
  }

  function tryProviderReject() {
    var roots = getRoots();
    for (var r = 0; r < roots.length; r++) {
      for (var i = 0; i < REJECT_SELECTORS.length; i++) {
        var el = roots[r].querySelector(REJECT_SELECTORS[i]);
        if (el && isVisible(el)) { if (clickEl(el)) return true; }
      }
    }
    return false;
  }
  function tryTextRejectInBanners() {
    var containers = findAllBannerContainers();
    for (var c = 0; c < containers.length; c++) {
      var nodes = containers[c].querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
      for (var i = 0; i < nodes.length; i++) {
        var b = nodes[i];
        if (!isVisible(b)) continue;
        var aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        var title = (b.getAttribute('title') || '').trim().toLowerCase();
        var val = (b.getAttribute('value') || '').trim().toLowerCase();
        var txt = visTxt(b);
        if (!txt && !aria && !title && !val) continue;
        if ((txt && ACCEPT_RE.test(txt)) || (aria && ACCEPT_RE.test(aria)) ||
          (title && ACCEPT_RE.test(title)) || (val && ACCEPT_RE.test(val))) continue;
        var combined = (txt + ' ' + aria + ' ' + title + ' ' + val);
        for (var j = 0; j < REJECT_PHRASES.length; j++) {
          if (combined.indexOf(REJECT_PHRASES[j]) !== -1) { if (clickEl(b)) return true; }
        }
      }
    }
    return false;
  }
  var _openedPrefs = false;
  function tryOpenPrefsThenReject() {
    if (_openedPrefs) return false;
    var target = null;
    var roots = getRoots();
    for (var r = 0; r < roots.length && !target; r++) {
      for (var i = 0; i < PREFS_PROVIDERS.length; i++) {
        var el = roots[r].querySelector(PREFS_PROVIDERS[i]);
        if (el && isVisible(el)) { target = el; break; }
      }
    }
    if (!target) {
      var containers = findAllBannerContainers();
      outer:
      for (var c = 0; c < containers.length; c++) {
        for (var g = 0; g < PREFS_GENERIC.length; g++) {
          var gel = containers[c].querySelector(PREFS_GENERIC[g]);
          if (gel && isVisible(gel)) { target = gel; break outer; }
        }
      }
    }
    if (target) {
      _openedPrefs = true;
      clickEl(target);
      setTimeout(function () {
        tryProviderReject() || tryTextRejectInBanners();
      }, 400);
      setTimeout(function () {
        tryProviderReject() || tryTextRejectInBanners() || hideKnownBanners();
      }, 1100);
      return true;
    }
    return false;
  }
  function unlockScroll() {
    try {
      var cs = findAllBannerContainers();
      for (var i = 0; i < cs.length; i++) {
        if (isVisible(cs[i])) return; // a banner is still up — keep the lock
      }
      var de = document.documentElement, b = document.body;
      if (de && de.style && de.style.overflow === 'hidden') de.style.overflow = '';
      if (b && b.style && b.style.overflow === 'hidden') b.style.overflow = '';
      if (b) b.classList.remove('modal-open', 'no-scroll');
    } catch (e) { }
  }
  function hideKnownBanners() {
    var roots = getRoots();
    var did = false;
    for (var r = 0; r < roots.length; r++) {
      for (var i = 0; i < BANNER_SELECTORS.length; i++) {
        try {
          var list = roots[r].querySelectorAll(BANNER_SELECTORS[i]);
          for (var k = 0; k < list.length; k++) {
            var el = list[k];
            if (el && isVisible(el)) {
              el.style.setProperty('display', 'none', 'important');
              did = true; LOG('hide', BANNER_SELECTORS[i]);
            }
          }
        } catch (e) { }
      }
    }
    if (did) setTimeout(unlockScroll, 400);
    return did;
  }

  function tryHandle() {
    var onCooldown = (Date.now() - _lastClickAt) < 1500;
    var containers = findAllBannerContainers();
    if (!onCooldown && tryProviderReject()) return true;
    if (!onCooldown && tryTextRejectInBanners()) return true;
    if (!onCooldown && tryOpenPrefsThenReject()) return true;
    if (containers.length > 0) {
      hideKnownBanners();
    }
    return false;
  }
  var _pending = false;
  function scheduleHandle() {
    if (_pending) return;
    _pending = true;
    setTimeout(function () { _pending = false; tryHandle(); }, 180);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryHandle, 250); });
  } else {
    setTimeout(tryHandle, 250);
  }
  var obs = new MutationObserver(function () { scheduleHandle(); });
  try { obs.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch (e) { }
  return 0;
})();
