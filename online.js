/* =============================================================
 * online.js —— 线上对战区块（UI 层）
 *
 * 流程：
 *   主菜单 → 线上对战 → 创建房间 / 加入房间 → 房间（选图、准备、开局）
 *
 * 通信交给 online-net.js：
 *   - 房间码 8 位，地图和房间状态用房间码派生的 AES-GCM 密钥加密；
 *   - 走公共 MQTT 中继（默认 EMQX，可在「高级」里换）；
 *   - 不经过我们自己的服务器，网页仍然是静态文件。
 *
 * 和 home.js / armory.js 的约定：
 *   - home.js 的 activate() 调 window.Online.open()；
 *   - 打开时盖住主菜单，把 #menu 设成 inert；
 *   - 键盘在 #online 内冒泡阶段截住，别漏给编辑器；
 *   - 房主 / 玩家离开时清掉 retained 状态，房间码作废。
 * ============================================================= */
(function () {
  'use strict';

  const mount = document.getElementById('online');
  if (!mount) return;

  const NET = window.OnlineNet;
  const MAPIO = window.MapIO;
  const TERRAINS = window.TERRAINS;
  const T_INDEX = window.T_INDEX;
  const MK = window.Markers;
  const HG = window.HexGrid;

  const SHELL = mount.querySelector('.online-shell');
  const $ = function (id) { return document.getElementById(id); };

  const BROKERS = [
    { id: 'emqx', name: 'EMQX · broker.emqx.io', url: 'wss://broker.emqx.io:8084/mqtt' },
    { id: 'hivemq', name: 'HiveMQ · broker.hivemq.com', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { id: 'mosquitto', name: 'Mosquitto · test.mosquitto.org', url: 'wss://test.mosquitto.org:8081/mqtt' },
  ];

  const NICK_KEY = 'bingqi-online:nick';
  const BROKER_KEY = 'bingqi-online:broker';
  const MAPS_KEY = 'bingqi-online:maps:v1';
  const MAX_PLAYERS = 2;
  const JOIN_WAIT_MS = 4200;
  const FULL_WAIT_MS = 900;
  const MAX_ONLINE_CELLS = 6000;      // 预览 / 中继负载上限（编辑器本身最大 80×60）
  const TITLE = '线上对战 · 兵棋';

  const state = {
    open: false,
    view: 'entry',          // entry / room
    tab: 'create',          // create / join
    name: '',
    brokerId: 'emqx',
    net: null,
    netStatus: 'idle',
    role: null,             // host / guest
    selfId: makeId(),
    roomCode: '',
    host: null,             // 房主 presence
    hostSeen: 0,
    guests: new Map(),      // id -> { presence, seen }
    map: null,              // MapIO.parse 的结果
    mapWrapper: null,       // { title, map }
    selectedMapId: '',
    phase: 'lobby',
    ready: false,
    connecting: false,
    gen: 0,
    joined: false,
    logs: [],
    dialogOpen: false,
    dialogEntries: new Map(),
    alertOpen: false,
    alertClose: null,
    hostGoneAlerted: false,
    drawRaf: 0,
    joinTimer: 0,
    savedTitle: '',
    lastFocus: null,
    draftCache: null,
  };

  /* =============================================================
   * 小工具
   * ============================================================= */

  function makeId() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    let s = '';
    for (let i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }

  function el(id) { return $(id); }

  function setText(id, text) {
    const n = el(id);
    if (n) n.textContent = text == null ? '' : String(text);
  }

  function hideEl(id, hidden) {
    const n = el(id);
    if (n) n.classList.toggle('hidden', !!hidden);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function clock(ts) {
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function isFileProtocol() { return location.protocol === 'file:'; }

  function hasCrypto() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  function broker() {
    for (let i = 0; i < BROKERS.length; i++) {
      if (BROKERS[i].id === state.brokerId) return BROKERS[i];
    }
    return BROKERS[0];
  }

  function modeName(mode) {
    const m = MK && MK.MODES ? MK.MODES.filter(function (x) { return x.id === mode; })[0] : null;
    return m ? m.name : '攻防战';
  }

  function modeDesc(mode) {
    const m = MK && MK.MODES ? MK.MODES.filter(function (x) { return x.id === mode; })[0] : null;
    return m ? m.desc : '';
  }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }

  function loadPrefs() {
    const savedNick = readStore(NICK_KEY);
    if (savedNick) state.name = savedNick.slice(0, 16);
    const savedBroker = readStore(BROKER_KEY);
    if (savedBroker && BROKERS.some(function (b) { return b.id === savedBroker; })) {
      state.brokerId = savedBroker;
    }
  }

  function savePrefs() {
    writeStore(NICK_KEY, state.name);
    writeStore(BROKER_KEY, state.brokerId);
  }

  function readName() {
    const input = el('online-name');
    let raw = input ? String(input.value || '') : state.name;
    raw = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    const name = (raw || '指挥官').slice(0, 16);
    state.name = name;
    if (input) input.value = name;
    savePrefs();
    return name;
  }

  function toast(msg, ms) {
    const t = el('online-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('show'); }, ms || 2300);
  }

  function pushLog(msg) {
    state.logs.push({ t: Date.now(), msg: String(msg) });
    if (state.logs.length > 40) state.logs.shift();
    renderLogs();
  }

  /* =============================================================
   * 地图库
   * ============================================================= */

  function parseMap(raw) {
    const parsed = MAPIO.parse(raw, TERRAINS, T_INDEX);
    const canonical = MAPIO.serialize({
      cols: parsed.cols,
      rows: parsed.rows,
      cells: parsed.cells,
      mode: parsed.mode,
      deploy: parsed.deploy,
    }, TERRAINS);
    return { parsed: parsed, map: canonical, warnings: parsed.warnings || [] };
  }

  function draftEntry() {
    let raw = null;
    try {
      raw = (window.BQ && window.BQ.toJSON) ? window.BQ.toJSON() : MAPIO.readLocal();
    } catch (e) { raw = null; }
    if (!raw) return null;
    try {
      const r = parseMap(raw);
      return {
        id: 'draft',
        title: '编辑器当前地图',
        source: 'draft',
        savedAt: null,
        parsed: r.parsed,
        map: r.map,
        warnings: r.warnings,
      };
    } catch (e) {
      return null;
    }
  }

  function readLibrary() {
    try {
      const raw = JSON.parse(readStore(MAPS_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }

  function writeLibrary(list) {
    if (!writeStore(MAPS_KEY, JSON.stringify(list))) {
      showAlert('地图库保存失败', '浏览器本地存储可能已满，或者当前是隐私模式。可以先用「导入地图」直接选图。');
      return false;
    }
    return true;
  }

  function libraryEntries() {
    const out = [];
    readLibrary().forEach(function (item) {
      if (!item || !item.map) return;
      try {
        const r = parseMap(item.map);
        out.push({
          id: String(item.id || ('m' + Math.random().toString(36).slice(2))),
          title: String(item.title || '未命名地图').slice(0, 40),
          source: 'library',
          savedAt: item.savedAt || null,
          parsed: r.parsed,
          map: r.map,
          warnings: r.warnings,
        });
      } catch (e) { /* 跳过坏档 */ }
    });
    return out;
  }

  function addLibrary(title, canonical) {
    const list = readLibrary();
    const item = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title: String(title || '导入地图').slice(0, 40),
      savedAt: new Date().toISOString(),
      map: canonical,
    };
    list.unshift(item);
    if (list.length > 20) list.length = 20;
    if (!writeLibrary(list)) return null;
    return item;
  }

  function mapMeta(parsed, title) {
    return {
      title: title,
      mode: parsed.mode,
      cols: parsed.cols,
      rows: parsed.rows,
    };
  }

  /* =============================================================
   * 地图画布
   * ============================================================= */

  function drawFlag(ctx, x, y, scale, color, kind) {
    const s = Math.max(2.4, scale * 0.95);
    const top = y - s * 1.2;
    ctx.save();
    ctx.strokeStyle = 'rgba(20, 24, 30, 0.9)';
    ctx.lineWidth = Math.max(1, s * 0.13);
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.55);
    ctx.lineTo(x, top);
    ctx.stroke();

    ctx.fillStyle = color;
    if (kind === 'hq') {
      ctx.fillRect(x, top, s * 1.15, s * 0.78);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x + s * 0.575, top + s * 0.39, Math.max(0.7, s * 0.14), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + s * 1.15, top + s * 0.38);
      ctx.lineTo(x, top + s * 0.76);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBoard(ctx, w, h, parsed, withMarkers) {
    const cols = parsed.cols, rows = parsed.rows;
    const b = HG.mapBounds(cols, rows, 1);
    const pad = Math.max(8, Math.min(w, h) * 0.055);
    const scale = Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h);
    if (!isFinite(scale) || scale <= 0) return;
    const offX = (w - b.w * scale) / 2;
    const offY = (h - b.h * scale) / 2;
    const zone = parsed.mode === 'attack' && parsed.deploy ? parsed.deploy.zone : null;
    const lw = Math.max(0.55, scale * 0.055);

    // 坐标契约（见 协作规则.md）：行 0 在最下方、行号向上增。
    // Canvas 的 y 轴向下，所以把地图的纵向翻一次，和 3D 默认视角保持一致。
    const toScreenY = function (py) {
      // py 已经是 scale 后的像素坐标，只有 b.minY 还是 1R 单位，别把 py 再乘一次 scale
      return offY + b.h * scale - (py - b.minY * scale);
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const t = TERRAINS[parsed.cells[idx]] || TERRAINS[0];
        const p = HG.center(c, r, scale);
        const x = offX + (p[0] - b.minX * scale);
        const y = toScreenY(p[1]);
        const pts = HG.corners(x, y, scale * 0.985);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
          else ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.closePath();
        ctx.fillStyle = t.fill;
        ctx.fill();
        if (zone && zone.has(idx)) {
          ctx.fillStyle = 'rgba(74, 134, 224, 0.36)';
          ctx.fill();
        }
        ctx.lineWidth = lw;
        ctx.strokeStyle = t.line;
        ctx.stroke();
      }
    }

    if (!withMarkers || parsed.mode !== 'attack' || !parsed.deploy) return;
    const d = parsed.deploy;
    const flagAt = function (p, color, kind) {
      if (!p) return;
      const q = HG.center(p.c, p.r, scale);
      drawFlag(ctx, offX + (q[0] - b.minX * scale), toScreenY(q[1]), scale, color, kind);
    };
    flagAt(d.spawn, '#e0573f', 'pennant');
    flagAt(d.hqA, '#e0a458', 'hq');
    flagAt(d.hqD, '#4a86e0', 'hq');
  }

  function drawMainMap() {
    const canvas = el('online-map');
    if (!canvas || state.view !== 'room' || mount.classList.contains('hidden')) return;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!state.map) return;
    drawBoard(ctx, w, h, state.map, true);
  }

  function scheduleDraw() {
    if (state.drawRaf) cancelAnimationFrame(state.drawRaf);
    state.drawRaf = requestAnimationFrame(function () {
      state.drawRaf = 0;
      drawMainMap();
    });
  }

  function drawThumb(canvas, parsed) {
    if (!canvas || !parsed) return;
    const w = 96, h = 58;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawBoard(ctx, w, h, parsed, false);
  }

  /* =============================================================
   * 状态 / 渲染
   * ============================================================= */

  function setStatus(s) {
    state.netStatus = s;
    const box = el('online-status');
    if (!box) return;
    box.setAttribute('data-state', s);
    const labels = {
      idle: '未连接',
      connecting: '连接中',
      connected: '已连接',
      reconnecting: '重连中',
      closed: '已断开',
      offline: '离线',
      error: '连接异常',
    };
    setText('online-status-text', labels[s] || '未连接');
    if (state.view === 'room') {
      renderBanner();
      renderActions();
    }
  }

  function setBusy(busy) {
    state.connecting = busy;
    renderEntry();
  }

  function onlineGuestList() {
    const out = [];
    state.guests.forEach(function (g) {
      if (g && g.presence && g.presence.online) out.push(g.presence);
    });
    return out;
  }

  function otherGuests() {
    return onlineGuestList().filter(function (g) { return g.id !== state.selfId; });
  }

  function renderEntry() {
    const create = state.tab === 'create';
    Array.prototype.forEach.call(mount.querySelectorAll('.online-tab'), function (t) {
      const on = t.getAttribute('data-tab') === state.tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    hideEl('online-code-field', create);
    const go = el('online-go');
    if (go) {
      go.disabled = state.connecting;
      go.textContent = state.connecting ? '连接中…' : (create ? '创建房间' : '加入房间');
    }
    const brokerSel = el('online-broker');
    if (brokerSel) brokerSel.disabled = state.connecting;

    const hint = el('online-entry-hint');
    if (!hint) return;
    if (!hasCrypto()) {
      hint.textContent = '当前页面不能使用加密 API：请用 https://、localhost 或直接双击 file:// 打开，再联机。';
      return;
    }
    if (state.connecting) {
      hint.textContent = create
        ? '正在连接中继并创建加密房间…'
        : '正在连接中继并寻找房间…';
    } else if (create) {
      hint.textContent = '创建后会生成 8 位房间码。房间是 2 人局：房主 + 1 位对手。';
    } else {
      hint.textContent = '输入房主发来的 8 位房间码。房主和你要使用同一个中继。';
    }
  }

  function renderStatus() {
    setStatus(state.netStatus);
  }

  function renderPlayers() {
    const box = el('online-players');
    if (!box) return;
    box.innerHTML = '';

    const rows = [];
    const hostOnline = state.role === 'host' ? true : !!(state.host && state.host.online);
    const hostName = state.role === 'host' ? state.name : ((state.host && state.host.name) || '房主');
    rows.push({
      id: 'host',
      name: hostName,
      role: 'host',
      online: hostOnline,
      ready: true,
      self: state.role === 'host',
    });

    if (state.role === 'guest') {
      rows.push({
        id: state.selfId,
        name: state.name,
        role: 'guest',
        online: true,
        ready: state.ready,
        self: true,
      });
    }

    onlineGuestList().forEach(function (g) {
      if (state.role === 'guest' && g.id === state.selfId) return;
      rows.push({
        id: g.id,
        name: g.name || '玩家',
        role: 'guest',
        online: !!g.online,
        ready: !!g.ready,
        self: false,
      });
    });

    // 去重（同一个 id 只留一条）
    const seen = Object.create(null);
    const list = rows.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });

    const onlineCount = list.filter(function (p) { return p.online; }).length;
    setText('online-player-count', Math.min(onlineCount, MAX_PLAYERS) + ' / ' + MAX_PLAYERS);

    list.forEach(function (p) {
      const li = document.createElement('li');
      li.className = 'online-player' +
        (p.role === 'host' ? ' is-host' : '') +
        (p.online ? '' : ' is-offline') +
        (p.self ? ' is-self' : '');

      const av = document.createElement('span');
      av.className = 'online-avatar';
      av.textContent = p.role === 'host' ? '房' : (p.name ? p.name.slice(0, 1) : '玩');

      const main = document.createElement('span');
      main.className = 'online-player-main';
      const b = document.createElement('b');
      b.textContent = p.name;
      if (p.self) {
        const em = document.createElement('em');
        em.textContent = '你';
        b.appendChild(em);
      }
      const small = document.createElement('small');
      small.textContent = p.role === 'host' ? '房主' : '玩家';
      main.appendChild(b);
      main.appendChild(small);

      const st = document.createElement('span');
      st.className = 'online-player-state';
      if (!p.online) {
        st.classList.add('is-off');
        st.textContent = '离线';
      } else if (p.role === 'host') {
        st.classList.add('is-on');
        st.textContent = '在线';
      } else if (p.ready) {
        st.classList.add('is-ready');
        st.textContent = '已准备';
      } else {
        st.textContent = '未准备';
      }

      li.appendChild(av);
      li.appendChild(main);
      li.appendChild(st);
      box.appendChild(li);
    });

    if (list.length < MAX_PLAYERS) {
      const li = document.createElement('li');
      li.className = 'online-player is-empty';
      const av = document.createElement('span');
      av.className = 'online-avatar';
      av.textContent = '?';
      const main = document.createElement('span');
      main.className = 'online-player-main';
      const b = document.createElement('b');
      b.textContent = '等待玩家加入';
      const small = document.createElement('small');
      small.textContent = '把房间码发给同学';
      main.appendChild(b);
      main.appendChild(small);
      li.appendChild(av);
      li.appendChild(main);
      box.appendChild(li);
    }
  }

  function deployChip(label, cls, ok, value) {
    const span = document.createElement('span');
    span.className = 'online-chip ' + cls + (ok ? '' : ' is-off');
    const dot = document.createElement('i');
    const text = document.createElement('span');
    text.textContent = label + ' ' + (ok ? (value || '✓') : '—');
    span.appendChild(dot);
    span.appendChild(text);
    return span;
  }

  function renderMapPanel() {
    const has = !!state.map;
    const isHost = state.role === 'host';
    const lobby = state.phase !== 'battle';

    hideEl('online-mode-badge', !has);
    if (has) {
      const badge = el('online-mode-badge');
      badge.textContent = modeName(state.map.mode);
      badge.className = 'online-mode-badge ' + (state.map.mode === 'contest' ? 'is-contest' : 'is-attack');
      setText('online-map-dims', state.map.cols + ' × ' + state.map.rows + ' · ' + state.map.cells.length + ' 格');
    } else {
      setText('online-map-dims', '');
    }

    hideEl('online-map-empty', has);
    hideEl('online-pick-map', !(isHost && lobby));
    if (isHost && lobby) setText('online-pick-map', has ? '更换地图' : '选择地图');
    hideEl('online-map-empty-action', !(isHost && lobby));
    setText('online-map-empty-title', isHost ? '还没有选择地图' : '等待房主选择地图');
    setText('online-map-empty-text', isHost
      ? '从地图库选一张，或导入编辑器导出的 JSON。'
      : '房主选好地图后，作战模式和部署标记会自动同步到这里。');

    const pickBtn = el('online-pick-map');
    if (pickBtn) pickBtn.disabled = !(isHost && lobby);

    const deploy = el('online-deploy');
    if (deploy) {
      deploy.innerHTML = '';
      if (has) {
        if (state.map.mode === 'attack') {
          const d = state.map.deploy || { spawn: null, hqA: null, hqD: null, zone: null };
          const zoneCount = d.zone ? d.zone.size : 0;
          deploy.appendChild(deployChip('出生点', 'is-spawn', !!d.spawn));
          deploy.appendChild(deployChip('攻指', 'is-hqa', !!d.hqA));
          deploy.appendChild(deployChip('守指', 'is-hqd', !!d.hqD));
          deploy.appendChild(deployChip('部署区', 'is-zone', zoneCount > 0, zoneCount + ' 格'));
        } else {
          const chip = document.createElement('span');
          chip.className = 'online-chip is-off';
          chip.textContent = '关键点位规则未定';
          deploy.appendChild(chip);
        }
      }
    }

    setText('online-map-title', has ? (state.mapWrapper && state.mapWrapper.title) || '未命名地图' : '—');
    setText('online-map-sub', has
      ? modeName(state.map.mode) + ' · ' + state.map.cols + ' × ' + state.map.rows + ' · ' + state.map.cells.length + ' 格'
      : '');
    setText('online-mode-desc', has ? modeDesc(state.map.mode) : '');

    scheduleDraw();
  }

  function canStart() {
    if (state.role !== 'host' || state.phase === 'battle' || !state.map) return false;
    if (state.netStatus !== 'connected') return false;
    const guests = otherGuests();
    if (guests.length !== 1) return false;
    return !!guests[0].ready;
  }

  function startReason() {
    if (state.role !== 'host') return '';
    if (state.phase === 'battle') return '对局已开始';
    if (state.netStatus !== 'connected') return '连接中断，正在重连…';
    if (!state.map) return '先选择一张地图';
    const guests = otherGuests();
    if (guests.length === 0) return '等待玩家加入';
    if (guests.length > 1) return '房间人数超出';
    if (!guests[0].ready) return '等待「' + (guests[0].name || '对手') + '」准备';
    return '';
  }

  function renderActions() {
    const isHost = state.role === 'host';
    const lobby = state.phase !== 'battle';
    const start = el('online-start');
    const ready = el('online-ready');
    const backLobby = el('online-back-lobby');
    const pick = el('online-pick-map');

    hideEl('online-start', !(isHost && lobby));
    hideEl('online-pick-map', !(isHost && lobby));
    hideEl('online-ready', !(!isHost && lobby));
    hideEl('online-back-lobby', !(isHost && !lobby));

    if (start) {
      const why = startReason();
      start.disabled = !!why;
      start.title = why || '双方已准备，开始对局';
    }

    if (ready) {
      ready.textContent = state.ready ? '取消准备' : '准备';
      ready.classList.toggle('on', state.ready);
      ready.disabled = state.netStatus !== 'connected';
    }

    if (pick) pick.textContent = (state.map ? '更换地图' : '选择地图');

    const note = el('online-ready-note');
    if (!note) return;
    if (state.phase === 'battle') {
      note.textContent = '对局进行中 · 地图已锁定';
      return;
    }
    if (isHost) {
      const why = startReason();
      note.textContent = why ? why : '双方就绪，可以开始';
    } else {
      note.textContent = state.ready ? '已准备，等待房主开始' : '准备后房主才能开始';
    }
  }

  function renderPhaseNote() {
    const phaseNote = el('online-phase-note');
    if (!phaseNote) return;
    const isHost = state.role === 'host';
    if (state.phase === 'battle') {
      phaseNote.textContent = '对局进行中';
    } else if (isHost) {
      const gs = otherGuests();
      if (!gs.length) phaseNote.textContent = '等待玩家加入';
      else if (gs.length > 1) phaseNote.textContent = '人数超出 2 人';
      else phaseNote.textContent = gs[0].ready ? '对手已准备，可以开始' : '等待对手准备';
    } else {
      phaseNote.textContent = state.ready ? '已准备，等待房主开始' : '点击准备，等待房主开始';
    }
  }

  function renderBanner() {
    const box = el('online-banner');
    if (!box) return;
    let text = '';
    let cls = '';
    if (state.role === 'guest' && state.host && state.host.online === false) {
      text = '房主已离开，房间已关闭';
      cls = 'is-danger';
    } else if (state.netStatus === 'reconnecting' || state.netStatus === 'offline' ||
               state.netStatus === 'closed' || state.netStatus === 'error') {
      text = state.netStatus === 'error' ? '连接异常，正在尝试恢复…' : '连接中断，正在重连…';
      cls = 'is-warn';
    } else if (state.phase === 'battle') {
      text = '对局已开始 · 地图已锁定';
      cls = 'is-live';
    }
    box.className = 'online-banner' + (text ? ' ' + cls : ' hidden');
    box.textContent = text;
  }

  function renderLogs() {
    const box = el('online-log');
    if (!box) return;
    box.innerHTML = '';
    if (!state.logs.length) {
      const li = document.createElement('li');
      li.className = 'online-log-empty';
      li.textContent = '房间动态会显示在这里';
      box.appendChild(li);
      return;
    }
    state.logs.slice(-14).forEach(function (item) {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.className = 'online-log-time';
      t.textContent = clock(item.t);
      const m = document.createElement('span');
      m.textContent = item.msg;
      li.appendChild(t);
      li.appendChild(m);
      box.appendChild(li);
    });
  }

  function renderRoom() {
    const isHost = state.role === 'host';
    const back = el('online-back');
    if (back) {
      back.title = '离开房间';
      back.setAttribute('aria-label', '离开房间');
    }
    setText('online-role-label', isHost ? '房主 · 创建者' : '玩家 · 已加入');
    const fmt = NET.formatCode(state.roomCode);
    setText('online-code-display', fmt);
    setText('online-code-box', fmt);
    const relayShort = (broker().name || '').split(' · ')[0];
    setText('online-code-note', isFileProtocol()
      ? '中继 ' + relayShort + ' · 本地文件打开：发房间码，并让对方拿到同一份网页。'
      : '中继 ' + relayShort + ' · 发给同学，输入同一串代码即可加入。');
    hideEl('online-invite', isFileProtocol());

    renderMapPanel();
    renderPlayers();
    renderActions();
    renderBanner();
    renderPhaseNote();
    renderLogs();

    document.title = fmt ? ('房间 ' + fmt + ' · 兵棋') : TITLE;
  }

  function setView(view) {
    state.view = view;
    const back = el('online-back');
    if (back) {
      back.title = view === 'room' ? '离开房间' : '返回主菜单';
      back.setAttribute('aria-label', view === 'room' ? '离开房间' : '返回主菜单');
    }
    if (view === 'entry') document.title = TITLE;
    hideEl('online-entry', view !== 'entry');
    hideEl('online-room', view !== 'room');
    if (view === 'room') {
      renderRoom();
      setTimeout(scheduleDraw, 30);
    } else {
      renderEntry();
    }
  }

  /* =============================================================
   * 房间生命周期
   * ============================================================= */

  function clearJoinTimer() {
    if (state.joinTimer) clearTimeout(state.joinTimer);
    state.joinTimer = 0;
  }

  function resetRoom() {
    clearJoinTimer();
    state.host = null;
    state.hostSeen = 0;
    state.guests.clear();
    state.map = null;
    state.mapWrapper = null;
    state.selectedMapId = '';
    state.phase = 'lobby';
    state.ready = false;
    state.joined = false;
    state.logs.length = 0;
    state.hostGoneAlerted = false;
  }

  async function connectNet(role, code, name, gen) {
    if (!NET) throw new Error('联机组件没有加载（online-net.js）');
    if (!window.mqtt) throw new Error('MQTT 组件没有加载（lib/mqtt.min.js）');

    const net = await NET.createNet({
      brokerUrl: broker().url,
      roomCode: code,
      role: role,
      name: name,
      selfId: state.selfId,
      onStatus: function (s) {
        if (gen !== state.gen) return;
        setStatus(s.state);
        if (s.state === 'error' && s.message) pushLog('中继：' + s.message);
      },
      onHost: function (presence) {
        if (gen !== state.gen) return;
        onHostPresence(presence);
      },
      onGuest: function (presence) {
        if (gen !== state.gen) return;
        onGuestPresence(presence);
      },
      onGuestRemoved: function (id) {
        if (gen !== state.gen) return;
        if (state.guests.delete(id)) {
          pushLog('玩家 离开了房间');
          renderPlayers();
          renderActions();
        }
      },
      onMap: function (wrapper) {
        if (gen !== state.gen) return;
        onMapReceived(wrapper);
      },
      onLog: function (msg) {
        if (gen !== state.gen) return;
        if (window.console) console.info('[online]', msg);
      },
    });
    return net;
  }

  async function startHost() {
    if (state.connecting) return;
    const name = readName();
    const gen = ++state.gen;
    resetRoom();
    state.role = 'host';
    state.roomCode = NET.randomCode();
    setView('entry');
    setBusy(true);
    setStatus('connecting');
    let net = null;

    try {
      net = await connectNet('host', state.roomCode, name, gen);
      if (gen !== state.gen) { net.disconnect(); return; }
      await net.connect();
      if (gen !== state.gen) { net.disconnect(); return; }
      state.net = net;
      await net.setHostState({
        phase: 'lobby',
        maxPlayers: MAX_PLAYERS,
        map: null,
      });
      if (gen !== state.gen) { net.disconnect(); return; }
      state.joined = true;
      setView('room');
      pushLog('房间已创建，等待玩家加入');
      // 房主不改地址栏：刷新后应该回主菜单，而不是拿自己的房间码当客人加入。
      renderRoom();
      mount.focus({ preventScroll: true });
    } catch (err) {
      if (gen !== state.gen) { if (net) net.disconnect(); return; }
      if (net) net.disconnect();
      state.net = null;
      state.joined = false;
      setView('entry');
      setStatus('idle');
      showAlert('创建房间失败', friendlyError(err));
    } finally {
      if (gen === state.gen) setBusy(false);
    }
  }

  function waitForHost(gen) {
    return new Promise(function (resolve, reject) {
      const started = Date.now();
      const tick = function () {
        if (gen !== state.gen) { reject(new Error('cancelled')); return; }
        if (state.host) {
          if (state.host.online === false) { reject(new Error('房主已离开')); return; }
          if (state.host.phase === 'battle') { reject(new Error('对局已经开始，暂时不能加入')); return; }
          resolve();
          return;
        }
        if (Date.now() - started > JOIN_WAIT_MS) {
          reject(new Error('没有找到这个房间，或者房主已经离线'));
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  async function startGuest(rawCode) {
    if (state.connecting) return;
    const code = NET.normalizeCode(rawCode);
    if (!NET.isValidCode(code)) {
      showAlert('房间码不对', '房间码是 8 位字母数字，例如 ABCD-EFGH。请向房主确认。');
      const input = el('online-code');
      if (input) { input.focus(); input.select(); }
      return;
    }
    const name = readName();
    const gen = ++state.gen;
    resetRoom();
    state.role = 'guest';
    state.roomCode = code;
    setView('entry');
    setBusy(true);
    setStatus('connecting');
    let net = null;

    try {
      net = await connectNet('guest', code, name, gen);
      if (gen !== state.gen) { net.disconnect(); return; }
      await net.connect();
      if (gen !== state.gen) { net.disconnect(); return; }
      state.net = net;
      await net.setGuestState({ ready: false });
      await waitForHost(gen);
      // 等一小会儿，收取其他玩家 retained 状态，判断房间是否已满
      await sleep(FULL_WAIT_MS);
      if (gen !== state.gen) return;
      if (otherGuests().length >= 1) throw new Error('房间已满（2 / 2）');
      if (!state.host || state.host.online === false) throw new Error('房主已离开');
      if (state.host.phase === 'battle') throw new Error('对局已经开始，暂时不能加入');

      state.joined = true;
      state.phase = state.host.phase || 'lobby';
      state.ready = false;
      setView('room');
      pushLog('已加入房间');
      updateRoomParam();
      renderRoom();
      mount.focus({ preventScroll: true });
    } catch (err) {
      if (gen !== state.gen) { if (net) net.disconnect(); return; }
      if (net) net.disconnect();
      state.net = null;
      state.joined = false;
      state.role = null;
      state.roomCode = '';
      setView('entry');
      setStatus('idle');
      if (err.message !== 'cancelled') showAlert('加入失败', friendlyError(err));
    } finally {
      if (gen === state.gen) setBusy(false);
    }
  }

  function friendlyError(err) {
    const msg = (err && err.message) ? err.message : '未知错误';
    if (/Web Crypto|getRandomValues|安全上下文/i.test(msg)) {
      return '当前页面无法使用浏览器加密 API。请用 https://、localhost 或 file:// 打开；内网 IP 的 http:// 不行。';
    }
    if (/timeout|超时/i.test(msg)) {
      return msg + '。如果中继不稳定，展开「高级：中继服务器」换一个再试。';
    }
    if (/房间已满|房主已离开|对局已经开始/.test(msg)) return msg;
    return msg + '。如果反复失败，可以换一个中继服务器再试。';
  }

  function onHostPresence(h) {
    if (!h || h.role !== 'host') return;
    state.host = h;
    state.hostSeen = Date.now();
    if (state.role === 'host') return;

    if (h.online === false) {
      if (state.joined && !state.hostGoneAlerted) {
        state.hostGoneAlerted = true;
        showAlert('房主已离开', '房间已经关闭。', function () { leaveRoom(); });
      }
      renderBanner();
      return;
    }

    if (state.joined) {
      state.phase = h.phase === 'battle' ? 'battle' : 'lobby';
      // 房主状态说“还没有地图”时，清掉可能从旧会话 retained 下来的地图
      if (!h.map && state.map) {
        state.map = null;
        state.mapWrapper = null;
        state.selectedMapId = '';
      }
      renderRoom();
    }
  }

  function onGuestPresence(g) {
    if (!g || g.role !== 'guest' || g.id === state.selfId) return;
    const prev = state.guests.get(g.id);
    state.guests.set(g.id, { presence: g, seen: Date.now() });
    if (!g.online) {
      state.guests.delete(g.id);
      if (prev) pushLog('「' + (g.name || '玩家') + '」离开了房间');
    } else if (!prev || !prev.presence || !prev.presence.online) {
      pushLog('「' + (g.name || '玩家') + '」加入了房间');
    } else if (!!prev.presence.ready !== !!g.ready) {
      pushLog('「' + (g.name || '玩家') + '」' + (g.ready ? '已准备' : '取消准备'));
    }
    renderPlayers();
    renderActions();
    renderBanner();
    renderPhaseNote();
  }

  function onMapReceived(wrapper) {
    if (!wrapper || !wrapper.map) return;
    let r;
    try {
      r = parseMap(wrapper.map);
    } catch (e) {
      pushLog('地图同步失败：' + e.message);
      return;
    }
    const title = String(wrapper.title || '房主地图').slice(0, 40);
    const changed = !state.map || state.mapWrapper.title !== title ||
      state.map.cols !== r.parsed.cols || state.map.rows !== r.parsed.rows ||
      state.map.mode !== r.parsed.mode;
    state.map = r.parsed;
    state.mapWrapper = { title: title, map: wrapper.map };
    state.selectedMapId = '';
    if (changed) pushLog('地图已同步：' + title);
    if (state.view === 'room') {
      renderMapPanel();
      renderActions();
    }
  }

  async function leaveRoom() {
    state.gen++;
    clearJoinTimer();
    const net = state.net;
    state.net = null;
    state.joined = false;
    if (net) {
      try { net.disconnect(); } catch (e) { /* ignore */ }
    }
    resetRoom();
    state.role = null;
    state.roomCode = '';
    setStatus('idle');
    setView('entry');
    closeMapDialog(true);
    hideAlert();
    clearRoomParam();
    renderEntry();
    const name = el('online-name');
    if (name) name.focus();
  }

  /* =============================================================
   * 地图选择
   * ============================================================= */

  function openMapDialog() {
    if (state.role !== 'host' || state.phase === 'battle') return;
    state.dialogOpen = true;
    hideEl('online-map-dialog', false);
    renderMapList();
    syncInert();
    const close = el('online-map-close');
    if (close) close.focus();
  }

  function closeMapDialog(silent) {
    if (!state.dialogOpen) return;
    state.dialogOpen = false;
    hideEl('online-map-dialog', true);
    syncInert();
    if (!silent) {
      const pick = el('online-pick-map');
      if (pick) pick.focus();
    }
  }

  function renderMapList() {
    const box = el('online-map-list');
    if (!box) return;
    box.innerHTML = '';
    state.dialogEntries.clear();

    const entries = [];
    const draft = draftEntry();
    if (draft) entries.push(draft);
    libraryEntries().forEach(function (e) { entries.push(e); });
    entries.forEach(function (e) { state.dialogEntries.set(e.id, e); });

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'online-map-list-empty';
      const b = document.createElement('b');
      b.textContent = '地图库还是空的';
      const p = document.createElement('p');
      p.textContent = '可以导入编辑器导出的 JSON；或者先回地图编辑器画一张，再回来选「编辑器当前地图」。';
      empty.appendChild(b);
      empty.appendChild(p);
      box.appendChild(empty);
      return;
    }

    entries.forEach(function (entry) {
      const row = document.createElement('div');
      row.className = 'online-map-item' + (entry.id === state.selectedMapId ? ' is-current' : '');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'online-map-item-pick';
      pick.setAttribute('data-pick', entry.id);

      const thumb = document.createElement('canvas');
      thumb.className = 'online-map-thumb';

      const main = document.createElement('span');
      main.className = 'online-map-item-main';
      const b = document.createElement('b');
      b.textContent = entry.title;
      const small = document.createElement('small');
      small.textContent = modeName(entry.parsed.mode) + ' · ' +
        entry.parsed.cols + ' × ' + entry.parsed.rows + ' · ' +
        entry.parsed.cells.length + ' 格';
      main.appendChild(b);
      main.appendChild(small);

      const badge = document.createElement('span');
      badge.className = 'online-map-item-badge' + (entry.source === 'draft' ? ' is-draft' : '');
      badge.textContent = entry.id === state.selectedMapId ? '使用中' :
        (entry.source === 'draft' ? '编辑器' : '选择');

      pick.appendChild(thumb);
      pick.appendChild(main);
      pick.appendChild(badge);
      row.appendChild(pick);

      if (entry.source !== 'draft') {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'online-map-item-del';
        del.setAttribute('data-del', entry.id);
        del.title = '从地图库移除';
        del.textContent = '×';
        row.appendChild(del);
      }

      box.appendChild(row);
      drawThumb(thumb, entry.parsed);
    });
  }

  function useMap(entry) {
    if (!entry || state.role !== 'host' || state.phase === 'battle') return;
    if (entry.parsed.cells.length > MAX_ONLINE_CELLS) {
      showAlert('地图太大', '线上对战目前最多同步 ' + MAX_ONLINE_CELLS + ' 格（大约 80 × 60），这张图有 ' +
        entry.parsed.cells.length + ' 格。可以在地图编辑器里缩小尺寸再试。');
      return;
    }
    if (JSON.stringify(entry.map).length > 700000) {
      showAlert('地图数据太大', '这张地图接近公共中继的单条消息上限，换一张小一点的地图再试。');
      return;
    }
    state.map = entry.parsed;
    state.mapWrapper = { title: entry.title, map: entry.map };
    state.selectedMapId = entry.id;

    if (state.net) {
      state.net.publishMap(state.mapWrapper);
      state.net.setHostState({
        phase: state.phase,
        maxPlayers: MAX_PLAYERS,
        map: mapMeta(entry.parsed, entry.title),
      });
    }
    closeMapDialog(true);
    renderRoom();
    pushLog('房主选择了「' + entry.title + '」');
    toast('已选择「' + entry.title + '」');
    if (entry.warnings && entry.warnings.length) {
      pushLog('地图提示：' + entry.warnings[0]);
    }
  }

  async function importMapFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showAlert('地图文件太大', '地图 JSON 应该只有几十 KB；超过 2 MB 的文件不会读入。');
      return;
    }
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const r = parseMap(raw);
      if (r.parsed.cells.length > MAX_ONLINE_CELLS) {
        throw new Error('地图有 ' + r.parsed.cells.length + ' 格，线上对战最多 ' + MAX_ONLINE_CELLS + ' 格');
      }
      const title = String(file.name || '导入地图').replace(/\.json$/i, '').slice(0, 40) || '导入地图';
      const item = addLibrary(title, r.map);
      if (!item) return;
      useMap({
        id: item.id,
        title: title,
        source: 'library',
        parsed: r.parsed,
        map: r.map,
        warnings: r.warnings,
      });
    } catch (err) {
      showAlert('地图读取失败', err && err.message ? err.message : '不是有效的地图文件');
    }
  }

  /* =============================================================
   * 提示 / 复制
   * ============================================================= */

  function syncInert() {
    if (!SHELL) return;
    if (state.dialogOpen || state.alertOpen) SHELL.setAttribute('inert', '');
    else SHELL.removeAttribute('inert');
  }

  function showAlert(title, text, onClose) {
    closeMapDialog(true);
    state.alertOpen = true;
    state.alertClose = typeof onClose === 'function' ? onClose : null;
    setText('online-alert-title', title);
    setText('online-alert-text', text);
    hideEl('online-alert', false);
    syncInert();
    const ok = el('online-alert-ok');
    if (ok) ok.focus();
  }

  function hideAlert() {
    if (!state.alertOpen) return;
    state.alertOpen = false;
    hideEl('online-alert', true);
    syncInert();
    if (!state.open) return;
    const target = state.view === 'entry' ? el('online-name') : mount;
    if (target) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function closeAlert() {
    const cb = state.alertClose;
    state.alertClose = null;
    hideAlert();
    if (cb) cb();
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  /* =============================================================
   * URL / 打开 / 关闭
   * ============================================================= */

  function queryParam(key) {
    try { return new URLSearchParams(location.search).get(key); } catch (e) { return null; }
  }

  function updateRoomParam() {
    if (!state.roomCode) return;
    try {
      const p = new URLSearchParams(location.search);
      p.set('room', NET.normalizeCode(state.roomCode));
      if (state.brokerId !== 'emqx') p.set('broker', state.brokerId);
      else p.delete('broker');
      history.replaceState(null, '', location.pathname + '?' + p.toString());
    } catch (e) { /* file:// 某些浏览器不允许改 URL */ }
  }

  function clearRoomParam() {
    try {
      const p = new URLSearchParams(location.search);
      if (!p.has('room') && !p.has('broker')) return;
      p.delete('room');
      p.delete('broker');
      const q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
    } catch (e) { /* ignore */ }
  }

  function fillBrokerSelect() {
    const sel = el('online-broker');
    if (!sel) return;
    sel.innerHTML = '';
    BROKERS.forEach(function (b) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
    sel.value = state.brokerId;
  }

  function open(opts) {
    if (state.open) return;
    state.open = true;
    state.savedTitle = document.title;
    state.lastFocus = document.activeElement;
    resetRoom();
    state.role = null;
    state.roomCode = '';
    fillBrokerSelect();
    const nameInput = el('online-name');
    if (nameInput) nameInput.value = state.name || '';

    const code = opts && opts.code ? NET.normalizeCode(opts.code) : '';
    state.tab = code ? 'join' : 'create';
    const codeInput = el('online-code');
    if (codeInput) codeInput.value = code ? NET.formatCode(code) : '';
    renderEntry();

    mount.classList.remove('hidden');
    mount.setAttribute('aria-hidden', 'false');
    document.body.classList.add('online-open');
    const menu = document.getElementById('menu');
    if (menu) menu.setAttribute('inert', '');
    document.title = TITLE;
    setStatus('idle');
    state.view = 'entry';
    hideEl('online-entry', false);
    hideEl('online-room', true);
    const backBtn = el('online-back');
    if (backBtn) {
      backBtn.title = '返回主菜单';
      backBtn.setAttribute('aria-label', '返回主菜单');
    }

    requestAnimationFrame(function () {
      if (code) {
        const c = el('online-code');
        if (c) c.focus();
      } else if (nameInput) {
        nameInput.focus();
        nameInput.select();
      } else {
        mount.focus();
      }
    });
  }

  function close() {
    if (!state.open) return;
    if (state.view === 'room' || state.net) leaveRoom();
    state.gen++;
    state.open = false;
    mount.classList.add('hidden');
    mount.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('online-open');
    const menu = document.getElementById('menu');
    if (menu) menu.removeAttribute('inert');
    state.dialogOpen = false;
    state.alertOpen = false;
    hideEl('online-map-dialog', true);
    hideEl('online-alert', true);
    syncInert();
    clearRoomParam();
    document.title = state.savedTitle || '兵棋 · 线上战术桌';
    const target = state.lastFocus && state.lastFocus !== document.body && document.contains(state.lastFocus)
      ? state.lastFocus
      : document.querySelector('.menu-item[data-module="online"]');
    if (target) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
    state.lastFocus = null;
  }

  /* =============================================================
   * 事件
   * ============================================================= */

  function go() {
    if (state.connecting) return;
    if (!hasCrypto()) {
      showAlert('无法联机', '浏览器只在 HTTPS、localhost 或 file:// 页面提供 Web Crypto。' +
        '如果这是用内网 IP 的 http:// 打开的，请换成 HTTPS 部署；或者把整个文件夹发给同学，直接双击 index.html。');
      return;
    }
    readName();
    if (state.tab === 'join') startGuest(el('online-code').value);
    else startHost();
  }

  mount.addEventListener('click', function (e) {
    const tab = e.target.closest ? e.target.closest('.online-tab') : null;
    if (tab) {
      if (state.connecting) return;
      state.tab = tab.getAttribute('data-tab') === 'join' ? 'join' : 'create';
      renderEntry();
      if (state.tab === 'join') {
        const c = el('online-code');
        if (c) c.focus();
      } else {
        const n = el('online-name');
        if (n) n.focus();
      }
      return;
    }

    const pick = e.target.closest ? e.target.closest('[data-pick]') : null;
    if (pick) {
      const entry = state.dialogEntries.get(pick.getAttribute('data-pick'));
      if (entry) useMap(entry);
      return;
    }
    const del = e.target.closest ? e.target.closest('[data-del]') : null;
    if (del) {
      const id = del.getAttribute('data-del');
      const list = readLibrary().filter(function (x) { return String(x.id) !== id; });
      writeLibrary(list);
      if (state.selectedMapId === id) state.selectedMapId = '';
      renderMapList();
      toast('已从地图库移除');
      return;
    }

    if (e.target === el('online-map-dialog')) closeMapDialog();
  });

  el('online-back').addEventListener('click', function () {
    if (state.view === 'room' || state.net) leaveRoom();
    else close();
  });

  el('online-go').addEventListener('click', go);

  ['online-name', 'online-code'].forEach(function (id) {
    const input = el(id);
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
  });

  const codeInput = el('online-code');
  if (codeInput) {
    codeInput.addEventListener('input', function () {
      const s = NET.normalizeCode(codeInput.value).slice(0, 8);
      codeInput.value = s.length > 4 ? s.slice(0, 4) + '-' + s.slice(4) : s;
    });
  }

  const brokerSel = el('online-broker');
  if (brokerSel) {
    brokerSel.addEventListener('change', function () {
      state.brokerId = brokerSel.value;
      savePrefs();
    });
  }

  el('online-copy').addEventListener('click', async function () {
    const ok = await copyText(NET.formatCode(state.roomCode));
    toast(ok ? '房间码已复制' : '复制失败，请手动选择房间码');
  });

  el('online-invite').addEventListener('click', async function () {
    if (isFileProtocol()) {
      toast('当前是本地文件打开，邀请链接不可用；发房间码即可。');
      return;
    }
    const p = new URLSearchParams();
    p.set('room', NET.normalizeCode(state.roomCode));
    if (state.brokerId !== 'emqx') p.set('broker', state.brokerId);
    const url = location.origin + location.pathname + '?' + p.toString();
    const ok = await copyText(url);
    toast(ok ? '邀请链接已复制' : '复制失败，请手动复制地址栏');
  });

  el('online-leave').addEventListener('click', leaveRoom);
  el('online-pick-map').addEventListener('click', openMapDialog);
  el('online-map-empty-action').addEventListener('click', openMapDialog);
  el('online-map-close').addEventListener('click', function () { closeMapDialog(); });
  el('online-map-import').addEventListener('click', function () { el('online-map-file').click(); });

  el('online-map-file').addEventListener('change', function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (file) importMapFile(file);
  });

  el('online-alert-ok').addEventListener('click', closeAlert);

  el('online-ready').addEventListener('click', async function () {
    if (state.role !== 'guest' || state.phase === 'battle') return;
    state.ready = !state.ready;
    if (state.net) {
      await state.net.setGuestState({ ready: state.ready });
    }
    renderActions();
    renderPlayers();
    renderPhaseNote();
  });

  el('online-start').addEventListener('click', async function () {
    if (!canStart() || !state.net) return;
    state.phase = 'battle';
    await state.net.setHostState({
      phase: 'battle',
      maxPlayers: MAX_PLAYERS,
      map: state.map ? mapMeta(state.map, state.mapWrapper.title) : null,
    });
    pushLog('对局开始');
    renderRoom();
  });

  el('online-back-lobby').addEventListener('click', async function () {
    if (state.role !== 'host' || !state.net) return;
    state.phase = 'lobby';
    await state.net.setHostState({
      phase: 'lobby',
      maxPlayers: MAX_PLAYERS,
      map: state.map ? mapMeta(state.map, state.mapWrapper.title) : null,
    });
    pushLog('已返回大厅');
    renderRoom();
  });

  /* 键盘：Escape 只负责关弹层 / 返回入口；房间内不按 Esc 直接退房。
   * 其他按键在 #online 内冒泡时截住（不阻止默认行为，输入框照常打字），
   * 避免漏给 home.js / app3d.js。 */
  document.addEventListener('keydown', function (e) {
    if (!state.open) return;
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (state.alertOpen) { closeAlert(); return; }
    if (state.dialogOpen) { closeMapDialog(); return; }
    if (state.view === 'entry') close();
  }, true);

  mount.addEventListener('keydown', function (e) { e.stopPropagation(); });
  mount.addEventListener('keyup', function (e) { e.stopPropagation(); });

  /* 画布尺寸 */
  if (window.ResizeObserver) {
    const wrap = el('online-map').parentElement;
    if (wrap) new ResizeObserver(scheduleDraw).observe(wrap);
  }
  window.addEventListener('resize', scheduleDraw);

  /* =============================================================
   * 初始化
   * ============================================================= */

  loadPrefs();
  fillBrokerSelect();
  renderLogs();
  setStatus('idle');
  const codeField = el('online-code');
  if (codeField) codeField.value = '';

  const initialRoom = queryParam('room');
  if (initialRoom) {
    const c = NET.normalizeCode(initialRoom);
    if (NET.isValidCode(c)) {
      const brokerParam = queryParam('broker');
      if (brokerParam && BROKERS.some(function (b) { return b.id === brokerParam; })) {
        state.brokerId = brokerParam;
      }
      // 直接打开，不排到 setTimeout：app3d.js 启动时可能长时间占住主线程，
      // 邀请链接不应该等编辑器初始化完才出现。
      open({ code: c });
    }
  }

  window.Online = {
    open: open,
    close: close,
    leaveRoom: leaveRoom,
    isOpen: function () { return state.open; },
    roomCode: function () { return state.roomCode; },
    state: state,
  };
})();
