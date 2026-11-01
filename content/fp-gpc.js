// fp-gpc.js — Global Privacy Control DOM signal.
// Mirrors the browser's navigator.globalPrivacyControl (main.js sends
// the Sec-GPC header via webRequest/DNR; this sets the JS-side flag,
// like preload-webview.js does with `spz-get-gpc`).
(function () {
  'use strict';
  try {
    if (navigator.globalPrivacyControl !== true) {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
        get: function () { return true; },
        configurable: true,
      });
    }
  } catch (e) { /* already defined */ }
})();
