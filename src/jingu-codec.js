(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JinGuCodec = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var SALT = new Uint8Array([0x02, 0x23, 0x7e, 0x7a, 0x9c, 0x7d, 0x62, 0x96]);
  var PASSWORD = 'MyPassword';
  var ITERATIONS = 1000;
  var MAX_SAVE_BYTES = 32 * 1024 * 1024;

  function fail(message) {
    throw new Error(message);
  }

  function assertBytes(value, name) {
    if (!(value instanceof Uint8Array)) fail(name + ' 값이 올바르지 않습니다.');
  }

  function isBytes(value) {
    return value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1);
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (isBytes(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    fail('바이트 배열이 필요합니다.');
  }

  function utf8Encode(text) {
    if (typeof text !== 'string') fail('문자열이 필요합니다.');
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 < text.length) {
          var low = text.charCodeAt(i + 1);
          if (low >= 0xDC00 && low <= 0xDFFF) {
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            i++;
          } else {
            code = 0xFFFD;
          }
        } else {
          code = 0xFFFD;
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        code = 0xFFFD;
      }
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 63));
      } else if (code < 0x10000) {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      } else {
        out.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    bytes = toBytes(bytes);
    var out = [];
    for (var i = 0; i < bytes.length;) {
      var b0 = bytes[i++];
      var code;
      if (b0 <= 0x7F) {
        code = b0;
      } else if (b0 >= 0xC2 && b0 <= 0xDF) {
        if (i >= bytes.length) fail('UTF-8 문자열이 올바르지 않습니다.');
        var b1 = bytes[i++];
        if ((b1 & 0xC0) !== 0x80) fail('UTF-8 문자열이 올바르지 않습니다.');
        code = ((b0 & 0x1F) << 6) | (b1 & 0x3F);
        if (code < 0x80) fail('UTF-8 문자열이 올바르지 않습니다.');
      } else if (b0 >= 0xE0 && b0 <= 0xEF) {
        if (i + 1 >= bytes.length) fail('UTF-8 문자열이 올바르지 않습니다.');
        var b1e = bytes[i++];
        var b2e = bytes[i++];
        if ((b1e & 0xC0) !== 0x80 || (b2e & 0xC0) !== 0x80) fail('UTF-8 문자열이 올바르지 않습니다.');
        code = ((b0 & 0x0F) << 12) | ((b1e & 0x3F) << 6) | (b2e & 0x3F);
        if (code < 0x800 || (code >= 0xD800 && code <= 0xDFFF)) fail('UTF-8 문자열이 올바르지 않습니다.');
      } else if (b0 >= 0xF0 && b0 <= 0xF4) {
        if (i + 2 >= bytes.length) fail('UTF-8 문자열이 올바르지 않습니다.');
        var b1f = bytes[i++];
        var b2f = bytes[i++];
        var b3f = bytes[i++];
        if ((b1f & 0xC0) !== 0x80 || (b2f & 0xC0) !== 0x80 || (b3f & 0xC0) !== 0x80) fail('UTF-8 문자열이 올바르지 않습니다.');
        code = ((b0 & 0x07) << 18) | ((b1f & 0x3F) << 12) | ((b2f & 0x3F) << 6) | (b3f & 0x3F);
        if (code < 0x10000 || code > 0x10FFFF) fail('UTF-8 문자열이 올바르지 않습니다.');
      } else {
        fail('UTF-8 문자열이 올바르지 않습니다.');
      }
      if (code <= 0xFFFF) {
        out.push(String.fromCharCode(code));
      } else {
        code -= 0x10000;
        out.push(String.fromCharCode(0xD800 + (code >> 10), 0xDC00 + (code & 1023)));
      }
    }
    return out.join('');
  }

  function sha1(data) {
    data = toBytes(data);
    var length = data.length;
    var blocks = ((length + 9 + 63) >> 6);
    var padded = new Uint8Array(blocks * 64);
    padded.set(data);
    padded[length] = 0x80;
    var bitHi = Math.floor(length / 536870912);
    var bitLo = ((length % 536870912) * 8) >>> 0;
    var end = blocks * 64;
    padded[end - 8] = (bitHi >>> 24) & 0xFF;
    padded[end - 7] = (bitHi >>> 16) & 0xFF;
    padded[end - 6] = (bitHi >>> 8) & 0xFF;
    padded[end - 5] = bitHi & 0xFF;
    padded[end - 4] = (bitLo >>> 24) & 0xFF;
    padded[end - 3] = (bitLo >>> 16) & 0xFF;
    padded[end - 2] = (bitLo >>> 8) & 0xFF;
    padded[end - 1] = bitLo & 0xFF;

    var h0 = 0x67452301;
    var h1 = 0xEFCDAB89;
    var h2 = 0x98BADCFE;
    var h3 = 0x10325476;
    var h4 = 0xC3D2E1F0;
    var w = new Uint32Array(80);

    for (var block = 0; block < end; block += 64) {
      for (var i = 0; i < 16; i++) {
        var p = block + i * 4;
        w[i] = ((padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3]) >>> 0;
      }
      for (i = 16; i < 80; i++) {
        var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = ((x << 1) | (x >>> 31)) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) {
          f = (b & c) | ((~b) & d);
          k = 0x5A827999;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ED9EBA1;
        } else if (i < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8F1BBCDC;
        } else {
          f = b ^ c ^ d;
          k = 0xCA62C1D6;
        }
        var t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d;
        d = c;
        c = ((b << 30) | (b >>> 2)) >>> 0;
        b = a;
        a = t;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
    }

    var out = new Uint8Array(20);
    var hs = [h0, h1, h2, h3, h4];
    for (i = 0; i < 5; i++) {
      out[i * 4] = (hs[i] >>> 24) & 0xFF;
      out[i * 4 + 1] = (hs[i] >>> 16) & 0xFF;
      out[i * 4 + 2] = (hs[i] >>> 8) & 0xFF;
      out[i * 4 + 3] = hs[i] & 0xFF;
    }
    return out;
  }

  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function hmacSha1(key, message) {
    key = toBytes(key);
    message = toBytes(message);
    if (key.length > 64) key = sha1(key);
    var ipad = new Uint8Array(64);
    var opad = new Uint8Array(64);
    for (var i = 0; i < 64; i++) {
      var k = i < key.length ? key[i] : 0;
      ipad[i] = k ^ 0x36;
      opad[i] = k ^ 0x5C;
    }
    return sha1(concatBytes(opad, sha1(concatBytes(ipad, message))));
  }

  function pbkdf2Sha1(password, salt, iterations, dkLen) {
    password = toBytes(password);
    salt = toBytes(salt);
    var hLen = 20;
    var l = Math.ceil(dkLen / hLen);
    var dk = new Uint8Array(dkLen);
    var block = new Uint8Array(salt.length + 4);
    block.set(salt);
    for (var i = 1; i <= l; i++) {
      block[salt.length] = (i >>> 24) & 0xFF;
      block[salt.length + 1] = (i >>> 16) & 0xFF;
      block[salt.length + 2] = (i >>> 8) & 0xFF;
      block[salt.length + 3] = i & 0xFF;
      var u = hmacSha1(password, block);
      var t = u.slice();
      for (var j = 1; j < iterations; j++) {
        u = hmacSha1(password, u);
        for (var k = 0; k < hLen; k++) t[k] ^= u[k];
      }
      var offset = (i - 1) * hLen;
      dk.set(t.subarray(0, Math.min(hLen, dkLen - offset)), offset);
    }
    return dk;
  }

  var aesSbox = null;
  var aesInvSbox = null;
  var aesTe0, aesTe1, aesTe2, aesTe3;
  var aesTd0, aesTd1, aesTd2, aesTd3;

  function xtime(x) {
    return ((x << 1) ^ ((x & 0x80) ? 0x1B : 0)) & 0xFF;
  }

  function gmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xFF;
      if (hi) a ^= 0x1B;
      b >>= 1;
    }
    return p;
  }

  function rotl8(x, n) {
    return ((x << n) | (x >>> (8 - n))) & 0xFF;
  }

  function initAes() {
    if (aesSbox) return;
    aesSbox = new Uint8Array(256);
    aesInvSbox = new Uint8Array(256);
    for (var i = 0; i < 256; i++) {
      var inv = i === 0 ? 0 : 0;
      if (i !== 0) {
        var p = 1;
        for (var j = 0; j < 254; j++) p = gmul(p, i);
        inv = p;
      }
      var s = inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63;
      aesSbox[i] = s & 0xFF;
      aesInvSbox[s & 0xFF] = i;
    }

    aesTe0 = new Uint32Array(256);
    aesTe1 = new Uint32Array(256);
    aesTe2 = new Uint32Array(256);
    aesTe3 = new Uint32Array(256);
    aesTd0 = new Uint32Array(256);
    aesTd1 = new Uint32Array(256);
    aesTd2 = new Uint32Array(256);
    aesTd3 = new Uint32Array(256);
    for (i = 0; i < 256; i++) {
      var x = aesSbox[i];
      var x2 = xtime(x);
      var x3 = x2 ^ x;
      var te0 = (x2 << 24) | (x << 16) | (x << 8) | x3;
      aesTe0[i] = te0 >>> 0;
      aesTe1[i] = ((te0 >>> 8) | (te0 << 24)) >>> 0;
      aesTe2[i] = ((te0 >>> 16) | (te0 << 16)) >>> 0;
      aesTe3[i] = ((te0 >>> 24) | (te0 << 8)) >>> 0;

      var y = aesInvSbox[i];
      var y9 = gmul(y, 9);
      var y11 = gmul(y, 11);
      var y13 = gmul(y, 13);
      var y14 = gmul(y, 14);
      var td0 = (y14 << 24) | (y9 << 16) | (y13 << 8) | y11;
      aesTd0[i] = td0 >>> 0;
      aesTd1[i] = ((td0 >>> 8) | (td0 << 24)) >>> 0;
      aesTd2[i] = ((td0 >>> 16) | (td0 << 16)) >>> 0;
      aesTd3[i] = ((td0 >>> 24) | (td0 << 8)) >>> 0;
    }
  }

  var rcon = new Uint8Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36]);

  function expandAes256Key(key) {
    initAes();
    if (key.length !== 32) fail('AES-256 키 길이가 올바르지 않습니다.');
    var nk = 8;
    var nr = 14;
    var expanded = new Uint8Array(240);
    expanded.set(key);
    var temp = new Uint8Array(4);
    var i = nk;
    while (i < 4 * (nr + 1)) {
      for (var j = 0; j < 4; j++) temp[j] = expanded[(i - 1) * 4 + j];
      if (i % nk === 0) {
        var t0 = temp[0];
        temp[0] = aesSbox[temp[1]] ^ rcon[i / nk];
        temp[1] = aesSbox[temp[2]];
        temp[2] = aesSbox[temp[3]];
        temp[3] = aesSbox[t0];
      } else if (i % nk === 4) {
        for (j = 0; j < 4; j++) temp[j] = aesSbox[temp[j]];
      }
      for (j = 0; j < 4; j++) expanded[i * 4 + j] = expanded[(i - nk) * 4 + j] ^ temp[j];
      i++;
    }
    return expanded;
  }

  function aesEncryptBlock(block, key) {
    initAes();
    var rk = (key && key.length === 240) ? key : expandAes256Key(key);
    var s0 = ((block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3]) >>> 0;
    var s1 = ((block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7]) >>> 0;
    var s2 = ((block[8] << 24) | (block[9] << 16) | (block[10] << 8) | block[11]) >>> 0;
    var s3 = ((block[12] << 24) | (block[13] << 16) | (block[14] << 8) | block[15]) >>> 0;
    var k0 = ((rk[0] << 24) | (rk[1] << 16) | (rk[2] << 8) | rk[3]) >>> 0;
    var k1 = ((rk[4] << 24) | (rk[5] << 16) | (rk[6] << 8) | rk[7]) >>> 0;
    var k2 = ((rk[8] << 24) | (rk[9] << 16) | (rk[10] << 8) | rk[11]) >>> 0;
    var k3 = ((rk[12] << 24) | (rk[13] << 16) | (rk[14] << 8) | rk[15]) >>> 0;
    s0 ^= k0; s1 ^= k1; s2 ^= k2; s3 ^= k3;
    var t0, t1, t2, t3, round = 0;
    for (round = 1; round < 14; round++) {
      var r = round * 16;
      t0 = aesTe0[(s0 >>> 24) & 0xFF] ^ aesTe1[(s1 >>> 16) & 0xFF] ^ aesTe2[(s2 >>> 8) & 0xFF] ^ aesTe3[s3 & 0xFF] ^ (((rk[r] << 24) | (rk[r + 1] << 16) | (rk[r + 2] << 8) | rk[r + 3]) >>> 0);
      t1 = aesTe0[(s1 >>> 24) & 0xFF] ^ aesTe1[(s2 >>> 16) & 0xFF] ^ aesTe2[(s3 >>> 8) & 0xFF] ^ aesTe3[s0 & 0xFF] ^ (((rk[r + 4] << 24) | (rk[r + 5] << 16) | (rk[r + 6] << 8) | rk[r + 7]) >>> 0);
      t2 = aesTe0[(s2 >>> 24) & 0xFF] ^ aesTe1[(s3 >>> 16) & 0xFF] ^ aesTe2[(s0 >>> 8) & 0xFF] ^ aesTe3[s1 & 0xFF] ^ (((rk[r + 8] << 24) | (rk[r + 9] << 16) | (rk[r + 10] << 8) | rk[r + 11]) >>> 0);
      t3 = aesTe0[(s3 >>> 24) & 0xFF] ^ aesTe1[(s0 >>> 16) & 0xFF] ^ aesTe2[(s1 >>> 8) & 0xFF] ^ aesTe3[s2 & 0xFF] ^ (((rk[r + 12] << 24) | (rk[r + 13] << 16) | (rk[r + 14] << 8) | rk[r + 15]) >>> 0);
      s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    }
    var r14 = 14 * 16;
    t0 = (((aesSbox[(s0 >>> 24) & 0xFF] << 24) | (aesSbox[(s1 >>> 16) & 0xFF] << 16) | (aesSbox[(s2 >>> 8) & 0xFF] << 8) | aesSbox[s3 & 0xFF]) >>> 0) ^ (((rk[r14] << 24) | (rk[r14 + 1] << 16) | (rk[r14 + 2] << 8) | rk[r14 + 3]) >>> 0);
    t1 = (((aesSbox[(s1 >>> 24) & 0xFF] << 24) | (aesSbox[(s2 >>> 16) & 0xFF] << 16) | (aesSbox[(s3 >>> 8) & 0xFF] << 8) | aesSbox[s0 & 0xFF]) >>> 0) ^ (((rk[r14 + 4] << 24) | (rk[r14 + 5] << 16) | (rk[r14 + 6] << 8) | rk[r14 + 7]) >>> 0);
    t2 = (((aesSbox[(s2 >>> 24) & 0xFF] << 24) | (aesSbox[(s3 >>> 16) & 0xFF] << 16) | (aesSbox[(s0 >>> 8) & 0xFF] << 8) | aesSbox[s1 & 0xFF]) >>> 0) ^ (((rk[r14 + 8] << 24) | (rk[r14 + 9] << 16) | (rk[r14 + 10] << 8) | rk[r14 + 11]) >>> 0);
    t3 = (((aesSbox[(s3 >>> 24) & 0xFF] << 24) | (aesSbox[(s0 >>> 16) & 0xFF] << 16) | (aesSbox[(s1 >>> 8) & 0xFF] << 8) | aesSbox[s2 & 0xFF]) >>> 0) ^ (((rk[r14 + 12] << 24) | (rk[r14 + 13] << 16) | (rk[r14 + 14] << 8) | rk[r14 + 15]) >>> 0);
    var out = new Uint8Array(16);
    out[0] = t0 >>> 24; out[1] = (t0 >>> 16) & 0xFF; out[2] = (t0 >>> 8) & 0xFF; out[3] = t0 & 0xFF;
    out[4] = t1 >>> 24; out[5] = (t1 >>> 16) & 0xFF; out[6] = (t1 >>> 8) & 0xFF; out[7] = t1 & 0xFF;
    out[8] = t2 >>> 24; out[9] = (t2 >>> 16) & 0xFF; out[10] = (t2 >>> 8) & 0xFF; out[11] = t2 & 0xFF;
    out[12] = t3 >>> 24; out[13] = (t3 >>> 16) & 0xFF; out[14] = (t3 >>> 8) & 0xFF; out[15] = t3 & 0xFF;
    return out;
  }

  function aesDecryptBlock(block, key) {
    initAes();
    var rk = (key && key.length === 240) ? key : expandAes256Key(key);
    var state = new Uint8Array(16);
    var i;
    for (i = 0; i < 16; i++) state[i] = block[i] ^ rk[14 * 16 + i];
    for (var round = 13; round >= 0; round--) {
      var s = new Uint8Array(16);
      for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) {
          s[((c + r) % 4) * 4 + r] = aesInvSbox[state[c * 4 + r]];
        }
      }
      var rOff = round * 16;
      for (i = 0; i < 16; i++) s[i] ^= rk[rOff + i];
      if (round !== 0) {
        var t = new Uint8Array(16);
        for (var col = 0; col < 4; col++) {
          var p = col * 4;
          var a0 = s[p], a1 = s[p + 1], a2 = s[p + 2], a3 = s[p + 3];
          t[p]     = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
          t[p + 1] = gmul(a0, 9)  ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
          t[p + 2] = gmul(a0, 13) ^ gmul(a1, 9)  ^ gmul(a2, 14) ^ gmul(a3, 11);
          t[p + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9)  ^ gmul(a3, 14);
        }
        state = t;
      } else {
        state = s;
      }
    }
    return state;
  }

  var derived = null;
  function deriveKeyIv() {
    if (derived) return derived;
    var dk = pbkdf2Sha1(utf8Encode(PASSWORD), SALT, ITERATIONS, 48);
    var key = dk.subarray(0, 32);
    derived = {
      key: key,
      iv: dk.subarray(32, 48),
      roundKeys: expandAes256Key(key)
    };
    return derived;
  }

  function encryptBytes(data) {
    data = toBytes(data);
    if (data.length > MAX_SAVE_BYTES) fail('저장 파일이 너무 큽니다.');
    var k = deriveKeyIv();
    var pad = 16 - (data.length % 16);
    var padded = new Uint8Array(data.length + pad);
    padded.set(data);
    for (var i = data.length; i < padded.length; i++) padded[i] = pad;
    var out = new Uint8Array(padded.length);
    var prev = new Uint8Array(16);
    prev.set(k.iv);
    for (var offset = 0; offset < padded.length; offset += 16) {
      var block = new Uint8Array(16);
      for (var j = 0; j < 16; j++) block[j] = padded[offset + j] ^ prev[j];
      var enc = aesEncryptBlock(block, k.roundKeys);
      out.set(enc, offset);
      prev = enc;
    }
    return out;
  }

  function decryptBytes(data) {
    data = toBytes(data);
    if (data.length > MAX_SAVE_BYTES + 16) fail('저장 파일이 너무 큽니다.');
    if (data.length === 0 || data.length % 16 !== 0) fail('암호화 데이터 길이가 올바르지 않습니다.');
    var k = deriveKeyIv();
    var out = new Uint8Array(data.length);
    var prev = new Uint8Array(16);
    prev.set(k.iv);
    for (var offset = 0; offset < data.length; offset += 16) {
      var enc = data.subarray(offset, offset + 16);
      var dec = aesDecryptBlock(enc, k.roundKeys);
      for (var j = 0; j < 16; j++) out[offset + j] = dec[j] ^ prev[j];
      prev = enc;
    }
    var pad = out[out.length - 1];
    if (pad < 1 || pad > 16 || pad > out.length) fail('패딩이 올바르지 않습니다.');
    for (var p = out.length - pad; p < out.length; p++) {
      if (out[p] !== pad) fail('패딩이 올바르지 않습니다.');
    }
    return out.subarray(0, out.length - pad);
  }

  function encryptJsonText(text) {
    if (typeof text !== 'string') fail('문자열이 필요합니다.');
    return encryptBytes(utf8Encode(text));
  }

  function decryptToJsonText(data) {
    var dec = decryptBytes(data);
    return utf8Decode(dec);
  }

  function parseJsonAst(text) {
    if (typeof text !== 'string') fail('JSON 문자열이 필요합니다.');
    var i = 0;
    var len = text.length;

    function error(message) {
      throw new Error(message + ' (위치 ' + i + ')');
    }

    function skipWs() {
      while (i < len) {
        var c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) i++;
        else break;
      }
    }

    function parseString() {
      if (text.charCodeAt(i) !== 0x22) error('JSON 문자열이 올바르지 않습니다.');
      i++;
      var out = '';
      while (i < len) {
        var c = text.charCodeAt(i++);
        if (c === 0x22) return out;
        if (c < 0x20) error('JSON 문자열이 올바르지 않습니다.');
        if (c === 0x5C) {
          if (i >= len) error('JSON 문자열이 올바르지 않습니다.');
          var e = text.charCodeAt(i++);
          if (e === 0x22) out += '"';
          else if (e === 0x5C) out += '\\';
          else if (e === 0x2F) out += '/';
          else if (e === 0x62) out += '\b';
          else if (e === 0x66) out += '\f';
          else if (e === 0x6E) out += '\n';
          else if (e === 0x72) out += '\r';
          else if (e === 0x74) out += '\t';
          else if (e === 0x75) {
            if (i + 4 > len) error('JSON 문자열이 올바르지 않습니다.');
            var hex = text.slice(i, i + 4);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) error('JSON 문자열이 올바르지 않습니다.');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            error('JSON 문자열이 올바르지 않습니다.');
          }
        } else {
          out += String.fromCharCode(c);
        }
      }
      error('JSON 문자열이 올바르지 않습니다.');
    }

    function parseNumber() {
      var start = i;
      if (text.charCodeAt(i) === 0x2D) i++;
      if (i >= len) error('JSON 숫자가 올바르지 않습니다.');
      if (text.charCodeAt(i) === 0x30) {
        i++;
        if (i < len && /[0-9]/.test(text.charAt(i))) error('JSON 숫자가 올바르지 않습니다.');
      } else if (text.charCodeAt(i) >= 0x31 && text.charCodeAt(i) <= 0x39) {
        while (i < len && /[0-9]/.test(text.charAt(i))) i++;
      } else {
        error('JSON 숫자가 올바르지 않습니다.');
      }
      var isInt = true;
      if (i < len && text.charCodeAt(i) === 0x2E) {
        isInt = false;
        i++;
        if (i >= len || !/[0-9]/.test(text.charAt(i))) error('JSON 숫자가 올바르지 않습니다.');
        while (i < len && /[0-9]/.test(text.charAt(i))) i++;
      }
      if (i < len && (text.charCodeAt(i) === 0x65 || text.charCodeAt(i) === 0x45)) {
        isInt = false;
        i++;
        if (i < len && (text.charCodeAt(i) === 0x2B || text.charCodeAt(i) === 0x2D)) i++;
        if (i >= len || !/[0-9]/.test(text.charAt(i))) error('JSON 숫자가 올바르지 않습니다.');
        while (i < len && /[0-9]/.test(text.charAt(i))) i++;
      }
      return makeNum(text.slice(start, i), isInt);
    }

    function parseValue() {
      skipWs();
      if (i >= len) error('JSON 값이 올바르지 않습니다.');
      var c = text.charCodeAt(i);
      if (c === 0x7B) return parseObject();
      if (c === 0x5B) return parseArray();
      if (c === 0x22) return parseString();
      if (c === 0x74) {
        if (text.slice(i, i + 4) !== 'true') error('JSON 값이 올바르지 않습니다.');
        i += 4;
        return true;
      }
      if (c === 0x66) {
        if (text.slice(i, i + 5) !== 'false') error('JSON 값이 올바르지 않습니다.');
        i += 5;
        return false;
      }
      if (c === 0x6E) {
        if (text.slice(i, i + 4) !== 'null') error('JSON 값이 올바르지 않습니다.');
        i += 4;
        return null;
      }
      if (c === 0x2D || (c >= 0x30 && c <= 0x39)) return parseNumber();
      error('JSON 값이 올바르지 않습니다.');
    }

    function parseObject() {
      i++;
      var entries = [];
      skipWs();
      if (i < len && text.charCodeAt(i) === 0x7D) {
        i++;
        return makeObj(entries);
      }
      while (i < len) {
        skipWs();
        var key = parseString();
        skipWs();
        if (i >= len || text.charCodeAt(i) !== 0x3A) error('JSON 객체가 올바르지 않습니다.');
        i++;
        var value = parseValue();
        entries.push([key, value]);
        skipWs();
        if (i >= len) error('JSON 객체가 올바르지 않습니다.');
        var c = text.charCodeAt(i++);
        if (c === 0x7D) return makeObj(entries);
        if (c !== 0x2C) error('JSON 객체가 올바르지 않습니다.');
      }
      error('JSON 객체가 올바르지 않습니다.');
    }

    function parseArray() {
      i++;
      var arr = [];
      skipWs();
      if (i < len && text.charCodeAt(i) === 0x5D) {
        i++;
        return arr;
      }
      while (i < len) {
        arr.push(parseValue());
        skipWs();
        if (i >= len) error('JSON 배열이 올바르지 않습니다.');
        var c = text.charCodeAt(i++);
        if (c === 0x5D) return arr;
        if (c !== 0x2C) error('JSON 배열이 올바르지 않습니다.');
      }
      error('JSON 배열이 올바르지 않습니다.');
    }

    var result = parseValue();
    skipWs();
    if (i !== len) error('JSON 뒤에 불필요한 문자가 있습니다.');
    return result;
  }

  function escapeJsonString(value) {
    var out = '"';
    for (var i = 0; i < value.length; i++) {
      var c = value.charCodeAt(i);
      if (c === 0x22) out += '\\"';
      else if (c === 0x5C) out += '\\\\';
      else if (c === 0x08) out += '\\b';
      else if (c === 0x0C) out += '\\f';
      else if (c === 0x0A) out += '\\n';
      else if (c === 0x0D) out += '\\r';
      else if (c === 0x09) out += '\\t';
      else if (c < 0x20) out += '\\u' + ('0000' + c.toString(16)).slice(-4);
      else out += value.charAt(i);
    }
    return out + '"';
  }

  function stringifyJsonAst(ast) {
    function write(value) {
      if (isJgObj(value)) {
        var parts = [];
        for (var i = 0; i < value.entries.length; i++) {
          parts.push(escapeJsonString(String(value.entries[i][0])) + ':' + write(value.entries[i][1]));
        }
        return '{' + parts.join(',') + '}';
      }
      if (isJgNum(value)) {
        if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value.raw)) fail('JSON 숫자가 올바르지 않습니다.');
        return value.raw;
      }
      if (Array.isArray(value)) {
        var items = [];
        for (var j = 0; j < value.length; j++) items.push(write(value[j]));
        return '[' + items.join(',') + ']';
      }
      if (value === null) return 'null';
      if (value === true) return 'true';
      if (value === false) return 'false';
      if (typeof value === 'string') return escapeJsonString(value);
      if (typeof value === 'number' && isFinite(value)) return String(value);
      fail('JSON AST 값이 올바르지 않습니다.');
    }
    return write(ast);
  }

  function isJgObj(value) {
    return !!(value && typeof value === 'object' && value.__jgObj === true && Array.isArray(value.entries));
  }

  function isJgNum(value) {
    return !!(value && typeof value === 'object' && value.__jgNum === true && typeof value.raw === 'string');
  }

  function makeObj(entries) {
    if (!Array.isArray(entries)) fail('객체 항목이 올바르지 않습니다.');
    return { __jgObj: true, entries: entries };
  }

  function makeNum(raw, isInt) {
    if (typeof raw !== 'string') raw = String(raw);
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) fail('JSON 숫자가 올바르지 않습니다.');
    return { __jgNum: true, raw: raw, isInt: isInt === undefined ? raw.indexOf('.') < 0 && raw.indexOf('e') < 0 && raw.indexOf('E') < 0 : !!isInt };
  }

  function numRaw(value) {
    if (!isJgNum(value)) fail('JinGu 숫자가 아닙니다.');
    return value.raw;
  }

  function numValue(value) {
    if (!isJgNum(value)) fail('JinGu 숫자가 아닙니다.');
    return Number(value.raw);
  }

  function numBigInt(value) {
    if (!isJgNum(value)) fail('JinGu 숫자가 아닙니다.');
    if (typeof BigInt !== 'function') fail('BigInt를 지원하지 않습니다.');
    if (/[.eE]/.test(value.raw)) fail('정수 숫자가 아닙니다.');
    return BigInt(value.raw);
  }

  function objHas(obj, key) {
    if (!isJgObj(obj)) return false;
    for (var i = 0; i < obj.entries.length; i++) if (obj.entries[i][0] === key) return true;
    return false;
  }

  function objGet(obj, key, fallback) {
    if (!isJgObj(obj)) return fallback;
    for (var i = 0; i < obj.entries.length; i++) if (obj.entries[i][0] === key) return obj.entries[i][1];
    return fallback;
  }

  function objSet(obj, key, value) {
    if (!isJgObj(obj)) fail('JinGu 객체가 아닙니다.');
    for (var i = 0; i < obj.entries.length; i++) {
      if (obj.entries[i][0] === key) {
        obj.entries[i][1] = value;
        return obj;
      }
    }
    obj.entries.push([key, value]);
    return obj;
  }

  function objDelete(obj, key) {
    if (!isJgObj(obj)) return false;
    for (var i = 0; i < obj.entries.length; i++) {
      if (obj.entries[i][0] === key) {
        obj.entries.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function objKeys(obj) {
    if (!isJgObj(obj)) return [];
    var keys = [];
    for (var i = 0; i < obj.entries.length; i++) keys.push(obj.entries[i][0]);
    return keys;
  }

  function toPlainJs(value) {
    if (isJgObj(value)) {
      var result = {};
      for (var i = 0; i < value.entries.length; i++) {
        var key = value.entries[i][0];
        if (key === '__proto__') Object.defineProperty(result, key, { value: toPlainJs(value.entries[i][1]), enumerable: true, configurable: true, writable: true });
        else result[key] = toPlainJs(value.entries[i][1]);
      }
      return result;
    }
    if (isJgNum(value)) return numValue(value);
    if (Array.isArray(value)) {
      var arr = [];
      for (var j = 0; j < value.length; j++) arr.push(toPlainJs(value[j]));
      return arr;
    }
    return value;
  }

  function detectSaveKind(ast) {
    if (isJgObj(ast)) {
      var hasGuide = objHas(ast, 'm_guideHash');
      var hasAchieve = objHas(ast, 'm_achieveHash');
      var hasSaveTime = objHas(ast, 'm_saveTime');
      var hasEquips = objHas(ast, 'm_equips');
      var hasEffect = objHas(ast, 'm_effectDic');
      var hasItem = objHas(ast, 'm_itemDic');
      if (hasGuide && hasAchieve && !hasSaveTime) return 'global';
      if (hasEquips && hasEffect && hasItem) return 'save';
    }
    fail('지원하지 않는 저장 파일 형식입니다.');
  }

  function decodeSaveBytes(bytes) {
    var text = decryptToJsonText(bytes);
    var ast = parseJsonAst(text);
    var kind = detectSaveKind(ast);
    return { kind: kind, ast: ast, jsonText: text };
  }

  function encodeSaveAst(ast) {
    var text = stringifyJsonAst(ast);
    return encryptJsonText(text);
  }

  return {
    SALT: SALT,
    PASSWORD: PASSWORD,
    ITERATIONS: ITERATIONS,
    MAX_SAVE_BYTES: MAX_SAVE_BYTES,
    deriveKeyIv: deriveKeyIv,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
    encryptJsonText: encryptJsonText,
    decryptToJsonText: decryptToJsonText,
    parseJsonAst: parseJsonAst,
    stringifyJsonAst: stringifyJsonAst,
    decodeSaveBytes: decodeSaveBytes,
    encodeSaveAst: encodeSaveAst,
    detectSaveKind: detectSaveKind,
    isJgObj: isJgObj,
    isJgNum: isJgNum,
    makeObj: makeObj,
    makeNum: makeNum,
    numValue: numValue,
    numRaw: numRaw,
    numBigInt: numBigInt,
    objHas: objHas,
    objGet: objGet,
    objSet: objSet,
    objDelete: objDelete,
    objKeys: objKeys,
    toPlainJs: toPlainJs,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode
  };
});
