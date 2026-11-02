// build.js — builds store-ready packages without any npm dependencies:
//   dist/chromium/  + startpozi-privacy-guard-chromium-v<ver>.zip
//   dist/firefox/   + startpozi-privacy-guard-firefox-v<ver>.zip   (AMO)
// The ROOT manifest.json IS the Firefox flavor (event page scripts +
// webRequestBlocking) — it loads in Firefox directly, unpacked.
// The Chromium flavor is derived: service worker + declarativeNetRequest
// static ruleset + contentSettings (webRequestBlocking is dropped —
// Chrome rejects it in MV3).
// ZIPs are STORE (uncompressed) — valid for CWS/AMO upload.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname + '/..';
const DIST = path.join(ROOT, 'dist');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;

// ---------------------------------------------------------------- zip (store)
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zip(files) {
  // files: [{name, data:Buffer}]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // UTF-8 flag
    local.writeUInt16LE(0, 8);         // method: store
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, f.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(f.data.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + f.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

// ---------------------------------------------------------------- zip (deflate)
const zlib = require('zlib');
function zipDeflated(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);        // UTF-8 flag
    local.writeUInt16LE(8, 8);             // method: deflate
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

// ---------------------------------------------------------------- tree walk
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.' || name === '..') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, base ? base + '/' + name : name, out);
    else out.push({ name: base ? base + '/' + name : name, path: p });
  }
  return out;
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of walk(src, '', [])) {
    const to = path.join(dst, f.name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, fs.readFileSync(f.path));
  }
}

// ---------------------------------------------------------------- flavors
const EXCLUDE_COMMON = [
  'dist', 'tools', 'node_modules', 'manifest.json', 'manifest.firefox.json',
  'README.md', '.git', 'ui/logo.png', 'ui/Settings.html',
  'AMO-LISTING.txt', '.gitignore',
];

// Chromium package: rebuild the background as a service worker, drop the
// Firefox-only webRequestBlocking (Chrome rejects it in MV3), drop the
// gecko block, and add the DNR static ruleset + contentSettings.
function chromiumManifest() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  m.background = { service_worker: 'background/background.js' };
  delete m.browser_specific_settings;
  m.permissions = m.permissions.filter(function (p) { return p !== 'webRequestBlocking'; });
  m.permissions.push('declarativeNetRequest', 'contentSettings');
  m.declarative_net_request = {
    rule_resources: [{ id: 'spz_builtin', enabled: true, path: 'rules/builtin.json' }],
  };
  return Buffer.from(JSON.stringify(m, null, 2));
}
// Opera package: Chromium flavor minus chrome_settings_overrides (Opera's
// validator rejects the search-provider override) and minus repo-only files.
function operaManifest() {
  const m = JSON.parse(chromiumManifest());
  delete m.chrome_settings_overrides;
  return Buffer.from(JSON.stringify(m, null, 2));
}
function firefoxManifest() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return Buffer.from(JSON.stringify(m, null, 2));
}

function buildFlavor(name, manifestSource, extraExclude) {
  const dir = path.join(DIST, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const files = [];
  for (const f of walk(ROOT, '', [])) {
    const top = f.name.split('/')[0];
    if (EXCLUDE_COMMON.indexOf(top) !== -1) continue;
    if ((extraExclude || []).indexOf(f.name) !== -1 ||
        (extraExclude || []).indexOf(top) !== -1) continue;
    files.push(f);
  }
  const manifestBuf = typeof manifestSource === 'function'
    ? manifestSource()
    : fs.readFileSync(path.join(ROOT, manifestSource));
  const fileList = files.map(function (f) {
    return { name: f.name, data: fs.readFileSync(f.path) };
  });
  fileList.push({ name: 'manifest.json', data: manifestBuf });
  copyDir(path.join(ROOT), dir);
  // remove excluded from the copied tree
  for (const ex of EXCLUDE_COMMON.concat(extraExclude || [])) {
    fs.rmSync(path.join(dir, ex), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifestBuf);
  const zipPath = path.join(DIST, 'startpozi-privacy-guard-' + name + '-v' + ver + '.zip');
  fs.writeFileSync(zipPath, zip(fileList));
  console.log('✓', name, '—', fileList.length, 'files →', path.relative(ROOT, zipPath));
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
buildFlavor('chromium', chromiumManifest, []);
buildFlavor('firefox', firefoxManifest, ['rules']); // DNR rulesets unused on Firefox
// Opera: Chromium flavor minus search-provider override; compressed upload zip
buildFlavor('opera', operaManifest, []);
(function () {
  const files = [];
  for (const f of walk(path.join(DIST, 'opera'), '', [])) {
    files.push({ name: f.name, data: fs.readFileSync(f.path) });
  }
  const zipPath = path.join(DIST, 'startpozi-privacy-guard-opera-v1.0.0.zip');
  fs.writeFileSync(zipPath, zipDeflated(files));
  console.log('✓ opera upload zip →', path.relative(ROOT, zipPath),
    (fs.statSync(zipPath).size / 1048576).toFixed(1) + ' MB (deflated)');
})();
console.log('done. v' + ver);
