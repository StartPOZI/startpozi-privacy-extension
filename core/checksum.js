// checksum.js — Adblock Plus list checksum verification.
// Ported from the StartPOZI Desktop Browser (lib/filter-checksum.js).
// The digest is computed over the list content with the checksum LINE
// removed (including its trailing newline), no outer trim; base64 is
// unpadded. Downloads whose checksum does not match are rejected and the
// cached copy is used instead — a truncated/tampered list never enters
// the engine.
'use strict';
(function (global) {
  // Returns: true (verified) / false (mismatch) / null (no checksum header).
  function verifyListChecksum(text) {
    if (typeof text !== 'string' || !text) return null;
    const m = text.match(/^[ \t]*![ \t]*Checksum:[ \t]*(\S+)[ \t]*\r?$/im);
    if (!m) return null;
    const body = text.replace(/^[ \t]*![ \t]*Checksum:[ \t]*\S+[ \t]*\r?\n?/im, '');
    const actual = global.SPZ.MD5.md5Base64(body);
    const expected = m[1].replace(/=+$/, '');
    return expected === actual;
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.Checksum = { verifyListChecksum };
})(typeof self !== 'undefined' ? self : this);
