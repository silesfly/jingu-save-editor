#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import base64
from collections import OrderedDict
import datetime
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
from urllib.parse import parse_qs, urlparse
import webbrowser

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

_WRITE_LOCK = threading.Lock()

APP_NAME = "금고군협전 세이브 에디터"
APP_VERSION = "1.0"
MAX_SAVE_BYTES = 32 * 1024 * 1024
MAX_HTTP_JSON_BYTES = 48 * 1024 * 1024
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18780
TOKEN_HEADER = "X-JinGu-Token"
SALT = bytes([0x02, 0x23, 0x7e, 0x7a, 0x9c, 0x7d, 0x62, 0x96])
PASSWORD = b"MyPassword"
ITERATIONS = 1000

RESERVED_DEVICE_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}

SBOX = (
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
)

INV_SBOX = (
    0x52, 0x09, 0x6A, 0xD5, 0x30, 0x36, 0xA5, 0x38, 0xBF, 0x40, 0xA3, 0x9E, 0x81, 0xF3, 0xD7, 0xFB,
    0x7C, 0xE3, 0x39, 0x82, 0x9B, 0x2F, 0xFF, 0x87, 0x34, 0x8E, 0x43, 0x44, 0xC4, 0xDE, 0xE9, 0xCB,
    0x54, 0x7B, 0x94, 0x32, 0xA6, 0xC2, 0x23, 0x3D, 0xEE, 0x4C, 0x95, 0x0B, 0x42, 0xFA, 0xC3, 0x4E,
    0x08, 0x2E, 0xA1, 0x66, 0x28, 0xD9, 0x24, 0xB2, 0x76, 0x5B, 0xA2, 0x49, 0x6D, 0x8B, 0xD1, 0x25,
    0x72, 0xF8, 0xF6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xD4, 0xA4, 0x5C, 0xCC, 0x5D, 0x65, 0xB6, 0x92,
    0x6C, 0x70, 0x48, 0x50, 0xFD, 0xED, 0xB9, 0xDA, 0x5E, 0x15, 0x46, 0x57, 0xA7, 0x8D, 0x9D, 0x84,
    0x90, 0xD8, 0xAB, 0x00, 0x8C, 0xBC, 0xD3, 0x0A, 0xF7, 0xE4, 0x58, 0x05, 0xB8, 0xB3, 0x45, 0x06,
    0xD0, 0x2C, 0x1E, 0x8F, 0xCA, 0x3F, 0x0F, 0x02, 0xC1, 0xAF, 0xBD, 0x03, 0x01, 0x13, 0x8A, 0x6B,
    0x3A, 0x91, 0x11, 0x41, 0x4F, 0x67, 0xDC, 0xEA, 0x97, 0xF2, 0xCF, 0xCE, 0xF0, 0xB4, 0xE6, 0x73,
    0x96, 0xAC, 0x74, 0x22, 0xE7, 0xAD, 0x35, 0x85, 0xE2, 0xF9, 0x37, 0xE8, 0x1C, 0x75, 0xDF, 0x6E,
    0x47, 0xF1, 0x1A, 0x71, 0x1D, 0x29, 0xC5, 0x89, 0x6F, 0xB7, 0x62, 0x0E, 0xAA, 0x18, 0xBE, 0x1B,
    0xFC, 0x56, 0x3E, 0x4B, 0xC6, 0xD2, 0x79, 0x20, 0x9A, 0xDB, 0xC0, 0xFE, 0x78, 0xCD, 0x5A, 0xF4,
    0x1F, 0xDD, 0xA8, 0x33, 0x88, 0x07, 0xC7, 0x31, 0xB1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xEC, 0x5F,
    0x60, 0x51, 0x7F, 0xA9, 0x19, 0xB5, 0x4A, 0x0D, 0x2D, 0xE5, 0x7A, 0x9F, 0x93, 0xC9, 0x9C, 0xEF,
    0xA0, 0xE0, 0x3B, 0x4D, 0xAE, 0x2A, 0xF5, 0xB0, 0xC8, 0xEB, 0xBB, 0x3C, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2B, 0x04, 0x7E, 0xBA, 0x77, 0xD6, 0x26, 0xE1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0C, 0x7D,
)

RCON = (
    0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40,
    0x80, 0x1B, 0x36, 0x6C, 0xD8, 0xAB, 0x4D, 0x9A,
)


def _gf_mul(a: int, b: int) -> int:
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x1B
        b >>= 1
    return p


MUL2 = tuple(_gf_mul(i, 2) for i in range(256))
MUL3 = tuple(_gf_mul(i, 3) for i in range(256))
MUL9 = tuple(_gf_mul(i, 9) for i in range(256))
MUL11 = tuple(_gf_mul(i, 11) for i in range(256))
MUL13 = tuple(_gf_mul(i, 13) for i in range(256))
MUL14 = tuple(_gf_mul(i, 14) for i in range(256))


class AES256CBC:
    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("AES-256 키 길이는 32바이트여야 합니다.")
        self.round_keys = self._expand_key(key)

    @staticmethod
    def _expand_key(key: bytes) -> list:
        w = [0] * 60
        for i in range(8):
            w[i] = (
                (key[4 * i] << 24)
                | (key[4 * i + 1] << 16)
                | (key[4 * i + 2] << 8)
                | key[4 * i + 3]
            )
        for i in range(8, 60):
            temp = w[i - 1]
            if i % 8 == 0:
                temp = ((temp << 8) & 0xFFFFFFFF) | (temp >> 24)
                temp = (
                    (SBOX[(temp >> 24) & 0xFF] << 24)
                    | (SBOX[(temp >> 16) & 0xFF] << 16)
                    | (SBOX[(temp >> 8) & 0xFF] << 8)
                    | SBOX[temp & 0xFF]
                )
                temp ^= RCON[i // 8] << 24
            elif i % 8 == 4:
                temp = (
                    (SBOX[(temp >> 24) & 0xFF] << 24)
                    | (SBOX[(temp >> 16) & 0xFF] << 16)
                    | (SBOX[(temp >> 8) & 0xFF] << 8)
                    | SBOX[temp & 0xFF]
                )
            w[i] = w[i - 8] ^ temp

        rkeys = []
        for r in range(15):
            rk = bytearray(16)
            for c in range(4):
                word = w[r * 4 + c]
                rk[4 * c] = (word >> 24) & 0xFF
                rk[4 * c + 1] = (word >> 16) & 0xFF
                rk[4 * c + 2] = (word >> 8) & 0xFF
                rk[4 * c + 3] = word & 0xFF
            rkeys.append(bytes(rk))
        return rkeys

    def _encrypt_block(self, block: bytes) -> bytes:
        rkeys = self.round_keys
        rk0 = rkeys[0]
        s = [block[i] ^ rk0[i] for i in range(16)]

        for r in range(1, 14):
            rk = rkeys[r]
            t0 = SBOX[s[0]]
            t1 = SBOX[s[5]]
            t2 = SBOX[s[10]]
            t3 = SBOX[s[15]]
            c0 = MUL2[t0] ^ MUL3[t1] ^ t2 ^ t3 ^ rk[0]
            c1 = t0 ^ MUL2[t1] ^ MUL3[t2] ^ t3 ^ rk[1]
            c2 = t0 ^ t1 ^ MUL2[t2] ^ MUL3[t3] ^ rk[2]
            c3 = MUL3[t0] ^ t1 ^ t2 ^ MUL2[t3] ^ rk[3]

            t0 = SBOX[s[4]]
            t1 = SBOX[s[9]]
            t2 = SBOX[s[14]]
            t3 = SBOX[s[3]]
            c4 = MUL2[t0] ^ MUL3[t1] ^ t2 ^ t3 ^ rk[4]
            c5 = t0 ^ MUL2[t1] ^ MUL3[t2] ^ t3 ^ rk[5]
            c6 = t0 ^ t1 ^ MUL2[t2] ^ MUL3[t3] ^ rk[6]
            c7 = MUL3[t0] ^ t1 ^ t2 ^ MUL2[t3] ^ rk[7]

            t0 = SBOX[s[8]]
            t1 = SBOX[s[13]]
            t2 = SBOX[s[2]]
            t3 = SBOX[s[7]]
            c8 = MUL2[t0] ^ MUL3[t1] ^ t2 ^ t3 ^ rk[8]
            c9 = t0 ^ MUL2[t1] ^ MUL3[t2] ^ t3 ^ rk[9]
            c10 = t0 ^ t1 ^ MUL2[t2] ^ MUL3[t3] ^ rk[10]
            c11 = MUL3[t0] ^ t1 ^ t2 ^ MUL2[t3] ^ rk[11]

            t0 = SBOX[s[12]]
            t1 = SBOX[s[1]]
            t2 = SBOX[s[6]]
            t3 = SBOX[s[11]]
            c12 = MUL2[t0] ^ MUL3[t1] ^ t2 ^ t3 ^ rk[12]
            c13 = t0 ^ MUL2[t1] ^ MUL3[t2] ^ t3 ^ rk[13]
            c14 = t0 ^ t1 ^ MUL2[t2] ^ MUL3[t3] ^ rk[14]
            c15 = MUL3[t0] ^ t1 ^ t2 ^ MUL2[t3] ^ rk[15]

            s = [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15]

        rk14 = rkeys[14]
        return bytes((
            SBOX[s[0]] ^ rk14[0], SBOX[s[5]] ^ rk14[1], SBOX[s[10]] ^ rk14[2], SBOX[s[15]] ^ rk14[3],
            SBOX[s[4]] ^ rk14[4], SBOX[s[9]] ^ rk14[5], SBOX[s[14]] ^ rk14[6], SBOX[s[3]] ^ rk14[7],
            SBOX[s[8]] ^ rk14[8], SBOX[s[13]] ^ rk14[9], SBOX[s[2]] ^ rk14[10], SBOX[s[7]] ^ rk14[11],
            SBOX[s[12]] ^ rk14[12], SBOX[s[1]] ^ rk14[13], SBOX[s[6]] ^ rk14[14], SBOX[s[11]] ^ rk14[15],
        ))

    def _decrypt_block(self, block: bytes) -> bytes:
        rkeys = self.round_keys
        rk14 = rkeys[14]
        s = [block[i] ^ rk14[i] for i in range(16)]

        for r in range(13, 0, -1):
            rk = rkeys[r]
            a0 = INV_SBOX[s[0]] ^ rk[0]
            a1 = INV_SBOX[s[13]] ^ rk[1]
            a2 = INV_SBOX[s[10]] ^ rk[2]
            a3 = INV_SBOX[s[7]] ^ rk[3]
            c0 = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3]
            c1 = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3]
            c2 = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3]
            c3 = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3]

            a0 = INV_SBOX[s[4]] ^ rk[4]
            a1 = INV_SBOX[s[1]] ^ rk[5]
            a2 = INV_SBOX[s[14]] ^ rk[6]
            a3 = INV_SBOX[s[11]] ^ rk[7]
            c4 = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3]
            c5 = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3]
            c6 = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3]
            c7 = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3]

            a0 = INV_SBOX[s[8]] ^ rk[8]
            a1 = INV_SBOX[s[5]] ^ rk[9]
            a2 = INV_SBOX[s[2]] ^ rk[10]
            a3 = INV_SBOX[s[15]] ^ rk[11]
            c8 = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3]
            c9 = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3]
            c10 = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3]
            c11 = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3]

            a0 = INV_SBOX[s[12]] ^ rk[12]
            a1 = INV_SBOX[s[9]] ^ rk[13]
            a2 = INV_SBOX[s[6]] ^ rk[14]
            a3 = INV_SBOX[s[3]] ^ rk[15]
            c12 = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3]
            c13 = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3]
            c14 = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3]
            c15 = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3]

            s = [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15]

        rk0 = rkeys[0]
        return bytes((
            INV_SBOX[s[0]] ^ rk0[0], INV_SBOX[s[13]] ^ rk0[1], INV_SBOX[s[10]] ^ rk0[2], INV_SBOX[s[7]] ^ rk0[3],
            INV_SBOX[s[4]] ^ rk0[4], INV_SBOX[s[1]] ^ rk0[5], INV_SBOX[s[14]] ^ rk0[6], INV_SBOX[s[11]] ^ rk0[7],
            INV_SBOX[s[8]] ^ rk0[8], INV_SBOX[s[5]] ^ rk0[9], INV_SBOX[s[2]] ^ rk0[10], INV_SBOX[s[15]] ^ rk0[11],
            INV_SBOX[s[12]] ^ rk0[12], INV_SBOX[s[9]] ^ rk0[13], INV_SBOX[s[6]] ^ rk0[14], INV_SBOX[s[3]] ^ rk0[15],
        ))

    def encrypt_cbc(self, plaintext: bytes, iv: bytes) -> bytes:
        if len(iv) != 16:
            raise ValueError("IV 길이는 16바이트여야 합니다.")
        pad_len = 16 - (len(plaintext) % 16)
        padded = plaintext + bytes([pad_len] * pad_len)
        out = bytearray(len(padded))
        prev = iv
        for offset in range(0, len(padded), 16):
            blk = bytes(padded[offset + i] ^ prev[i] for i in range(16))
            enc = self._encrypt_block(blk)
            out[offset:offset + 16] = enc
            prev = enc
        return bytes(out)

    def decrypt_cbc(self, ciphertext: bytes, iv: bytes) -> bytes:
        if len(iv) != 16:
            raise ValueError("IV 길이는 16바이트여야 합니다.")
        if not ciphertext or (len(ciphertext) % 16) != 0:
            raise ValueError("암호문 길이가 16바이트의 배수가 아닙니다.")
        out = bytearray(len(ciphertext))
        prev = iv
        for offset in range(0, len(ciphertext), 16):
            blk = ciphertext[offset:offset + 16]
            dec = self._decrypt_block(blk)
            out[offset:offset + 16] = bytes(dec[i] ^ prev[i] for i in range(16))
            prev = blk
        pad_len = out[-1]
        if pad_len < 1 or pad_len > 16:
            raise ValueError("잘못된 PKCS#7 패딩 값입니다.")
        for b in out[-pad_len:]:
            if b != pad_len:
                raise ValueError("PKCS#7 패딩 검증에 실패했습니다.")
        return bytes(out[:-pad_len])


def derive_key_iv() -> tuple:
    dk = hashlib.pbkdf2_hmac("sha1", PASSWORD, SALT, ITERATIONS, 48)
    return dk[:32], dk[32:48]


def encrypt_bytes(plaintext: bytes) -> bytes:
    key, iv = derive_key_iv()
    cipher = AES256CBC(key)
    return cipher.encrypt_cbc(plaintext, iv)


def decrypt_bytes(ciphertext: bytes) -> bytes:
    key, iv = derive_key_iv()
    cipher = AES256CBC(key)
    return cipher.decrypt_cbc(ciphertext, iv)


def sdict(pairs=None) -> OrderedDict:
    keys = []
    vals = []
    if pairs:
        for k, v in pairs:
            keys.append(k)
            vals.append(v)
    return OrderedDict([("m_Keys", keys), ("m_Values", vals)])


def shash(items=None) -> OrderedDict:
    return OrderedDict([("m_Keys", list(items) if items else [])])


def sdict_get(d: dict, key, default=None):
    keys = d.get("m_Keys", [])
    vals = d.get("m_Values", [])
    for idx, k in enumerate(keys):
        if k == key and idx < len(vals):
            return vals[idx]
    return default


def sdict_set(d: dict, key, value) -> None:
    keys = d.setdefault("m_Keys", [])
    vals = d.setdefault("m_Values", [])
    for idx, k in enumerate(keys):
        if k == key:
            if idx < len(vals):
                vals[idx] = value
            else:
                while len(vals) < idx:
                    vals.append(0)
                vals.append(value)
            return
    keys.append(key)
    vals.append(value)


def sdict_remove(d: dict, key) -> bool:
    keys = d.get("m_Keys", [])
    vals = d.get("m_Values", [])
    for idx, k in enumerate(keys):
        if k == key:
            keys.pop(idx)
            if idx < len(vals):
                vals.pop(idx)
            return True
    return False


def shash_add(h: dict, item) -> bool:
    keys = h.setdefault("m_Keys", [])
    if item not in keys:
        keys.append(item)
        return True
    return False


def shash_remove(h: dict, item) -> bool:
    keys = h.get("m_Keys", [])
    if item in keys:
        keys.remove(item)
        return True
    return False


SAVE_DATA_DICT_FIELDS = {
    "m_effectDic", "m_npcDic", "m_monsterDic", "m_resDic",
    "m_itemDic", "m_itemTimeDic", "m_weiTuoDic", "m_dialogCDDic",
    "m_dialogTurnDic", "m_wuXueExpDic", "m_characterDic",
    "m_delayShowDic", "m_monsterShowDic", "m_resShowDic",
    "m_delayHideDic", "m_delayDotDic", "m_delayCancelDotDic",
    "m_animalExpDic", "m_friendLvDic", "m_storeDic",
    "m_postDic", "m_treasureDic",
}

SAVE_DATA_HASH_FIELDS = {
    "m_globalBuffHash", "m_treasureHash", "m_receiveHash",
    "m_completeHash", "m_failHash", "m_danYaoGotHash",
    "m_fishGotHash", "m_itemGotHash", "m_dialogHash",
    "m_dialogLockHash", "m_wanderHash", "m_wanderLockHash",
    "m_weiTuoLockHash", "m_unlockHash", "m_dotHash",
    "m_postRewardHash", "m_takeHash", "m_danFangHash",
    "m_daZaoHash", "m_ganWuHash", "m_favoBookHash",
    "m_treasureLockHash", "m_campHash", "m_readedHash",
    "m_levelHash", "m_chessHash",
}

GLOBAL_DATA_HASH_FIELDS = (
    "m_guideHash", "m_achieveHash", "m_equipHash", "m_wuXueHash",
    "m_danFangHash", "m_daZaoHash", "m_propHash", "m_matHash",
    "m_fishHash", "m_huntHash",
)

SAVE_DATA_FIELD_ORDER = (
    "m_diffucultEnum", "m_scene", "m_pos", "m_gameTime", "m_realTime",
    "m_effectDic", "m_saveTime", "m_path", "m_name", "m_skin",
    "m_yangCheng", "m_equips", "m_globalBuffHash", "m_npcDic",
    "m_monsterDic", "m_resDic", "m_treasureHash", "m_itemDic",
    "m_itemTimeDic", "m_receiveHash", "m_completeHash", "m_failHash",
    "m_danYaoGotHash", "m_fishGotHash", "m_itemGotHash", "m_dialogHash",
    "m_dialogLockHash", "m_wanderHash", "m_wanderLockHash", "m_weiTuoDic",
    "m_weiTuoLockHash", "m_dialogCDDic", "m_dialogTurnDic", "m_unlockHash",
    "m_dotHash", "m_postRewardHash", "m_showMainId", "m_showBranchId",
    "m_fishRob", "m_huntBow", "m_tiLi", "m_turn", "m_takeHash",
    "m_fights", "m_leaderFamily", "m_leaderName", "m_leaderDirection",
    "m_hp", "m_mp", "m_jingLi", "m_wuXueExpDic", "m_danFangHash",
    "m_daZaoHash", "m_characterDic", "m_ganWuHash", "m_quanActives",
    "m_daoActives", "m_jianActives", "m_qiangActives", "m_anqiActives",
    "m_qinActives", "m_passives", "m_favoBookHash", "m_delayShowDic",
    "m_monsterShowDic", "m_resShowDic", "m_delayHideDic", "m_delayDotDic",
    "m_delayCancelDotDic", "m_animalExpDic", "m_friendLvDic", "m_storeDic",
    "m_postDic", "m_treasureDic", "m_treasureLockHash", "m_campHash",
    "m_readedHash", "m_levelHash", "m_chessHash",
)


def default_save_data() -> OrderedDict:
    return OrderedDict([
        ("m_diffucultEnum", 2),
        ("m_scene", 5),
        ("m_pos", OrderedDict([("x", 0.0), ("y", 0.0)])),
        ("m_gameTime", 1200),
        ("m_realTime", 540),
        ("m_effectDic", sdict()),
        ("m_saveTime", 638990123456789012),
        ("m_path", ""),
        ("m_name", "초기 세이브"),
        ("m_skin", "PuTong"),
        ("m_yangCheng", False),
        ("m_equips", [0, 0, 0, 0]),
        ("m_globalBuffHash", shash()),
        ("m_npcDic", sdict()),
        ("m_monsterDic", sdict()),
        ("m_resDic", sdict()),
        ("m_treasureHash", shash()),
        ("m_itemDic", sdict()),
        ("m_itemTimeDic", sdict()),
        ("m_receiveHash", shash()),
        ("m_completeHash", shash()),
        ("m_failHash", shash()),
        ("m_danYaoGotHash", shash()),
        ("m_fishGotHash", shash()),
        ("m_itemGotHash", shash()),
        ("m_dialogHash", shash()),
        ("m_dialogLockHash", shash()),
        ("m_wanderHash", shash()),
        ("m_wanderLockHash", shash()),
        ("m_weiTuoDic", sdict()),
        ("m_weiTuoLockHash", shash()),
        ("m_dialogCDDic", sdict()),
        ("m_dialogTurnDic", sdict()),
        ("m_unlockHash", shash()),
        ("m_dotHash", shash()),
        ("m_postRewardHash", shash()),
        ("m_showMainId", 0),
        ("m_showBranchId", 0),
        ("m_fishRob", 0),
        ("m_huntBow", 0),
        ("m_tiLi", 20),
        ("m_turn", 1),
        ("m_takeHash", shash()),
        ("m_fights", [3, 0, 0, 0, 0]),
        ("m_leaderFamily", "장"),
        ("m_leaderName", "삼풍"),
        ("m_leaderDirection", 6),
        ("m_hp", 1.0),
        ("m_mp", 1.0),
        ("m_jingLi", 1.0),
        ("m_wuXueExpDic", sdict()),
        ("m_danFangHash", shash()),
        ("m_daZaoHash", shash()),
        ("m_characterDic", sdict()),
        ("m_ganWuHash", shash()),
        ("m_quanActives", [0, 0, 0, 0, 0, 0]),
        ("m_daoActives", [0, 0, 0, 0, 0, 0]),
        ("m_jianActives", [0, 0, 0, 0, 0, 0]),
        ("m_qiangActives", [0, 0, 0, 0, 0, 0]),
        ("m_anqiActives", [0, 0, 0, 0, 0, 0]),
        ("m_qinActives", [0, 0, 0, 0, 0, 0]),
        ("m_passives", [0, 0, 0]),
        ("m_favoBookHash", shash()),
        ("m_delayShowDic", sdict()),
        ("m_monsterShowDic", sdict()),
        ("m_resShowDic", sdict()),
        ("m_delayHideDic", sdict()),
        ("m_delayDotDic", sdict()),
        ("m_delayCancelDotDic", sdict()),
        ("m_animalExpDic", sdict()),
        ("m_friendLvDic", sdict()),
        ("m_storeDic", sdict()),
        ("m_postDic", sdict()),
        ("m_treasureDic", sdict()),
        ("m_treasureLockHash", shash()),
        ("m_campHash", shash()),
        ("m_readedHash", shash()),
        ("m_levelHash", shash()),
        ("m_chessHash", shash()),
    ])


def default_global_data() -> OrderedDict:
    return OrderedDict((field, shash()) for field in GLOBAL_DATA_HASH_FIELDS)


def _load_real_catalog() -> dict:
    cat_path = Path(__file__).resolve().parent / "src" / "catalog-data.js"
    if not cat_path.is_file():
        return {}
    try:
        raw = cat_path.read_text(encoding="utf-8")
        marker = "  return "
        start = raw.find(marker)
        end = raw.rfind(";\n});")
        if start >= 0 and end > start:
            return json.loads(raw[start + len(marker):end])
    except Exception:
        pass
    return {}


_REAL_CAT = _load_real_catalog()
GANWU_IDS = [x["id"] for x in _REAL_CAT.get("trees", [])] or [g * 100 + n for g in range(1, 6) for n in range(1, 17)]
DANFANG_IDS = [x["id"] for x in _REAL_CAT.get("danFang", [])] or list(range(51001, 51027))
DAZAO_IDS = [x["id"] for x in _REAL_CAT.get("daZao", [])] or list(range(52001, 52051))
ACHIEVE_IDS = [x["id"] for x in _REAL_CAT.get("achieves", [])] or list(range(100101, 100110))
EQUIP_IDS = [x["id"] for x in _REAL_CAT.get("equips", [])] or list(range(70101, 70110))
WUXUE_IDS = [x["id"] for x in _REAL_CAT.get("wuxue", [])] or list(range(50001, 50010))
WUXUE_MAX_EXP = {x["id"]: int(x.get("lvMax", 10)) * int(x.get("exp", 100)) for x in _REAL_CAT.get("wuxue", [])}

CATALOG = {
    "items": {x["id"]: x["name"] for x in _REAL_CAT.get("items", [])} or {10001: "전폐", 10002: "감오점"},
    "effects": {x["id"]: x["name"] for x in _REAL_CAT.get("effects", [])},
    "ganWuIds": GANWU_IDS,
    "danFangIds": DANFANG_IDS,
    "daZaoIds": DAZAO_IDS,
    "globalUnlocks": {
        "m_achieveHash": ACHIEVE_IDS,
        "m_equipHash": EQUIP_IDS,
        "m_wuXueHash": WUXUE_IDS,
        "m_danFangHash": DANFANG_IDS,
        "m_daZaoHash": DAZAO_IDS,
    },
}

PRESETS = OrderedDict([
    ("money_rich", {
        "name": "전폐·감오점 충만",
        "description": "전폐 1억(10001) 및 감오점 999개(10002)를 설정합니다.",
        "target": "save",
    }),
    ("max_six_stats", {
        "name": "육유·정통 극대화",
        "description": "육유(101~106=100), 무기 정통(201~206=100), 내공/소요/실전(501~503=99999)을 설정합니다.",
        "target": "save",
    }),
    ("max_life_skills", {
        "name": "생활 8기예·체력 만렙",
        "description": "생활 기예(301~308=99999), 기혈/내력/정력 비율(1.0), 체력(m_tiLi=100)을 최대치로 설정합니다.",
        "target": "save",
    }),
    ("full_ganwu", {
        "name": "실전 감오 80노드 해금",
        "description": "실전 감오(m_ganWuHash) 80개 노드를 모두 해금합니다.",
        "target": "save",
    }),
    ("full_recipes", {
        "name": "단방·단조 도안 전체 해금",
        "description": "단방(m_danFangHash) 및 단조 도안(m_daZaoHash)을 모두 해금합니다.",
        "target": "save",
    }),
    ("global_unlock_all", {
        "name": "글로벌 도감·업적 전체 해금",
        "description": "Setting.bytes의 업적·장비·무학·단방·도안 해시셋 도감을 모두 해금합니다.",
        "target": "global",
    }),
])


def detect_save_kind(data: dict) -> str:
    if not isinstance(data, dict):
        return "unknown"
    if "m_guideHash" in data and "m_achieveHash" in data and "m_saveTime" not in data:
        return "global"
    if "m_equips" in data and "m_itemDic" in data and "m_effectDic" in data:
        return "save"
    return "unknown"


def apply_preset(data: dict, preset_id: str) -> dict:
    if preset_id not in PRESETS:
        raise ValueError(f"알 수 없는 프리셋입니다: {preset_id}")
    kind = detect_save_kind(data)

    if preset_id == "money_rich":
        if kind == "global":
            raise ValueError("money_rich 프리셋은 일반 세이브 파일에만 적용할 수 있습니다.")
        item_dic = data.setdefault("m_itemDic", sdict())
        sdict_set(item_dic, 10001, 100000000)
        sdict_set(item_dic, 10002, 999)
        return data

    if preset_id == "max_six_stats":
        if kind == "global":
            raise ValueError("max_six_stats 프리셋은 일반 세이브 파일에만 적용할 수 있습니다.")
        eff = data.setdefault("m_effectDic", sdict())
        for k in range(101, 107):
            sdict_set(eff, k, 100.0)
        for k in range(201, 207):
            sdict_set(eff, k, 100.0)
        for k in range(501, 504):
            sdict_set(eff, k, 99999.0)
        return data

    if preset_id == "max_life_skills":
        if kind == "global":
            raise ValueError("max_life_skills 프리셋은 일반 세이브 파일에만 적용할 수 있습니다.")
        eff = data.setdefault("m_effectDic", sdict())
        for k in range(301, 309):
            sdict_set(eff, k, 99999.0)
        data["m_tiLi"] = 100
        data["m_hp"] = 1.0
        data["m_mp"] = 1.0
        data["m_jingLi"] = 1.0
        return data

    if preset_id == "full_ganwu":
        if kind == "global":
            raise ValueError("full_ganwu 프리셋은 일반 세이브 파일에만 적용할 수 있습니다.")
        gw = data.setdefault("m_ganWuHash", shash())
        for gid in GANWU_IDS:
            shash_add(gw, gid)
        return data

    if preset_id == "full_recipes":
        if kind == "global":
            raise ValueError("full_recipes 프리셋은 일반 세이브 파일에만 적용할 수 있습니다.")
        df = data.setdefault("m_danFangHash", shash())
        dz = data.setdefault("m_daZaoHash", shash())
        for rid in DANFANG_IDS:
            shash_add(df, rid)
        for rid in DAZAO_IDS:
            shash_add(dz, rid)
        return data

    if preset_id == "global_unlock_all":
        if kind != "global":
            raise ValueError("global_unlock_all 프리셋은 Setting.bytes(전역 데이터)에만 적용할 수 있습니다.")
        for field, ids in CATALOG["globalUnlocks"].items():
            h = data.setdefault(field, shash())
            for item_id in ids:
                shash_add(h, item_id)
        return data

    return data


def validate_data(data: dict) -> list:
    errors = []
    if not isinstance(data, dict):
        return ["최상위 JSON 객체가 딕셔너리 형식이 아닙니다."]
    kind = detect_save_kind(data)
    if kind == "unknown":
        errors.append("SaveData 또는 GlobalData(Setting.bytes) 형식을 판별할 수 없습니다.")
        return errors

    if kind == "global":
        for field in GLOBAL_DATA_HASH_FIELDS:
            if field not in data:
                errors.append(f"전역 데이터 필수 필드가 누락되었습니다: {field}")
            else:
                val = data[field]
                if not isinstance(val, dict) or not isinstance(val.get("m_Keys"), list):
                    errors.append(f"해시셋 형식이 올바르지 않습니다: {field}")
        return errors

    for field in SAVE_DATA_FIELD_ORDER:
        if field not in data:
            errors.append(f"세이브 필수 필드가 누락되었습니다: {field}")

    for field in SAVE_DATA_DICT_FIELDS:
        if field in data:
            val = data[field]
            if (
                not isinstance(val, dict)
                or not isinstance(val.get("m_Keys"), list)
                or not isinstance(val.get("m_Values"), list)
                or len(val["m_Keys"]) != len(val["m_Values"])
            ):
                errors.append(f"딕셔너리 필드 형식 또는 키/값 길이가 올바르지 않습니다: {field}")

    for field in SAVE_DATA_HASH_FIELDS:
        if field in data:
            val = data[field]
            if not isinstance(val, dict) or not isinstance(val.get("m_Keys"), list):
                errors.append(f"해시셋 필드 형식이 올바르지 않습니다: {field}")

    if "m_yangCheng" in data and not isinstance(data["m_yangCheng"], bool):
        errors.append("불리언 필드 형식이 올바르지 않습니다: m_yangCheng")

    return errors


def save_root() -> Path:
    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        base = Path(user_profile)
    else:
        base = Path.home()
    return base / "AppData" / "LocalLow" / "\u91d1\u5341\u56db\u5de5\u4f5c\u5ba4" / "JinGu" / "SaveDatas"


def game_process_running() -> bool:
    if os.environ.get("JGSE_SIMULATE_GAME_RUNNING") == "1":
        return True
    proc_dir = Path("/proc")
    if proc_dir.is_dir():
        try:
            for entry in proc_dir.iterdir():
                if not entry.name.isdigit():
                    continue
                try:
                    comm = (entry / "comm").read_text(encoding="utf-8", errors="ignore").strip()
                    if comm in ("JinGu.exe", "JinGu"):
                        return True
                    cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", errors="ignore")
                    if re.search(r"(?:^|[/\\\s])JinGu(?:\.exe)?(?:\s|$)", cmdline):
                        return True
                except OSError:
                    continue
        except OSError:
            pass
    if sys.platform.startswith("win"):
        try:
            res = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq JinGu.exe", "/NH"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            if "JinGu.exe" in (res.stdout or ""):
                return True
        except Exception:
            pass
    return False


def safe_path(path, require_ext: bool = True, for_write: bool = False) -> Path:
    if path is None:
        raise ValueError("경로가 비어 있습니다.")
    raw = str(path).strip()
    if not raw:
        raise ValueError("경로가 비어 있습니다.")
    if "\x00" in raw:
        raise ValueError("경로에 유효하지 않은 널 문자가 포함되어 있습니다.")

    # ADS 콜론 검사 (드라이브 문자 C:\ 또는 C:/ 제외)
    colon_check = raw
    if len(raw) >= 2 and raw[0].isalpha() and raw[1] == ":":
        colon_check = raw[2:]
    if ":" in colon_check:
        raise ValueError("경로에 허용되지 않는 콜론(:)이 포함되어 있습니다.")

    parts = re.split(r"[\\/]+", raw)
    for part in parts:
        if not part:
            continue
        stem = part.split(".")[0].upper()
        if stem in RESERVED_DEVICE_NAMES:
            raise ValueError(f"예약된 장치 이름은 경로에 사용할 수 없습니다: {part}")

    p = Path(raw)
    if require_ext and p.suffix.lower() != ".bytes":
        raise ValueError("세이브 파일은 .bytes 확장자여야 합니다.")

    # 대상 및 모든 상위 경로에 심볼릭 링크가 있는지 확인
    abs_p = Path(os.path.abspath(raw))
    cur = abs_p
    checked = set()
    while True:
        s_cur = str(cur)
        if s_cur in checked:
            break
        checked.add(s_cur)
        if os.path.islink(s_cur):
            raise ValueError(f"심볼릭 링크 경로는 보안상 허용되지 않습니다: {s_cur}")
        if not for_write and cur == abs_p and not os.path.exists(s_cur):
            break
        parent = cur.parent
        if parent == cur:
            break
        cur = parent

    return abs_p


def compute_sha256(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


def read_encrypted_json(path) -> tuple:
    p = safe_path(path, require_ext=True, for_write=False)
    if not p.is_file():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {p}")
    size = p.stat().st_size
    if size > MAX_SAVE_BYTES:
        raise ValueError(f"파일 크기가 제한({MAX_SAVE_BYTES}바이트)을 초과했습니다.")
    raw_bytes = p.read_bytes()
    sha256_hex = compute_sha256(raw_bytes)
    plaintext = decrypt_bytes(raw_bytes)
    text = plaintext.decode("utf-8-sig")
    data = json.loads(text, object_pairs_hook=OrderedDict)
    info = {
        "path": str(p),
        "name": p.name,
        "size": len(raw_bytes),
        "sha256": sha256_hex,
        "kind": detect_save_kind(data),
        "mtime": datetime.datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
    }
    return data, raw_bytes, info


def serialize_json_bytes(data: dict) -> bytes:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return text.encode("utf-8")


def write_encrypted_json(path, data: dict, expected_sha256: str = None) -> dict:
    if game_process_running():
        raise RuntimeError("게임(JinGu.exe)이 실행 중입니다. 세이브 손상을 방지하기 위해 게임을 먼저 종료해 주세요.")

    p = safe_path(path, require_ext=True, for_write=True)
    plaintext = serialize_json_bytes(data)
    encrypted = encrypt_bytes(plaintext)
    if len(encrypted) > MAX_SAVE_BYTES:
        raise ValueError(f"저장할 파일 크기가 제한({MAX_SAVE_BYTES}바이트)을 초과했습니다.")

    lock_key = hashlib.sha256(str(p).encode("utf-8")).hexdigest()[:16]
    lock_path = Path(tempfile.gettempdir()) / f"jingu-write-{lock_key}.lock"

    with _WRITE_LOCK:
        lock_file = None
        try:
            if fcntl is not None:
                lock_file = open(lock_path, "a+b")
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)

            p.parent.mkdir(parents=True, exist_ok=True)
            backup_path = None
            if expected_sha256 and not p.exists():
                raise FileNotFoundError("SHA-256 검증 대상 파일이 존재하지 않습니다.")

            if p.exists():
                old_bytes = p.read_bytes()
                old_sha = compute_sha256(old_bytes)
                if expected_sha256 and old_sha.lower() != expected_sha256.lower():
                    raise ValueError("파일이 외부에서 변경되었습니다(SHA-256 불일치). 다시 불러온 뒤 저장해 주세요.")
                ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
                rand_hex = secrets.token_hex(3)
                backup_name = f"{p.name}.backup-{ts}-{rand_hex}.bak"
                backup_path = p.with_name(backup_name)
                with open(backup_path, "wb") as bf:
                    bf.write(old_bytes)
                    bf.flush()
                    os.fsync(bf.fileno())
                verify_sha = compute_sha256(backup_path.read_bytes())
                if verify_sha != old_sha:
                    raise IOError("백업 파일 SHA-256 무결성 검증에 실패했습니다.")

            fd, tmp_name = tempfile.mkstemp(prefix=f".{p.name}.tmp-", dir=str(p.parent))
            try:
                with os.fdopen(fd, "wb") as tf:
                    tf.write(encrypted)
                    tf.flush()
                    os.fsync(tf.fileno())
                os.replace(tmp_name, p)
            except Exception:
                try:
                    if os.path.exists(tmp_name):
                        os.unlink(tmp_name)
                except OSError:
                    pass
                raise
        finally:
            if lock_file is not None:
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                finally:
                    lock_file.close()

    new_sha = compute_sha256(encrypted)
    return {
        "path": str(p),
        "name": p.name,
        "size": len(encrypted),
        "sha256": new_sha,
        "backupPath": str(backup_path) if backup_path else None,
        "kind": detect_save_kind(data),
    }


def list_save_files(root_dir: Path = None) -> list:
    target_dir = root_dir if root_dir is not None else save_root()
    results = []
    if not target_dir.is_dir():
        return results
    scan_dirs = [target_dir] + [target_dir / sub for sub in ("Fixed", "AutoSave", "Global") if (target_dir / sub).is_dir()]
    candidates = []
    for d in scan_dirs:
        candidates.extend(sorted(d.iterdir(), key=lambda x: x.name.lower()))
    for entry in candidates:
        if not entry.is_file():
            continue
        if entry.suffix.lower() != ".bytes":
            continue
        try:
            abs_entry = safe_path(entry, require_ext=True, for_write=False)
            st = abs_entry.stat()
            if st.st_size > MAX_SAVE_BYTES:
                continue
            raw = abs_entry.read_bytes()
            sha = compute_sha256(raw)
            kind = "unknown"
            try:
                dec = decrypt_bytes(raw)
                obj = json.loads(dec.decode("utf-8-sig"))
                kind = detect_save_kind(obj)
            except Exception:
                kind = "invalid"
            results.append({
                "path": str(abs_entry),
                "name": abs_entry.name,
                "size": st.st_size,
                "sha256": sha,
                "kind": kind,
                "mtime": datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            })
        except Exception:
            continue
    return results


def build_html_page(token: str) -> str:
    dist_html = Path(__file__).resolve().parent / "dist" / "JinGuSaveEditor-v1.0.html"
    if dist_html.is_file():
        html = dist_html.read_text(encoding="utf-8")
        meta = f'<meta name="jingu-token" content="{token}">'
        if re.search(r"<head[^>]*>", html, flags=re.IGNORECASE):
            return re.sub(r"(<head[^>]*>)", r"\1\n  " + meta, html, count=1, flags=re.IGNORECASE)
        return meta + html
    html = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="jingu-token" content="__TOKEN__">
<title>__APP_NAME__ v__APP_VERSION__</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; background: #14161a; color: #e8ecf2; margin: 0; padding: 20px; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { margin: 0 0 8px 0; font-size: 22px; color: #f6c967; }
  .sub { color: #9aa4b2; font-size: 13px; margin-bottom: 18px; }
  .card { background: #1d2128; border: 1px solid #2d333f; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  select, input, textarea, button { background: #121418; color: #e8ecf2; border: 1px solid #353c49; border-radius: 6px; padding: 8px 10px; font-size: 13px; }
  button { background: #2d5a9e; border-color: #3a6fc0; cursor: pointer; font-weight: 600; }
  button:hover { background: #386cb8; }
  button.warn { background: #8c3b3b; border-color: #a94949; }
  textarea { width: 100%; min-height: 360px; font-family: Consolas, monospace; box-sizing: border-box; }
  .status { padding: 10px 12px; border-radius: 6px; background: #18202c; border: 1px solid #2b3a4f; font-size: 13px; margin-top: 10px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #2a313d; color: #cfd7e3; }
</style>
</head>
<body>
<div class="wrap">
  <h1>__APP_NAME__ <span class="badge">v__APP_VERSION__</span></h1>
  <div class="sub">금고군협전(AppID 3313720) 로컬 세이브 에디터</div>

  <div class="card">
    <div class="row">
      <select id="saveSelect" style="min-width: 340px;"></select>
      <button onclick="refreshList()">목록 새로고침</button>
      <button onclick="loadSelected()">불러오기</button>
      <button onclick="saveCurrent()" class="warn">저장하기 (자동 백업)</button>
    </div>
    <div class="row" style="margin-top: 10px;">
      <input id="customPath" type="text" placeholder="직접 .bytes 파일 경로 입력" style="flex: 1; min-width: 280px;">
      <button onclick="loadCustom()">경로 열기</button>
    </div>
    <div id="statusBox" class="status">준비되었습니다.</div>
  </div>

  <div class="card">
    <div class="row" style="margin-bottom: 10px;">
      <span class="badge">원클릭 프리셋</span>
      <select id="presetSelect"></select>
      <button onclick="applyPresetUI()">프리셋 적용</button>
    </div>
    <textarea id="jsonEditor" spellcheck="false" placeholder="세이브 JSON 데이터가 여기에 표시됩니다."></textarea>
  </div>
</div>

<script>
const TOKEN = document.querySelector('meta[name="jingu-token"]').getAttribute('content');
let currentSha256 = null;
let currentPath = null;

function setStatus(msg, isError=false) {
  const box = document.getElementById('statusBox');
  box.textContent = msg;
  box.style.borderColor = isError ? '#b84b4b' : '#2b3a4f';
  box.style.color = isError ? '#ffb4b4' : '#e8ecf2';
}

async function apiFetch(url, opts={}) {
  const headers = Object.assign({}, opts.headers || {}, {
    'X-JinGu-Token': TOKEN,
    'Content-Type': 'application/json'
  });
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || ('요청 실패: ' + res.status));
  }
  return data;
}

async function init() {
  try {
    const info = await apiFetch('/api/info');
    const pSel = document.getElementById('presetSelect');
    pSel.innerHTML = '';
    for (const [k, v] of Object.entries(info.presets)) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = v.name + ' - ' + v.description;
      pSel.appendChild(opt);
    }
    await refreshList();
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function refreshList() {
  try {
    const res = await apiFetch('/api/saves');
    const sel = document.getElementById('saveSelect');
    sel.innerHTML = '';
    for (const f of res.files) {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = f.name + ' (' + f.kind + ', ' + f.size + 'B)';
      sel.appendChild(opt);
    }
    setStatus('세이브 목록을 불러왔습니다. (' + res.files.length + '개)');
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function loadPath(path) {
  try {
    const res = await apiFetch('/api/load', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
    currentPath = res.info.path;
    currentSha256 = res.info.sha256;
    document.getElementById('customPath').value = currentPath;
    document.getElementById('jsonEditor').value = JSON.stringify(res.data, null, 2);
    setStatus('불러오기 완료: ' + res.info.name + ' (SHA-256: ' + currentSha256.slice(0, 12) + '...)');
  } catch (e) {
    setStatus(e.message, true);
  }
}

function loadSelected() {
  const path = document.getElementById('saveSelect').value;
  if (!path) {
    setStatus('선택된 파일이 없습니다.', true);
    return;
  }
  loadPath(path);
}

function loadCustom() {
  const path = document.getElementById('customPath').value.trim();
  if (!path) {
    setStatus('경로를 입력해 주세요.', true);
    return;
  }
  loadPath(path);
}

async function saveCurrent() {
  if (!currentPath) {
    setStatus('먼저 세이브 파일을 불러와 주세요.', true);
    return;
  }
  try {
    const parsed = JSON.parse(document.getElementById('jsonEditor').value);
    const res = await apiFetch('/api/save', {
      method: 'POST',
      body: JSON.stringify({
        path: currentPath,
        data: parsed,
        expectedSha256: currentSha256
      })
    });
    currentSha256 = res.info.sha256;
    setStatus('저장 완료! 백업: ' + (res.info.backupPath || '없음'));
  } catch (e) {
    setStatus(e.message, true);
  }
}

function applyPresetUI() {
  const editor = document.getElementById('jsonEditor');
  if (!editor.value.trim()) {
    setStatus('먼저 세이브 파일을 불러와 주세요.', true);
    return;
  }
  try {
    const obj = JSON.parse(editor.value);
    const pid = document.getElementById('presetSelect').value;
    if (pid === 'money_rich') {
      obj.m_itemDic = obj.m_itemDic || { m_Keys: [], m_Values: [] };
      setDic(obj.m_itemDic, 10001, 100000000);
      setDic(obj.m_itemDic, 10002, 999);
    } else if (pid === 'max_six_stats') {
      obj.m_effectDic = obj.m_effectDic || { m_Keys: [], m_Values: [] };
      for (let k = 101; k <= 106; k++) setDic(obj.m_effectDic, k, 100);
      for (let k = 201; k <= 206; k++) setDic(obj.m_effectDic, k, 100);
      for (let k = 501; k <= 503; k++) setDic(obj.m_effectDic, k, 99999);
    } else if (pid === 'max_life_skills') {
      obj.m_effectDic = obj.m_effectDic || { m_Keys: [], m_Values: [] };
      for (let k = 301; k <= 308; k++) setDic(obj.m_effectDic, k, 99999);
      obj.m_tiLi = 100;
      obj.m_hp = 1.0;
      obj.m_mp = 1.0;
      obj.m_jingLi = 1.0;
    } else if (pid === 'full_ganwu') {
      obj.m_ganWuHash = obj.m_ganWuHash || { m_Keys: [] };
      for (let id = 1001; id <= 1080; id++) addHash(obj.m_ganWuHash, id);
    } else if (pid === 'full_recipes') {
      obj.m_danFangHash = obj.m_danFangHash || { m_Keys: [] };
      obj.m_daZaoHash = obj.m_daZaoHash || { m_Keys: [] };
      for (let id = 2001; id <= 2030; id++) addHash(obj.m_danFangHash, id);
      for (let id = 3001; id <= 3030; id++) addHash(obj.m_daZaoHash, id);
    } else {
      setStatus('이 프리셋은 CLI에서 적용하거나 전역 데이터에 적용할 수 있습니다.', true);
      return;
    }
    editor.value = JSON.stringify(obj, null, 2);
    setStatus('프리셋이 편집기에 반영되었습니다. 저장하기를 눌러 반영하세요.');
  } catch (e) {
    setStatus('JSON 파싱 오류: ' + e.message, true);
  }
}

function setDic(dic, key, val) {
  const idx = dic.m_Keys.indexOf(key);
  if (idx >= 0) dic.m_Values[idx] = val;
  else { dic.m_Keys.push(key); dic.m_Values.push(val); }
}

function addHash(h, val) {
  if (!h.m_Keys.includes(val)) h.m_Keys.push(val);
}

init();
</script>
</body>
</html>
"""
    return (
        html.replace("__TOKEN__", token)
        .replace("__APP_NAME__", APP_NAME)
        .replace("__APP_VERSION__", APP_VERSION)
    )


class JinGuHandler(BaseHTTPRequestHandler):
    server_version = f"JinGuEditor/{APP_VERSION}"

    def log_message(self, format, *args):
        return

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status_code: int, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _check_local_security(self, require_token: bool = True) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host not in ("127.0.0.1", "localhost", "[::1]", ""):
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "허용되지 않은 Host 헤더입니다."})
            return False

        origin = self.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            if (parsed.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1"):
                self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "허용되지 않은 Origin입니다."})
                return False

        sec_fetch = (self.headers.get("Sec-Fetch-Site") or "").lower()
        if sec_fetch and sec_fetch not in ("same-origin", "same-site", "none"):
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "허용되지 않은 Sec-Fetch-Site 요청입니다."})
            return False

        if require_token:
            expected_token = getattr(self.server, "jingu_token", "")
            got_token = self.headers.get(TOKEN_HEADER, "")
            if not expected_token or not secrets.compare_digest(got_token, expected_token):
                self._send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "인증 토큰이 올바르지 않습니다."})
                return False

        return True

    def _read_json_body(self) -> dict:
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            raise ValueError("Content-Length 헤더가 필요합니다.")
        length = int(raw_len)
        if length < 0 or length > MAX_HTTP_JSON_BYTES:
            raise ValueError(f"요청 본문 크기가 제한({MAX_HTTP_JSON_BYTES}바이트)을 초과했습니다.")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"), object_pairs_hook=OrderedDict)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            if not self._check_local_security(require_token=False):
                return
            token = getattr(self.server, "jingu_token", "")
            self._send_html(HTTPStatus.OK, build_html_page(token))
            return

        if parsed.path == "/api/info":
            if not self._check_local_security(require_token=True):
                return
            self._send_json(HTTPStatus.OK, {
                "ok": True,
                "appName": APP_NAME,
                "version": APP_VERSION,
                "saveRoot": str(save_root()),
                "gameRunning": game_process_running(),
                "presets": PRESETS,
                "catalog": CATALOG,
            })
            return

        if parsed.path in ("/api/saves", "/api/list"):
            if not self._check_local_security(require_token=True):
                return
            custom_dir = getattr(self.server, "save_dir_override", None)
            files = list_save_files(custom_dir)
            self._send_json(HTTPStatus.OK, {"ok": True, "files": files})
            return

        if parsed.path == "/api/load":
            if not self._check_local_security(require_token=True):
                return
            try:
                qs = parse_qs(parsed.query)
                path = (qs.get("path") or [None])[0]
                if not path:
                    raise ValueError("path 파라미터가 필요합니다.")
                data, raw_bytes, info = read_encrypted_json(path)
                self._send_json(HTTPStatus.OK, {
                    "ok": True,
                    "info": info,
                    "data": data,
                    "rawBase64": base64.b64encode(raw_bytes).decode("ascii"),
                })
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "요청한 경로를 찾을 수 없습니다."})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/load":
            if not self._check_local_security(require_token=True):
                return
            try:
                req = self._read_json_body()
                path = req.get("path")
                data, raw_bytes, info = read_encrypted_json(path)
                self._send_json(HTTPStatus.OK, {
                    "ok": True,
                    "info": info,
                    "data": data,
                    "rawBase64": base64.b64encode(raw_bytes).decode("ascii"),
                })
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return

        if parsed.path == "/api/save":
            if not self._check_local_security(require_token=True):
                return
            try:
                req = self._read_json_body()
                path = req.get("path")
                expected_sha = req.get("expectedSha256")
                if "rawBase64" in req and req["rawBase64"] is not None:
                    raw_cipher = base64.b64decode(req["rawBase64"], validate=True)
                    dec = decrypt_bytes(raw_cipher)
                    data = json.loads(dec.decode("utf-8-sig"), object_pairs_hook=OrderedDict)
                elif "data" in req and req["data"] is not None:
                    data = req["data"]
                else:
                    raise ValueError("data 또는 rawBase64 필드가 필요합니다.")

                errs = validate_data(data)
                if errs:
                    raise ValueError("데이터 검증 실패: " + "; ".join(errs))

                info = write_encrypted_json(path, data, expected_sha256=expected_sha)
                self._send_json(HTTPStatus.OK, {"ok": True, "info": info})
            except FileNotFoundError as exc:
                self._send_json(HTTPStatus.CONFLICT, {"ok": False, "error": str(exc)})
            except ValueError as exc:
                status = HTTPStatus.CONFLICT if "SHA-256" in str(exc) else HTTPStatus.BAD_REQUEST
                self._send_json(status, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "요청한 경로를 찾을 수 없습니다."})


def cmd_demo(args) -> int:
    print(f"[{APP_NAME} v{APP_VERSION}] 데모 실행")
    if getattr(args, "is_global", False):
        obj = default_global_data()
        apply_preset(obj, "global_unlock_all")
    else:
        obj = default_save_data()
        apply_preset(obj, "money_rich")
        apply_preset(obj, "max_six_stats")
        apply_preset(obj, "full_ganwu")
    raw_json = serialize_json_bytes(obj)
    enc = encrypt_bytes(raw_json)
    dec = decrypt_bytes(enc)
    restored = json.loads(dec.decode("utf-8"), object_pairs_hook=OrderedDict)
    errs = validate_data(restored)
    if errs:
        print("검증 실패:", errs)
        return 1
    out_path = getattr(args, "out", None)
    if out_path:
        p = safe_path(out_path, require_ext=True, for_write=True)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(enc)
        print(f"데모 파일 저장 완료: {p} ({len(enc)}바이트)")
    if detect_save_kind(restored) == "global":
        print(f"전역 데모 왕복 성공! 크기={len(enc)}바이트, 업적={len(restored['m_achieveHash']['m_Keys'])}개")
    else:
        money = sdict_get(restored["m_itemDic"], 10001, 0)
        pts = sdict_get(restored["m_itemDic"], 10002, 0)
        ganwu_cnt = len(restored["m_ganWuHash"]["m_Keys"])
        print(f"암복호화 왕복 성공! 암호문 크기={len(enc)}바이트, 전폐={money}, 감오점={pts}, 감오={ganwu_cnt}개")
    return 0


def cmd_inspect(args) -> int:
    data, _, info = read_encrypted_json(args.file)
    print(f"파일: {info['path']}")
    print(f"종류: {info['kind']} | 크기: {info['size']}바이트 | SHA-256: {info['sha256']}")
    if info["kind"] == "save":
        print(f"장면: {data.get('m_scene')} | 이름: {data.get('m_name')} | 턴: {data.get('m_turn')}")
        money = sdict_get(data.get("m_itemDic", {}), 10001, 0)
        pts = sdict_get(data.get("m_itemDic", {}), 10002, 0)
        print(f"전폐(10001): {money} | 감오점(10002): {pts}")
    elif info["kind"] == "global":
        counts = {k: len(data[k].get("m_Keys", [])) for k in GLOBAL_DATA_HASH_FIELDS if k in data}
        print("전역 해금 항목 수:", json.dumps(counts, ensure_ascii=False))
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def cmd_validate(args) -> int:
    data, _, info = read_encrypted_json(args.file)
    errs = validate_data(data)
    if errs:
        print(f"검증 실패 ({info['name']}):")
        for e in errs:
            print(" -", e)
        return 1
    print(f"검증 성공: {info['name']} ({info['kind']})")
    return 0


def cmd_presets(args) -> int:
    if args.list or not args.file:
        print("사용 가능한 프리셋 목록:")
        for pid, meta in PRESETS.items():
            print(f" - {pid} ({meta['target']}): {meta['name']} - {meta['description']}")
        return 0

    data, _, info = read_encrypted_json(args.file)
    for pid in args.apply:
        apply_preset(data, pid)
    res = write_encrypted_json(args.file, data, expected_sha256=info["sha256"])
    print(f"프리셋 적용 및 저장 완료: {res['path']} (백업: {res['backupPath']})")
    return 0


def cmd_edit(args) -> int:
    data, _, info = read_encrypted_json(args.file)
    if args.set_name is not None:
        data["m_name"] = args.set_name
    if args.money is not None:
        sdict_set(data.setdefault("m_itemDic", sdict()), 10001, int(args.money))
    if args.points is not None:
        sdict_set(data.setdefault("m_itemDic", sdict()), 10002, int(args.points))
    if args.set_item:
        item_dic = data.setdefault("m_itemDic", sdict())
        for spec in args.set_item:
            k_str, v_str = spec.split("=", 1)
            sdict_set(item_dic, int(k_str), int(v_str))
    eff_specs = list(args.set_stat or []) + list(args.set_effect or [])
    if eff_specs:
        eff_dic = data.setdefault("m_effectDic", sdict())
        for spec in eff_specs:
            k_str, v_str = spec.split("=", 1)
            sdict_set(eff_dic, int(k_str), float(v_str))
    if args.max_wuxue:
        wx_dic = data.setdefault("m_wuXueExpDic", sdict())
        for wid, max_exp in WUXUE_MAX_EXP.items():
            sdict_set(wx_dic, wid, max_exp)
    if args.unlock_all_global:
        apply_preset(data, "global_unlock_all")
    if args.preset:
        for pid in args.preset:
            apply_preset(data, pid)

    errs = validate_data(data)
    if errs:
        raise ValueError("편집 후 스키마 검증 실패: " + "; ".join(errs))

    out_target = args.output or args.file
    expected = info["sha256"] if Path(out_target).resolve() == Path(args.file).resolve() else None
    res = write_encrypted_json(out_target, data, expected_sha256=expected)
    print(f"편집 저장 완료: {res['path']} (백업: {res['backupPath']})")
    return 0


def cmd_serve(args) -> int:
    token = secrets.token_urlsafe(24)
    server = ThreadingHTTPServer((args.host, args.port), JinGuHandler)
    server.jingu_token = token
    server.save_dir_override = Path(args.save_dir) if args.save_dir else None
    url = f"http://{args.host}:{args.port}/"
    print(f"{APP_NAME} v{APP_VERSION} 서버가 시작되었습니다: {url}")
    print(f"인증 토큰 ({TOKEN_HEADER}): {token}")
    if args.open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.server_close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jingu_editor.py", description=f"{APP_NAME} v{APP_VERSION}")
    sub = parser.add_subparsers(dest="command")

    p_demo = sub.add_parser("demo", help="암복호화 및 프리셋 데모 실행")
    p_demo.add_argument("out", nargs="?", help="저장할 데모 .bytes 경로 (선택)")
    p_demo.add_argument("--global", dest="is_global", action="store_true", help="Setting.bytes 전역 데모 생성")
    p_demo.set_defaults(func=cmd_demo)

    p_ins = sub.add_parser("inspect", help="세이브 파일 정보 및 내용 조회")
    p_ins.add_argument("file", help=".bytes 세이브 파일 경로")
    p_ins.add_argument("--json", action="store_true", help="전체 JSON 출력")
    p_ins.set_defaults(func=cmd_inspect)

    p_val = sub.add_parser("validate", help="세이브 파일 스키마 검증")
    p_val.add_argument("file", help=".bytes 세이브 파일 경로")
    p_val.set_defaults(func=cmd_validate)

    p_pre = sub.add_parser("presets", help="프리셋 목록 조회 및 적용")
    p_pre.add_argument("--list", action="store_true", help="프리셋 목록 출력")
    p_pre.add_argument("--file", help="적용할 .bytes 파일 경로")
    p_pre.add_argument("--apply", nargs="+", default=[], help="적용할 프리셋 ID")
    p_pre.set_defaults(func=cmd_presets)

    p_edit = sub.add_parser("edit", help="세이브 파일 항목 편집")
    p_edit.add_argument("file", help=".bytes 세이브 파일 경로")
    p_edit.add_argument("--output", help="다른 경로에 저장")
    p_edit.add_argument("--set-name", help="세이브 이름 변경")
    p_edit.add_argument("--money", type=int, help="전폐(10001) 수량 설정")
    p_edit.add_argument("--points", type=int, help="감오점(10002) 수량 설정")
    p_edit.add_argument("--set-item", action="append", help="아이템 설정 (예: 10001=1000000)")
    p_edit.add_argument("--set-effect", action="append", help="속성/효과 설정 (예: 101=100)")
    p_edit.add_argument("--set-stat", action="append", help="속성/효과 설정 별칭 (예: 101=100)")
    p_edit.add_argument("--max-wuxue", action="store_true", help="전 무학 최대 수련치 적용")
    p_edit.add_argument("--unlock-all-global", action="store_true", help="전역 도감·업적 전체 해금")
    p_edit.add_argument("--preset", action="append", help="함께 적용할 프리셋 ID")
    p_edit.set_defaults(func=cmd_edit)

    p_srv = sub.add_parser("serve", help="로컬 웹 에디터 서버 실행")
    p_srv.add_argument("--host", default=DEFAULT_HOST, help=f"바인드 호스트 (기본: {DEFAULT_HOST})")
    p_srv.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"포트 번호 (기본: {DEFAULT_PORT})")
    p_srv.add_argument("--save-dir", help="세이브 폴더 경로 직접 지정")
    p_srv.add_argument("--open-browser", action="store_true", help="서버 시작 시 브라우저 열기")
    p_srv.set_defaults(func=cmd_serve)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return 0
    try:
        return args.func(args)
    except Exception as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
