// fp-shield.js — Fingerprint shield (default ON).
// Ported from the StartPOZI Desktop Browser (preload-webview.js, the
// `sec.fpShield` block): safe value-noise/normalization that never
// touches identity strings. Canvas noise, CPU/RAM values, Battery API,
// sendBeacon, media devices, screen depth, local fonts, font metrics.
(function () {
  'use strict';
  var _n = function (f) { try { Object.defineProperty(f, 'name', { value: f.name, configurable: true }); } catch (e) { } return f; };
  var _fs = Symbol.for('spz');
  if (Navigator.prototype[_fs] & 64) return;
  try { Object.defineProperty(Navigator.prototype, _fs, { value: (Navigator.prototype[_fs] || 0) | 64, enumerable: false, configurable: true }); } catch (e) { }

  // Canvas 2D fingerprint — mutate a few base64 chars / LSB pixels.
  var _oTDU = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = _n(function toDataURL() {
    var r = _oTDU.apply(this, arguments);
    if (r && r.indexOf('data:') === 0 && r.length > 40) {
      var ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var pos = r.length - 8 - Math.floor(Math.random() * 8);
      if (pos > 22 && r[pos] !== '=') { r = r.slice(0, pos) + ch[Math.floor(Math.random() * ch.length)] + r.slice(pos + 1); }
    }
    return r;
  });
  var _oGID = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = _n(function getImageData() {
    var d = _oGID.apply(this, arguments);
    if (d.data.length > 100) {
      var st = Math.max(1000, Math.floor(d.data.length / 4));
      for (var i = 0; i < d.data.length; i += st) { d.data[i] = d.data[i] ^ 1; }
    }
    return d;
  });

  // Hardware fingerprint: CPU cores / RAM — identical for everyone.
  var _npS = Navigator.prototype;
  try { Object.defineProperty(_npS, 'hardwareConcurrency', { get: function () { return 4; } }); } catch (e) { }
  try { Object.defineProperty(_npS, 'deviceMemory', { get: function () { return 4; } }); } catch (e) { }

  // sendBeacon — fire-and-forget tracking pings. Noop silently.
  try { Navigator.prototype.sendBeacon = _n(function sendBeacon() { return true; }); } catch (e) { }

  // Battery Status API — stable, generic profile for every user.
  try {
    Object.defineProperty(_npS, 'getBattery', {
      value: function () {
        return Promise.resolve({
          charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
          addEventListener: function () { }, removeEventListener: function () { },
        });
      }, configurable: true, writable: true,
    });
  } catch (e) { }

  // MediaDevices — anonymous device list, no stable ids.
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      var _oe = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = function () {
        return _oe().then(function (list) {
          return list.map(function (d) { return { kind: d.kind, deviceId: '', groupId: '', label: '' }; });
        }).catch(function () { return []; });
      };
    }
  } catch (e) { }
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints) {
      navigator.mediaDevices.getSupportedConstraints = function () {
        return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      };
    }
  } catch (e) { }

  // Screen colour depth — normalize.
  try { Object.defineProperty(Screen.prototype, 'colorDepth', { get: function () { return 24; }, configurable: true }); } catch (e) { }
  try { Object.defineProperty(Screen.prototype, 'pixelDepth', { get: function () { return 24; }, configurable: true }); } catch (e) { }

  // Local font enumeration API — remove it outright.
  try {
    if (window.queryLocalFonts) {
      try { delete window.queryLocalFonts; } catch (e0) { }
      try { Object.defineProperty(window, 'queryLocalFonts', { value: undefined, writable: false, configurable: false }); } catch (e1) { }
    }
  } catch (e) { }

  // Font-metrics fingerprinting: quantize TextMetrics to 0.25px with a
  // stable per-page jitter.
  function _qmk(m, k, v) {
    try {
      var nv = Math.round((v + _mtJ) / 0.25) * 0.25;
      Object.defineProperty(m, k, { get: function () { return nv; }, configurable: true });
    } catch (e) { }
  }
  var _mtJ = (Math.floor(Math.random() * 4)) * 0.0625;
  try {
    var _oMT = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = _n(function measureText() {
      var m = _oMT.apply(this, arguments);
      try {
        if (m) {
          _qmk(m, 'width', typeof m.width === 'number' ? m.width : 0);
          ['actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent',
            'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent']
            .forEach(function (k) { if (typeof m[k] === 'number') _qmk(m, k, m[k]); });
        }
      } catch (e) { }
      return m;
    });
  } catch (e) { }
})();
