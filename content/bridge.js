// bridge.js — visible-URL cleaner (ISOLATED world, main frame only).
// Companion to the network-level param stripping (DNR regexSubstitution /
// webRequest redirect): rewrites the visible URL via history.replaceState
// using the SAME tracking-parameter list as the browser's
// lib/url-cleaner.js (keep in sync).
(function () {
  'use strict';
  var TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
    'mc_eid', 'mc_cid', '_ga', '_gl', '_hsenc', '_hsmi',
    'hsCtaTracking', 'vero_id', 'oly_anon_id', 'oly_enc_id',
    'otc', 'igshid', 'wickedid', 'twclid', 'ttclid',
    'li_fat_id', 'li_shid', 'spm', 'scm',
  ];
  try {
    var u = new URL(location.href);
    if (!u.origin || u.origin === 'null') return;
    var params = u.searchParams;
    var changed = false;
    TRACKING_PARAMS.forEach(function (p) {
      if (params.has(p)) { params.delete(p); changed = true; }
    });
    if (!changed) return;
    var cleaned = u.origin + u.pathname;
    if (params.toString()) cleaned += '?' + params.toString();
    if (u.hash) cleaned += u.hash;
    history.replaceState(null, '', cleaned);
  } catch (e) { /* unparsable — leave */ }
})();
