// fp-webgl.js — WebGL fingerprint masking (default ON).
// Ported from the StartPOZI Desktop Browser (preload-webview.js, the
// `sec.blockWebGL` block): vendor/renderer STRINGS are spoofed, never
// rendering itself. Same values as the browser ("StartPOZI …").
(function () {
  'use strict';
  var _f = Symbol.for('spz');
  if (Navigator.prototype[_f] & 4) return;
  try { Object.defineProperty(Navigator.prototype, _f, { value: (Navigator.prototype[_f] || 0) | 4, enumerable: false, configurable: true }); } catch (e) { }

  if (typeof WebGLRenderingContext === 'undefined') return;

  var _getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) {
    if (p === 37445) return 'StartPOZI';
    if (p === 37446) return 'StartPOZI Browser Graphics Engine';
    if (p === 7937) return 'StartPOZI Browser Graphics Engine';
    if (p === 7936) return 'StartPOZI';
    if (p === 37447) return 'WebGL 2.0';
    return _getParam.apply(this, arguments);
  };
  if (typeof WebGL2RenderingContext !== 'undefined') {
    var _getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'StartPOZI';
      if (p === 37446) return 'StartPOZI Browser Graphics Engine';
      if (p === 7937) return 'StartPOZI Browser Graphics Engine';
      if (p === 7936) return 'StartPOZI';
      if (p === 37447) return 'WebGL 2.0';
      return _getParam2.apply(this, arguments);
    };
  }
  var _getExt = WebGLRenderingContext.prototype.getExtension;
  WebGLRenderingContext.prototype.getExtension = function (name) {
    if (name === 'WEBGL_debug_renderer_info') {
      return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
    }
    return _getExt.apply(this, arguments);
  };
})();
