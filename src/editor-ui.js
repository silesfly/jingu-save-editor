(function () {
  'use strict';

  var Codec = window.JinGuCodec;
  var Catalog = window.JinGuCatalog || {};
  var Core = window.JinGuEditorCore;

  var SAVE_TABS = [
    { id: 'tab-summary', panel: 'panel-summary', key: 'summary' },
    { id: 'tab-stats', panel: 'panel-stats', key: 'stats' },
    { id: 'tab-wuxue', panel: 'panel-wuxue', key: 'wuxue' },
    { id: 'tab-bag', panel: 'panel-bag', key: 'bag' },
    { id: 'tab-party', panel: 'panel-party', key: 'party' },
    { id: 'tab-world', panel: 'panel-world', key: 'world' }
  ];

  var ACTIVE_SKILL_FIELDS = [
    { field: 'm_daoActives', label: '도법 초식 (6칸)', wuxueType: 1 },
    { field: 'm_jianActives', label: '검법 초식 (6칸)', wuxueType: 2 },
    { field: 'm_quanActives', label: '권장 초식 (6칸)', wuxueType: 3 },
    { field: 'm_qiangActives', label: '창법 초식 (6칸)', wuxueType: 4 },
    { field: 'm_anqiActives', label: '암기 초식 (6칸)', wuxueType: 5 },
    { field: 'm_qinActives', label: '음률 초식 (6칸)', wuxueType: 6 }
  ];

  var EQUIP_SLOTS = [
    { slot: 0, label: '무기', minType2: 2, maxType2: 7 },
    { slot: 1, label: '방어구', type2: 8 },
    { slot: 2, label: '신발', type2: 9 },
    { slot: 3, label: '장신구', type2: 10 }
  ];

  var STAT_GROUPS = [
    {
      title: '육유 기초 속성 (101~106)',
      ids: [
        { id: 101, label: '근골' },
        { id: 102, label: '체백' },
        { id: 103, label: '신법' },
        { id: 104, label: '오성' },
        { id: 105, label: '정력(속성)' },
        { id: 106, label: '복연' }
      ]
    },
    {
      title: '무기 정통 (201~206)',
      ids: [
        { id: 201, label: '도법 정통' },
        { id: 202, label: '검법 정통' },
        { id: 203, label: '권장 정통' },
        { id: 204, label: '창법 정통' },
        { id: 205, label: '암기 정통' },
        { id: 206, label: '음률 정통' }
      ]
    },
    {
      title: '내공 / 소요 / 실전 (501~503)',
      ids: [
        { id: 501, label: '내공' },
        { id: 502, label: '소요' },
        { id: 503, label: '실전' }
      ]
    },
    {
      title: '생활 8기예 (301~308)',
      ids: [
        { id: 301, label: '단조' },
        { id: 302, label: '연단' },
        { id: 303, label: '의술' },
        { id: 304, label: '독술' },
        { id: 305, label: '조리' },
        { id: 306, label: '다도' },
        { id: 307, label: '감정' },
        { id: 308, label: '채집' }
      ]
    },
    {
      title: '강호 평판 및 문파 (401~404)',
      ids: [
        { id: 401, label: '선악' },
        { id: 402, label: '명망' },
        { id: 403, label: '정연' },
        { id: 404, label: '문파 실력' }
      ]
    },
    {
      title: '상한 보정 (601~602)',
      ids: [
        { id: 601, label: '정력 상한' },
        { id: 602, label: '체력 상한' }
      ]
    }
  ];

  var GLOBAL_HASH_DEFS = [
    { field: 'm_achieveHash', label: '업적 도감', catalogKey: 'achieves' },
    { field: 'm_equipHash', label: '장비 도감', catalogKey: 'equips' },
    { field: 'm_wuXueHash', label: '무학 도감', catalogKey: 'wuxue' },
    { field: 'm_danFangHash', label: '단방 도감', catalogKey: 'danFang' },
    { field: 'm_daZaoHash', label: '단조 도감', catalogKey: 'daZao' },
    { field: 'm_guideHash', label: '강호 지남', catalogKey: null, readOnly: true },
    { field: 'm_propHash', label: '전투 도구 도감', itemType2: 14 },
    { field: 'm_matHash', label: '재료 도감', itemType2: 15 },
    { field: 'm_fishHash', label: '어류 도감', itemType2: 20 },
    { field: 'm_huntHash', label: '수렵 도감', itemType2: 21 }
  ];

  function getGlobalHashCatalog(def) {
    if (!def || def.readOnly || def.catalogKey === null) return [];
    if (def.itemType2 !== undefined) {
      return toList(Catalog.items).filter(function (it) {
        return it && it.type2 === def.itemType2;
      });
    }
    return def.catalogKey ? toList(Catalog[def.catalogKey]) : [];
  }

  var state = {
    session: null,
    activeTab: 'tab-summary',
    dirty: false,
    fileName: '',
    nativePath: '',
    nativeSha256: '',
    nativeFiles: [],
    serverToken: '',
    serverLoadedName: '',
    serverSha256: '',
    serverFiles: [],
    bagSearch: '',
    pickerCallback: null,
    pickerItems: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (val === undefined || val === null) return;
        if (key === 'className') {
          node.className = String(val);
        } else if (key === 'textContent') {
          node.textContent = String(val);
        } else if (key === 'value') {
          node.value = val;
        } else if (key === 'checked') {
          node.checked = Boolean(val);
        } else if (key === 'disabled') {
          node.disabled = Boolean(val);
        } else if (key.indexOf('on') === 0 && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'dataset' && typeof val === 'object') {
          Object.keys(val).forEach(function (dk) {
            node.dataset[dk] = val[dk];
          });
        } else {
          node.setAttribute(key, String(val));
        }
      });
    }
    if (children !== undefined && children !== null) {
      if (Array.isArray(children)) {
        children.forEach(function (c) {
          if (c === undefined || c === null) return;
          if (typeof c === 'string' || typeof c === 'number') {
            node.appendChild(document.createTextNode(String(c)));
          } else {
            node.appendChild(c);
          }
        });
      } else if (typeof children === 'string' || typeof children === 'number') {
        node.appendChild(document.createTextNode(String(children)));
      } else {
        node.appendChild(children);
      }
    }
    return node;
  }

  function toList(col) {
    if (!col) return [];
    if (Array.isArray(col)) return col;
    if (col instanceof Map) {
      var out = [];
      col.forEach(function (v, k) {
        if (v && typeof v === 'object') {
          out.push(v);
        } else {
          out.push({ id: k, name: String(v) });
        }
      });
      return out;
    }
    if (typeof col === 'object') {
      return Object.keys(col).map(function (k) {
        var v = col[k];
        if (v && typeof v === 'object') {
          if (v.id === undefined) {
            return Object.assign({ id: isNaN(Number(k)) ? k : Number(k) }, v);
          }
          return v;
        }
        return { id: isNaN(Number(k)) ? k : Number(k), name: String(v) };
      });
    }
    return [];
  }

  function findEntry(col, id) {
    if (!col || id === undefined || id === null) return null;
    if (col instanceof Map) {
      return col.get(id) || col.get(String(id)) || col.get(Number(id)) || null;
    }
    if (Array.isArray(col)) {
      for (var i = 0; i < col.length; i++) {
        if (String(col[i].id) === String(id)) return col[i];
      }
      return null;
    }
    if (typeof col === 'object') {
      return col[id] || col[String(id)] || null;
    }
    return null;
  }

  function entryName(col, id, fallbackPrefix) {
    var entry = findEntry(col, id);
    if (entry && entry.name) return entry.name;
    if (typeof entry === 'string') return entry;
    return (fallbackPrefix || '항목') + ' #' + id;
  }

  function u8ToBase64(u8) {
    var bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      var sub = bytes.subarray(i, i + chunk);
      parts.push(String.fromCharCode.apply(null, sub));
    }
    return btoa(parts.join(''));
  }

  function base64ToU8(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      u8[i] = bin.charCodeAt(i);
    }
    return u8;
  }

  function setStatus(msg, isError) {
    var box = $('status-msg');
    if (!box) return;
    box.textContent = msg || '';
    box.className = isError ? 'status-msg error' : 'status-msg';
  }

  function markDirty(flag) {
    state.dirty = Boolean(flag);
    updateHeader();
    renderValidationAndDiff();
  }

  function updateHeader() {
    var fileBadge = $('file-badge');
    var kindBadge = $('kind-badge');
    var dirtyBadge = $('dirty-badge');

    if (fileBadge) {
      fileBadge.textContent = state.session ? (state.fileName || '이름 없음') : '열린 파일 없음';
    }
    if (kindBadge) {
      if (!state.session) {
        kindBadge.textContent = '대기';
      } else if (state.session.getKind() === 'global') {
        kindBadge.textContent = '전역 도감 (Setting.bytes)';
      } else {
        kindBadge.textContent = '세이브 데이터';
      }
    }
    if (dirtyBadge) {
      dirtyBadge.textContent = state.dirty ? '수정됨 *' : '저장됨';
      dirtyBadge.className = state.dirty ? 'badge dirty' : 'badge clean';
    }
  }

  function initTheme() {
    var btn = $('btn-theme');
    var saved = localStorage.getItem('jingu_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    if (btn) {
      btn.textContent = saved === 'dark' ? '라이트 모드' : '다크 모드';
      btn.addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme') || 'dark';
        var next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('jingu_theme', next);
        btn.textContent = next === 'dark' ? '라이트 모드' : '다크 모드';
      });
    }
  }

  function initTabs() {
    var tablist = $('save-tablist');
    if (!tablist) return;

    SAVE_TABS.forEach(function (t, idx) {
      var btn = $(t.id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        selectTab(t.id);
      });
      btn.addEventListener('keydown', function (e) {
        var nextIdx = -1;
        if (e.key === 'ArrowRight') {
          nextIdx = (idx + 1) % SAVE_TABS.length;
        } else if (e.key === 'ArrowLeft') {
          nextIdx = (idx - 1 + SAVE_TABS.length) % SAVE_TABS.length;
        } else if (e.key === 'Home') {
          nextIdx = 0;
        } else if (e.key === 'End') {
          nextIdx = SAVE_TABS.length - 1;
        }
        if (nextIdx >= 0) {
          e.preventDefault();
          var targetId = SAVE_TABS[nextIdx].id;
          selectTab(targetId);
          var targetEl = $(targetId);
          if (targetEl) targetEl.focus();
        }
      });
    });
  }

  function selectTab(tabId) {
    state.activeTab = tabId;
    SAVE_TABS.forEach(function (t) {
      var btn = $(t.id);
      var panel = $(t.panel);
      var active = t.id === tabId;
      if (btn) {
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.tabIndex = active ? 0 : -1;
        btn.classList.toggle('active', active);
      }
      if (panel) {
        panel.hidden = !active;
      }
    });
  }

  function initPicker() {
    var dialog = $('picker-dialog');
    var search = $('picker-search');
    var closeBtn = $('picker-close');
    if (!dialog) return;

    dialog.addEventListener('close', function () {
      dialog.returnValue = '';
      state.pickerCallback = null;
      state.pickerItems = [];
      if (search) search.value = '';
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        dialog.close();
      });
    }

    if (search) {
      search.addEventListener('input', function () {
        renderPickerList(search.value.trim().toLowerCase());
      });
    }
  }

  function openPicker(title, items, onSelect) {
    var dialog = $('picker-dialog');
    var titleEl = $('picker-title');
    var search = $('picker-search');
    if (!dialog) return;

    if (titleEl) titleEl.textContent = title || '항목 선택';
    state.pickerItems = items || [];
    state.pickerCallback = onSelect;
    if (search) search.value = '';
    renderPickerList('');
    dialog.showModal();
    if (search) search.focus();
  }

  function renderPickerList(query) {
    var listEl = $('picker-list');
    var dialog = $('picker-dialog');
    if (!listEl) return;
    clearNode(listEl);

    var filtered = state.pickerItems.filter(function (item) {
      if (!query) return true;
      var hay = (String(item.id) + ' ' + (item.name || '') + ' ' + (item.sub || '')).toLowerCase();
      return hay.indexOf(query) !== -1;
    });

    if (filtered.length === 0) {
      listEl.appendChild(el('div', { className: 'empty-hint', textContent: '일치하는 항목이 없습니다.' }));
      return;
    }

    filtered.slice(0, 300).forEach(function (item) {
      var btn = el('button', {
        type: 'button',
        className: 'picker-item',
        onClick: function () {
          var cb = state.pickerCallback;
          if (dialog) dialog.close();
          if (cb) cb(item.id, item);
        }
      }, [
        el('span', { className: 'picker-id', textContent: '#' + item.id }),
        el('span', { className: 'picker-name', textContent: item.name || ('항목 #' + item.id) }),
        item.sub ? el('span', { className: 'picker-sub', textContent: item.sub }) : null
      ]);
      listEl.appendChild(btn);
    });
  }

  function loadSessionBytes(u8, fileName, sourceInfo) {
    try {
      var session = Core.createSession(Catalog);
      session.loadBytes(u8, fileName);
      state.session = session;
      state.fileName = session.getFileName() || fileName || 'save.bytes';
      state.dirty = false;
      state.nativePath = '';
      state.nativeSha256 = '';
      state.serverLoadedName = '';
      state.serverSha256 = '';

      if (sourceInfo && sourceInfo.nativePath !== undefined) {
        state.nativePath = sourceInfo.nativePath || '';
        state.nativeSha256 = sourceInfo.nativeSha256 || '';
      }
      if (sourceInfo && sourceInfo.serverLoadedName !== undefined) {
        state.serverLoadedName = sourceInfo.serverLoadedName || '';
        state.serverSha256 = sourceInfo.serverSha256 || '';
      }

      renderWorkspace();
      setStatus('불러오기 완료: ' + state.fileName, false);
    } catch (err) {
      setStatus('파일 불러오기 실패: ' + (err && err.message ? err.message : String(err)), true);
    }
  }

  function renderWorkspace() {
    var emptyState = $('empty-state');
    var workspace = $('editor-workspace');
    var tablist = $('save-tablist');
    var globalPanel = $('panel-global');
    var btnDownload = $('btn-download-save');
    if (btnDownload) btnDownload.disabled = !state.session;

    updateHeader();

    if (!state.session) {
      if (emptyState) emptyState.hidden = false;
      if (workspace) workspace.hidden = true;
      return;
    }

    if (emptyState) emptyState.hidden = true;
    if (workspace) workspace.hidden = false;

    var isGlobal = state.session.getKind() === 'global';

    if (tablist) tablist.hidden = isGlobal;
    SAVE_TABS.forEach(function (t) {
      var p = $(t.panel);
      if (p && isGlobal) p.hidden = true;
    });
    if (globalPanel) globalPanel.hidden = !isGlobal;

    renderPresets();
    renderValidationAndDiff();

    if (isGlobal) {
      renderGlobalPanel();
    } else {
      selectTab(state.activeTab || 'tab-summary');
      renderSummaryPanel();
      renderStatsPanel();
      renderWuXuePanel();
      renderBagPanel();
      renderPartyPanel();
      renderWorldPanel();
    }
  }

  function renderPresets() {
    var bar = $('preset-bar');
    if (!bar) return;
    clearNode(bar);

    if (!state.session || state.session.getKind() === 'global') {
      bar.hidden = true;
      return;
    }

    var presets = typeof Core.listPresets === 'function' ? Core.listPresets() : [];
    if (!presets || presets.length === 0) {
      bar.hidden = true;
      return;
    }

    bar.hidden = false;
    bar.appendChild(el('span', { className: 'bar-label', textContent: '빠른 프리셋:' }));
    presets.forEach(function (p) {
      bar.appendChild(el('button', {
        type: 'button',
        className: 'btn btn-preset',
        title: p.desc || p.name,
        textContent: p.name,
        onClick: function () {
          try {
            state.session.applyPreset(p.id);
            markDirty(true);
            renderWorkspace();
            setStatus('프리셋 적용됨: ' + p.name, false);
          } catch (err) {
            setStatus('프리셋 적용 실패: ' + err.message, true);
          }
        }
      }));
    });
  }

  function renderValidationAndDiff() {
    var valBar = $('validation-bar');
    var diffBox = $('diff-box');
    if (!state.session) return;

    if (valBar) {
      clearNode(valBar);
      var raw = typeof state.session.validate === 'function' ? state.session.validate() : [];
      var issues = Array.isArray(raw) ? raw : [].concat(raw && raw.errors || [], raw && raw.warnings || []);
      if (!issues || issues.length === 0) {
        valBar.className = 'validation-bar ok';
        valBar.textContent = '무결성 검증 통과 (이상 없음)';
      } else {
        valBar.className = 'validation-bar warn';
        valBar.appendChild(el('strong', { textContent: '검증 경고 (' + issues.length + '건): ' }));
        issues.forEach(function (iss, idx) {
          var text = typeof iss === 'string' ? iss : (iss.message || iss.msg || JSON.stringify(iss));
          valBar.appendChild(el('span', { textContent: (idx > 0 ? ' | ' : '') + text }));
        });
      }
    }

    if (diffBox) {
      clearNode(diffBox);
      var diffs = typeof state.session.computeDiff === 'function' ? state.session.computeDiff() : [];
      if (!diffs || diffs.length === 0) {
        diffBox.hidden = true;
      } else {
        diffBox.hidden = false;
        diffBox.appendChild(el('div', { className: 'diff-title', textContent: '변경 내역 (' + diffs.length + '건)' }));
        var ul = el('ul', { className: 'diff-list' });
        diffs.slice(0, 50).forEach(function (d) {
          var line = typeof d === 'string'
            ? d
            : (d.label || d.path || d.field || '항목') + ': ' + String(d.before) + ' -> ' + String(d.after);
          ul.appendChild(el('li', { textContent: line }));
        });
        if (diffs.length > 50) {
          ul.appendChild(el('li', { textContent: '... 외 ' + (diffs.length - 50) + '건' }));
        }
        diffBox.appendChild(ul);
      }
    }
  }

  function makeFieldInput(labelText, type, value, onChange, extraAttrs) {
    var inputAttrs = Object.assign({
      type: type || 'text',
      value: value !== undefined && value !== null ? value : ''
    }, extraAttrs || {});

    inputAttrs.onChange = function (e) {
      var v = type === 'number' ? Number(e.target.value) : e.target.value;
      onChange(v, e);
    };

    return el('label', { className: 'field' }, [
      el('span', { className: 'field-label', textContent: labelText }),
      el('input', inputAttrs)
    ]);
  }

  function renderSummaryPanel() {
    var panel = $('panel-summary');
    if (!panel || !state.session) return;
    clearNode(panel);

    var summary = state.session.getSummary() || {};
    var metaFields = [
      { key: 'saveName', label: '세이브 이름', type: 'text' },
      { key: 'leaderFamily', label: '주인공 성씨', type: 'text' },
      { key: 'leaderName', label: '주인공 이름', type: 'text' },
      { key: 'leaderDirection', label: '성향 / 노선', type: 'number' },
      { key: 'diffucultEnum', label: '난이도', type: 'number' },
      { key: 'scene', label: '현재 씬 ID', type: 'number' },
      { key: 'turn', label: '진행 턴', type: 'number' },
      { key: 'tiLi', label: '체력', type: 'number' },
      { key: 'hp', label: '현재 생명(HP)', type: 'number' },
      { key: 'mp', label: '현재 내력(MP)', type: 'number' },
      { key: 'jingLi', label: '현재 정력', type: 'number' },
      { key: 'yangCheng', label: '양성 모드', type: 'checkbox' },
      { key: 'fishRob', label: '낚싯대 등급', type: 'number' },
      { key: 'huntBow', label: '사냥 활 등급', type: 'number' }
    ];

    var metaGrid = el('div', { className: 'form-grid' });
    metaFields.forEach(function (mf) {
      if (mf.type === 'checkbox') {
        metaGrid.appendChild(el('label', { className: 'field' }, [
          el('span', { className: 'field-label', textContent: mf.label }),
          el('input', {
            type: 'checkbox',
            checked: Boolean(summary[mf.key]),
            onChange: function (e) {
              var patch = {};
              patch[mf.key] = Boolean(e.target.checked);
              state.session.setMeta(patch);
              markDirty(true);
              renderSummaryPanel();
            }
          })
        ]));
        return;
      }
      metaGrid.appendChild(makeFieldInput(mf.label, mf.type, summary[mf.key], function (val) {
        var patch = {};
        patch[mf.key] = val;
        state.session.setMeta(patch);
        markDirty(true);
        renderSummaryPanel();
      }));
    });

    metaGrid.appendChild(makeFieldInput('전폐 (10001)', 'number', state.session.getMoney(), function (val) {
      state.session.setMoney(val);
      markDirty(true);
    }));

    metaGrid.appendChild(makeFieldInput('감오점 (10002)', 'number', state.session.getComprehensionPoints(), function (val) {
      state.session.setComprehensionPoints(val);
      markDirty(true);
    }));

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '기본 정보 및 재화' }),
      metaGrid
    ]));

    var derived = typeof state.session.getDerivedStats === 'function' ? state.session.getDerivedStats() : {};
    var derivedGrid = el('div', { className: 'stats-cards' });
    var derivedList = Array.isArray(derived)
      ? derived
      : Object.keys(derived).map(function (k) { return { label: k, value: derived[k] }; });

    if (derivedList.length === 0) {
      derivedGrid.appendChild(el('div', { className: 'empty-hint', textContent: '파생 전투 능력치 정보가 없습니다.' }));
    } else {
      derivedList.forEach(function (d) {
        derivedGrid.appendChild(el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-card-label', textContent: d.label || d.name || d.key }),
          el('div', { className: 'stat-card-value', textContent: String(d.value !== undefined ? d.value : d.val) })
        ]));
      });
    }

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '실시간 파생 전투 능력치' }),
      derivedGrid
    ]));
  }

  function renderStatsPanel() {
    var panel = $('panel-stats');
    if (!panel || !state.session) return;
    clearNode(panel);

    STAT_GROUPS.forEach(function (grp) {
      var grid = el('div', { className: 'form-grid' });
      grp.ids.forEach(function (item) {
        var cur = state.session.getEffect(item.id);
        var catEntry = findEntry(Catalog.effects, item.id);
        var label = (catEntry && catEntry.name) ? (catEntry.name + ' (' + item.id + ')') : (item.label + ' (' + item.id + ')');
        grid.appendChild(makeFieldInput(label, 'number', cur, function (val) {
          state.session.setEffect(item.id, val);
          markDirty(true);
          renderSummaryPanel();
        }));
      });

      panel.appendChild(el('section', { className: 'card' }, [
        el('h3', { textContent: grp.title }),
        grid
      ]));
    });
  }

  function renderWuXuePanel() {
    var panel = $('panel-wuxue');
    if (!panel || !state.session) return;
    clearNode(panel);

    var wuxueList = toList(Catalog.wuxue);

    // Active skills (6 slots each)
    var activeCard = el('section', { className: 'card' }, [
      el('h3', { textContent: '장착 무학 초식' })
    ]);

    ACTIVE_SKILL_FIELDS.forEach(function (af) {
      var slots = state.session.getActiveSlots(af.field) || [];
      var row = el('div', { className: 'slot-group' }, [
        el('div', { className: 'slot-group-title', textContent: af.label })
      ]);
      var slotRow = el('div', { className: 'slot-row' });
      for (var i = 0; i < 6; i++) {
        (function (idx) {
          var wid = slots[idx] || 0;
          var label = wid ? entryName(Catalog.wuxue, wid, '무학') : '(비어 있음)';
          slotRow.appendChild(el('div', { className: 'slot-box' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-slot',
              textContent: (idx + 1) + ': ' + label,
              onClick: function () {
                var filteredWuxue = wuxueList.filter(function (w) {
                  return w && (w.type === af.wuxueType || w.type === 0);
                });
                var pickerWuxue = filteredWuxue.length > 0 ? filteredWuxue : wuxueList;
                var items = [{ id: 0, name: '(해제 / 비우기)', sub: '' }].concat(pickerWuxue.map(function (w) {
                  return { id: w.id, name: w.name, sub: w.desc || '' };
                }));
                openPicker(af.label + ' - 슬롯 ' + (idx + 1), items, function (chosenId) {
                  state.session.setActiveSlot(af.field, idx, chosenId);
                  markDirty(true);
                  renderWuXuePanel();
                });
              }
            })
          ]));
        })(i);
      }
      row.appendChild(slotRow);
      activeCard.appendChild(row);
    });
    panel.appendChild(activeCard);

    // Passives (3 slots)
    var passives = state.session.getPassives() || [];
    var passiveList = toList(Catalog.passives);
    var passiveRow = el('div', { className: 'slot-row' });
    for (var p = 0; p < 3; p++) {
      (function (idx) {
        var pid = passives[idx] || 0;
        var label = pid ? entryName(Catalog.passives, pid, '심법') : '(비어 있음)';
        passiveRow.appendChild(el('button', {
          type: 'button',
          className: 'btn btn-slot',
          textContent: '심법 ' + (idx + 1) + ': ' + label,
          onClick: function () {
            var items = [{ id: 0, name: '(해제 / 비우기)', sub: '' }].concat(passiveList.map(function (w) {
              return { id: w.id, name: w.name, sub: w.desc || '' };
            }));
            openPicker('장착 심법 - 슬롯 ' + (idx + 1), items, function (chosenId) {
              state.session.setPassiveSlot(idx, chosenId);
              markDirty(true);
              renderWuXuePanel();
            });
          }
        }));
      })(p);
    }

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '장착 심법 (m_passives, 3칸)' }),
      passiveRow
    ]));

    // Owned WuXue Exp Table
    var owned = state.session.listWuXue() || [];
    var toolbar = el('div', { className: 'card-toolbar' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '보유 무학 추가',
        onClick: function () {
          var items = wuxueList.map(function (w) {
            return { id: w.id, name: w.name, sub: w.desc || '' };
          });
          openPicker('보유 무학 추가', items, function (chosenId) {
            state.session.setWuXueExp(chosenId, 0);
            markDirty(true);
            renderWuXuePanel();
          });
        }
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-warn',
        textContent: '전체 만렙',
        onClick: function () {
          state.session.maxOutAllWuXue();
          markDirty(true);
          renderWuXuePanel();
          setStatus('보유 무학 전체 만렙 적용 완료', false);
        }
      })
    ]);

    var table = el('table', { className: 'data-table' }, [
      el('thead', null, [
        el('tr', null, [
          el('th', { textContent: 'ID' }),
          el('th', { textContent: '무학 이름' }),
          el('th', { textContent: '숙련도(경험치)' }),
          el('th', { textContent: '작업' })
        ])
      ])
    ]);
    var tbody = el('tbody');
    owned.forEach(function (w) {
      var id = w.id !== undefined ? w.id : w.wuxueId;
      var exp = w.exp !== undefined ? w.exp : w.value;
      var name = w.name || entryName(Catalog.wuxue, id, '무학');
      tbody.appendChild(el('tr', null, [
        el('td', { textContent: String(id) }),
        el('td', { textContent: name }),
        el('td', null, [
          el('input', {
            type: 'number',
            value: exp,
            onChange: function (e) {
              state.session.setWuXueExp(id, Number(e.target.value));
              markDirty(true);
            }
          })
        ]),
        el('td', null, [
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            textContent: '제거',
            onClick: function () {
              state.session.setWuXueExp(id, -1);
              markDirty(true);
              renderWuXuePanel();
            }
          })
        ])
      ]));
    });
    if (owned.length === 0) {
      tbody.appendChild(el('tr', null, [
        el('td', { colSpan: 4, className: 'empty-hint', textContent: '보유 중인 무학이 없습니다.' })
      ]));
    }
    table.appendChild(tbody);

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '보유 무학 목록 (' + owned.length + '종)' }),
      toolbar,
      table
    ]));
  }

  function renderBagPanel() {
    var panel = $('panel-bag');
    if (!panel || !state.session) return;
    clearNode(panel);

    var allItems = toList(Catalog.items);
    var equips = state.session.getEquips() || [];

    // Equipped 4 slots
    var equipRow = el('div', { className: 'slot-row' });
    EQUIP_SLOTS.forEach(function (es) {
      var itemId = equips[es.slot] || 0;
      var label = itemId ? entryName(Catalog.items, itemId, '장비') : '(미착용)';
      equipRow.appendChild(el('button', {
        type: 'button',
        className: 'btn btn-slot',
        textContent: es.label + ': ' + label,
        onClick: function () {
          var filtered = allItems.filter(function (it) {
            if (!it) return false;
            return es.minType2 !== undefined
              ? (it.type2 >= es.minType2 && it.type2 <= es.maxType2)
              : (it.type2 === es.type2);
          });
          var pickerItems = [{ id: 0, name: '(장비 해제)', sub: '' }].concat(filtered.map(function (it) {
            return { id: it.id, name: it.name, sub: it.desc || '' };
          }));
          openPicker(es.label + ' 슬롯 장착', pickerItems, function (chosenId) {
            state.session.setEquip(es.slot, chosenId);
            markDirty(true);
            renderBagPanel();
            renderSummaryPanel();
          });
        }
      }));
    });

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '착용 장비 (4칸)' }),
      equipRow
    ]));

    // Inventory table
    var bagItems = state.session.listItems() || [];
    var searchInput = el('input', {
      type: 'search',
      placeholder: '인벤토리 검색 (이름 또는 ID)...',
      value: state.bagSearch,
      onInput: function (e) {
        state.bagSearch = e.target.value;
        renderBagPanel();
      }
    });

    var toolbar = el('div', { className: 'card-toolbar' }, [
      searchInput,
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '아이템 추가',
        onClick: function () {
          var pickerItems = allItems.map(function (it) {
            return { id: it.id, name: it.name, sub: it.desc || '' };
          });
          openPicker('아이템 추가', pickerItems, function (chosenId) {
            var existing = bagItems.find(function (b) { return String(b.id) === String(chosenId); });
            var nextQty = existing ? (Number(existing.qty || existing.count || 0) + 1) : 1;
            state.session.setItemCount(chosenId, nextQty);
            markDirty(true);
            renderBagPanel();
          });
        }
      })
    ]);

    var q = state.bagSearch.trim().toLowerCase();
    var filteredBag = bagItems.filter(function (it) {
      if (!q) return true;
      var name = it.name || entryName(Catalog.items, it.id, '아이템');
      return (String(it.id) + ' ' + name).toLowerCase().indexOf(q) !== -1;
    });

    var table = el('table', { className: 'data-table' }, [
      el('thead', null, [
        el('tr', null, [
          el('th', { textContent: 'ID' }),
          el('th', { textContent: '아이템 이름' }),
          el('th', { textContent: '수량' }),
          el('th', { textContent: '작업' })
        ])
      ])
    ]);
    var tbody = el('tbody');
    filteredBag.forEach(function (it) {
      var id = it.id;
      var qty = it.qty !== undefined ? it.qty : (it.count !== undefined ? it.count : it.value);
      var name = it.name || entryName(Catalog.items, id, '아이템');
      tbody.appendChild(el('tr', null, [
        el('td', { textContent: String(id) }),
        el('td', { textContent: name }),
        el('td', null, [
          el('input', {
            type: 'number',
            min: 0,
            value: qty,
            onChange: function (e) {
              state.session.setItemCount(id, Number(e.target.value));
              markDirty(true);
            }
          })
        ]),
        el('td', null, [
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            textContent: '삭제',
            onClick: function () {
              state.session.setItemCount(id, 0);
              markDirty(true);
              renderBagPanel();
            }
          })
        ])
      ]));
    });
    if (filteredBag.length === 0) {
      tbody.appendChild(el('tr', null, [
        el('td', { colSpan: 4, className: 'empty-hint', textContent: '표시할 아이템이 없습니다.' })
      ]));
    }
    table.appendChild(tbody);

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '보유 아이템 (' + bagItems.length + '종)' }),
      toolbar,
      table
    ]));

    // DanFang (26) & DaZao (50) recipe grids
    panel.appendChild(renderHashGridCard('보유 단방 레시피 (m_danFangHash)', 'm_danFangHash', Catalog.danFang, '단방'));
    panel.appendChild(renderHashGridCard('보유 단조 레시피 (m_daZaoHash)', 'm_daZaoHash', Catalog.daZao, '단조'));
  }

  function renderHashGridCard(title, hashField, catalogCol, prefix) {
    var ownedIds = new Set((state.session.getHashIds(hashField) || []).map(String));
    var entries = toList(catalogCol);

    var toolbar = el('div', { className: 'card-toolbar' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-sm',
        textContent: '전체 해금',
        onClick: function () {
          var allIds = entries.map(function (e) { return e.id; });
          state.session.setHashIds(hashField, allIds);
          markDirty(true);
          renderWorkspace();
        }
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-sm',
        textContent: '전체 해제',
        onClick: function () {
          state.session.setHashIds(hashField, []);
          markDirty(true);
          renderWorkspace();
        }
      })
    ]);

    var grid = el('div', { className: 'toggle-grid' });
    entries.forEach(function (entry) {
      var checked = ownedIds.has(String(entry.id));
      grid.appendChild(el('label', { className: 'toggle-chip' + (checked ? ' active' : '') }, [
        el('input', {
          type: 'checkbox',
          checked: checked,
          onChange: function (e) {
            state.session.toggleHashId(hashField, entry.id, e.target.checked);
            markDirty(true);
          }
        }),
        el('span', { textContent: (entry.name || (prefix + ' #' + entry.id)) + ' (#' + entry.id + ')' })
      ]));
    });

    if (entries.length === 0) {
      grid.appendChild(el('div', { className: 'empty-hint', textContent: '카탈로그 데이터가 없습니다.' }));
    }

    return el('section', { className: 'card' }, [
      el('h3', { textContent: title + ' (' + ownedIds.size + '/' + entries.length + ')' }),
      toolbar,
      grid
    ]);
  }

  function renderPartyPanel() {
    var panel = $('panel-party');
    if (!panel || !state.session) return;
    clearNode(panel);

    var npcs = toList(Catalog.npcs);
    var party = state.session.getParty() || [];

    // Active combat party m_fights[0..4]
    var partyRow = el('div', { className: 'slot-row' });
    for (var i = 0; i < 5; i++) {
      (function (slot) {
        var npcId = party[slot] || 0;
        if (slot === 0) {
          var leaderLabel = npcId ? entryName(Catalog.npcs, npcId, '주인공') : '주인공 (무기 연동)';
          partyRow.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-slot',
            disabled: true,
            title: '슬롯 0은 무기 종류에 따라 자동 동기화됩니다.',
            textContent: '출전 1(주인공): ' + leaderLabel
          }));
        } else {
          var label = npcId ? entryName(Catalog.npcs, npcId, '동료') : '(빈 자리)';
          partyRow.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-slot',
            textContent: '출전 ' + (slot + 1) + ': ' + label,
            onClick: function () {
              var items = [{ id: 0, name: '(출전 해제)', sub: '' }].concat(npcs.map(function (n) {
                return { id: n.id, name: n.name, sub: n.title || '' };
              }));
              openPicker('출전 동료 선택 - 슬롯 ' + (slot + 1), items, function (chosenId) {
                state.session.setPartySlot(slot, chosenId);
                markDirty(true);
                renderPartyPanel();
              });
            }
          }));
        }
      })(i);
    }

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '전투 출전 파티 (m_fights 0~4)' }),
      partyRow
    ]));

    // Recruited NPCs m_takeHash
    var recruited = new Set((state.session.listRecruitedNpcs() || []).map(function (r) {
      return String(typeof r === 'object' ? r.id : r);
    }));
    var takeHashIds = new Set((state.session.getHashIds('m_takeHash') || []).map(String));
    var recruitGrid = el('div', { className: 'toggle-grid' });
    npcs.forEach(function (npc) {
      var on = takeHashIds.has(String(npc.id)) || recruited.has(String(npc.id));
      recruitGrid.appendChild(el('label', { className: 'toggle-chip' + (on ? ' active' : '') }, [
        el('input', {
          type: 'checkbox',
          checked: on,
          onChange: function (e) {
            state.session.toggleRecruit(npc.id, e.target.checked);
            markDirty(true);
          }
        }),
        el('span', { textContent: (npc.name || ('동료 #' + npc.id)) + ' (#' + npc.id + ')' })
      ]));
    });

    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '영입 가능 동료 (m_takeHash)' }),
      recruitGrid
    ]));

    // Friends intimacy m_friendLvDic
    var friends = toList(Catalog.friends);
    var friendGrid = el('div', { className: 'form-grid' });
    friends.forEach(function (f) {
      var fid = f.npcId !== undefined ? f.npcId : f.id;
      var val = state.session.getDictValue('m_friendLvDic', fid);
      friendGrid.appendChild(makeFieldInput((f.name || ('지인 #' + fid)) + ' (#' + fid + ')', 'number', val, function (nextVal) {
        state.session.setDictValue('m_friendLvDic', fid, nextVal);
        markDirty(true);
      }));
    });
    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '친밀도 / 호감도 (m_friendLvDic)' }),
      friendGrid
    ]));

    // Spirit Beasts m_animalExpDic
    var animals = toList(Catalog.animals);
    var animalGrid = el('div', { className: 'form-grid' });
    animals.forEach(function (a) {
      var aid = a.npcId !== undefined ? a.npcId : a.id;
      var val = state.session.getDictValue('m_animalExpDic', aid);
      animalGrid.appendChild(makeFieldInput((a.name || ('영수 #' + aid)) + ' (#' + aid + ')', 'number', val, function (nextVal) {
        state.session.setDictValue('m_animalExpDic', aid, nextVal);
        markDirty(true);
      }));
    });
    panel.appendChild(el('section', { className: 'card' }, [
      el('h3', { textContent: '영수 경험치 (m_animalExpDic)' }),
      animalGrid
    ]));
  }

  function renderWorldPanel() {
    var panel = $('panel-world');
    if (!panel || !state.session) return;
    clearNode(panel);

    // 80 GanWu nodes grouped by treeGroups 1..5
    var ganWuList = toList(Catalog.trees || Catalog.ganWu);
    var ownedGanWu = new Set((state.session.getHashIds('m_ganWuHash') || []).map(String));
    var treeGroups = Catalog.treeGroups || {
      1: '감오 계통 1',
      2: '감오 계통 2',
      3: '감오 계통 3',
      4: '감오 계통 4',
      5: '감오 계통 5'
    };

    var ganWuCard = el('section', { className: 'card' }, [
      el('h3', { textContent: '감오 노드 (m_ganWuHash, ' + ownedGanWu.size + '/' + ganWuList.length + ')' }),
      el('div', { className: 'card-toolbar' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-sm',
          textContent: '전체 감오 해금',
          onClick: function () {
            state.session.setHashIds('m_ganWuHash', ganWuList.map(function (g) { return g.id; }));
            markDirty(true);
            renderWorldPanel();
          }
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-sm',
          textContent: '전체 감오 해제',
          onClick: function () {
            state.session.setHashIds('m_ganWuHash', []);
            markDirty(true);
            renderWorldPanel();
          }
        })
      ])
    ]);

    for (var gIdx = 1; gIdx <= 5; gIdx++) {
      var groupNodes = ganWuList.filter(function (n) {
        var grp = n.treeGroup !== undefined ? n.treeGroup : (n.group !== undefined ? n.group : 1);
        return Number(grp) === gIdx;
      });
      if (groupNodes.length === 0) continue;
      var groupTitle = treeGroups[gIdx] || ('계통 ' + gIdx);
      var groupGrid = el('div', { className: 'toggle-grid' });
      groupNodes.forEach(function (node) {
        var checked = ownedGanWu.has(String(node.id));
        groupGrid.appendChild(el('label', { className: 'toggle-chip' + (checked ? ' active' : '') }, [
          el('input', {
            type: 'checkbox',
            checked: checked,
            onChange: function (e) {
              state.session.toggleHashId('m_ganWuHash', node.id, e.target.checked);
              markDirty(true);
            }
          }),
          el('span', { textContent: (node.name || ('감오 #' + node.id)) + ' (#' + node.id + ')' })
        ]));
      });
      ganWuCard.appendChild(el('div', { className: 'sub-group' }, [
        el('h4', { textContent: groupTitle }),
        groupGrid
      ]));
    }
    panel.appendChild(ganWuCard);

    // Global Buffs
    panel.appendChild(renderHashGridCard('전역 버프 (m_globalBuffHash)', 'm_globalBuffHash', Catalog.globalBuffs, '버프'));

    // Tasks
    panel.appendChild(renderHashGridCard('진행 중인 임무 (m_receiveHash)', 'm_receiveHash', Catalog.tasks, '임무'));
    panel.appendChild(renderHashGridCard('완료된 임무 (m_completeHash)', 'm_completeHash', Catalog.tasks, '임무'));
  }

  function renderGlobalPanel() {
    var panel = $('panel-global');
    if (!panel || !state.session) return;
    clearNode(panel);

    panel.appendChild(el('div', { className: 'card-toolbar' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '카탈로그 지원 도감 전체 해금',
        onClick: function () {
          GLOBAL_HASH_DEFS.forEach(function (def) {
            if (def.readOnly) return;
            var entries = getGlobalHashCatalog(def);
            if (!entries.length) return;
            state.session.setHashIds(def.field, entries.map(function (e) { return e.id; }));
          });
          markDirty(true);
          renderGlobalPanel();
          setStatus('카탈로그 지원 전역 도감 해금 완료 (강호 지남은 기존 ID 보존)', false);
        }
      })
    ]));

    GLOBAL_HASH_DEFS.forEach(function (def) {
      if (def.readOnly) {
        var curIds = state.session.getHashIds(def.field) || [];
        panel.appendChild(el('section', { className: 'card' }, [
          el('h3', { textContent: def.label + ' (' + def.field + ', 현재 ' + curIds.length + '건 보존)' }),
          el('div', { className: 'empty-hint', textContent: '정적 카탈로그가 없는 항목으로, 기존 세이브의 ID 목록을 변경하지 않고 보존합니다.' })
        ]));
        return;
      }
      var catalogEntries = getGlobalHashCatalog(def);
      panel.appendChild(renderHashGridCard(def.label + ' (' + def.field + ')', def.field, catalogEntries, def.label));
    });
  }

  function initBrowserControls() {
    var fileInput = $('file-input');
    var btnDemo = $('btn-load-demo');
    var btnDemoGlobal = $('btn-load-demo-global');
    var btnDownload = $('btn-download-save');

    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          loadSessionBytes(new Uint8Array(reader.result), file.name, {});
        };
        reader.readAsArrayBuffer(file);
        fileInput.value = '';
      });
    }

    if (btnDemo) {
      btnDemo.addEventListener('click', function () {
        try {
          var bytes = Core.buildDemoSaveBytes(Catalog);
          loadSessionBytes(bytes, 'DemoSave.bytes', {});
        } catch (err) {
          setStatus('데모 세이브 생성 실패: ' + err.message, true);
        }
      });
    }

    if (btnDemoGlobal) {
      btnDemoGlobal.addEventListener('click', function () {
        try {
          var bytes = Core.buildDemoGlobalBytes(Catalog);
          loadSessionBytes(bytes, 'Setting.bytes', {});
        } catch (err) {
          setStatus('데모 전역 데이터 생성 실패: ' + err.message, true);
        }
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', function () {
        if (!state.session) {
          setStatus('다운로드할 파일이 열려 있지 않습니다.', true);
          return;
        }
        try {
          var u8 = state.session.saveBytes();
          var blob = new Blob([u8], { type: 'application/octet-stream' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = state.fileName || 'SaveData.bytes';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          markDirty(false);
          setStatus('브라우저 다운로드 완료: ' + a.download, false);
        } catch (err) {
          setStatus('내보내기 실패: ' + err.message, true);
        }
      });
    }
  }

  function initNativeWebView() {
    var hasNative = Boolean(window.chrome && window.chrome.webview);
    var bar = $('native-controls');
    if (!bar) return;
    if (!hasNative) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;

    var btnDiscover = $('btn-native-discover');
    var selectEl = $('native-save-select');
    var btnOpen = $('btn-native-open');
    var btnSave = $('btn-native-save');
    var btnSaveAs = $('btn-native-save-as');

    function postNative(payload) {
      window.chrome.webview.postMessage(payload);
    }

    window.chrome.webview.addEventListener('message', function (ev) {
      var msg = ev.data;
      if (typeof msg === 'string') {
        try { msg = JSON.parse(msg); } catch (_) { return; }
      }
      if (!msg || typeof msg !== 'object') return;

      var cmd = msg.cmd || msg.type;
      if (msg.ok === false && msg.error) {
        setStatus('네이티브 오류: ' + msg.error, true);
        return;
      }

      if (cmd === 'discoverResult' || cmd === 'discover') {
        var files = msg.files || [];
        state.nativeFiles = files;
        if (selectEl) {
          clearNode(selectEl);
          files.forEach(function (f) {
            var path = typeof f === 'string' ? f : (f.path || f.fullPath);
            var label = typeof f === 'string' ? f : (f.name || f.label || path);
            selectEl.appendChild(el('option', { value: path, textContent: label }));
          });
        }
        setStatus('세이브 탐색 완료 (' + files.length + '개)', false);
      } else if (cmd === 'openResult' || cmd === 'open') {
        if (msg.dataB64) {
          var u8 = base64ToU8(msg.dataB64);
          var name = msg.name || (msg.path ? msg.path.split(/[\\/]/).pop() : 'SaveData.bytes');
          loadSessionBytes(u8, name, {
            nativePath: msg.path || '',
            nativeSha256: msg.sha256 || msg.hash || ''
          });
        }
      } else if (cmd === 'saveResult' || cmd === 'save' || cmd === 'saveAsResult' || cmd === 'saveAs') {
        if (msg.path) state.nativePath = msg.path;
        if (msg.name) state.fileName = msg.name;
        if (msg.sha256 || msg.hash) state.nativeSha256 = msg.sha256 || msg.hash;
        markDirty(false);
        setStatus('네이티브 저장 완료: ' + (state.nativePath || state.fileName), false);
      }
    });

    if (btnDiscover) {
      btnDiscover.addEventListener('click', function () {
        postNative({ cmd: 'discover' });
      });
    }

    if (btnOpen) {
      btnOpen.addEventListener('click', function () {
        var chosenPath = selectEl ? selectEl.value : '';
        postNative({ cmd: 'open', path: chosenPath });
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', function () {
        if (!state.session) {
          setStatus('저장할 세션이 없습니다.', true);
          return;
        }
        try {
          var dataB64 = u8ToBase64(state.session.saveBytes());
          postNative({
            cmd: 'save',
            path: state.nativePath,
            expectedHash: state.nativeSha256,
            dataB64: dataB64
          });
        } catch (err) {
          setStatus('저장 직렬화 실패: ' + err.message, true);
        }
      });
    }

    if (btnSaveAs) {
      btnSaveAs.addEventListener('click', function () {
        if (!state.session) {
          setStatus('저장할 세션이 없습니다.', true);
          return;
        }
        try {
          var dataB64 = u8ToBase64(state.session.saveBytes());
          postNative({
            cmd: 'saveAs',
            path: state.nativePath,
            suggestName: state.fileName,
            suggestPath: state.nativePath,
            expectedHash: state.nativeSha256,
            dataB64: dataB64
          });
        } catch (err) {
          setStatus('다른 이름으로 저장 실패: ' + err.message, true);
        }
      });
    }

    postNative({ cmd: 'discover' });
  }

  function initServerControls() {
    var metaToken = document.querySelector('meta[name="jingu-token"]');
    var bar = $('server-controls');
    if (!bar) return;

    if (!metaToken || !metaToken.getAttribute('content')) {
      bar.hidden = true;
      return;
    }

    state.serverToken = metaToken.getAttribute('content');
    bar.hidden = false;

    var selectEl = $('server-save-select');
    var btnReload = $('btn-server-reload');
    var btnLoad = $('btn-server-load');
    var btnSave = $('btn-server-save');

    function apiFetch(url, options) {
      var opts = options || {};
      var headers = Object.assign({ 'X-JinGu-Token': state.serverToken }, opts.headers || {});
      return fetch(url, Object.assign({}, opts, { headers: headers })).then(function (res) {
        return res.json();
      });
    }

    function reloadServerList() {
      apiFetch('/api/list')
        .then(function (data) {
          if (!data || !data.ok) {
            setStatus('서버 목록 조회 실패: ' + (data && data.error ? data.error : '알 수 없는 오류'), true);
            return;
          }
          var files = data.files || [];
          state.serverFiles = files;
          if (selectEl) {
            clearNode(selectEl);
            files.forEach(function (f) {
              var p = typeof f === 'string' ? f : (f.path || f.name);
              var label = typeof f === 'string' ? f : (f.name || f.path);
              selectEl.appendChild(el('option', { value: p, textContent: label }));
            });
          }
          setStatus('서버 세이브 목록 갱신됨 (' + files.length + '개)', false);
        })
        .catch(function (err) {
          setStatus('서버 목록 요청 오류: ' + err.message, true);
        });
    }

    if (btnReload) {
      btnReload.addEventListener('click', reloadServerList);
    }

    if (btnLoad) {
      btnLoad.addEventListener('click', function () {
        var targetPath = selectEl ? selectEl.value : '';
        if (!targetPath) {
          setStatus('불러올 서버 파일을 선택하세요.', true);
          return;
        }
        apiFetch('/api/load?path=' + encodeURIComponent(targetPath))
          .then(function (data) {
            if (!data || !data.ok || !data.rawBase64) {
              setStatus('서버 파일 불러오기 실패: ' + (data && data.error ? data.error : '응답 오류'), true);
              return;
            }
            var info = data.info || {};
            var u8 = base64ToU8(data.rawBase64);
            var loadedName = info.path || targetPath;
            var displayName = info.name || loadedName.split(/[\\/]/).pop();
            loadSessionBytes(u8, displayName, {
              serverLoadedName: loadedName,
              serverSha256: info.sha256 || ''
            });
          })
          .catch(function (err) {
            setStatus('서버 불러오기 오류: ' + err.message, true);
          });
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', function () {
        if (!state.session) {
          setStatus('저장할 세션이 없습니다.', true);
          return;
        }
        var targetPath = selectEl ? selectEl.value : state.serverLoadedName;
        if (!targetPath) {
          setStatus('저장할 서버 대상 파일이 없습니다.', true);
          return;
        }
        if (!state.serverLoadedName) {
          var okDemo = window.confirm(
            '현재 편집 중인 세션(' + (state.fileName || '로컬 파일') + ')은 서버에서 불러온 파일이 아닙니다. 선택한 서버 파일(' + targetPath + ')에 덮어쓰시겠습니까?'
          );
          if (!okDemo) {
            setStatus('서버 덮어쓰기가 취소되었습니다.', false);
            return;
          }
        } else if (targetPath !== state.serverLoadedName) {
          var ok = window.confirm(
            '현재 불러온 파일(' + state.serverLoadedName + ')과 다른 대상(' + targetPath + ')에 덮어쓰시겠습니까?'
          );
          if (!ok) {
            setStatus('서버 덮어쓰기가 취소되었습니다.', false);
            return;
          }
        }
        try {
          var rawBase64 = u8ToBase64(state.session.saveBytes());
          apiFetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: targetPath,
              expectedSha256: state.serverSha256,
              rawBase64: rawBase64
            })
          })
            .then(function (data) {
              if (!data || !data.ok) {
                setStatus('서버 저장 실패: ' + (data && data.error ? data.error : '응답 오류'), true);
                return;
              }
              state.serverLoadedName = targetPath;
              if (data.info && data.info.sha256) {
                state.serverSha256 = data.info.sha256;
              } else if (data.sha256) {
                state.serverSha256 = data.sha256;
              }
              markDirty(false);
              setStatus('서버 저장 완료: ' + targetPath, false);
            })
            .catch(function (err) {
              setStatus('서버 저장 요청 오류: ' + err.message, true);
            });
        } catch (err) {
          setStatus('저장 직렬화 실패: ' + err.message, true);
        }
      });
    }

    reloadServerList();
  }

  function bootstrap() {
    initTheme();
    initTabs();
    initPicker();
    initBrowserControls();
    initNativeWebView();
    initServerControls();
    renderWorkspace();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
