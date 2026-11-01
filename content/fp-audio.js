// fp-audio.js — Audio fingerprint protection (default ON).
// Ported verbatim from the StartPOZI Desktop Browser (preload-webview.js,
// the `sec.audioFp` block): per-page-load deterministic micro-noise on
// the READ paths only (~-140 dB, below any audible or DSP threshold).
// Playback is NOT touched.
(function () {
  'use strict';
  if (window.__spzAudioFp) return;
  try { Object.defineProperty(window, '__spzAudioFp', { value: true, enumerable: false, configurable: true }); } catch (e) { window.__spzAudioFp = true; }
  var _nat = function (f) { try { Object.defineProperty(f, 'name', { value: f.name, configurable: true }); } catch (e) { } return f; };
  var _seed = Math.floor(Math.random() * 2147483646) + 1;
  function _n(i) { var x = Math.sin(i * 12.9898 + _seed) * 43758.5453; return (x - Math.floor(x)) - 0.5; }
  // Noise scales with the value magnitude so every change is >= 1 ulp.
  function _f32(a, salt) {
    for (var i = 0; i < a.length; i++) {
      var v = a[i];
      if (typeof v === 'number' && isFinite(v) && v !== 0) {
        a[i] = v + _n(i + salt) * 4.76837158e-7 * Math.max(1, Math.abs(v));
      }
    }
  }
  function _u8(a, salt) {
    for (var i = 0; i < a.length; i++) {
      var v = a[i];
      if (v > 0 && v < 255) {
        var d = _n(i + salt);
        if (d > 0.25) a[i] = Math.min(255, v + 1);
        else if (d < -0.25) a[i] = Math.max(0, v - 1);
      }
    }
  }
  function _p(proto, name, fn) {
    try {
      var o = proto[name];
      if (!o) return;
      proto[name] = _nat(function () {
        var r = o.apply(this, arguments);
        try { fn.apply(null, arguments); } catch (e) { }
        return r;
      });
      try { Object.defineProperty(proto[name], 'name', { value: name, configurable: true }); } catch (e) { }
    } catch (e) { }
  }
  if (window.AnalyserNode) {
    _p(AnalyserNode.prototype, 'getFloatFrequencyData', function (a) { _f32(a, 0); });
    _p(AnalyserNode.prototype, 'getFloatTimeDomainData', function (a) { _f32(a, 7); });
    _p(AnalyserNode.prototype, 'getByteFrequencyData', function (a) { _u8(a, 13); });
    _p(AnalyserNode.prototype, 'getByteTimeDomainData', function (a) { _u8(a, 29); });
  }
  if (window.OfflineAudioContext) {
    try {
      var _sr = OfflineAudioContext.prototype.startRendering;
      OfflineAudioContext.prototype.startRendering = _nat(function () {
        var p = _sr.apply(this, arguments);
        try {
          if (p && typeof p.then === 'function') {
            p.then(function (buf) {
              try {
                if (buf && buf.getChannelData && buf.numberOfChannels) {
                  for (var c = 0; c < buf.numberOfChannels; c++) { _f32(buf.getChannelData(c), 101 + c * 7); }
                }
              } catch (e) { }
            });
          }
        } catch (e) { }
        return p;
      });
    } catch (e) { }
  }
})();
