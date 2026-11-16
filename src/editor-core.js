(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./jingu-codec'));
  } else {
    root.JinGuEditorCore = factory(root.JinGuCodec);
  }
})(typeof self !== 'undefined' ? self : this, function(Codec) {
  'use strict';

  if (!Codec) throw new Error('코덱을 불러올 수 없습니다.');

  var SAVE_HASH_FIELDS = {
    m_globalBuffHash: true, m_treasureHash: true, m_receiveHash: true,
    m_completeHash: true, m_failHash: true, m_danYaoGotHash: true,
    m_fishGotHash: true, m_itemGotHash: true, m_dialogHash: true,
    m_dialogLockHash: true, m_wanderHash: true, m_wanderLockHash: true,
    m_weiTuoLockHash: true, m_unlockHash: true, m_dotHash: true,
    m_postRewardHash: true, m_takeHash: true, m_danFangHash: true,
    m_daZaoHash: true, m_ganWuHash: true, m_favoBookHash: true,
    m_treasureLockHash: true, m_campHash: true, m_readedHash: true,
    m_levelHash: true, m_chessHash: true
  };

  var GLOBAL_HASH_FIELDS = {
    m_guideHash: true, m_achieveHash: true, m_equipHash: true,
    m_wuXueHash: true, m_danFangHash: true, m_daZaoHash: true,
    m_propHash: true, m_matHash: true, m_fishHash: true, m_huntHash: true
  };

  var ALL_HASH_FIELDS = {};
  Object.keys(SAVE_HASH_FIELDS).forEach(function(k) { ALL_HASH_FIELDS[k] = true; });
  Object.keys(GLOBAL_HASH_FIELDS).forEach(function(k) { ALL_HASH_FIELDS[k] = true; });

  var DICT_FIELDS = {
    m_effectDic: true, m_npcDic: true, m_monsterDic: true, m_resDic: true,
    m_itemDic: true, m_itemTimeDic: true, m_weiTuoDic: true,
    m_dialogCDDic: true, m_dialogTurnDic: true, m_wuXueExpDic: true,
    m_characterDic: true, m_delayShowDic: true, m_monsterShowDic: true,
    m_resShowDic: true, m_delayHideDic: true, m_delayDotDic: true,
    m_delayCancelDotDic: true, m_animalExpDic: true, m_friendLvDic: true,
    m_storeDic: true, m_postDic: true, m_treasureDic: true
  };

  var ACTIVE_FIELDS = {
    m_quanActives: true, m_daoActives: true, m_jianActives: true,
    m_qiangActives: true, m_anqiActives: true, m_qinActives: true
  };

  var META_MAP = {
    leaderFamily: 'm_leaderFamily', leaderName: 'm_leaderName',
    saveName: 'm_name', name: 'm_name',
    diffucultEnum: 'm_diffucultEnum', difficulty: 'm_diffucultEnum',
    scene: 'm_scene', turn: 'm_turn', tiLi: 'm_tiLi',
    gameTime: 'm_gameTime', realTime: 'm_realTime',
    yangCheng: 'm_yangCheng', hp: 'm_hp', mp: 'm_mp',
    jingLi: 'm_jingLi', fishRob: 'm_fishRob', huntBow: 'm_huntBow',
    leaderDirection: 'm_leaderDirection'
  };

  var STAT_NAMES = ['공격', '방어', '생명', '내력', '속도', '명중', '회피', '치명', '저항', '기세'];

  function isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v) && !Codec.isJgNum(v);
  }
  function jgGet(o, k) {
    if (!o) return undefined;
    if (Codec.isJgObj(o)) return Codec.objGet(o, k);
    return o[k];
  }
  function jgSet(o, k, v) {
    if (Codec.isJgObj(o)) return Codec.objSet(o, k, v);
    if (o) o[k] = v;
    return v;
  }
  function jgHas(o, k) {
    if (!o) return false;
    return Codec.isJgObj(o) ? Codec.objHas(o, k) : Object.prototype.hasOwnProperty.call(o, k);
  }
  function jgDel(o, k) {
    if (!o) return;
    if (Codec.isJgObj(o)) return Codec.objDelete(o, k);
    try { delete o[k]; } catch (e) {}
  }
  function jgKeys(o) {
    if (!o) return [];
    return Codec.isJgObj(o) ? Codec.objKeys(o) : Object.keys(o);
  }
  function newObj() { return Codec.makeObj([]); }
  function num(v, isInt) {
    if (isInt) {
      var n = typeof v === 'bigint' ? v : Math.trunc(Number(v));
      return Codec.makeNum(typeof n === 'bigint' ? n.toString() : String(n), true);
    }
    var f = Number(v);
    if (!isFinite(f)) f = 0;
    return Codec.makeNum(Number.isInteger(f) ? f.toFixed(1) : String(f), false);
  }
  function numRaw(v) { return Codec.isJgNum(v) ? Codec.numRaw(v) : String(v); }
  function toNum(v, d) {
    if (Codec.isJgNum(v)) {
      var n = Codec.numValue(v);
      return typeof n === 'bigint' ? Number(n) : Number(n);
    }
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '') {
      var p = Number(v);
      if (!isNaN(p)) return p;
    }
    return d === undefined ? 0 : d;
  }
  function toInt(v, d) {
    var n = toNum(v, d === undefined ? 0 : d);
    return Math.trunc(n);
  }
  function toBig(v, d) {
    if (Codec.isJgNum(v)) {
      try { return Codec.numBigInt(v); } catch (e) {}
      var r = Codec.numRaw(v);
      try { return BigInt(r); } catch (e2) {}
    }
    if (typeof v === 'bigint') return v;
    try { return BigInt(String(v)); } catch (e3) { return BigInt(d || 0); }
  }
  function ensureObj(parent, key) {
    var v = jgGet(parent, key);
    if (!isObj(v) || (!Codec.isJgObj(v) && !jgKeys(v).length && Array.isArray(v))) {
      v = newObj();
      jgSet(parent, key, v);
    }
    return v;
  }
  function ensureArray(parent, key, len) {
    var v = jgGet(parent, key);
    if (!Array.isArray(v)) {
      v = [];
      for (var i = 0; i < len; i++) v.push(num(0, true));
      jgSet(parent, key, v);
    }
    while (v.length < len) v.push(num(0, true));
    return v;
  }
  function arrInt(arr, i) { return arr && i >= 0 && i < arr.length ? toInt(arr[i], 0) : 0; }
  function setArr(parent, key, idx, val, len) {
    var a = ensureArray(parent, key, len || 0);
    while (a.length <= idx) a.push(num(0, true));
    a[idx] = num(val, true);
    return a;
  }
  function hashObj(ids) {
    var h = newObj();
    var a = [];
    (ids || []).forEach(function(id) { a.push(num(id, true)); });
    jgSet(h, 'm_Keys', a);
    return h;
  }
  function dictObj(pairs) {
    var d = newObj();
    var ks = [], vs = [];
    (pairs || []).forEach(function(p) {
      ks.push(num(p[0], true));
      vs.push(p[1]);
    });
    jgSet(d, 'm_Keys', ks);
    jgSet(d, 'm_Values', vs);
    return d;
  }
  function hashIds(v) {
    if (!isObj(v)) return [];
    var a = jgGet(v, 'm_Keys');
    if (!Array.isArray(a)) return [];
    return a.map(function(x) { return toInt(x, 0); });
  }
  function dictArrays(d) {
    var ks = jgGet(d, 'm_Keys');
    var vs = jgGet(d, 'm_Values');
    if (!Array.isArray(ks)) { ks = []; jgSet(d, 'm_Keys', ks); }
    if (!Array.isArray(vs)) { vs = []; jgSet(d, 'm_Values', vs); }
    return { keys: ks, values: vs };
  }
  function findKeyIndex(d, id) {
    var a = dictArrays(d);
    var target = Number(id);
    for (var i = 0; i < a.keys.length; i++) {
      if (toNum(a.keys[i], NaN) === target) return i;
    }
    return -1;
  }

  function resolveCatalogList(catalog, keys) {
    if (!catalog) return [];
    for (var i = 0; i < keys.length; i++) {
      var v = catalog[keys[i]];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        var out = [];
        Object.keys(v).forEach(function(k) {
          var e = v[k];
          if (e && typeof e === 'object') {
            if (e.id === undefined) {
              try { e.id = isNaN(Number(k)) ? k : Number(k); } catch (e2) {}
            }
            out.push(e);
          } else {
            out.push({ id: isNaN(Number(k)) ? k : Number(k), value: e });
          }
        });
        return out;
      }
    }
    return [];
  }
  function findCatalogEntry(catalog, id, keys) {
    if (!catalog || id === undefined || id === null) return null;
    var nid = Number(id);
    var maps = ['itemMap', 'itemsById', 'equipMap', 'wuxueMap', 'npcMap'];
    for (var m = 0; m < maps.length; m++) {
      var mp = catalog[maps[m]];
      if (mp && typeof mp === 'object' && !Array.isArray(mp)) {
        if (mp[id] !== undefined) return mp[id];
        if (mp[String(id)] !== undefined) return mp[String(id)];
      }
    }
    var lists = keys || ['items', 'equips', 'wuxue', 'npcs', 'trees'];
    for (var l = 0; l < lists.length; l++) {
      var arr = catalog[lists[l]];
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) {
          var e = arr[i];
          if (Number(e && e.id) === nid) return e;
        }
      } else if (arr && typeof arr === 'object') {
        if (arr[id] !== undefined) return arr[id];
        if (arr[String(id)] !== undefined) return arr[String(id)];
      }
    }
    return null;
  }
  function entryType2(entry) {
    if (!entry) return 0;
    var v = entry.type2 !== undefined ? entry.type2 : entry.type2Enum;
    return toInt(v, 0);
  }
  function computeLeaderId(equipsArr, catalog) {
    var weaponId = equipsArr && equipsArr.length ? toInt(equipsArr[0], 0) : 0;
    if (!weaponId) return 3;
    var e = findCatalogEntry(catalog, weaponId, ['items', 'equips', 'itemList', 'allItems']);
    var t = entryType2(e);
    var map = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
    return map[t] || 3;
  }
  function catalogIds(catalog, keys) {
    var arr = resolveCatalogList(catalog, keys);
    return arr.map(function(e) { return toInt(e && e.id !== undefined ? e.id : e, 0); })
      .filter(function(v) { return v > 0; });
  }

  function defaultHash() { return hashObj([]); }
  function defaultDict() { return dictObj([]); }
  function defaultActive(len) {
    var a = [];
    for (var i = 0; i < (len || 6); i++) a.push(num(0, true));
    return a;
  }
  function defaultEquips() {
    var a = [];
    for (var i = 0; i < 4; i++) a.push(num(0, true));
    return a;
  }
  function defaultFights() {
    var a = [num(3, true)];
    for (var i = 1; i < 5; i++) a.push(num(0, true));
    return a;
  }
  function defaultPos() {
    var p = newObj();
    jgSet(p, 'x', num(0, true));
    jgSet(p, 'y', num(0, true));
    return p;
  }
  function nowTicks() {
    return String(BigInt(Date.now()) * 10000n + 621355968000000000n);
  }
  function makeSaveAst(catalog, opts) {
    var ast = newObj();
    var o = opts || {};
    var add = function(k, v) { jgSet(ast, k, v); };
    add('m_diffucultEnum', num(o.diffucultEnum || 1, true));
    add('m_scene', num(o.scene || 0, true));
    add('m_pos', defaultPos());
    add('m_gameTime', num(o.gameTime || 0, false));
    add('m_realTime', num(o.realTime || 0, false));
    add('m_effectDic', defaultDict());
    add('m_saveTime', Codec.makeNum(nowTicks(), true));
    add('m_path', '');
    add('m_name', o.saveName || '초기 세이브');
    add('m_skin', o.skin || 'PuTong');
    add('m_yangCheng', !!o.yangCheng);
    add('m_equips', defaultEquips());
    add('m_globalBuffHash', defaultHash());
    add('m_npcDic', defaultDict());
    add('m_monsterDic', defaultDict());
    add('m_resDic', defaultDict());
    add('m_treasureHash', defaultHash());
    add('m_itemDic', defaultDict());
    add('m_itemTimeDic', defaultDict());
    add('m_receiveHash', defaultHash());
    add('m_completeHash', defaultHash());
    add('m_failHash', defaultHash());
    add('m_danYaoGotHash', defaultHash());
    add('m_fishGotHash', defaultHash());
    add('m_itemGotHash', defaultHash());
    add('m_dialogHash', defaultHash());
    add('m_dialogLockHash', defaultHash());
    add('m_wanderHash', defaultHash());
    add('m_wanderLockHash', defaultHash());
    add('m_weiTuoDic', defaultDict());
    add('m_weiTuoLockHash', defaultHash());
    add('m_dialogCDDic', defaultDict());
    add('m_dialogTurnDic', defaultDict());
    add('m_unlockHash', defaultHash());
    add('m_dotHash', defaultHash());
    add('m_postRewardHash', defaultHash());
    add('m_showMainId', num(0, true));
    add('m_showBranchId', num(0, true));
    add('m_fishRob', num(0, true));
    add('m_huntBow', num(0, true));
    add('m_tiLi', num(o.tiLi === undefined ? 20 : o.tiLi, true));
    add('m_turn', num(o.turn === undefined ? 1 : o.turn, true));
    add('m_takeHash', defaultHash());
    add('m_fights', defaultFights());
    add('m_leaderFamily', o.leaderFamily || '장');
    add('m_leaderName', o.leaderName || '삼풍');
    add('m_leaderDirection', num(o.leaderDirection === undefined ? 6 : o.leaderDirection, true));
    add('m_hp', num(o.hp === undefined ? 1 : o.hp, false));
    add('m_mp', num(o.mp === undefined ? 1 : o.mp, false));
    add('m_jingLi', num(o.jingLi === undefined ? 1 : o.jingLi, false));
    add('m_wuXueExpDic', defaultDict());
    add('m_danFangHash', defaultHash());
    add('m_daZaoHash', defaultHash());
    add('m_characterDic', defaultDict());
    add('m_ganWuHash', defaultHash());
    add('m_quanActives', defaultActive(6));
    add('m_daoActives', defaultActive(6));
    add('m_jianActives', defaultActive(6));
    add('m_qiangActives', defaultActive(6));
    add('m_anqiActives', defaultActive(6));
    add('m_qinActives', defaultActive(6));
    add('m_passives', defaultActive(3));
    add('m_favoBookHash', defaultHash());
    add('m_delayShowDic', defaultDict());
    add('m_monsterShowDic', defaultDict());
    add('m_resShowDic', defaultDict());
    add('m_delayHideDic', defaultDict());
    add('m_delayDotDic', defaultDict());
    add('m_delayCancelDotDic', defaultDict());
    add('m_animalExpDic', defaultDict());
    add('m_friendLvDic', defaultDict());
    add('m_storeDic', defaultDict());
    add('m_postDic', defaultDict());
    add('m_treasureDic', defaultDict());
    add('m_treasureLockHash', defaultHash());
    add('m_campHash', defaultHash());
    add('m_readedHash', defaultHash());
    add('m_levelHash', defaultHash());
    add('m_chessHash', defaultHash());
    return ast;
  }
  function fillMissingSaveFields(ast) {
    var template = makeSaveAst(null, {});
    var tkeys = jgKeys(template);
    for (var i = 0; i < tkeys.length; i++) {
      var k = tkeys[i];
      if (!jgHas(ast, k)) jgSet(ast, k, jgGet(template, k));
    }
    return ast;
  }
  function makeGlobalAst() {
    var ast = newObj();
    ['m_guideHash', 'm_achieveHash', 'm_equipHash', 'm_wuXueHash',
     'm_danFangHash', 'm_daZaoHash', 'm_propHash', 'm_matHash',
     'm_fishHash', 'm_huntHash'].forEach(function(k) {
      jgSet(ast, k, defaultHash());
    });
    return ast;
  }
  function buildDemoSaveBytes(catalog) {
    var ast = makeSaveAst(catalog, {});
    var equips = jgGet(ast, 'm_equips');
    var leader = computeLeaderId(equips, catalog);
    setArr(ast, 'm_fights', 0, leader, 5);
    return Codec.encodeSaveAst(ast);
  }
  function buildDemoGlobalBytes(catalog) {
    return Codec.encodeSaveAst(makeGlobalAst());
  }

  function listPresets() {
    return [
      { id: 'money_rich', name: '부유한 재산', desc: '돈 1억, 보조 화폐 999', targetKind: 'save' },
      { id: 'max_six_stats', name: '육대 능력 최대', desc: '기본 능력과 포인트 능력 최대', targetKind: 'save' },
      { id: 'max_life_skills', name: '생활 기술 최대', desc: '생활 기술과 체력 최대', targetKind: 'save' },
      { id: 'full_ganwu', name: '깨달음 전체 해금', desc: '모든 깨달음 해금', targetKind: 'save' },
      { id: 'full_recipes', name: '제작법 전체 해금', desc: '모든 단방과 대조 해금', targetKind: 'save' },
      { id: 'global_unlock_all', name: '전역 전체 해금', desc: '모든 업적과 도감 해금', targetKind: 'global' }
    ];
  }

  function createSession(catalog) {
    var state = {
      catalog: catalog || {},
      kind: null,
      ast: null,
      fileName: '',
      originalAst: null,
      originalKind: null
    };

    function ensureLoaded() {
      if (!state.ast) throw new Error('세이브가 로드되지 않았습니다.');
      return state.ast;
    }
    function top(k, def) {
      var a = ensureLoaded();
      var v = jgGet(a, k);
      if (v === undefined && def !== undefined) {
        if (def === 'dict') { v = defaultDict(); jgSet(a, k, v); }
        else if (def === 'hash') { v = defaultHash(); jgSet(a, k, v); }
        else if (def === 'arr') { v = []; jgSet(a, k, v); }
      }
      return v;
    }
    function saveOrThrow() {
      if (state.kind !== 'save') throw new Error('세이브 파일에서만 사용할 수 있습니다.');
      return ensureLoaded();
    }
    function globalOrThrow() {
      if (state.kind !== 'global') throw new Error('전역 설정에서만 사용할 수 있습니다.');
      return ensureLoaded();
    }
    function loadBytes(u8, fileName) {
      var r = Codec.decodeSaveBytes(u8);
      state.kind = r.kind;
      state.ast = r.ast;
      state.fileName = fileName || '';
      if (r.kind === 'save') fillMissingSaveFields(state.ast);
      else fillMissingGlobalFields(state.ast);
      state.originalAst = cloneAst(state.ast);
      state.originalKind = state.kind;
      return session;
    }
    function fillMissingGlobalFields(ast) {
      var t = makeGlobalAst();
      var keys = jgKeys(t);
      for (var i = 0; i < keys.length; i++) {
        if (!jgHas(ast, keys[i])) jgSet(ast, keys[i], jgGet(t, keys[i]));
      }
      return ast;
    }
    function saveBytes() {
      if (!state.ast) throw new Error('세이브가 로드되지 않았습니다.');
      return Codec.encodeSaveAst(state.ast);
    }
    function getKind() { return state.kind; }
    function getFileName() { return state.fileName; }
    function getAst() { return state.ast; }
    function cloneAst(v) {
      if (!v) return v;
      if (Codec.isJgNum(v)) return Codec.makeNum(Codec.numRaw(v), Codec.numRaw(v).indexOf('.') < 0);
      if (Array.isArray(v)) return v.map(cloneAst);
      if (isObj(v)) {
        var o = newObj();
        jgKeys(v).forEach(function(k) { jgSet(o, k, cloneAst(jgGet(v, k))); });
        return o;
      }
      return v;
    }
    function cloneSnapshot() { return cloneAst(state.ast); }

    function getDict(field, create) {
      var a = ensureLoaded();
      var d = jgGet(a, field);
      if (!isObj(d)) {
        if (!create) return null;
        d = defaultDict();
        jgSet(a, field, d);
      }
      return d;
    }
    function getHash(field, create) {
      var a = ensureLoaded();
      var h = jgGet(a, field);
      if (!isObj(h)) {
        if (!create) return null;
        h = defaultHash();
        jgSet(a, field, h);
      }
      return h;
    }
    function getHashIds(field) {
      var a = ensureLoaded();
      var h = jgGet(a, field);
      return hashIds(h);
    }
    function setHashIds(field, ids) {
      var a = ensureLoaded();
      var uniq = {}, out = [];
      (ids || []).forEach(function(x) {
        var n = toInt(x, 0);
        if (n > 0 && !uniq[n]) { uniq[n] = true; out.push(n); }
      });
      jgSet(a, field, hashObj(out));
      return out;
    }
    function toggleHashId(field, id, on) {
      var ids = getHashIds(field);
      var n = toInt(id, 0);
      var set = {};
      ids.forEach(function(x) { set[x] = true; });
      if (on === undefined) on = !set[n];
      if (n > 0) {
        if (on) set[n] = true; else delete set[n];
      }
      var out = Object.keys(set).map(function(k) { return Number(k); });
      out.sort(function(x, y) { return x - y; });
      setHashIds(field, out);
      return out;
    }
    function getDictValue(field, id) {
      var d = getDict(field, false);
      if (!d) return undefined;
      var idx = findKeyIndex(d, id);
      if (idx < 0) return undefined;
      return dictArrays(d).values[idx];
    }
    function setDictValue(field, id, val) {
      var d = getDict(field, true);
      var a = dictArrays(d);
      var idx = findKeyIndex(d, id);
      if (idx >= 0) {
        if (val === undefined || val === null) {
          a.keys.splice(idx, 1);
          a.values.splice(idx, 1);
        } else {
          a.values[idx] = val;
        }
      } else if (val !== undefined && val !== null) {
        a.keys.push(num(id, true));
        a.values.push(val);
      }
      return val;
    }
    function getEffect(id) {
      var v = getDictValue('m_effectDic', id);
      return v === undefined ? 0 : toInt(v, 0);
    }
    function setEffect(id, val) {
      saveOrThrow();
      setDictValue('m_effectDic', id, num(val, true));
      return val;
    }
    function listEffects() {
      var d = getDict('m_effectDic', true);
      var a = dictArrays(d);
      var out = [];
      for (var i = 0; i < a.keys.length; i++) {
        out.push({ id: toInt(a.keys[i], 0), value: toInt(a.values[i], 0) });
      }
      out.sort(function(x, y) { return x.id - y.id; });
      return out;
    }
    function getMoney() {
      var v = getDictValue('m_itemDic', 10001);
      return v === undefined ? 0 : toInt(v, 0);
    }
    function setMoney(n) { return setItemCount(10001, Math.max(0, Math.trunc(Number(n) || 0))); }
    function getComprehensionPoints() {
      var v = getDictValue('m_itemDic', 10002);
      return v === undefined ? 0 : toInt(v, 0);
    }
    function setComprehensionPoints(n) { return setItemCount(10002, Math.max(0, Math.trunc(Number(n) || 0))); }

    function getEquips() {
      var a = top('m_equips', 'arr');
      if (!Array.isArray(a)) { a = defaultEquips(); jgSet(state.ast, 'm_equips', a); }
      var out = [];
      for (var i = 0; i < 4; i++) out.push(toInt(a[i], 0));
      return out;
    }
    function setEquip(slot, itemId) {
      saveOrThrow();
      var s = Math.trunc(Number(slot));
      if (!(s >= 0 && s <= 3)) throw new Error('장비 슬롯은 0부터 3까지입니다.');
      var id = Math.trunc(Number(itemId) || 0);
      if (id > 0) {
        var e = findCatalogEntry(state.catalog, id, ['items', 'equips', 'itemList', 'allItems']);
        if (!e) throw new Error('존재하지 않는 장비 번호입니다.');
        var t2 = entryType2(e);
        if (t2 === 0) throw new Error('장비 종류를 확인할 수 없습니다.');
        if (s === 0 && !(t2 >= 2 && t2 <= 7)) throw new Error('무기 슬롯(0)에는 무기류(type2 2~7)만 장착할 수 있습니다.');
        if (s === 1 && t2 !== 8) throw new Error('방어구 슬롯(1)에는 방어구(type2 8)만 장착할 수 있습니다.');
        if (s === 2 && t2 !== 9) throw new Error('신발 슬롯(2)에는 신발(type2 9)만 장착할 수 있습니다.');
        if (s === 3 && t2 !== 10) throw new Error('장신구 슬롯(3)에는 장신구(type2 10)만 장착할 수 있습니다.');
      }
      setArr(state.ast, 'm_equips', s, id, 4);
      var eq = getEquips();
      var leader = computeLeaderId(eq, state.catalog);
      setArr(state.ast, 'm_fights', 0, leader, 5);
      return leader;
    }
    function getParty() {
      var a = top('m_fights', 'arr');
      if (!Array.isArray(a)) { a = defaultFights(); jgSet(state.ast, 'm_fights', a); }
      var out = [];
      for (var i = 0; i < 5; i++) out.push(toInt(a[i], 0));
      return out;
    }
    function setPartySlot(slot, npcId) {
      saveOrThrow();
      var s = Math.trunc(Number(slot));
      if (!(s >= 0 && s <= 4)) throw new Error('파티 슬롯은 0부터 4까지입니다.');
      if (s === 0) {
        var eq = getEquips();
        var leader = computeLeaderId(eq, state.catalog);
        setArr(state.ast, 'm_fights', 0, leader, 5);
        return leader;
      }
      var id = Math.trunc(Number(npcId) || 0);
      if (id > 0 && !findCatalogEntry(state.catalog, id, ['npcs', 'characters', 'npcList'])) {
        throw new Error('존재하지 않는 동료 번호입니다.');
      }
      setArr(state.ast, 'm_fights', s, id, 5);
      if (id > 0) {
        var h = getHashIds('m_takeHash');
        if (h.indexOf(id) < 0) toggleHashId('m_takeHash', id, true);
      } else {
        var h2 = getHashIds('m_takeHash').filter(function(x) { return x !== id; });
        if (id <= 0) { /* 슬롯 비우기는 모집 목록을 건드리지 않습니다. */ }
      }
      return id;
    }
    function listRecruitedNpcs() {
      return getHashIds('m_takeHash');
    }
    function toggleRecruit(npcId, on) {
      saveOrThrow();
      var id = Math.trunc(Number(npcId) || 0);
      if (id <= 0) throw new Error('동료 번호가 올바르지 않습니다.');
      if (on === undefined) on = getHashIds('m_takeHash').indexOf(id) < 0;
      toggleHashId('m_takeHash', id, !!on);
      if (!on) {
        var f = ensureArray(state.ast, 'm_fights', 5);
        for (var i = 1; i < 5; i++) if (toInt(f[i], 0) === id) f[i] = num(0, true);
      }
      return !!on;
    }

    function wuxueIdsFromCatalog() {
      return catalogIds(state.catalog, ['wuxue', 'wuXue', 'skills', 'trees']);
    }
    function getWuXueExp(id) { return getDictValue('m_wuXueExpDic', id); }
    function listWuXue() {
      var d = getDict('m_wuXueExpDic', true);
      var a = dictArrays(d);
      var out = [];
      for (var i = 0; i < a.keys.length; i++) {
        out.push({ id: toInt(a.keys[i], 0), exp: toInt(a.values[i], 0) });
      }
      var known = wuxueIdsFromCatalog();
      var seen = {};
      out.forEach(function(x) { seen[x.id] = true; });
      known.forEach(function(id) { if (!seen[id]) out.push({ id: id, exp: 0 }); });
      out.sort(function(x, y) { return x.id - y.id; });
      return out;
    }
    function setWuXueExp(id, exp) {
      saveOrThrow();
      var raw = Number(exp);
      if (!isNaN(raw) && raw < 0) {
        setDictValue('m_wuXueExpDic', id, undefined);
        return -1;
      }
      var n = Math.max(0, Math.trunc(raw || 0));
      setDictValue('m_wuXueExpDic', id, num(n, true));
      return n;
    }
    function maxOutAllWuXue() {
      saveOrThrow();
      var ids = wuxueIdsFromCatalog();
      if (!ids.length) ids = listWuXue().map(function(x) { return x.id; });
      ids.forEach(function(id) { setWuXueExp(id, 99999); });
      return ids.length;
    }
    function getActiveSlots(field) {
      if (!ACTIVE_FIELDS[field]) throw new Error('알 수 없는 무공 슬롯입니다.');
      var a = top(field, 'arr');
      if (!Array.isArray(a)) { a = defaultActive(6); jgSet(state.ast, field, a); }
      var out = [];
      for (var i = 0; i < 6; i++) out.push(toInt(a[i], 0));
      return out;
    }
    function setActiveSlot(field, idx, wuxueId) {
      saveOrThrow();
      if (!ACTIVE_FIELDS[field]) throw new Error('알 수 없는 무공 슬롯입니다.');
      var i = Math.trunc(Number(idx));
      if (!(i >= 0 && i <= 5)) throw new Error('무공 슬롯은 0부터 5까지입니다.');
      setArr(state.ast, field, i, Math.max(0, Math.trunc(Number(wuxueId) || 0)), 6);
    }
    function getPassives() {
      var a = top('m_passives', 'arr');
      if (!Array.isArray(a)) { a = defaultActive(3); jgSet(state.ast, 'm_passives', a); }
      var out = [];
      for (var i = 0; i < 3; i++) out.push(toInt(a[i], 0));
      return out;
    }
    function setPassiveSlot(idx, wuxueId) {
      saveOrThrow();
      var i = Math.trunc(Number(idx));
      if (!(i >= 0 && i <= 2)) throw new Error('패시브 슬롯은 0부터 2까지입니다.');
      setArr(state.ast, 'm_passives', i, Math.max(0, Math.trunc(Number(wuxueId) || 0)), 3);
    }

    function getDerivedStats() {
      var out = [];
      for (var i = 1; i <= 10; i++) {
        var total = getEffect(i);
        if (i >= 1 && i <= 6) total += getEffect(100 + i);
        if (i >= 1 && i <= 3) total += getEffect(500 + i);
        out.push(total);
      }
      var eq = getEquips();
      for (var s = 0; s < eq.length; s++) {
        if (!eq[s]) continue;
        var e = findCatalogEntry(state.catalog, eq[s], ['items', 'equips', 'itemList', 'allItems']);
        if (!e) continue;
        var stats = e.stats || e.attrs || e.attributes;
        if (Array.isArray(stats)) {
          for (var j = 0; j < 10 && j < stats.length; j++) out[j] += toInt(stats[j], 0);
        } else if (stats && typeof stats === 'object') {
          for (var k = 1; k <= 10; k++) {
            if (stats[k] !== undefined || stats[String(k)] !== undefined) {
              out[k - 1] += toInt(stats[k] !== undefined ? stats[k] : stats[String(k)], 0);
            }
          }
        }
      }
      return out.map(function(v, idx) { return { index: idx + 1, name: STAT_NAMES[idx], value: v }; });
    }

    function getSummary() {
      var a = ensureLoaded();
      var kind = state.kind;
      var counts = {};
      counts.hash = 0; counts.dict = 0; counts.items = 0; counts.wuxue = 0; counts.trees = 0;
      ['m_receiveHash', 'm_completeHash', 'm_failHash', 'm_ganWuHash', 'm_danFangHash', 'm_daZaoHash', 'm_takeHash'].forEach(function(k) {
        counts.hash += getHashIds(k).length;
      });
      counts.items = getDictSize('m_itemDic');
      counts.wuxue = getDictSize('m_wuXueExpDic');
      counts.trees = getHashIds('m_ganWuHash').length;
      var saveNameVal = jgGet(a, 'm_name');
      var diffVal = toInt(jgGet(a, 'm_diffucultEnum'), 1);
      var summary = {
        kind: kind,
        fileName: state.fileName,
        name: saveNameVal,
        saveName: saveNameVal,
        saveTime: Codec.isJgNum(jgGet(a, 'm_saveTime')) ? Codec.numRaw(jgGet(a, 'm_saveTime')) : '',
        leaderFamily: jgGet(a, 'm_leaderFamily'),
        leaderName: jgGet(a, 'm_leaderName'),
        leaderDirection: toInt(jgGet(a, 'm_leaderDirection'), 6),
        difficulty: diffVal,
        diffucultEnum: diffVal,
        scene: toInt(jgGet(a, 'm_scene'), 0),
        turn: toInt(jgGet(a, 'm_turn'), 1),
        tiLi: toInt(jgGet(a, 'm_tiLi'), 0),
        gameTime: toNum(jgGet(a, 'm_gameTime'), 0),
        realTime: toNum(jgGet(a, 'm_realTime'), 0),
        yangCheng: !!jgGet(a, 'm_yangCheng'),
        hp: toNum(jgGet(a, 'm_hp'), 1),
        mp: toNum(jgGet(a, 'm_mp'), 1),
        jingLi: toNum(jgGet(a, 'm_jingLi'), 1),
        fishRob: toInt(jgGet(a, 'm_fishRob'), 0),
        huntBow: toInt(jgGet(a, 'm_huntBow'), 0),
        money: getMoney(),
        comprehension: getComprehensionPoints(),
        counts: counts,
        derivedStats: kind === 'save' ? getDerivedStats() : []
      };
      return summary;
    }
    function getDictSize(field) {
      var d = getDict(field, false);
      if (!d) return 0;
      return dictArrays(d).keys.length;
    }

    function setMeta(patch) {
      saveOrThrow();
      var p = patch || {};
      Object.keys(META_MAP).forEach(function(k) {
        if (p[k] === undefined) return;
        var field = META_MAP[k];
        var v = p[k];
        if (k === 'leaderFamily' || k === 'leaderName' || k === 'saveName' || k === 'name') {
          jgSet(state.ast, field, String(v === null ? '' : v));
        } else if (k === 'yangCheng') {
          jgSet(state.ast, field, !!v);
        } else if (k === 'hp' || k === 'mp' || k === 'jingLi' || k === 'gameTime' || k === 'realTime') {
          jgSet(state.ast, field, num(v, false));
        } else {
          jgSet(state.ast, field, num(v, true));
        }
      });
      if (p.equips) {
        var eq = getEquips();
      }
      return getSummary();
    }

    function listItems() {
      var d = getDict('m_itemDic', true);
      var a = dictArrays(d);
      var out = [];
      for (var i = 0; i < a.keys.length; i++) {
        out.push({ id: toInt(a.keys[i], 0), count: toInt(a.values[i], 0) });
      }
      out.sort(function(x, y) { return x.id - y.id; });
      return out;
    }
    function setItemCount(id, qty) {
      saveOrThrow();
      var itemId = Math.trunc(Number(id) || 0);
      var n = Math.trunc(Number(qty) || 0);
      if (itemId <= 0) throw new Error('아이템 번호가 올바르지 않습니다.');
      if (n <= 0) {
        setDictValue('m_itemDic', itemId, undefined);
        setDictValue('m_itemTimeDic', itemId, undefined);
      } else {
        setDictValue('m_itemDic', itemId, num(n, true));
      }
      return n;
    }

    function applyPreset(id) {
      var a = ensureLoaded();
      switch (id) {
        case 'money_rich':
          saveOrThrow();
          setMoney(100000000);
          setComprehensionPoints(999);
          break;
        case 'max_six_stats':
          saveOrThrow();
          for (var i = 1; i <= 6; i++) setEffect(100 + i, 100);
          for (var j = 1; j <= 6; j++) setEffect(200 + j, 100);
          for (var k = 1; k <= 3; k++) setEffect(500 + k, 99999);
          break;
        case 'max_life_skills':
          saveOrThrow();
          for (var l = 1; l <= 8; l++) setEffect(300 + l, 99999);
          jgSet(a, 'm_tiLi', num(100, true));
          jgSet(a, 'm_hp', num(1, false));
          jgSet(a, 'm_mp', num(1, false));
          jgSet(a, 'm_jingLi', num(1, false));
          break;
        case 'full_ganwu':
          saveOrThrow();
          setHashIds('m_ganWuHash', catalogIds(state.catalog, ['trees', 'ganWu', 'comprehensions']));
          break;
        case 'full_recipes':
          saveOrThrow();
          setHashIds('m_danFangHash', catalogIds(state.catalog, ['danFang', 'danFangs', 'recipes']));
          setHashIds('m_daZaoHash', catalogIds(state.catalog, ['daZao', 'daZaos', 'forges']));
          break;
        case 'global_unlock_all':
          globalOrThrow();
          setHashIds('m_achieveHash', catalogIds(state.catalog, ['achieves', 'achievements']));
          setHashIds('m_equipHash', catalogIds(state.catalog, ['equips', 'equipments']));
          setHashIds('m_wuXueHash', catalogIds(state.catalog, ['wuxue', 'wuXue', 'skills']));
          setHashIds('m_danFangHash', catalogIds(state.catalog, ['danFang', 'danFangs', 'recipes']));
          setHashIds('m_daZaoHash', catalogIds(state.catalog, ['daZao', 'daZaos', 'forges']));
          break;
        default:
          throw new Error('알 수 없는 프리셋입니다: ' + id);
      }
      return summarizeAppliedPreset(id);
    }
    function summarizeAppliedPreset(id) { return { id: id, ok: true }; }

    function validate() {
      var errors = [], warnings = [];
      if (!state.ast) {
        errors.push('세이브 데이터가 없습니다.');
        return { ok: false, errors: errors, warnings: warnings };
      }
      if (state.kind !== 'save' && state.kind !== 'global') errors.push('파일 종류를 알 수 없습니다.');
      if (state.kind === 'save') {
        var diff = toInt(jgGet(state.ast, 'm_diffucultEnum'), 0);
        if (diff < 1 || diff > 4) errors.push('난이도는 1부터 4까지여야 합니다.');
        var scene = toInt(jgGet(state.ast, 'm_scene'), -1);
        if (scene < 0 || scene > 164) errors.push('장면 번호는 0부터 164까지여야 합니다.');
        if (!jgHas(state.ast, 'm_leaderName') || !String(jgGet(state.ast, 'm_leaderName'))) warnings.push('가문 대표 이름이 비어 있습니다.');
        var eq = getEquips();
        for (var i = 0; i < 4; i++) if (eq[i] > 0 && !findCatalogEntry(state.catalog, eq[i], ['items', 'equips', 'itemList', 'allItems'])) warnings.push('장비 번호 ' + eq[i] + '을 도감에서 찾지 못했습니다.');
        var take = getHashIds('m_takeHash');
        var f = getParty();
        for (var s = 1; s < 5; s++) if (f[s] > 0 && take.indexOf(f[s]) < 0) warnings.push('파티 동료 ' + f[s] + '이 모집 목록에 없습니다.');
      } else if (state.kind === 'global') {
        Object.keys(GLOBAL_HASH_FIELDS).forEach(function(k) {
          if (!jgHas(state.ast, k)) warnings.push('전역 항목 ' + k + '이 없습니다.');
        });
      }
      return { ok: errors.length === 0, errors: errors, warnings: warnings };
    }

    function computeDiff() {
      if (!state.originalAst || !state.ast) return [];
      var out = [];
      var before = flattenAst(state.originalAst);
      var after = flattenAst(state.ast);
      var keys = {};
      Object.keys(before).forEach(function(k) { keys[k] = true; });
      Object.keys(after).forEach(function(k) { keys[k] = true; });
      Object.keys(keys).sort().forEach(function(path) {
        var b = before[path], a = after[path];
        if (b !== a) out.push({ field: path, label: diffLabel(path), before: b, after: a });
      });
      return out;
    }
    function flattenAst(v, prefix, out) {
      out = out || {};
      prefix = prefix || '';
      if (Codec.isJgNum(v)) {
        out[prefix || '(값)'] = Codec.numRaw(v);
      } else if (Array.isArray(v)) {
        out[prefix || '(배열)'] = JSON.stringify(v.map(function(x) { return Codec.isJgNum(x) ? Codec.numRaw(x) : x; }));
      } else if (isObj(v)) {
        var ks = jgKeys(v);
        if (!ks.length) out[prefix || '(객체)'] = '{}';
        ks.forEach(function(k) { flattenAst(jgGet(v, k), prefix ? prefix + '.' + k : k, out); });
      } else {
        out[prefix || '(값)'] = v;
      }
      return out;
    }
    function diffLabel(path) {
      var map = {
        'm_effectDic': '효과 사전', 'm_itemDic': '아이템 사전',
        'm_equips': '장비', 'm_fights': '파티', 'm_ganWuHash': '깨달음',
        'm_danFangHash': '단방', 'm_daZaoHash': '대조',
        'm_tiLi': '체력', 'm_hp': '생명', 'm_mp': '내력', 'm_jingLi': '정력',
        'm_name': '세이브 이름', 'm_leaderName': '가문 대표', 'm_money': '돈'
      };
      var base = path.split('.')[0];
      return map[base] || map[path] || path;
    }

    var session = {
      loadBytes: loadBytes,
      saveBytes: saveBytes,
      getKind: getKind,
      getFileName: getFileName,
      getAst: getAst,
      cloneSnapshot: cloneSnapshot,
      getSummary: getSummary,
      setMeta: setMeta,
      getMoney: getMoney,
      setMoney: setMoney,
      getComprehensionPoints: getComprehensionPoints,
      setComprehensionPoints: setComprehensionPoints,
      getEffect: getEffect,
      setEffect: setEffect,
      listEffects: listEffects,
      getDerivedStats: getDerivedStats,
      listItems: listItems,
      setItemCount: setItemCount,
      getEquips: getEquips,
      setEquip: setEquip,
      getParty: getParty,
      setPartySlot: setPartySlot,
      listRecruitedNpcs: listRecruitedNpcs,
      toggleRecruit: toggleRecruit,
      listWuXue: listWuXue,
      setWuXueExp: setWuXueExp,
      maxOutAllWuXue: maxOutAllWuXue,
      getActiveSlots: getActiveSlots,
      setActiveSlot: setActiveSlot,
      getPassives: getPassives,
      setPassiveSlot: setPassiveSlot,
      getHashIds: getHashIds,
      toggleHashId: toggleHashId,
      setHashIds: setHashIds,
      getDictValue: getDictValue,
      setDictValue: setDictValue,
      applyPreset: applyPreset,
      validate: validate,
      computeDiff: computeDiff
    };
    return session;
  }

  return {
    computeLeaderId: computeLeaderId,
    buildDemoSaveBytes: buildDemoSaveBytes,
    buildDemoGlobalBytes: buildDemoGlobalBytes,
    listPresets: listPresets,
    createSession: createSession
  };
});
