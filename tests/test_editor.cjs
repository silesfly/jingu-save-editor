'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const HANZI_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const HTML_TAG_RE = /<[^>]+>/;
const HANGUL_RE = /[\uAC00-\uD7A3]/;

const PASSWORD = 'MyPassword';
const SALT = Buffer.from([0x02, 0x23, 0x7e, 0x7a, 0x9c, 0x7d, 0x62, 0x96]);
const ITERATIONS = 1000;
const KEY_LEN = 32;
const IV_LEN = 16;

function deriveKeyAndIv() {
  const dk = crypto.pbkdf2Sync(PASSWORD, SALT, ITERATIONS, KEY_LEN + IV_LEN, 'sha1');
  return {
    dk,
    key: dk.subarray(0, KEY_LEN),
    iv: dk.subarray(KEY_LEN, KEY_LEN + IV_LEN),
  };
}

function nodeEncryptUtf8(text) {
  const { key, iv } = deriveKeyAndIv();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
}

function nodeDecryptToUtf8(buf) {
  const { key, iv } = deriveKeyAndIv();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(Buffer.from(buf)), decipher.final()]).toString('utf8');
}

function openEditorSession(EditorCore, bytes, catalog, name) {
  const sess = EditorCore.createSession(catalog);
  sess.loadBytes(bytes, name || 'test.bytes');
  return sess;
}

function pass(name) {
  console.log(`[PASS] ${name}`);
}

function run() {
  global.window = global;
  const catalogMod = require(path.join(ROOT_DIR, 'src', 'catalog-data.js'));
  if (!global.window.JinGuCatalog && catalogMod) {
    global.window.JinGuCatalog = catalogMod;
  }
  const codecMod = require(path.join(ROOT_DIR, 'src', 'jingu-codec.js'));
  if (!global.window.JinGuCodec && codecMod) {
    global.window.JinGuCodec = codecMod;
  }
  const editorMod = require(path.join(ROOT_DIR, 'src', 'editor-core.js'));
  if (!global.window.JinGuEditorCore && editorMod) {
    global.window.JinGuEditorCore = editorMod;
  }

  const C = global.window.JinGuCatalog;
  const Codec = global.window.JinGuCodec;
  const EditorCore = global.window.JinGuEditorCore;

  assert.ok(C && typeof C === 'object', 'JinGuCatalog must be loaded');
  assert.ok(Codec && typeof Codec === 'object', 'JinGuCodec must be loaded');
  assert.ok(EditorCore && typeof EditorCore === 'object', 'JinGuEditorCore must be loaded');
  pass('1. Module loading & global.window bindings');

  assert.ok(Array.isArray(C.items) && C.items.length > 900, `items.length > 900 (got ${C.items && C.items.length})`);
  assert.ok(Array.isArray(C.equips) && C.equips.length > 100, `equips.length > 100 (got ${C.equips && C.equips.length})`);
  assert.ok(Array.isArray(C.wuxue) && C.wuxue.length >= 200, `wuxue.length >= 200 (got ${C.wuxue && C.wuxue.length})`);
  assert.ok(Array.isArray(C.skills) && C.skills.length > 1000, `skills.length > 1000 (got ${C.skills && C.skills.length})`);
  assert.ok(Array.isArray(C.passives) && C.passives.length > 500, `passives.length > 500 (got ${C.passives && C.passives.length})`);
  assert.ok(Array.isArray(C.npcs) && C.npcs.length > 400, `npcs.length > 400 (got ${C.npcs && C.npcs.length})`);
  assert.strictEqual(C.scenes.length, 165, `scenes.length === 165 (got ${C.scenes && C.scenes.length})`);
  assert.ok(Array.isArray(C.achieves) && C.achieves.length > 150, `achieves.length > 150 (got ${C.achieves && C.achieves.length})`);
  assert.strictEqual(C.effects.length, 80, `effects.length === 80 (got ${C.effects && C.effects.length})`);
  assert.strictEqual(C.trees.length, 80, `trees.length === 80 (got ${C.trees && C.trees.length})`);

  const serializedCatalog = JSON.stringify(C);
  assert.strictEqual(HANZI_RE.test(serializedCatalog), false, 'Catalog JSON must contain zero raw Hanzi');

  for (const listName of ['items', 'wuxue', 'skills', 'scenes']) {
    for (const entry of C[listName]) {
      const label = entry && (entry.name || entry.title || '');
      assert.strictEqual(
        HTML_TAG_RE.test(String(label)),
        false,
        `HTML/markup tag found in ${listName}: ${label}`
      );
    }
  }
  pass('2. Catalog integrity (counts, zero Hanzi, zero HTML tags)');

  const demoBytes = EditorCore.buildDemoSaveBytes(C);
  assert.ok(demoBytes && demoBytes.length > 0, 'buildDemoSaveBytes must return non-empty bytes');

  const decodedDemo = Codec.decodeSaveBytes(demoBytes);
  assert.ok(decodedDemo && decodedDemo.ast, 'decodeSaveBytes must return object with ast');

  const reencodedPureJs = Buffer.from(Codec.encodeSaveAst(decodedDemo.ast));
  const decryptedByNode = nodeDecryptToUtf8(reencodedPureJs);
  const reencryptedByNode = nodeEncryptUtf8(decryptedByNode);

  assert.strictEqual(
    Buffer.compare(reencodedPureJs, reencryptedByNode),
    0,
    'Pure-JS JinGuCodec.encodeSaveAst ciphertext must match Node crypto byte-for-byte'
  );
  const decodedFromNode = Codec.decodeSaveBytes(reencryptedByNode);
  assert.ok(decodedFromNode && decodedFromNode.ast, 'decodeSaveBytes must decode Node-encrypted ciphertext');
  pass('3. Codec parity (pure-JS PBKDF2 + AES-256-CBC === Node crypto)');

  const int64SaveTime = '638990123456789012';
  const int64ItemTick = '638990987654321987';
  const baseJsonObj = JSON.parse(decryptedByNode);
  baseJsonObj.m_saveTime = 0;
  baseJsonObj.m_itemTimeDic = { m_Keys: [], m_Values: [] };
  let rawInt64Json = JSON.stringify(baseJsonObj);
  rawInt64Json = rawInt64Json.replace('"m_saveTime":0', `"m_saveTime":${int64SaveTime}`);
  rawInt64Json = rawInt64Json.replace(
    '"m_itemTimeDic":{"m_Keys":[],"m_Values":[]}',
    `"m_itemTimeDic":{"m_Keys":[1001],"m_Values":[${int64ItemTick}]}`
  );

  const encryptedInt64 = nodeEncryptUtf8(rawInt64Json);
  const parsedInt64 = Codec.decodeSaveBytes(encryptedInt64);
  const roundTrippedBytes = Codec.encodeSaveAst(parsedInt64.ast);
  const roundTrippedJson = nodeDecryptToUtf8(roundTrippedBytes);

  assert.ok(
    roundTrippedJson.includes(`"m_saveTime":${int64SaveTime}`),
    'm_saveTime Int64 exact digits must survive Codec round-trip'
  );
  assert.ok(
    roundTrippedJson.includes(int64ItemTick),
    'm_itemTimeDic Int64 exact digits must survive Codec round-trip'
  );

  const int64Session = openEditorSession(EditorCore, encryptedInt64, C, 'int64.bytes');
  int64Session.setMoney(123456);
  const exportedInt64Bytes = int64Session.saveBytes();
  const exportedInt64Json = nodeDecryptToUtf8(exportedInt64Bytes);
  assert.ok(
    exportedInt64Json.includes(int64SaveTime),
    'm_saveTime Int64 exact digits must survive EditorCore session saveBytes'
  );
  assert.ok(
    exportedInt64Json.includes(int64ItemTick),
    'm_itemTimeDic Int64 exact digits must survive EditorCore session saveBytes'
  );
  pass('4. Lossless Int64 round-trip');

  const session = openEditorSession(EditorCore, demoBytes, C, 'demo.bytes');
  assert.strictEqual(session.getKind(), 'save', 'SaveData session getKind() must be "save"');

  const initialSummary = session.getSummary();
  assert.ok(initialSummary && typeof initialSummary === 'object', 'getSummary() must return an object');

  session.setMeta({
    leaderFamily: '\uB3C5\uACE0',
    leaderName: '\uAD6C\uD328',
    tiLi: 90,
    leaderDirection: 2,
  });
  session.setMoney(8888888);
  session.setComprehensionPoints(777);

  const statsBefore = session.getDerivedStats();
  session.setEffect(101, 120);
  const statsAfter = session.getDerivedStats();
  assert.notDeepStrictEqual(statsAfter, statsBefore, 'getDerivedStats() must reflect setEffect(101, 120)');

  const testItemId = C.items[0].id;
  session.setItemCount(testItemId, 5);
  session.setItemCount(testItemId, 12);
  session.setItemCount(testItemId, 0);

  const firstWeapon = C.equips.find((e) => e.slot === 0 || e.equipType === 0 || e.type === 0 || e.equipPos === 0) || C.equips[0];
  session.setEquip(0, firstWeapon.id);

  const npcId = C.npcs[0].id;
  session.setPartySlot(1, npcId);
  session.toggleRecruit(npcId);

  const wuxueId = C.wuxue[0].id;
  session.setWuXueExp(wuxueId, 5000);
  session.maxOutAllWuXue();

  session.setActiveSlot('m_quanActives', 0, wuxueId);
  session.setPassiveSlot(0, C.passives[0].id);

  assert.strictEqual(session.getSummary().tiLi, 90);
  session.toggleHashId('m_ganWuHash', C.trees[0].id);

  for (const preset of [
    'money_rich',
    'max_six_stats',
    'max_life_skills',
    'full_ganwu',
    'full_recipes',
  ]) {
    session.applyPreset(preset);
  }

  const saveValidation = session.validate();
  assert.strictEqual(saveValidation.ok, true, `SaveData validate().ok must be true: ${JSON.stringify(saveValidation)}`);

  const diff = session.computeDiff();
  assert.ok(diff && (Array.isArray(diff) ? diff.length > 0 : Object.keys(diff).length > 0), 'computeDiff() must report changes');

  const updatedSummary = session.getSummary();
  assert.strictEqual(updatedSummary.leaderFamily, '\uB3C5\uACE0');
  assert.strictEqual(updatedSummary.leaderName, '\uAD6C\uD328');
  assert.strictEqual(updatedSummary.tiLi, 100);

  const reimportedSession = openEditorSession(EditorCore, session.saveBytes(), C, 'reimported.bytes');
  assert.strictEqual(reimportedSession.validate().ok, true);
  pass('5. SaveData session (meta, stats, items, equips, party, wuxue, skills, presets, validate, diff)');

  const globalBytes = EditorCore.buildDemoGlobalBytes(C);
  assert.ok(globalBytes && globalBytes.length > 0, 'buildDemoGlobalBytes must return non-empty bytes');

  const globalSession = openEditorSession(EditorCore, globalBytes, C, 'Setting.bytes');
  assert.strictEqual(globalSession.getKind(), 'global', 'GlobalData session getKind() must be "global"');

  globalSession.toggleHashId('m_achieveHash', C.achieves[0].id);
  globalSession.applyPreset('global_unlock_all');

  const globalValidation = globalSession.validate();
  assert.strictEqual(globalValidation.ok, true, `GlobalData validate().ok must be true: ${JSON.stringify(globalValidation)}`);
  pass('6. GlobalData (Setting.bytes) session');

  const tampered = Uint8Array.from(demoBytes);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;

  const wrongKeyDk = crypto.pbkdf2Sync('WrongPassword', SALT, ITERATIONS, KEY_LEN + IV_LEN, 'sha1');
  const wrongCipher = crypto.createCipheriv(
    'aes-256-cbc',
    wrongKeyDk.subarray(0, KEY_LEN),
    wrongKeyDk.subarray(KEY_LEN, KEY_LEN + IV_LEN)
  );
  const wrongKeyBytes = Buffer.concat([wrongCipher.update(Buffer.from('{"m_equips":[]}')), wrongCipher.final()]);

  const badJsonBytes = nodeEncryptUtf8('{not-valid-json');

  const invalidCases = [
    ['empty buffer', new Uint8Array(0)],
    ['truncated buffer', new Uint8Array(5)],
    ['non-block-aligned buffer', new Uint8Array(17)],
    ['tampered ciphertext', tampered],
    ['wrong-key ciphertext', wrongKeyBytes],
    ['corrupted JSON payload', badJsonBytes],
  ];

  for (const [label, payload] of invalidCases) {
    let caught = null;
    try {
      Codec.decodeSaveBytes(payload);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof Error, `Expected Error for ${label}`);
    assert.ok(
      HANGUL_RE.test(caught.message),
      `Expected Korean error message for ${label}, got: ${caught.message}`
    );
  }
  pass('7. Corrupted/tampered/wrong-key/truncated .bytes throws clean Korean Error');

  const distHtmlPath = path.join(ROOT_DIR, 'dist', 'JinGuSaveEditor-v1.0.html');
  if (fs.existsSync(distHtmlPath)) {
    const html = fs.readFileSync(distHtmlPath, 'utf8');
    assert.strictEqual(/<script\b[^>]*\bsrc\s*=/i.test(html), false, 'dist HTML must have 0 <script src>');
    const strippedSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.strictEqual(/https?:\/\//i.test(strippedSvgNs), false, 'dist HTML must have 0 external http(s) URLs');
    assert.strictEqual(HANZI_RE.test(html), false, 'dist HTML must have 0 raw Hanzi');
    pass('8. dist/JinGuSaveEditor-v1.0.html audit (0 external URLs, 0 script src, 0 raw Hanzi)');
  } else {
    pass('8. dist/JinGuSaveEditor-v1.0.html not present (skipped)');
  }

  console.log('ALL_JS_TESTS_PASS');
}

run();
