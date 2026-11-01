// fp-rtc.js — WebRTC IP leak protection (default ON).
// Ported from the StartPOZI Desktop Browser (preload-webview.js, the
// `sec.blockWebRTC` block): RTCPeerConnection construction throws, so
// WebRTC cannot leak the local IP — even under VPN or Tor.
(function () {
  'use strict';
  var _f = Symbol.for('spz');
  if (Navigator.prototype[_f] & 1) return;
  try { Object.defineProperty(Navigator.prototype, _f, { value: (Navigator.prototype[_f] || 0) | 1, enumerable: false, configurable: true }); } catch (e) { }
  var _origRTC = window.RTCPeerConnection || function () { };
  window.RTCPeerConnection = function () {
    throw new DOMException('WebRTC is disabled for privacy protection', 'NotAllowedError');
  };
  window.RTCPeerConnection.prototype = _origRTC.prototype;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = window.RTCPeerConnection;
})();
