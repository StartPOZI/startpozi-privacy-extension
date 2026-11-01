// shoot.js — screenshot the extension UI pages in headless Firefox via
// Marionette, so we can SEE what the user sees. Usage:
//   node tools/shoot.js   → /tmp/opencode/shots/*.png
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const XPI = path.join(ROOT, 'dist', 'startpozi-privacy-guard-firefox-v1.0.0.zip');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spz-shoot-'));
const PROFILE = path.join(TMP, 'profile');
const SHOTS = '/tmp/opencode/shots';

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
      if (msg.applicationType) continue; // greeting
      if (Array.isArray(msg) && msg.length >= 3 && this.pending.has(msg[1])) {
        const { resolve, reject } = this.pending.get(msg[1]);
        this.pending.delete(msg[1]);
        if (msg[2]) reject(new Error(JSON.stringify(msg[2]).slice(0, 200)));
        else {
          const body = msg[3];
          resolve(body && typeof body === 'object' && !Array.isArray(body) &&
            ('value' in body) ? body.value : body);
        }
      }
    }
  }
  send(name, params, timeoutMs) {
    const id = ++this.nextId;
    const msg = JSON.stringify([0, id, name, params || {}]);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(msg.length + ':' + msg);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id); reject(new Error('timeout: ' + name));
        }
      }, timeoutMs || 25000);
    });
  }
}

fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'user.js'), `
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.experiments.enabled", true);
user_pref("extensions.autoDisableScopes", 0);
user_pref("browser.shell.checkDefaultBrowser", false);
`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log('[shoot]', m);

(async function () {
  const ff = spawn('firefox', ['--headless', '--no-remote', '-marionette',
    '-remote-allow-system-access', '-profile', PROFILE, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  const m = new Marionette();
  for (let i = 0; i < 40; i++) {
    try { await m.connect(2828); break; } catch (e) { await sleep(500); }
  }
  await m.send('WebDriver:NewSession', { capabilities: {} });
  await m.send('Addon:Install', { path: XPI, temporary: true });
  await sleep(2500);
  // find the extension tab (welcome page auto-opened)
  let base = null, extHandle = null;
  for (let i = 0; i < 20 && !extHandle; i++) {
    await sleep(1000);
    for (const h of await m.send('WebDriver:GetWindowHandles')) {
      try {
        await m.send('WebDriver:SwitchToWindow', { handle: h, focus: false });
        const url = String(await m.send('WebDriver:GetCurrentURL'));
        const mm = url.match(/^(moz-extension:\/\/[0-9a-f-]+)\//);
        if (mm) { base = mm[1]; extHandle = h; break; }
      } catch (e) { /* gone */ }
    }
  }
  if (!base) throw new Error('no extension tab');
  log('base: ' + base);

  // resize the tab window for wide screenshots
  try { await m.send('WebDriver:SetWindowRect', { x: 0, y: 0, width: 1280, height: 900 }); }
  catch (e) { log('SetWindowRect: ' + e.message); }

  async function shot(page, name, settleMs) {
    await m.send('WebDriver:Navigate', { url: base + page });
    await sleep(settleMs || 2000);
    const b64 = await m.send('WebDriver:TakeScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(b64, 'base64'));
    log('✓ ' + name + '.png');
  }

  await shot('/ui/popup.html', 'popup', 1800);
  await shot('/ui/popup.html?lang=ru', 'popup-ru', 2500);
  await shot('/ui/options.html', 'options-blocker', 2500);
  await shot('/ui/options.html#security', 'options-security', 2500);
  await shot('/ui/options.html?lang=ru', 'options-ru', 3000);
  try { ff.kill('SIGKILL'); } catch (e) { }
  console.log('shots in', SHOTS);
  process.exit(0);
})().catch((e) => {
  console.error('SHOOT FAIL:', e.message);
  process.exit(1);
});
