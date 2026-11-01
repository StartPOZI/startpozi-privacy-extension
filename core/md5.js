// md5.js — pure-JS MD5 (RFC 1321), implemented with the standard
// per-step formulation. Round constants are GENERATED from
// T[i] = floor(2^32 * |sin(i)|) — no hand-typed tables to get wrong.
// Only used to verify ABP filter-list checksums (base64 md5); Web Crypto
// does not provide MD5.
'use strict';
(function (global) {
  const K = new Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  function rotl(x, c) { return ((x << c) | (x >>> (32 - c))) >>> 0; }

  function md5Words(str) {
    // UTF-8 bytes
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length &&
               str.charCodeAt(i + 1) >= 0xdc00 &&
               str.charCodeAt(i + 1) <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) +
          (str.charCodeAt(i + 1) - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }

    // Pad: 0x80, zeros, 64-bit little-endian bit length
    const bitLen = bytes.length * 8;
    const withPad = bytes.slice();
    withPad.push(0x80);
    while (withPad.length % 64 !== 56) withPad.push(0);
    // low 32 bits (inputs here are far below 2^32 bits) + high word 0
    for (let i = 0; i < 4; i++) withPad.push((bitLen >>> (8 * i)) & 0xff);
    withPad.push(0, 0, 0, 0);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    for (let off = 0; off < withPad.length; off += 64) {
      const M = new Array(16);
      for (let j = 0; j < 16; j++) {
        M[j] = ((withPad[off + j * 4]) | (withPad[off + j * 4 + 1] << 8) |
          (withPad[off + j * 4 + 2] << 16) | (withPad[off + j * 4 + 3] << 24)) >>> 0;
      }
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, S[i])) >>> 0;
      }
      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }
    return [a0, b0, c0, d0];
  }

  function wordsToBase64(words) {
    let bin = '';
    for (let w = 0; w < words.length; w++) {
      bin += String.fromCharCode(words[w] & 0xff, (words[w] >>> 8) & 0xff,
        (words[w] >>> 16) & 0xff, (words[w] >>> 24) & 0xff);
    }
    return btoa(bin);
  }

  function md5Base64(str) {
    return wordsToBase64(md5Words(str)).replace(/=+$/, '');
  }

  global.SPZ = global.SPZ || {};
  global.SPZ.MD5 = { md5Base64, md5Words };
})(typeof self !== 'undefined' ? self : this);
