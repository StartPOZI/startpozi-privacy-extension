// fp-identity.js — Fingerprinting protection (OPT-IN, like the browser).
// Ported from the StartPOZI Desktop Browser (preload-webview.js, the
// `sec.fingerprint` block). The browser spoofs platform to the REAL OS
// (claiming another OS would itself be a fingerprint); here we FREEZE
// the real platform value and normalize languages, plus farble the
// AudioBuffer read path (same as the browser).
(function () {
  'use strict';
  var _n = function (f) { try { Object.defineProperty(f, 'name', { value: f.name, configurable: true }); } catch (e) { } return f; };
  var _f = Symbol.for('spz');
  if (Navigator.prototype[_f] & 2) return;
  try { Object.defineProperty(Navigator.prototype, _f, { value: (Navigator.prototype[_f] || 0) | 2, enumerable: false, configurable: true }); } catch (e) { }
  var _np = Navigator.prototype;

  // Freeze the REAL platform — anti-fingerprinting normalization that
  // cannot mismatch with other OS signals.
  try {
    var realPlatform = Navigator.prototype.platform &&
      Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform');
    if (realPlatform && realPlatform.get) {
      var fixed = realPlatform.get.call(navigator);
      Object.defineProperty(_np, 'platform', { get: function () { return fixed; } });
    }
  } catch (e) { }

  // Normalize the languages list (same value as the browser's spoof).
  try { Object.defineProperty(_np, 'languages', { get: function () { return ['en-US', 'en']; } }); } catch (e) { }

  // AudioContext fingerprinting — tiny noise on the LSBs of the float
  // output (the classic OfflineAudioContext + DynamicsCompressor id).
  try {
    var _ac = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (_ac) {
      var _origGetChannel = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function () {
        var d = _origGetChannel.apply(this, arguments);
        if (d && d.length > 100) {
          for (var i = 0; i < d.length; i += Math.max(1000, Math.floor(d.length / 4))) {
            d[i] = d[i] + (Math.random() - 0.5) * 1.0e-7;
          }
        }
        return d;
      };
    }
  } catch (e) { }
})();
