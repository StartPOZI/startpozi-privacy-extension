// styles-probe.js — measure the RENDERED look (computed styles + geometry)
// of the extension UI vs the browser's own CSS expectations.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const XPI = path.join(ROOT, 'dist', 'startpozi-privacy-guard-firefox-v1.0.0.zip');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spz-probe-'));

class Marionette {
  connect(port) {
    return new Promise((resolve, reject) => {
      this.buf = ''; this.nextId = 0; this.pending = new Map();
      this.sock = net.connect(port, '127.0.0.1', () => resolve());
      this.sock.on('data', (d) => this._onData(d));
      this.sock.on('error', reject);
    });
  }
  _onData(d) {
    this.buf += d.toString('utf8');
    for (;;) {
      const colon = this.buf.indexOf(':');
      if (colon === -1) return;
      const len = parseInt(this.buf.slice(0, colon), 10);
      if (isNaN(len)) { this.buf = this.buf.slice(colon + 1); continue; }
      if (this.buf.length < colon + 1 + len) return;
      const payload = this.buf.substr(colon + 1, len);
      this.buf = this.buf.slice(colon + 1 + len);
      let msg = null;
      try { msg = JSON.parse(payload); } catch (e) { continue; }
      if (msg.applicationType) continue;
      if (Array.isArray(msg) && msg.length >= 3 && this.pending.has(msg[1])) {
        const { resolve, reject } = this.pending.get(msg[1]);
        this.pending.delete(msg[1]);
        if (msg[2]) reject(new Error(JSON.stringify(msg[2]).slice(0, 150)));
        else {
          const b = msg[3];
          resolve(b && typeof b === 'object' && !Array.isArray(b) && ('value' in b) ? b.value : b);
        }
      }
    }
  }
  send(name, params, ms) {
    const id = ++this.nextId;
    const msg = JSON.stringify([0, id, name, params || {}]);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(msg.length + ':' + msg);
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + name)); } }, ms || 20000);
    });
  }
}

const PROFILE = path.join(TMP, 'p');
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'user.js'),
  'user_pref("xpinstall.signatures.required", false);\n' +
  'user_pref("extensions.experiments.enabled", true);\n' +
  'user_pref("extensions.autoDisableScopes", 0);\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POPUP_PROBE = `
var out = {};
function cs(el, props) { if (!el) return null; var o = {};
  props.forEach(function(p){ o[p] = getComputedStyle(el).getPropertyValue(p); });
  var r = el.getBoundingClientRect(); o.w = Math.round(r.width); o.h = Math.round(r.height);
  return o; }
out.stylesheets = Array.from(document.styleSheets).map(function(s){ return (s.href||'inline').split('/').pop(); });
out.bodyFont = getComputedStyle(document.body).fontFamily.slice(0, 40);
out.bodyBgImage = getComputedStyle(document.body).backgroundImage.slice(0, 60);
out.card = cs(document.querySelector('.adblock-panel'), ['background-color','border-radius','border','width']);
out.statNum = cs(document.querySelector('.ab-stat-num'), ['color','font-size','font-weight']);
out.toggle = cs(document.querySelector('.ab-toggle'), ['width','height']);
out.toggleOn = cs(document.querySelector('.ab-toggle input:checked + .ab-slider'), ['background-color']);
out.btn = cs(document.querySelector('.ab-action-btn'), ['border-radius','color','font-size']);
out.rows = document.querySelectorAll('.ab-action-btn').length;
return JSON.stringify(out);`;

const OPTIONS_PROBE = `
var out = {};
function cs(el, props) { if (!el) return null; var o = {};
  props.forEach(function(p){ o[p] = getComputedStyle(el).getPropertyValue(p); });
  var r = el.getBoundingClientRect(); o.w = Math.round(r.width); o.h = Math.round(r.height);
  return o; }
out.stylesheets = Array.from(document.styleSheets).map(function(s){ return (s.href||'inline').split('/').pop(); });
out.bodyBg = getComputedStyle(document.body).backgroundColor;
out.bodyBgImage = getComputedStyle(document.body).backgroundImage.slice(0, 60);
out.window = cs(document.querySelector('.window'), ['display','flex-direction','height','width']);
out.sidebar = cs(document.querySelector('.sidebar'), ['width','background-color','backdrop-filter']);
out.navLink = cs(document.querySelector('.sidebar nav a'), ['color','font-size','padding','border-radius']);
out.navLinkActive = cs(document.querySelector('.sidebar nav a.active'), ['background-color','color']);
out.card = cs(document.querySelector('.content .card'), ['background-color','border-radius','padding','border']);
out.h2 = cs(document.querySelector('.content .section.active h2'), ['color','font-size','font-weight']);
out.toggle = cs(document.querySelector('.px-toggle-wrap'), ['width','height']);
out.toggleOn = cs(document.querySelector('#abSettingsToggle:checked + .px-toggle-track') || document.querySelector('.px-toggle-wrap input:checked + .px-toggle-track'), ['background-color']);
out.searchInput = cs(document.getElementById('settingsSearchInput'), ['background-color','color','border-radius']);
out.fhRow = cs(document.querySelector('.fh-row'), ['background-color','border','border-radius']);
out.contentPad = cs(document.querySelector('.content'), ['padding']);
return JSON.stringify(out);`;

(async function () {
  const ff = spawn('firefox', ['--headless', '--no-remote', '-marionette',
    '-remote-allow-system-access', '-profile', PROFILE, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  const m = new Marionette();
  for (let i = 0; i < 40; i++) { try { await m.connect(2828); break; } catch (e) { await sleep(500); } }
  await m.send('WebDriver:NewSession', { capabilities: {} });
  await m.send('Addon:Install', { path: XPI, temporary: true });
  await sleep(2500);
  let base = null;
  for (let i = 0; i < 20 && !base; i++) {
    await sleep(1000);
    for (const h of await m.send('WebDriver:GetWindowHandles')) {
      try {
        await m.send('WebDriver:SwitchToWindow', { handle: h, focus: false });
        const url = String(await m.send('WebDriver:GetCurrentURL'));
        const mm = url.match(/^(moz-extension:\/\/[0-9a-f-]+)\//);
        if (mm) { base = mm[1]; break; }
      } catch (e) {}
    }
  }
  if (!base) throw new Error('no extension tab');
  try { await m.send('WebDriver:SetWindowRect', { x: 0, y: 0, width: 1280, height: 900 }); } catch (e) {}

  await m.send('WebDriver:Navigate', { url: base + '/ui/popup.html' });
  await sleep(1800);
  console.log('=== POPUP ===');
  console.log(await m.send('WebDriver:ExecuteScript', { script: 'return (function(){' + POPUP_PROBE + '})()', args: [] }, 15000));

  await m.send('WebDriver:Navigate', { url: base + '/ui/options.html' });
  await sleep(2500);
  console.log('=== OPTIONS ===');
  console.log(await m.send('WebDriver:ExecuteScript', { script: 'return (function(){' + OPTIONS_PROBE + '})()', args: [] }, 15000));

  try { ff.kill('SIGKILL'); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
