// picker.js — element zapper («Block ads manually»), портирован 1:1 из
// StartPOZI Browser main.js (_MAIN_WORLD_PICKER_CODE). Отличия порта:
// работает в ISOLATED world расширения (надёжные capture-listeners на
// window, доступ к chrome.runtime.sendMessage) и результат уходит сообщением
// в background, а не Promise-ом в главный процесс.
// Инжектится через chrome.scripting.executeScript во ВСЕ фреймы вкладки —
// реклама живёт внутри iframe, и у каждого фрейма свой window.
(function () {
  'use strict';

  // Повторный вызов = отмена уже идущего выбора (toggle, как в браузере).
  if (window.__spzPickerActive) {
    try { if (window.__spzCancelPicker) window.__spzCancelPicker(); } catch (e0) {}
    return;
  }
  try {
    Object.defineProperty(window, '__spzPickerActive',
      { value: true, enumerable: false, configurable: true, writable: true });
  } catch (e) { window.__spzPickerActive = true; }

  function done(v) {
    try {
      Object.defineProperty(window, '__spzPickerActive',
        { value: false, enumerable: false, configurable: true, writable: true });
    } catch (e) { window.__spzPickerActive = false; }
    window.__spzCancelPicker = null;
    cleanup();
    if (v && chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: 'pickerResult' }, v), function () {
          void chrome.runtime.lastError; // ответ не важен
        });
      } catch (e1) { /* контекст умер — не страшно */ }
    }
  }
  try {
    Object.defineProperty(window, '__spzCancelPicker',
      { value: function () { done(null); }, enumerable: false, configurable: true, writable: true });
  } catch (e) { window.__spzCancelPicker = function () { done(null); }; }

  var style = document.createElement('style');
  style.id = '__spz_picker_style';
  style.textContent =
    '.__spz_hover{outline:2px solid #e74c3c!important;outline-offset:-2px!important;background:rgba(231,76,60,0.12)!important;cursor:crosshair!important;}' +
    '.__spz_overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:none;background:rgba(0,0,0,0.35);}' +
    '.__spz_hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#222;color:#fff;font:13px/1.4 -apple-system,sans-serif;' +
      'padding:10px 16px;border-radius:10px;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.4);max-width:90%;text-align:center;pointer-events:none;}' +
    '.__spz_hint b{color:#ff6b6b}.__spz_hint kbd{background:#444;border-radius:4px;padding:1px 6px;font-family:monospace;}';
  document.documentElement.appendChild(style);

  var overlay = document.createElement('div');
  overlay.className = '__spz_overlay';
  document.documentElement.appendChild(overlay);

  var hint = document.createElement('div');
  hint.className = '__spz_hint';
  // Build via DOM API + textContent only: сайты с Trusted-Types CSP
  // бросают на innerHTML — это убивало picker сразу после вставки overlay.
  (function () {
    function kbd(txt) { var k = document.createElement('kbd'); k.textContent = txt; return k; }
    hint.appendChild(document.createTextNode('Click an element to '));
    var b = document.createElement('b'); b.textContent = 'hide it forever'; hint.appendChild(b);
    hint.appendChild(document.createTextNode('. ')); hint.appendChild(kbd('Esc'));
    hint.appendChild(document.createTextNode(' — cancel, ')); hint.appendChild(kbd('U'));
    hint.appendChild(document.createTextNode(' — undo last.'));
  })();
  document.documentElement.appendChild(hint);

  var lastHover = null;
  function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s; }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) {
      var id = el.id.trim();
      if (/^[A-Za-z][\w\-.:]*$/.test(id)) return '#' + esc(id);
    }
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var part = node.nodeName.toLowerCase();
      if (node.id && /^[A-Za-z][\w\-.:]*$/.test(node.id.trim())) {
        parts.unshift('#' + esc(node.id.trim()));
        break;
      }
      var parent = node.parentElement;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) {
          return c.nodeName === node.nodeName;
        });
        if (sibs.length > 1) {
          part += ':nth-of-type(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = parent;
    }
    var sel = parts.join(' > ');
    if (sel.length > 200 && el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).slice(0, 2)
        .map(function (c) { return '.' + esc(c); }).join('');
      if (cls) return el.nodeName.toLowerCase() + cls;
    }
    return sel;
  }

  function hov(e) {
    if (!e.isTrusted) return; // игнорировать синтетику самой страницы
    var t = e.target;
    if (!t || t.nodeType !== 1 || t === overlay || t === hint ||
        t === document.body || t === document.documentElement) return;
    if (lastHover && lastHover !== t) {
      try { lastHover.classList.remove('__spz_hover'); } catch (err) {}
    }
    try { t.classList.add('__spz_hover'); } catch (err) {}
    lastHover = t;
  }

  function click(e) {
    if (!e.isTrusted) return; // выбирает только реальный клик пользователя
    e.preventDefault(); e.stopPropagation();
    var t = e.target;
    if (!t || t === overlay || t === hint) return;
    var sel = buildSelector(t);
    if (sel) { done({ domain: window.location.hostname, selector: sel }); return; }
    // Неselectable target (html/body/пустой фон дают пустой селектор) —
    // НЕ закрываем picker: мигнём подсказкой, что клик замечен и проигнорирован.
    try {
      hint.style.transition = 'opacity .12s';
      hint.style.opacity = '0.25';
      setTimeout(function () { try { hint.style.opacity = '1'; } catch (e2) {} }, 200);
    } catch (e2) {}
  }

  function key(e) {
    if (!e.isTrusted) return;
    if (e.key === 'Escape') { e.preventDefault(); done(null); }
    else if (e.key && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      done({ undo: true, domain: window.location.hostname });
    }
  }

  // window capture: срабатывает ДО любых document-обработчиков страницы.
  window.addEventListener('mouseover', hov, true);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', key, true);

  function cleanup() {
    window.removeEventListener('mouseover', hov, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', key, true);
    if (lastHover) { try { lastHover.classList.remove('__spz_hover'); } catch (err) {} }
    if (style.parentNode) style.parentNode.removeChild(style);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (hint.parentNode) hint.parentNode.removeChild(hint);
  }

  // Страховка: не держать overlay вечно.
  setTimeout(function () { if (window.__spzPickerActive) done(null); }, 120000);
})();
