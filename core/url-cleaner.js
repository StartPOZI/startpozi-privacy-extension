// url-cleaner.js — tracking-parameter stripper (pure module).
// Ported verbatim from the StartPOZI Desktop Browser (lib/url-cleaner.js):
// same parameter list, same semantics (hash preserved, opaque origins
// returned unchanged).
'use strict';
(function (global) {
  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
    'mc_eid', 'mc_cid', '_ga', '_gl', '_hsenc', '_hsmi',
    'hsCtaTracking', 'vero_id', 'oly_anon_id', 'oly_enc_id',
    'otc', 'igshid', 'wickedid', 'twclid', 'ttclid',
    'li_fat_id', 'li_shid', 'spm', 'scm',
  ];

  function cleanTrackingParams(url) {
    try {
      const urlObj = new URL(url);
      // Opaque origins (file:, about:, data:, …) report origin === 'null':
      // rebuilding from urlObj.origin would yield a literal "null" scheme.
      if (!urlObj.origin || urlObj.origin === 'null') return url;
      const params = urlObj.searchParams;
      let changed = false;
      TRACKING_PARAMS.forEach(function (param) {
        if (params.has(param)) {
          params.delete(param);
          changed = true;
        }
      });
      if (changed) {
        let cleaned = urlObj.origin + urlObj.pathname;
        if (params.toString()) cleaned += '?' + params.toString();
        if (urlObj.hash) cleaned += urlObj.hash;
        return cleaned;
      }
    } catch (e) { /* unparsable → unchanged */ }
    return url;
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.UrlCleaner = { TRACKING_PARAMS, cleanTrackingParams };
})(typeof self !== 'undefined' ? self : this);
