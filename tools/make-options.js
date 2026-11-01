// make-options.js — builds ui/options.html from the browser's real
// Settings.html (copied by the user into ui/Settings.html).
// Keeps the browser's markup/styles VERBATIM; only:
//   - drops browser-only sections (proxy, profiles, backup, …) and the
//     master-password lock overlay, keeps #blocker / #security / #about
//   - swaps Settings-inline.js / i18n.js / jsQR for the extension's
//     ui/options-inline.js + ui/i18n-ext.js
//   - fixes asset paths to the extension's own icons
// The generated page is wired to the extension in ui/options-inline.js.
// Run: node tools/make-options.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'ui', 'Settings.html'), 'utf8');
const KEEP_SECTIONS = ['blocker', 'security', 'about'];
const DEFAULT_SECTION = 'blocker';
const DROP_SCRIPTS = [
  /<script src="vendor\/jsqr\/jsQR\.min\.js"><\/script>\s*/g,
  /<script src="i18n\.js"><\/script>\s*/g,
  /<script src="Settings-inline\.js"><\/script>\s*/g,
];

function cut(s, from, to) {
  const a = s.indexOf(from);
  if (a === -1) throw new Error('marker not found: ' + from);
  const b = to ? s.indexOf(to, a) : -1;
  if (to && b === -1) throw new Error('end marker not found: ' + to);
  return { text: s.slice(a, b === -1 ? undefined : b), a, b: b === -1 ? s.length : b };
}

// ---- head ----------------------------------------------------------------
let head = src.slice(0, src.indexOf('</head>') + '</head>'.length);
DROP_SCRIPTS.forEach(function (re) { head = head.replace(re, ''); });
head = head.replace(/<link rel="icon"[^>]*>/,
  '<link rel="icon" type="image/x-icon" href="../icons/favicon.ico">');
head = head.replace(/<title>[^<]*<\/title>/,
  '<title>StartPOZI Privacy Guard — Settings</title>');
// CSP: страница расширения должна иметь право тянуть СВОИ файлы (словари
// i18n) — 'self' в Firefox не всегда матчит moz-extension://<uuid>, поэтому
// схемы расширений добавлены явно (иначе fetch словаря молча блокируется и
// «язык не переключается»).
head = head.replace("connect-src 'self' https://startpozi.com",
  "connect-src 'self' moz-extension: chrome-extension: https://startpozi.com");

// ---- sidebar (keep the browser's search box + nav, filter links) --------
const sb = cut(src, '<div class="sidebar">', '<div class="content">').text;
const navStart = sb.indexOf('<nav>');
const navEnd = sb.indexOf('</nav>') + '</nav>'.length;
let nav = sb.slice(navStart, navEnd);
let firstKept = true;
nav = nav.replace(/<a href="#([^"]+)"[\s\S]*?<\/a>/g, function (m, id) {
  if (KEEP_SECTIONS.indexOf(id) === -1) return '';
  // the browser's CSS only shows .section.active — mark the default one
  if (firstKept) {
    firstKept = false;
    return m.replace('<a href="#' + id + '"', '<a href="#' + id + '" class="active"');
  }
  return m;
});
const sidebar = sb.slice(0, navStart) + nav + sb.slice(navEnd);

// ---- sections -------------------------------------------------------------
const secIds = [...src.matchAll(/<div id="([a-z-]+)" class="section">/g)].map(function (m) {
  return m[1];
});
function sectionSlice(id) {
  const start = src.indexOf('<div id="' + id + '" class="section">');
  if (start === -1) throw new Error('section missing: ' + id);
  const i = secIds.indexOf(id);
  let end = src.length;
  for (let j = i + 1; j < secIds.length; j++) {
    const p = src.indexOf('<div id="' + secIds[j] + '" class="section">');
    if (p > start) { end = p; break; }
  }
  return src.slice(start, end);
}
let secBlocker = sectionSlice('blocker');
let secSecurity = sectionSlice('security');
let secAbout = sectionSlice('about');

// about: fix the logo path (browser asset → extension icon), cut at the
// restart button (everything after the about cards is browser tail UI),
// then close the section div cleanly.
secAbout = secAbout.replace(/src="assets\/favicon\/icons1\.png"/, 'src="../icons/icon128.png"');
(function () {
  const rb = secAbout.indexOf('<button id="restart-button"');
  if (rb !== -1) secAbout = secAbout.slice(0, rb);
  secAbout = secAbout.replace(/[\s]+$/, '');
  // The browser's about section relies on parser auto-closing (its source
  // is unbalanced). Re-balance the slice so the section is self-contained.
  let opens = (secAbout.match(/<div\b/g) || []).length;
  let closes = (secAbout.match(/<\/div>/g) || []).length;
  while (closes > opens) { // strip surplus trailing closers
    secAbout = secAbout.replace(/<\/div>\s*$/, '');
    closes--;
  }
  while (opens > closes) { // close whatever is still open (incl. #about)
    secAbout += '\n            </div>';
    opens--;
  }
})();

// inside security: drop blocks that are pure browser features (DoH, Tor
// hardening CSP, SSL certificates manager). Cut by stable comment markers.
function cutBetween(s, fromMark, toMark) {
  const a = s.indexOf(fromMark);
  if (a === -1) return s;
  const b = s.indexOf(toMark, a);
  if (b === -1) return s.slice(0, a);
  return s.slice(0, a) + s.slice(b);
}
// DoH … up to Tor hardening header
secSecurity = cutBetween(secSecurity, '<!-- DNS-over-HTTPS -->',
  '<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border-color);">');
// … Tor hardening + SSL certs … up to the section close — cut from the Tor
// header to the LAST closing pair of the section.
(function () {
  const a = secSecurity.indexOf('<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border-color);">');
  if (a !== -1) {
    const closeIdx = secSecurity.lastIndexOf('</div>\n                </div>');
    if (closeIdx > a) secSecurity = secSecurity.slice(0, a) + secSecurity.slice(closeIdx);
  }
  // Re-balance after surgery: the browser markup relies on parser
  // auto-closing, so strip/append exactly the missing closers.
  let opens = (secSecurity.match(/<div\b/g) || []).length;
  let closes = (secSecurity.match(/<\/div>/g) || []).length;
  while (closes > opens) { secSecurity = secSecurity.replace(/<\/div>\s*$/, ''); closes--; }
  while (opens > closes) { secSecurity += '\n            </div>'; opens--; }
})();

// ---- tail (toast + extension scripts) --------------------------------------
const tail = [
  '',
  '    <!-- Toast notification (from the browser Settings) -->',
  '    <div id="toast" class="toast"></div>',
  '',
  '<script src="i18n-ext.js"></script>',
  '<script src="options-inline.js"></script>',
  '</body>',
  '</html>',
  '',
].join('\n');

const out = head + '\n<body class="theme-dark">\n\n    <div class="window">\n'
  + sidebar
  + '\n        <div class="content">\n'
  + '            ' + secBlocker.trim().replace('<div id="blocker" class="section">',
      '<div id="blocker" class="section active">')
  + '\n' + secSecurity.trim()
  + '\n' + secAbout.trim()
  + '\n        </div>\n    </div>\n'
  + tail;

// --- Брендинг и ссылки расширения (переживают регенерацию) --------------
// 1) «О StartPOZI» → «О StartPOZI Guard» (nav + заголовок секции)
// 2) «© 2026 StartPOZI Project» → «© 2026 StartPOZI»
// 3) «Поломки и баги» → репозиторий РАСШИРЕНИЯ, не браузера
// 4) убрать кнопку «Проверить обновления» из «О» (обновление списков
//    остаётся в разделе Blocker; версия обновляется вместе с расширением)
const outBranded = out
  .replace(/<h2>About StartPOZI<\/h2>/g, '<h2>About StartPOZI Guard</h2>')
  .replace(/(\n\s+)About StartPOZI(\n\s+<\/a>)/g, '$1About StartPOZI Guard$2')
  .replace(/© 2026 StartPOZI Project\. All rights reserved\./g,
    '© 2026 StartPOZI. All rights reserved.')
  .replace(/https:\/\/github\.com\/StartPOZI\/StartPOZI-Desktop-Browser-beta-\/issues/g,
    'https://github.com/StartPOZI/startpozi-privacy-extension/issues')
  .replace(/<div class="buttons-container"[^>]*>\s*<button[^>]*id="aboutCheckUpdate"[\s\S]*?<\/div>\s*<div id="aboutUpdateStatus"[^>]*><\/div>/, '');

fs.writeFileSync(path.join(ROOT, 'ui', 'options.html'), outBranded);

// NOTE: ui/popup-settings.css больше не генерируется — попап теперь
// ТОЧНАЯ копия панели #adblockPanel браузера и использует ui/popup.css
// (правила .adblock-panel / .ab-* дословно из style.css браузера).
console.log('ui/options.html written:',
  (out.length / 1024).toFixed(0) + ' KB',
  '| sections kept:', KEEP_SECTIONS.join(', '),
  '| sections dropped:', secIds.filter(function (s) {
    return KEEP_SECTIONS.indexOf(s) === -1 && s !== 'main';
  }).length);
if (out.indexOf('Settings-inline.js') !== -1) throw new Error('stale script reference!');
if (out.indexOf('assets/') !== -1) console.log('note: leftover assets/ refs:',
  (out.match(/assets\/[^\s"')]+/g) || []).slice(0, 5));
