/* =============================================================
 * online.js —— 线上对战区块（UI 层）
 *
 * 流程：
 *   主菜单 → 线上对战 → 创建 / 加入房间 → 选地图 → 定模式 → 选阵营 → 准备开局
 *   也可以走「本地测试」：不连中继，一台电脑热座操控 1v1 / 2v1 / 2v2。
 *
 * 2v2 大厅：
 *   - 房间最多 4 人（攻方 2 + 守方 2），房主算在编制里；
 *   - 地图的 mode 决定这一局是攻防战还是争夺战（争夺战规则未定，先拦下）；
 *   - 攻防战里每个人自己选攻方 / 守方，双方各至少 1 人、最多 2 人；
 *   - 所有在线玩家都选了阵营并准备后，房主才能开始。
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
  const MAX_PLAYERS = (NET && NET.MAX_PLAYERS) || 4;
  const MAX_PER_SIDE = (NET && NET.MAX_PER_SIDE) || 2;
  const JOIN_WAIT_MS = 4200;
  const FULL_WAIT_MS = 1200;
  const MAX_ONLINE_CELLS = 6000;      // 预览 / 中继负载上限（编辑器本身最大 80×60）
  const TITLE = '线上对战 · 兵棋';

  const SIDES = [
    {
      id: 'attacker', name: '攻方', short: '攻', text: '进攻方',
      desc: '从出生点逐环展开，向守方指挥部推进',
    },
    {
      id: 'defender', name: '守方', short: '守', text: '防守方',
      desc: '在部署区内布防，守住指挥部与阵地',
    },
  ];
  const SIDE_BY_ID = {};
  SIDES.forEach(function (s) { SIDE_BY_ID[s.id] = s; });

  /* 国家阵营。目前只有美 / 德导入了单位模型，其余先显示但不能选。 */
  const FACTIONS = [
    { id: 'us', name: '美国', code: 'US', char: '美', color: '#5b8ad6', available: true },
    { id: 'de', name: '德国', code: 'DE', char: '德', color: '#909cab', available: true },
    { id: 'ussr', name: '苏联', code: 'USSR', char: '苏', color: '#d2453c', available: false },
    { id: 'uk', name: '英国', code: 'UK', char: '英', color: '#8a9a58', available: false },
    { id: 'cn', name: '中国', code: 'CN', char: '中', color: '#c2603f', available: false },
  ];
  const FACTION_BY_ID = {};
  FACTIONS.forEach(function (f) { FACTION_BY_ID[f.id] = f; });

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
    joinedAt: 0,            // 本端进入房间的时间，用来算“同侧谁先来”
    roomCode: '',
    host: null,             // 房主 presence
    hostSeen: 0,
    guests: new Map(),      // id -> { presence, seen }
    map: null,              // MapIO.parse 的结果
    mapWrapper: null,       // { title, map }
    selectedMapId: '',
    side: null,             // 自己选的阵营：attacker / defender
    faction: null,          // 自己选的国家阵营：us / de / ussr / uk / cn
    factionReady: false,    // 自己这一方是否已确认国家阵营
    deckReady: false,       // 自己这一方是否已确认师配置
    prep: null,             // 战前配置：{ corpsId, divisionId, units, ready }
    prepData: null,         // window.PREP_DATA
    prepLoading: false,
    prepError: '',
    hostFactions: null,     // 开局时房主发布的双方国家快照
    factionView: false,     // 是否正在“选国家阵营”大界面
    factionPrompted: false, // 攻守双方就位后是否已经自动跳过界面
    hostTeams: null,        // 开局时房主发布的编制快照
    test: false,            // 本地测试模式：不连中继，一台电脑热座操控
    testSeats: [],          // { id, name, side, ready }，第一个是房主
    testSeq: 0,
    activeSeat: '',         // 当前操控的本机玩家 id
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

  function sideDef(id) {
    return id && SIDE_BY_ID[id] ? SIDE_BY_ID[id] : null;
  }

  function sideName(id) {
    const s = sideDef(id);
    return s ? s.name : '未选攻守';
  }

  function factionDef(id) {
    return id && FACTION_BY_ID[id] ? FACTION_BY_ID[id] : null;
  }

  function normalizeFaction(id) {
    return id && FACTION_BY_ID[id] ? id : null;
  }

  function factionName(id) {
    const f = factionDef(id);
    return f ? f.name : '未定';
  }

  function availableFactions() {
    return FACTIONS.filter(function (f) { return f.available; });
  }

  function createPrep() {
    return { corpsId: '', divisionId: '', units: {}, ready: false };
  }

  function normalizeSide(id) {
    return id === 'attacker' || id === 'defender' ? id : null;
  }

  function otherSide(id) {
    return id === 'attacker' ? 'defender' : 'attacker';
  }

  function truncName(name) {
    const s = String(name || '玩家');
    return s.length > 8 ? s.slice(0, 8) + '…' : s;
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
      local: '本地测试',
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

  /* 当前实时在场的人（房主 + 客人），是选阵营 / 开局判定的依据 */
  function liveRoster() {
    if (state.test) {
      return state.testSeats.map(function (s, i) {
        return {
          id: s.id,
          name: s.name,
          role: i === 0 ? 'host' : 'guest',
          online: true,
          ready: i === 0 ? true : !!s.ready,
          side: normalizeSide(s.side),
          faction: normalizeFaction(s.faction),
          factionReady: !!s.factionReady,
          deckReady: !!s.deckReady,
          prep: s.prep || null,
          joinedAt: i + 1,
          self: s.id === state.activeSeat,
        };
      });
    }

    const out = [];
    const hostPresence = state.role === 'host' ? null : state.host;
    out.push({
      id: state.role === 'host' ? state.selfId : ((hostPresence && hostPresence.id) || 'host'),
      name: state.role === 'host' ? state.name : ((hostPresence && hostPresence.name) || '房主'),
      role: 'host',
      online: state.role === 'host' ? true : !!(hostPresence && hostPresence.online),
      ready: true,
      side: normalizeSide(state.role === 'host' ? state.side : (hostPresence && hostPresence.side)),
      faction: normalizeFaction(state.role === 'host' ? state.faction : (hostPresence && hostPresence.faction)),
      factionReady: state.role === 'host' ? state.factionReady : !!(hostPresence && hostPresence.factionReady),
      deckReady: state.role === 'host' ? state.deckReady : !!(hostPresence && hostPresence.deckReady),
      prep: state.role === 'host' ? state.prep : (hostPresence && hostPresence.prep) || null,
      joinedAt: 0,
      self: state.role === 'host',
    });
    onlineGuestList().forEach(function (g) {
      out.push({
        id: g.id,
        name: g.name || '玩家',
        role: 'guest',
        online: !!g.online,
        ready: !!g.ready,
        side: normalizeSide(g.side),
        faction: normalizeFaction(g.faction),
        factionReady: !!g.factionReady,
        deckReady: !!g.deckReady,
        prep: g.prep || null,
        joinedAt: Number(g.joinedAt) || 0,
        self: g.id === state.selfId,
      });
    });
    if (state.role === 'guest' && !out.some(function (p) { return p.id === state.selfId; })) {
      out.push({
        id: state.selfId, name: state.name, role: 'guest',
        online: true, ready: state.ready, side: normalizeSide(state.side),
        faction: normalizeFaction(state.faction),
        factionReady: state.factionReady,
        deckReady: state.deckReady,
        prep: state.prep,
        joinedAt: Number(state.joinedAt) || 0,
        self: true,
      });
    }
    return out;
  }

  /* 开局后以房主发布的编制快照为准，中途掉线的人仍留在名单里 */
  function roster() {
    const live = liveRoster();
    if (state.phase === 'battle' && state.hostTeams && state.hostTeams.length) {
      const byId = {};
      live.forEach(function (p) { byId[p.id] = p; });
      return state.hostTeams.map(function (t) {
        const l = byId[t.id] || null;
        return {
          id: t.id,
          name: t.name || (l && l.name) || '玩家',
          role: t.role === 'host' ? 'host' : 'guest',
          online: l ? l.online : (t.id === state.selfId),
          ready: t.role === 'host' ? true : !!(l && l.ready),
          side: normalizeSide(t.side),
          faction: normalizeFaction(t.faction),
          joinedAt: l ? l.joinedAt : 0,
          self: t.id === state.selfId,
        };
      });
    }
    return live;
  }

  function onlineRoster() {
    return roster().filter(function (p) { return p.online; });
  }

  function sideCount(side, excludeId) {
    return onlineRoster().filter(function (p) {
      return p.side === side && p.id !== excludeId;
    }).length;
  }

  function teamCounts() {
    const list = onlineRoster();
    return {
      attacker: list.filter(function (p) { return p.side === 'attacker'; }).length,
      defender: list.filter(function (p) { return p.side === 'defender'; }).length,
      unassigned: list.filter(function (p) { return !p.side; }).length,
      total: list.length,
    };
  }

  function teamsReady() {
    const c = teamCounts();
    return c.total >= 2 && c.attacker >= 1 && c.defender >= 1 &&
      c.attacker <= MAX_PER_SIDE && c.defender <= MAX_PER_SIDE && c.unassigned === 0;
  }

  function canChooseSide() {
    return state.phase !== 'battle' && !!state.map && state.map.mode === 'attack';
  }

  /* 每一方的“队长”：房主在自己那侧优先，其余同侧最早进来的人（joinedAt 小者）。 */
  function sideCaptain(side) {
    const list = roster().filter(function (p) {
      return p.online && p.side === side;
    });
    if (!list.length) return null;
    const host = list.filter(function (p) { return p.role === 'host'; })[0];
    if (host) return host;
    return list.slice().sort(function (a, b) {
      const ja = Number(a.joinedAt) || 0;
      const jb = Number(b.joinedAt) || 0;
      if (ja !== jb) return ja - jb;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    })[0];
  }

  function sideFaction(side) {
    if (state.phase === 'battle' && state.hostFactions) {
      return normalizeFaction(state.hostFactions[side]);
    }
    const cap = sideCaptain(side);
    return cap ? normalizeFaction(cap.faction) : null;
  }

  function selfIsCaptain(side) {
    const cap = sideCaptain(side);
    return !!cap && !!cap.self;
  }

  function factionsConflict() {
    const a = sideFaction('attacker');
    const d = sideFaction('defender');
    return !!a && !!d && a === d;
  }

  function factionsReady() {
    const a = sideFaction('attacker');
    const d = sideFaction('defender');
    return !!a && !!d && a !== d;
  }

  function myFactionReady() {
    if (!state.test) return !!state.factionReady;
    const seat = activeTestSeat();
    return !!(seat && seat.factionReady);
  }

  function myDeckReady() {
    if (!state.test) return !!state.deckReady;
    const seat = activeTestSeat();
    return !!(seat && seat.deckReady);
  }

  function myPrep() {
    if (!state.test) {
      if (!state.prep) state.prep = createPrep();
      return state.prep;
    }
    const seat = activeTestSeat();
    if (!seat) return createPrep();
    if (!seat.prep) seat.prep = createPrep();
    return seat.prep;
  }

  function sidePrep(side) {
    const cap = sideCaptain(side);
    return cap ? cap.prep || null : null;
  }

  function sideFactionConfirmed(side) {
    const cap = sideCaptain(side);
    return !!(cap && cap.factionReady);
  }

  function sideDeckConfirmed(side) {
    const cap = sideCaptain(side);
    return !!(cap && cap.deckReady);
  }

  function bothFactionsConfirmed() {
    return factionsReady() && sideFactionConfirmed('attacker') && sideFactionConfirmed('defender');
  }

  function bothDecksConfirmed() {
    return sideDeckConfirmed('attacker') && sideDeckConfirmed('defender');
  }

  async function pickFaction(side, id) {
    const s = normalizeSide(side);
    const f = factionDef(id);
    if (!s || !f) return;
    if (!canChooseSide()) {
      toast('先选一张攻防战地图，再选国家阵营');
      return;
    }
    if (state.side !== s) {
      toast('先选到' + sideName(s) + '，再选国家阵营');
      return;
    }
    if (!selfIsCaptain(s)) {
      const cap = sideCaptain(s);
      toast('本阵营由「' + (cap ? cap.name : '队长') + '」选择');
      return;
    }
    if (!f.available) {
      toast(f.name + '的单位模型还没导入，先只开放美国和德国');
      return;
    }
    const other = sideFaction(otherSide(s));
    if (other === id) {
      toast('对方已经选了' + f.name + '，双方阵营不能相同');
      return;
    }

    if (state.test) {
      const seat = activeTestSeat();
      if (!seat) return;
      seat.faction = id;
      syncActiveSeat();
      refreshRoom();
      pushLog('「' + seat.name + '」的' + sideName(s) + '阵营：' + f.name);
      toast('「' + seat.name + '」的' + sideName(s) + '阵营：' + f.name);
      return;
    }

    state.faction = id;
    if (state.net) {
      if (state.role === 'host') await state.net.setHostState({ faction: id });
      else await state.net.setGuestState({ faction: id, side: s, ready: state.ready });
    }
    refreshRoom();
    pushLog((state.role === 'host' ? '房主' : '你') + '为' + sideName(s) + '选了' + f.name);
    toast(sideName(s) + '阵营：' + f.name);
  }

  function randomFaction(side) {
    const s = normalizeSide(side);
    if (!s) {
      toast('先选择攻方或守方');
      return;
    }
    if (!selfIsCaptain(s)) {
      const cap = sideCaptain(s);
      toast('本阵营由「' + (cap ? cap.name : '队长') + '」随机');
      return;
    }
    const other = sideFaction(otherSide(s));
    const current = sideFaction(s);
    let pool = availableFactions().filter(function (f) {
      return f.id !== other && f.id !== current;
    });
    if (!pool.length) {
      pool = availableFactions().filter(function (f) { return f.id !== other; });
    }
    if (!pool.length) {
      toast('没有可随机的阵营');
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    pickFaction(s, pick.id);
  }

  function bothSidesHavePlayers() {
    const c = teamCounts();
    return c.attacker > 0 && c.defender > 0;
  }

  function applyRoomStage() {
    const prep = state.phase === 'prepare' && state.view === 'room';
    const open = state.factionView && state.phase === 'lobby' && state.view === 'room';
    const grid = mount.querySelector('.online-room-grid');
    const foot = mount.querySelector('.online-room-foot');
    if (grid) grid.classList.toggle('hidden', open || prep);
    if (foot) foot.classList.toggle('hidden', open || prep);
    hideEl('online-faction-view', !open);
    hideEl('online-prep', !prep);
    hideEl('online-flow', prep);
    hideEl('online-test', prep);
    hideEl('online-banner', prep);
  }

  /* 攻守双方都有人后自动跳到“选国家阵营”大界面；关掉后不再自动弹。 */
  function syncFactionView() {
    if (state.view !== 'room') {
      state.factionView = false;
      return;
    }
    if (state.phase !== 'lobby') state.factionView = false;
    const both = bothSidesHavePlayers();
    const attackMap = !!state.map && state.map.mode === 'attack';
    if (state.phase === 'battle' || !attackMap || !both) {
      state.factionView = false;
    }
    if (!both || !attackMap) state.factionPrompted = false;
    if (!state.factionView && state.phase === 'lobby' && both && attackMap &&
        !!state.side && !factionsReady() && !state.factionPrompted) {
      state.factionView = true;
      state.factionPrompted = true;
    }
    applyRoomStage();
    if (state.factionView) renderFactionView();
  }

  function openFactionView() {
    if (state.view !== 'room' || state.phase === 'battle') return;
    if (!state.map || state.map.mode !== 'attack') {
      toast('先选一张攻防战地图，再选国家阵营');
      return;
    }
    if (!bothSidesHavePlayers()) {
      toast('先让双方都选好攻守，再选国家阵营');
      return;
    }
    if (!state.side) {
      toast('先选择你的攻守');
      return;
    }
    state.factionView = true;
    state.factionPrompted = true;
    applyRoomStage();
    renderFactionView();
    const back = el('online-faction-back');
    if (back) back.focus();
  }

  function closeFactionView() {
    if (!state.factionView) return;
    state.factionView = false;
    applyRoomStage();
    refreshRoom();
    const btn = el('online-faction-open');
    if (btn && !btn.disabled) btn.focus();
  }

  /* 房间侧栏里的阵营摘要：只显示结果和入口，真正的选择在大界面里。 */
  function prepPayload(prep) {
    return {
      corpsId: prep.corpsId || '',
      divisionId: prep.divisionId || '',
      units: Object.assign({}, prep.units || {}),
      ready: !!prep.ready,
    };
  }

  function publishPrep() {
    const prep = myPrep();
    state.deckReady = !!prep.ready;
    if (state.test) {
      const seat = activeTestSeat();
      if (seat) seat.deckReady = state.deckReady;
      return;
    }
    if (!state.net) return;
    const payload = prepPayload(prep);
    if (state.role === 'host') {
      state.net.setHostState({ prep: payload, deckReady: state.deckReady });
    } else {
      state.net.setGuestState({ prep: payload, deckReady: state.deckReady });
    }
  }

  async function confirmFaction() {
    const side = normalizeSide(state.side);
    if (!side) {
      toast('先选择你的攻守');
      return;
    }
    if (!factionsReady()) {
      toast('双方先把国家阵营选完');
      return;
    }
    if (!selfIsCaptain(side)) {
      const cap = sideCaptain(side);
      toast('本阵营由「' + (cap ? cap.name : '队长') + '」确认');
      return;
    }
    if (myFactionReady()) return;

    if (state.test) {
      const seat = activeTestSeat();
      if (seat) seat.factionReady = true;
      refreshRoom();
      maybePrepare();
      return;
    }

    state.factionReady = true;
    if (state.net) {
      if (state.role === 'host') await state.net.setHostState({ factionReady: true });
      else await state.net.setGuestState({ factionReady: true });
    }
    refreshRoom();
    maybePrepare();
  }

  function maybePrepare() {
    if (state.phase !== 'lobby') return;
    if (!state.map || state.map.mode !== 'attack') return;
    if (!factionsReady() || !bothFactionsConfirmed()) return;
    if (state.test) {
      enterPrepare();
      return;
    }
    if (state.role === 'host') enterPrepare();
  }

  function enterPrepare() {
    if (state.phase === 'prepare') return;
    state.phase = 'prepare';
    state.factionView = false;
    state.factionPrompted = true;
    if (state.test) {
      const seat = activeTestSeat();
      if (seat) seat.factionReady = true;
    }
    if (state.net && state.role === 'host') {
      const factions = { attacker: sideFaction('attacker'), defender: sideFaction('defender') };
      state.hostFactions = factions;
      state.net.setHostState({
        phase: 'prepare',
        factions: factions,
        side: state.side,
        faction: state.faction,
        prep: prepPayload(myPrep()),
        deckReady: state.deckReady,
      });
    }
    pushLog('双方阵营已确认 · 进入 A 阶段战前准备');
    renderRoom();
    window.dispatchEvent(new Event('resize'));
  }

  function renderFactionPick() {
    const box = el('online-faction');
    if (!box) return;
    box.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'online-faction-head';
    const title = document.createElement('b');
    title.textContent = '国家阵营';
    head.appendChild(title);

    const btn = document.createElement('button');
    btn.id = 'online-faction-open';
    btn.type = 'button';
    btn.className = 'btn small';
    const ready = factionsReady();
    const locked = state.phase === 'battle';
    const confirmed = myFactionReady();
    const both = bothSidesHavePlayers();
    btn.textContent = locked ? '已锁定' : (confirmed ? '阵营已确认' : (ready ? '更换阵营' : '选择阵营'));
    btn.disabled = locked || confirmed || !both || !state.map || state.map.mode !== 'attack' || !state.side;
    btn.title = btn.disabled
      ? (locked ? '对局已开始，阵营已锁定' : (confirmed ? '本阵营已确认，等待对方' : '双方选好攻守后开放'))
      : '打开国家阵营界面';
    head.appendChild(btn);
    box.appendChild(head);

    const row = document.createElement('div');
    row.className = 'online-faction-summary';
    SIDES.forEach(function (side) {
      const chip = document.createElement('span');
      chip.className = 'online-faction-chip is-' + side.id;
      const dot = document.createElement('i');
      const label = document.createElement('b');
      label.textContent = side.name;
      const value = document.createElement('span');
      const fac = sideFaction(side.id);
      value.textContent = fac ? factionName(fac) : '待选';
      if (!fac) value.classList.add('is-empty');
      chip.appendChild(dot);
      chip.appendChild(label);
      chip.appendChild(value);
      row.appendChild(chip);
    });
    box.appendChild(row);

    const note = document.createElement('p');
    note.className = 'online-faction-note';
    if (locked) {
      note.textContent = '对局已开始，双方阵营已锁定。';
    } else if (!both) {
      note.textContent = '双方都选好攻守后，会进入国家阵营界面。';
    } else if (factionsConflict()) {
      note.textContent = '双方阵营不能相同，点「更换阵营」调整。';
    } else if (!ready) {
      note.textContent = '还有一方没选国家阵营，点「选择阵营」继续。';
    } else {
      note.textContent = '双方阵营已确定；需要修改可以点「更换阵营」。';
    }
    box.appendChild(note);
  }

  function renderFactionView() {
    const view = el('online-faction-view');
    const board = el('online-faction-board');
    if (!view || !board) return;
    board.innerHTML = '';

    const locked = state.phase === 'battle';
    const conflict = factionsConflict();
    const ready = factionsReady();
    const mySide = normalizeSide(state.side);
    const myConfirmed = myFactionReady();
    const myCaptain = mySide ? selfIsCaptain(mySide) : false;

    SIDES.forEach(function (side) {
      const faction = sideFaction(side.id);
      const other = sideFaction(otherSide(side.id));
      const cap = sideCaptain(side.id);
      const isCaptain = !!cap && !!cap.self;
      const isActive = state.side === side.id;
      const confirmed = sideFactionConfirmed(side.id);
      const canPick = isActive && isCaptain && !locked && !confirmed &&
        !!state.map && state.map.mode === 'attack';

      const panel = document.createElement('section');
      panel.className = 'faction-panel is-' + side.id +
        (isActive ? ' is-active' : '') +
        (faction ? ' is-done' : '') +
        (confirmed ? ' is-confirmed' : '') +
        (conflict && faction ? ' is-conflict' : '');

      const head = document.createElement('header');
      head.className = 'faction-panel-head';
      const tag = document.createElement('span');
      tag.className = 'faction-panel-tag';
      const dot = document.createElement('i');
      const tagName = document.createElement('b');
      tagName.textContent = side.name;
      tag.appendChild(dot);
      tag.appendChild(tagName);
      head.appendChild(tag);

      const capLabel = document.createElement('span');
      capLabel.className = 'faction-panel-captain';
      if (locked) capLabel.textContent = '已锁定';
      else if (confirmed) capLabel.textContent = '已确认';
      else if (!cap) capLabel.textContent = '等待本方玩家';
      else if (cap.self) capLabel.textContent = '队长：你';
      else capLabel.textContent = '队长：' + cap.name;
      head.appendChild(capLabel);

      const stateChip = document.createElement('span');
      stateChip.className = 'faction-panel-state' +
        (conflict && faction ? ' is-conflict' : (faction ? ' is-set' : ''));
      stateChip.textContent = conflict && faction ? '冲突' :
        (faction ? (confirmed ? '已确认 ' : '已选 ') + factionName(faction) : '待选');
      head.appendChild(stateChip);
      panel.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'faction-panel-nations';
      FACTIONS.forEach(function (f) {
        const selected = faction === f.id;
        const taken = other === f.id;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'faction-card is-' + f.id +
          (selected ? ' is-selected' : '') +
          (f.available ? '' : ' is-unavailable') +
          (taken ? ' is-taken' : '');
        card.setAttribute('data-faction', f.id);
        card.setAttribute('data-faction-side', side.id);
        card.setAttribute('aria-pressed', selected ? 'true' : 'false');
        card.disabled = !canPick || !f.available || taken;
        if (confirmed) card.title = '本阵营已确认';
        else if (!f.available) card.title = f.name + '的单位模型还没导入';
        else if (taken) card.title = '对方已经选了' + f.name + '，双方阵营不能相同';
        else if (!canPick) card.title = isActive ? '本阵营由队长选择' : '只能选自己这一方';
        else card.title = '选' + f.name;

        const ch = document.createElement('span');
        ch.className = 'faction-card-char';
        ch.textContent = f.char;
        ch.style.color = f.color;
        ch.style.borderColor = f.color + '66';
        ch.style.background = f.color + '18';

        const main = document.createElement('span');
        main.className = 'faction-card-main';
        const name = document.createElement('b');
        name.textContent = f.name;
        const code = document.createElement('small');
        code.textContent = f.available ? f.code : '未导入';
        main.appendChild(name);
        main.appendChild(code);

        const mark = document.createElement('span');
        mark.className = 'faction-card-mark';
        mark.textContent = selected ? (confirmed ? '已确认' : '已选') :
          (!f.available ? '未导入' : (taken ? '对方已选' : ''));
        card.appendChild(ch);
        card.appendChild(main);
        card.appendChild(mark);
        grid.appendChild(card);
      });

      const rand = document.createElement('button');
      rand.type = 'button';
      rand.className = 'faction-card is-random';
      rand.setAttribute('data-faction-random-side', side.id);
      rand.disabled = !canPick;
      rand.title = canPick ? '在已导入、且没被对方选走的阵营里随机' : '本阵营由队长选择';
      const dice = document.createElement('span');
      dice.className = 'faction-card-char is-dice';
      dice.textContent = '?';
      const rmain = document.createElement('span');
      rmain.className = 'faction-card-main';
      const rname = document.createElement('b');
      rname.textContent = '随机';
      const rcode = document.createElement('small');
      rcode.textContent = 'RANDOM';
      rmain.appendChild(rname);
      rmain.appendChild(rcode);
      rand.appendChild(dice);
      rand.appendChild(rmain);
      grid.appendChild(rand);
      panel.appendChild(grid);

      const note = document.createElement('p');
      note.className = 'faction-panel-note';
      if (locked) {
        note.textContent = '对局已开始，本局阵营已锁定。';
      } else if (confirmed) {
        note.textContent = '本阵营已确认，等待对方。';
      } else if (!cap) {
        note.textContent = '等待玩家选择攻守。';
      } else if (!isCaptain) {
        note.textContent = '由队长「' + cap.name + '」选择；同侧队友只看结果。';
      } else if (isActive) {
        note.textContent = '由你选择：点国家卡片，或点「随机」。双方不能相同。';
      } else {
        note.textContent = '由队长「' + cap.name + '」选择；这里可以实时看到结果。';
      }
      panel.appendChild(note);
      board.appendChild(panel);
    });

    const status = el('online-faction-status');
    if (status) {
      const bothConfirmed = sideFactionConfirmed('attacker') && sideFactionConfirmed('defender');
      status.className = 'online-faction-status' +
        (conflict ? ' is-conflict' : (bothConfirmed ? ' is-ready' : ''));
      if (locked) {
        status.textContent = '对局已开始，阵营已锁定。';
      } else if (conflict) {
        status.textContent = '双方阵营不能相同，请任一方换一个。';
      } else if (bothConfirmed) {
        status.textContent = '双方已确认，正在进入 A 阶段战前准备…';
      } else if (ready) {
        status.textContent = '攻方 ' + (sideFactionConfirmed('attacker') ? '已确认' : '待确认') +
          ' · 守方 ' + (sideFactionConfirmed('defender') ? '已确认' : '待确认') + '。';
      } else {
        const missing = [];
        if (!sideFaction('attacker')) missing.push('攻方');
        if (!sideFaction('defender')) missing.push('守方');
        status.textContent = '等待 ' + missing.join(' / ') + ' 选择国家阵营。';
      }
    }

    const done = el('online-faction-done');
    if (done) {
      const canConfirm = ready && !!mySide && myCaptain && !myConfirmed && !locked;
      done.disabled = !canConfirm;
      if (locked) done.textContent = '已锁定';
      else if (myConfirmed) done.textContent = '已确认，等待对方';
      else if (!ready) done.textContent = '双方选好后确认';
      else if (!myCaptain) done.textContent = '由队长确认';
      else done.textContent = '确认阵营，进入战前准备';
    }
  }

  /* =============================================================
   * A 阶段战前准备：军 / 师 / 配卡
   * ============================================================= */

  let prepDataPromise = null;
  let prepRaf = 0;

  function loadPrepData() {
    if (window.PREP_DATA && window.PREP_DATA.factions) {
      state.prepData = window.PREP_DATA;
      return Promise.resolve(state.prepData);
    }
    if (prepDataPromise) return prepDataPromise;
    state.prepLoading = true;
    state.prepError = '';
    prepDataPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      const cacheBust = (location.protocol === 'http:' || location.protocol === 'https:') ? '?v=' + Date.now() : '';
      s.src = 'online-prep-data.js' + cacheBust;
      s.onload = function () {
        state.prepLoading = false;
        if (window.PREP_DATA && window.PREP_DATA.factions) {
          state.prepData = window.PREP_DATA;
          resolve(state.prepData);
        } else {
          reject(new Error('online-prep-data.js 没有定义 window.PREP_DATA'));
        }
      };
      s.onerror = function () {
        state.prepLoading = false;
        reject(new Error('没有找到 online-prep-data.js'));
      };
      document.head.appendChild(s);
    }).catch(function (err) {
      state.prepLoading = false;
      state.prepError = err.message;
      prepDataPromise = null;
      throw err;
    });
    return prepDataPromise;
  }

  function prepFaction(side) {
    const id = sideFaction(side);
    return id && state.prepData && state.prepData.factions ? state.prepData.factions[id] || null : null;
  }

  function prepCorps(data, prep) {
    if (!data || !prep || !prep.corpsId) return null;
    return data.corps.filter(function (c) { return c.id === prep.corpsId; })[0] || null;
  }

  function prepDivision(data, prep) {
    if (!data || !prep || !prep.divisionId) return null;
    return data.divisions.filter(function (d) { return d.id === prep.divisionId; })[0] || null;
  }

  function prepEligibleDivisions(data) {
    if (!data) return [];
    return data.divisions.filter(function (d) {
      return d.phase === 'AB' && d.type !== 'armored';
    });
  }

  function prepFunds(division, side) {
    if (!division || !division.attack) return 0;
    return side === 'attacker' ? division.attack.A : division.defense.A;
  }

  function prepUnitInfo(data, name) {
    const u = data && data.units ? data.units[name] : null;
    if (!u) return { price: 0, hp: 0, cat: 'support', missing: true };
    return u;
  }

  // 主战 / 辅助作战 / 纯辅助 / 飞机。占格按血量：
  // HP>=4 主战、HP=3 辅助作战，二者都占主战格；HP<3 纯辅助占辅助格；飞机单独占飞机格。
  function prepUnitClass(info) {
    if (!info) return 'support';
    if (info.cat === 'air') return 'air';
    const hp = Number(info.hp);
    if (isFinite(hp) && hp > 0) {
      if (hp >= 4) return 'main';
      if (hp === 3) return 'aux';
      return 'support';
    }
    if (info.cat === 'main' || info.cat === 'aux' || info.cat === 'support') return info.cat;
    return 'support';
  }

  function prepSlotClass(info) {
    const cls = prepUnitClass(info);
    if (cls === 'air') return 'air';
    if (cls === 'support') return 'support';
    return 'main';
  }

  function prepEntryList(data, prep) {
    const out = [];
    if (!data || !prep) return out;
    const div = prepDivision(data, prep);
    if (div) {
      (div.pool.A || []).forEach(function (u) {
        out.push({
          key: 'div|' + u.name, name: u.name, max: u.max, source: 'division',
          info: prepUnitInfo(data, u.name),
        });
      });
    }
    const corps = prepCorps(data, prep);
    if (corps) {
      corps.units.forEach(function (u) {
        out.push({
          key: 'corps|' + u.name, name: u.name, max: u.max, source: 'corps',
          info: prepUnitInfo(data, u.name),
        });
      });
    }
    return out;
  }

  function prepStats(data, prep, side) {
    const div = prepDivision(data, prep);
    const entries = prepEntryList(data, prep);
    const byKey = {};
    entries.forEach(function (e) { byKey[e.key] = e; });
    let main = 0, support = 0, air = 0, cost = 0, total = 0;
    Object.keys(prep.units || {}).forEach(function (key) {
      const e = byKey[key];
      if (!e) return;
      const n = Number(prep.units[key]) || 0;
      if (n <= 0) return;
      total += n;
      cost += n * (e.info.price || 0);
      const slot = prepSlotClass(e.info);
      if (slot === 'air') air += n;
      else if (slot === 'main') main += n;
      else support += n;
    });
    return {
      main: main, support: support, air: air, cost: cost, total: total,
      mainLimit: div ? div.slots.main : 0,
      supportLimit: div ? div.slots.support : 0,
      planeLimit: div ? (div.planes == null ? Infinity : div.planes) : 0,
      funds: prepFunds(div, side),
      division: div,
      entries: entries,
    };
  }

  function prepCatLabel(cat) {
    if (cat === 'air') return '飞机';
    if (cat === 'main') return '主战';
    if (cat === 'aux') return '辅助作战';
    return '纯辅助';
  }

  function prepCanAdd(entry, stats) {
    if (!entry) return false;
    const count = Number(myPrep().units[entry.key]) || 0;
    if (count >= entry.max) return false;
    const info = entry.info;
    if (stats.cost + (info.price || 0) > stats.funds) return false;
    const slot = prepSlotClass(info);
    if (slot === 'air') return stats.air + 1 <= stats.planeLimit;
    if (slot === 'main') return stats.main + 1 <= stats.mainLimit;
    return stats.support + 1 <= stats.supportLimit;
  }

  function prepAddReason(entry, stats) {
    if (!entry) return '';
    const count = Number(myPrep().units[entry.key]) || 0;
    if (count >= entry.max) return '已到该单位上限';
    if (stats.cost + (entry.info.price || 0) > stats.funds) return '经费不足';
    const slot = prepSlotClass(entry.info);
    if (slot === 'air' && stats.air + 1 > stats.planeLimit) return '飞机格子已满';
    if (slot === 'main' && stats.main + 1 > stats.mainLimit) {
      return prepUnitClass(entry.info) === 'aux' ? '主战格子已满（辅助作战也占主战格）' : '主战格子已满';
    }
    if (slot === 'support' && stats.support + 1 > stats.supportLimit) return '辅助格子已满';
    return '';
  }

  function prepAdjust(key, delta) {
    const side = normalizeSide(state.side);
    if (!side || state.phase !== 'prepare') return;
    if (!selfIsCaptain(side)) {
      const cap = sideCaptain(side);
      toast('本侧配置由「' + (cap ? cap.name : '队长') + '」操作');
      return;
    }
    const data = prepFaction(side);
    const prep = myPrep();
    if (!data || prep.ready) return;
    const stats = prepStats(data, prep, side);
    const entry = stats.entries.filter(function (e) { return e.key === key; })[0];
    if (!entry) return;
    const cur = Number(prep.units[key]) || 0;
    if (delta > 0) {
      const why = prepAddReason(entry, stats);
      if (why) { toast(why); return; }
      prep.units[key] = cur + 1;
    } else {
      if (cur <= 0) return;
      if (cur <= 1) delete prep.units[key];
      else prep.units[key] = cur - 1;
    }
    prep.ready = false;
    publishPrep();
    renderPrep();
  }

  function prepChooseCorps(id) {
    const side = normalizeSide(state.side);
    if (!side || !selfIsCaptain(side)) return;
    const data = prepFaction(side);
    if (!data) return;
    const prep = myPrep();
    if (prep.ready) return;
    const corps = data.corps.filter(function (c) { return c.id === id; })[0];
    if (!corps) return;
    prep.corpsId = id;
    prep.divisionId = '';
    prep.units = {};
    prep.ready = false;
    publishPrep();
    renderPrep();
  }

  function prepChooseDivision(id) {
    const side = normalizeSide(state.side);
    if (!side || !selfIsCaptain(side)) return;
    const data = prepFaction(side);
    if (!data) return;
    const prep = myPrep();
    if (prep.ready) return;
    const div = prepEligibleDivisions(data).filter(function (d) { return d.id === id; })[0];
    if (!div) return;
    prep.divisionId = id;
    prep.units = {};
    prep.ready = false;
    publishPrep();
    renderPrep();
  }

  function prepClearCorps() {
    const prep = myPrep();
    if (prep.ready) return;
    prep.corpsId = '';
    prep.divisionId = '';
    prep.units = {};
    prep.ready = false;
    publishPrep();
    renderPrep();
  }

  function prepClearDivision() {
    const prep = myPrep();
    if (prep.ready) return;
    prep.divisionId = '';
    prep.units = {};
    prep.ready = false;
    publishPrep();
    renderPrep();
  }

  function confirmPrepDeck() {
    const side = normalizeSide(state.side);
    if (!side || state.phase !== 'prepare') return;
    if (!selfIsCaptain(side)) {
      const cap = sideCaptain(side);
      toast('本侧配置由「' + (cap ? cap.name : '队长') + '」确认');
      return;
    }
    const data = prepFaction(side);
    const prep = myPrep();
    const div = prepDivision(data, prep);
    if (!prep.corpsId || !div) { toast('先选好军和师'); return; }
    const stats = prepStats(data, prep, side);
    if (stats.total <= 0) { toast('至少带 1 个单位'); return; }
    prep.ready = true;
    state.deckReady = true;
    if (state.test) {
      const seat = activeTestSeat();
      if (seat) seat.deckReady = true;
    }
    publishPrep();
    renderPrep();
    pushLog((side === 'attacker' ? '攻方' : '守方') + '配置已确认（' + stats.main + ' 主战 / ' + stats.support + ' 辅助 / ' + stats.air + ' 飞机）');
    if (bothDecksConfirmed()) toast('双方配置都已确认，战前准备完成');
  }

  function unlockPrepDeck() {
    const side = normalizeSide(state.side);
    if (!side || state.phase !== 'prepare') return;
    if (!selfIsCaptain(side)) return;
    if (bothDecksConfirmed()) { toast('双方都已确认，配置已锁定'); return; }
    const prep = myPrep();
    if (!prep.ready) return;
    prep.ready = false;
    state.deckReady = false;
    if (state.test) {
      const seat = activeTestSeat();
      if (seat) seat.deckReady = false;
    }
    publishPrep();
    renderPrep();
    toast('已取消确认，可以继续调整');
  }

  function prepFileStem() {
    const side = normalizeSide(state.side);
    const data = prepFaction(side);
    const prep = myPrep();
    const div = prepDivision(data, prep);
    return 'bingqi-' + (div ? div.id : (sideFaction(side) || 'deck')) + '-A';
  }

  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) { return false; }
  }

  function exportPrepDeck() {
    const side = normalizeSide(state.side);
    const prep = myPrep();
    if (!prep.corpsId || !prep.divisionId) { toast('先选好军和师，再导出'); return; }
    const units = Object.keys(prep.units).filter(function (k) { return prep.units[k] > 0; }).map(function (k) {
      const parts = k.split('|');
      return { name: parts.slice(1).join('|'), source: parts[0] === 'corps' ? 'corps' : 'division', count: prep.units[k] };
    });
    const payload = {
      format: 'bingqi-division-deck',
      version: 1,
      faction: sideFaction(side),
      corps: prep.corpsId,
      division: prep.divisionId,
      phase: 'A',
      units: units,
    };
    if (downloadText(prepFileStem() + '.json', JSON.stringify(payload, null, 2))) {
      toast('配置已导出');
    } else {
      toast('导出失败，浏览器可能不允许下载');
    }
  }

  async function importPrepDeck(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) { toast('配置文件太大'); return; }
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (e) {
      showAlert('配置读取失败', '不是有效的 JSON 文件。');
      return;
    }
    if (!payload || payload.format !== 'bingqi-division-deck' || payload.version !== 1) {
      showAlert('不是兵棋配置', '这个文件不是「bingqi-division-deck」配置。');
      return;
    }
    if (!Array.isArray(payload.units)) {
      showAlert('配置格式不对', '配置里的 `units` 必须是数组。');
      return;
    }
    if (payload.phase && payload.phase !== 'A') {
      showAlert('阶段不一致', '本版先只导入 A 阶段配置。');
      return;
    }
    const side = normalizeSide(state.side);
    const data = prepFaction(side);
    if (!data) { toast('当前没有阵营数据'); return; }
    if (!selfIsCaptain(side)) {
      const cap = sideCaptain(side);
      toast('本侧配置由「' + (cap ? cap.name : '队长') + '」导入');
      return;
    }
    if (myPrep().ready) { toast('本侧配置已确认，先不能导入'); return; }
    if (payload.faction && payload.faction !== sideFaction(side)) {
      showAlert('阵营不一致', '这是另一个国家阵营的配置；当前是「' + factionName(sideFaction(side)) + '」。');
      return;
    }
    const corps = data.corps.filter(function (c) { return c.id === payload.corps; })[0];
    const div = prepEligibleDivisions(data).filter(function (d) { return d.id === payload.division; })[0];
    if (!corps || !div) {
      showAlert('军或师不存在', '配置里的军 / 师在当前数据里找不到，可能数据文件改过。');
      return;
    }
    const temp = createPrep();
    temp.corpsId = corps.id;
    temp.divisionId = div.id;
    const errors = [];
    (payload.units || []).forEach(function (u) {
      if (!u || !u.name) return;
      const source = u.source === 'corps' ? 'corps' : 'division';
      const entry = prepEntryList(data, temp).filter(function (e) {
        return e.source === source && e.name === u.name;
      })[0];
      if (!entry) { errors.push('找不到单位：' + u.name); return; }
      const n = Math.max(0, Math.min(entry.max, Number(u.count) || 0));
      if (n > 0) temp.units[entry.key] = n;
    });
    const stats = prepStats(data, temp, side);
    if (stats.cost > stats.funds) errors.push('经费超出：' + stats.cost + ' / ' + stats.funds);
    if (stats.main > stats.mainLimit) errors.push('主战格子超出：' + stats.main + ' / ' + stats.mainLimit);
    if (stats.support > stats.supportLimit) errors.push('辅助格子超出：' + stats.support + ' / ' + stats.supportLimit);
    if (stats.air > stats.planeLimit) errors.push('飞机格子超出：' + stats.air + ' / ' + (stats.planeLimit === Infinity ? '不限' : stats.planeLimit));
    if (errors.length) {
      showAlert('配置不能导入', errors.slice(0, 4).join('\n'));
      return;
    }
    const prep = myPrep();
    prep.corpsId = temp.corpsId;
    prep.divisionId = temp.divisionId;
    prep.units = temp.units;
    prep.ready = false;
    publishPrep();
    renderPrep();
    toast('配置已导入：' + div.name);
  }

  function schedulePrepMap() {
    if (prepRaf) cancelAnimationFrame(prepRaf);
    prepRaf = requestAnimationFrame(function () {
      prepRaf = 0;
      drawPrepMap();
    });
  }

  function drawPrepMap() {
    const canvas = el('online-prep-map');
    const wrap = el('online-prep');
    if (!canvas || !wrap || state.phase !== 'prepare' || !state.map) return;
    const w = canvas.clientWidth || wrap.clientWidth;
    const h = canvas.clientHeight || 250;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawBoard(ctx, w, h, state.map, true);
  }

  function prepSeatSwitch() {
    const box = el('online-prep-seats');
    if (!box) return;
    box.innerHTML = '';
    if (!state.test) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    state.testSeats.forEach(function (seat) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prep-seat' + (seat.id === state.activeSeat ? ' is-active' : '');
      btn.setAttribute('data-prep-seat', seat.id);
      btn.textContent = seat.name;
      btn.title = '切换到「' + seat.name + '」';
      box.appendChild(btn);
    });
  }

  function prepHeader(side, data, prep) {
    const div = prepDivision(data, prep);
    const corps = prepCorps(data, prep);
    setText('online-prep-sub',
      (state.mapWrapper && state.mapWrapper.title ? state.mapWrapper.title : '作战地图') +
      ' · A 阶段 · 你方 ' + sideName(side) + ' / ' + factionName(sideFaction(side)) +
      ' · 对手 ' + sideName(otherSide(side)) + ' / ' + factionName(sideFaction(otherSide(side))));
    const status = el('online-prep-status');
    if (status) {
      const myReady = !!prep.ready;
      const oppReady = sideDeckConfirmed(otherSide(side));
      status.className = 'online-prep-status' +
        (bothDecksConfirmed() ? ' is-ready' : (myReady ? ' is-part' : ''));
      if (bothDecksConfirmed()) status.textContent = '双方配置已确认 · 战前准备完成';
      else if (myReady) status.textContent = '你方已确认 · 等待对方';
      else if (oppReady) status.textContent = '对方已确认 · 等你配置';
      else status.textContent = '配置中 · ' + (corps ? corps.name : '选军') + ' / ' + (div ? div.name : '选师');
    }
    prepSeatSwitch();
  }

  function prepCorpsCards(data, prep, canEdit) {
    const wrap = document.createElement('div');
    wrap.className = 'prep-corps-grid';
    data.corps.forEach(function (c) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'prep-corps-card' + (prep.corpsId === c.id ? ' is-selected' : '');
      card.setAttribute('data-prep-corps', c.id);
      card.disabled = !canEdit;
      const title = document.createElement('b');
      title.textContent = c.name;
      const sub = document.createElement('small');
      sub.textContent = '军直属 · ' + c.units.length + ' 种 · 全局数量固定';
      const list = document.createElement('span');
      list.className = 'prep-corps-units';
      list.textContent = c.units.map(function (u) { return u.name + '×' + u.max; }).join(' · ');
      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(list);
      wrap.appendChild(card);
    });
    return wrap;
  }

  function prepDivisionCards(data, prep, canEdit) {
    const wrap = document.createElement('div');
    wrap.className = 'prep-division-grid';
    prepEligibleDivisions(data).forEach(function (d) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'prep-division-card' + (prep.divisionId === d.id ? ' is-selected' : '');
      card.setAttribute('data-prep-division', d.id);
      card.disabled = !canEdit;
      const top = document.createElement('div');
      top.className = 'prep-division-top';
      const title = document.createElement('b');
      title.textContent = d.name;
      const type = document.createElement('em');
      type.textContent = d.type === 'airborne' ? '空降' : (d.type === 'mountain' ? '山地' : '步兵');
      top.appendChild(title);
      top.appendChild(type);
      const meta = document.createElement('small');
      meta.textContent = 'A 阶段 · 主战 ' + d.slots.main + ' / 辅助 ' + d.slots.support +
        ' · 飞机 ' + (d.planes == null ? '不限' : d.planes) +
        ' · 经费 ' + d.attack.A + '（攻）/ ' + d.defense.A + '（守）';
      const pool = document.createElement('span');
      pool.className = 'prep-division-pool';
      pool.textContent = 'A 池 ' + d.pool.A.length + ' 种单位' +
        (d.pool.B.length ? ' · B 追加 ' + d.pool.B.length + ' 种' : '');
      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(pool);
      wrap.appendChild(card);
    });
    return wrap;
  }

  function prepUnitCard(entry, count, stats, canEdit) {
    const card = document.createElement('div');
    const info = entry.info;
    const cls = prepUnitClass(info);
    card.className = 'prep-unit-card is-' + cls + (entry.source === 'corps' ? ' is-corps' : '');
    const top = document.createElement('div');
    top.className = 'prep-unit-top';
    const name = document.createElement('b');
    name.textContent = entry.name;
    const tag = document.createElement('em');
    tag.textContent = entry.source === 'corps' ? '军属' : prepCatLabel(cls);
    top.appendChild(name);
    top.appendChild(tag);
    const meta = document.createElement('small');
    meta.textContent = (entry.source === 'corps' ? prepCatLabel(cls) + ' · ' : '') +
      '价 ' + (info.missing ? '—' : info.price) + ' · 血 ' + (info.missing ? '—' : info.hp) +
      ' · 上限 ' + entry.max;
    const controls = document.createElement('div');
    controls.className = 'prep-unit-controls';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'prep-mini';
    minus.textContent = '−';
    minus.disabled = !canEdit || count <= 0;
    minus.setAttribute('data-prep-unit', entry.key);
    minus.setAttribute('data-prep-delta', '-1');
    const num = document.createElement('span');
    num.className = 'prep-unit-count';
    num.textContent = count + ' / ' + entry.max;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'prep-mini';
    plus.textContent = '＋';
    plus.disabled = !canEdit || !prepCanAdd(entry, stats);
    plus.title = canEdit ? prepAddReason(entry, stats) : '';
    plus.setAttribute('data-prep-unit', entry.key);
    plus.setAttribute('data-prep-delta', '1');
    controls.appendChild(minus);
    controls.appendChild(num);
    controls.appendChild(plus);
    card.appendChild(top);
    card.appendChild(meta);
    card.appendChild(controls);
    return card;
  }

  function prepDeckView(data, prep, side, canEdit) {
    const div = prepDivision(data, prep);
    const corps = prepCorps(data, prep);
    const stats = prepStats(data, prep, side);
    const wrap = document.createElement('div');
    wrap.className = 'prep-deck';

    const bar = document.createElement('div');
    bar.className = 'prep-deck-summary';
    const chips = [
      { t: '主战', v: stats.main + ' / ' + stats.mainLimit, cls: stats.main >= stats.mainLimit ? ' is-full' : '' },
      { t: '辅助', v: stats.support + ' / ' + stats.supportLimit, cls: stats.support >= stats.supportLimit ? ' is-full' : '' },
      { t: '飞机', v: stats.air + ' / ' + (stats.planeLimit === Infinity ? '不限' : stats.planeLimit), cls: stats.air >= stats.planeLimit ? ' is-full' : '' },
      { t: '经费', v: stats.cost + ' / ' + stats.funds, cls: stats.cost >= stats.funds ? ' is-full' : '' },
    ];
    chips.forEach(function (c) {
      const chip = document.createElement('span');
      chip.className = 'prep-stat' + c.cls;
      const b = document.createElement('b');
      b.textContent = c.v;
      const s = document.createElement('small');
      s.textContent = c.t;
      chip.appendChild(b);
      chip.appendChild(s);
      bar.appendChild(chip);
    });
    const actions = document.createElement('div');
    actions.className = 'prep-deck-actions';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button'; exportBtn.className = 'btn small';
    exportBtn.setAttribute('data-prep-export', '1'); exportBtn.textContent = '导出配置';
    const importBtn = document.createElement('button');
    importBtn.type = 'button'; importBtn.className = 'btn small';
    importBtn.setAttribute('data-prep-import', '1'); importBtn.textContent = '导入配置';
    importBtn.disabled = !selfIsCaptain(side) || prep.ready;
    importBtn.title = importBtn.disabled ? '本侧由队长导入，已确认时先「修改配置」' : '导入之前导出的师卡组';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn small primary';
    confirmBtn.setAttribute('data-prep-confirm', '1');
    confirmBtn.textContent = prep.ready ? '已确认' : '确认配置';
    confirmBtn.disabled = !canEdit || prep.ready || stats.total <= 0;
    actions.appendChild(exportBtn);
    actions.appendChild(importBtn);
    actions.appendChild(confirmBtn);
    if (prep.ready && !bothDecksConfirmed()) {
      const unlockBtn = document.createElement('button');
      unlockBtn.type = 'button'; unlockBtn.className = 'btn small';
      unlockBtn.setAttribute('data-prep-unlock', '1');
      unlockBtn.textContent = '修改配置';
      unlockBtn.disabled = !selfIsCaptain(side);
      actions.appendChild(unlockBtn);
    }
    bar.appendChild(actions);
    wrap.appendChild(bar);

    const meta = document.createElement('div');
    meta.className = 'prep-deck-meta';
    const metaText = document.createElement('span');
    metaText.textContent = 'A 阶段经费 ' + stats.funds + ' · ' + (corps ? corps.name : '未选军') +
      ' · ' + (div ? div.name : '未选师') +
      ' · 辅助作战占主战格，纯辅助占辅助格；军属同样计入';
    const change = document.createElement('div');
    change.className = 'prep-change';
    const backDiv = document.createElement('button');
    backDiv.type = 'button'; backDiv.className = 'btn small';
    backDiv.setAttribute('data-prep-change-division', '1'); backDiv.textContent = '更换师';
    backDiv.disabled = !canEdit || prep.ready;
    const backCorps = document.createElement('button');
    backCorps.type = 'button'; backCorps.className = 'btn small';
    backCorps.setAttribute('data-prep-change-corps', '1'); backCorps.textContent = '更换军';
    backCorps.disabled = !canEdit || prep.ready;
    change.appendChild(backDiv);
    change.appendChild(backCorps);
    meta.appendChild(metaText);
    meta.appendChild(change);
    wrap.appendChild(meta);

    const groups = [
      { id: 'main', label: '师属主战', src: 'division' },
      { id: 'aux', label: '师属辅助作战 · 占主战格', src: 'division' },
      { id: 'support', label: '师属纯辅助 · 占辅助格', src: 'division' },
      { id: 'air', label: '师属飞机', src: 'division' },
      { id: 'corps', label: '军属单位', src: 'corps' },
    ];
    groups.forEach(function (g) {
      const list = stats.entries.filter(function (e) {
        return g.src === 'corps' ? e.source === 'corps' : (e.source === 'division' && prepUnitClass(e.info) === g.id);
      });
      if (!list.length) return;
      const section = document.createElement('section');
      section.className = 'prep-unit-group';
      const h = document.createElement('h4');
      h.textContent = g.label;
      const count = document.createElement('span');
      count.textContent = list.length + ' 种';
      h.appendChild(count);
      section.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'prep-unit-grid';
      list.forEach(function (e) {
        grid.appendChild(prepUnitCard(e, Number(prep.units[e.key]) || 0, stats, canEdit));
      });
      section.appendChild(grid);
      wrap.appendChild(section);
    });

    const note = document.createElement('p');
    note.className = 'prep-deck-note';
    note.textContent = 'A 阶段卡池；B 阶段会在 A 的基础上追加单位（本版先配 A）。辅助作战（HP=3）占主战格，只有纯辅助（HP<3）占辅助格；军属单位可在部署时召唤，但全局上限固定，并占用当前师的格子。';
    wrap.appendChild(note);
    return wrap;
  }

  function prepOppPanel(side) {
    const oppSide = otherSide(side);
    const oppFac = sideFaction(oppSide);
    const data = state.prepData && state.prepData.factions ? state.prepData.factions[oppFac] : null;
    const summary = sidePrep(oppSide);
    const cap = sideCaptain(oppSide);
    const wrap = document.createElement('div');
    wrap.className = 'prep-opp';
    const kicker = document.createElement('p');
    kicker.className = 'online-kicker';
    kicker.textContent = 'OPPONENT / ' + sideName(oppSide).toUpperCase();
    wrap.appendChild(kicker);
    const h = document.createElement('h3');
    h.textContent = sideName(oppSide) + ' · ' + factionName(oppFac);
    wrap.appendChild(h);
    const capLine = document.createElement('p');
    capLine.className = 'prep-opp-line';
    capLine.textContent = cap ? '队长：' + cap.name : '等待玩家';
    wrap.appendChild(capLine);
    if (!data) {
      const p = document.createElement('p');
      p.className = 'prep-opp-line';
      p.textContent = '正在加载编制数据…';
      wrap.appendChild(p);
      return wrap;
    }
    const corps = summary ? data.corps.filter(function (c) { return c.id === summary.corpsId; })[0] : null;
    const div = summary ? data.divisions.filter(function (d) { return d.id === summary.divisionId; })[0] : null;
    const line1 = document.createElement('p');
    line1.className = 'prep-opp-line';
    line1.textContent = '军：' + (corps ? corps.name : '未选');
    const line2 = document.createElement('p');
    line2.className = 'prep-opp-line';
    line2.textContent = 'A 阶段师：' + (div ? div.name : '未选');
    wrap.appendChild(line1);
    wrap.appendChild(line2);
    const ready = document.createElement('div');
    ready.className = 'prep-opp-ready' + (summary && summary.ready ? ' is-ready' : '');
    ready.textContent = summary && summary.ready ? '配置已确认' : '配置中';
    wrap.appendChild(ready);
    if (summary && summary.units) {
      let main = 0, support = 0, air = 0, cost = 0;
      Object.keys(summary.units).forEach(function (k) {
        const parts = k.split('|');
        const nm = parts.slice(1).join('|');
        const src = parts[0] === 'corps' ? 'corps' : 'division';
        const info = data.units[nm] || { price: 0, cat: 'support' };
        const n = Number(summary.units[k]) || 0;
        cost += n * (info.price || 0);
        if (src === 'division' || src === 'corps') {
          const slot = prepSlotClass(info);
          if (slot === 'air') air += n;
          else if (slot === 'main') main += n;
          else support += n;
        }
      });
      const stats = document.createElement('p');
      stats.className = 'prep-opp-line';
      stats.textContent = '配卡：主战 ' + main + ' · 辅助 ' + support + ' · 飞机 ' + air + ' · 经费 ' + cost;
      wrap.appendChild(stats);
    }
    return wrap;
  }

  function renderPrep() {
    if (state.phase !== 'prepare' || state.view !== 'room') return;
    const me = el('online-prep-me');
    const opp = el('online-prep-opp');
    if (!me || !opp) return;
    prepSeatSwitch();

    if (!state.prepData) {
      me.innerHTML = '<div class="prep-loading"><b>正在加载战前编制数据…</b><p>online-prep-data.js</p></div>';
      opp.innerHTML = '';
      if (state.prepError) {
        me.innerHTML = '<div class="prep-loading is-error"><b>编制数据加载失败</b><p>' +
          String(state.prepError).replace(/</g, '&lt;') + '</p><button type="button" class="btn small" data-prep-retry="1">重试</button></div>';
      } else if (!state.prepLoading) {
        loadPrepData().then(function () {
          if (state.phase === 'prepare') renderPrep();
        }).catch(function () {
          if (state.phase === 'prepare') renderPrep();
        });
      }
      return;
    }

    const side = normalizeSide(state.side);
    if (!side) {
      me.innerHTML = '<div class="prep-loading is-error"><b>还没有选择攻守</b><p>回到房间选好攻守后再进战前准备。</p></div>';
      opp.innerHTML = '';
      return;
    }
    const data = prepFaction(side);
    if (!data) {
      me.innerHTML = '<div class="prep-loading is-error"><b>当前阵营没有编制数据</b><p>online-prep-data.js 里还没有这个国家。</p></div>';
      opp.innerHTML = '';
      return;
    }
    const prep = myPrep();
    const canEdit = selfIsCaptain(side) && !prep.ready;
    prepHeader(side, data, prep);

    me.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'prep-stage';
    if (!prep.divisionId) {
      const toolbar = document.createElement('div');
      toolbar.className = 'prep-toolbar';
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'btn small';
      importBtn.setAttribute('data-prep-import', '1');
      importBtn.textContent = '导入配置';
      importBtn.disabled = !canEdit;
      importBtn.title = canEdit ? '导入之前导出的师卡组 JSON' : '本侧由队长导入';
      toolbar.appendChild(importBtn);
      stage.appendChild(toolbar);
    }
    const stepRow = document.createElement('div');
    stepRow.className = 'prep-steps';
    const steps = [
      { id: 'corps', n: '01', t: '选择军', done: !!prep.corpsId, active: !prep.corpsId },
      { id: 'division', n: '02', t: '选择 A 阶段师', done: !!prep.divisionId, active: !!prep.corpsId && !prep.divisionId },
      { id: 'deck', n: '03', t: '配卡', done: !!prep.ready, active: !!prep.divisionId && !prep.ready },
      { id: 'confirm', n: '04', t: '确认', done: !!prep.ready, active: false },
    ];
    steps.forEach(function (s) {
      const span = document.createElement('span');
      span.className = 'prep-step' + (s.done ? ' is-done' : '') + (s.active ? ' is-active' : '');
      span.innerHTML = '<i>' + (s.done ? '✓' : s.n) + '</i><b>' + s.t + '</b>';
      stepRow.appendChild(span);
    });
    stage.appendChild(stepRow);

    if (!selfIsCaptain(side)) {
      const cap = sideCaptain(side);
      const note = document.createElement('p');
      note.className = 'prep-lock-note';
      note.textContent = '本侧配置由队长「' + (cap ? cap.name : '队长') + '」操作；你可以在这里查看。';
      stage.appendChild(note);
    }

    if (!prep.corpsId) {
      const h = document.createElement('h3');
      h.textContent = '第 1 步 / 选择军';
      const sub = document.createElement('p');
      sub.className = 'prep-step-note';
      sub.textContent = '军在一整局中不再改变；军直属单位全局上限固定，并计入之后每个师的格子。';
      stage.appendChild(h);
      stage.appendChild(sub);
      stage.appendChild(prepCorpsCards(data, prep, canEdit));
    } else if (!prep.divisionId) {
      const h = document.createElement('h3');
      h.textContent = '第 2 步 / 选择 A 阶段师';
      const sub = document.createElement('p');
      sub.className = 'prep-step-note';
      sub.textContent = '步兵 / 空降 / 山地师可在 A、B 阶段加入；装甲师只在 C 阶段加入，所以这里不显示装甲师。';
      stage.appendChild(h);
      stage.appendChild(sub);
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'btn small prep-back';
      back.setAttribute('data-prep-change-corps', '1'); back.textContent = '返回换军';
      back.disabled = !canEdit;
      stage.appendChild(back);
      stage.appendChild(prepDivisionCards(data, prep, canEdit));
    } else {
      stage.appendChild(prepDeckView(data, prep, side, canEdit));
    }
    me.appendChild(stage);
    opp.innerHTML = '';
    opp.appendChild(prepOppPanel(side));
    schedulePrepMap();
  }

  async function pickSide(side) {
    const id = normalizeSide(side);
    if (!id || !canChooseSide()) return;

    if (state.test) {
      const seat = activeTestSeat();
      if (!seat || seat.side === id) return;
      if (sideCount(id, seat.id) >= MAX_PER_SIDE) {
        toast(sideName(id) + '已经满了（' + MAX_PER_SIDE + ' / ' + MAX_PER_SIDE + '）');
        return;
      }
      const wasReady = seat.ready;
      const hadFaction = !!seat.faction;
      seat.side = id;
      seat.faction = null;
      if (wasReady && seat.id !== state.testSeats[0].id) seat.ready = false;
      syncActiveSeat();
      refreshRoom();
      toast('「' + seat.name + '」进' + sideName(id) +
        (wasReady ? '，准备已取消' : '') + (hadFaction ? '，国家阵营已清空' : ''));
      return;
    }

    if (state.side === id) return;
    if (sideCount(id) >= MAX_PER_SIDE) {
      toast(sideName(id) + '已经满了（' + MAX_PER_SIDE + ' / ' + MAX_PER_SIDE + '）');
      return;
    }
    const hadFaction = !!state.faction;
    state.side = id;
    state.faction = null;
    if (state.role === 'guest' && state.ready) {
      state.ready = false;
      toast('已换到' + sideName(id) + '，准备状态已取消' + (hadFaction ? '，国家阵营已清空' : ''));
    } else {
      toast('已加入' + sideName(id) + (hadFaction ? '，国家阵营已清空' : ''));
    }
    if (state.net) {
      if (state.role === 'host') {
        await state.net.setHostState({ side: id, faction: null });
      } else {
        await state.net.setGuestState({ side: id, faction: null, ready: state.ready });
      }
    }
    refreshRoom();
  }

  /* =============================================================
   * 本地测试模式：不连中继，一台电脑热座操控多名本机玩家
   * ============================================================= */

  function refreshRoom() {
    if (state.view !== 'room') return;
    renderPlayers();
    renderSidePick();
    renderFactionPick();
    renderFlow();
    renderTestPanel();
    renderActions();
    renderBanner();
    renderPhaseNote();
    syncFactionView();
    if (state.phase === 'prepare') renderPrep();
  }

  function testSeatById(id) {
    return state.testSeats.filter(function (s) { return s.id === id; })[0] || null;
  }

  function activeTestSeat() {
    return testSeatById(state.activeSeat) || state.testSeats[0] || null;
  }

  function syncActiveSeat() {
    const seat = activeTestSeat();
    if (!seat) {
      state.activeSeat = '';
      state.side = null;
      state.faction = null;
      state.ready = false;
      return;
    }
    state.activeSeat = seat.id;
    state.side = normalizeSide(seat.side);
    state.faction = normalizeFaction(seat.faction);
    state.ready = !!seat.ready;
  }

  function ensureTestSeats(n) {
    while (state.testSeats.length < n) {
      state.testSeq += 1;
      state.testSeats.push({
        id: 'seat' + state.testSeq,
        name: '本机玩家 ' + (state.testSeats.length + 1),
        side: null,
        faction: null,
        factionReady: false,
        deckReady: false,
        prep: createPrep(),
        ready: false,
      });
    }
    if (state.testSeats.length > n) state.testSeats.length = n;
    if (!testSeatById(state.activeSeat)) {
      state.activeSeat = state.testSeats.length ? state.testSeats[0].id : '';
    }
    syncActiveSeat();
  }

  function setupTestScenario(n) {
    if (!state.test) return;
    ensureTestSeats(n);
    refreshRoom();
    toast('本机玩家：' + n + ' 人（点名字切换操控）');
  }

  function setActiveTestSeat(id) {
    if (!state.test) return;
    const seat = testSeatById(id);
    if (!seat || seat.id === state.activeSeat) return;
    state.activeSeat = seat.id;
    syncActiveSeat();
    refreshRoom();
    toast('现在操控「' + seat.name + '」');
  }

  function setTestSeatSide(id, side) {
    const seat = testSeatById(id);
    const s = normalizeSide(side);
    if (!seat || !s || !canChooseSide()) {
      toast('先选一张攻防战地图，再安排阵营');
      return;
    }
    if (seat.side === s) return;
    if (sideCount(s, seat.id) >= MAX_PER_SIDE) {
      toast(sideName(s) + '已经满了（' + MAX_PER_SIDE + ' / ' + MAX_PER_SIDE + '）');
      return;
    }
    const wasReady = seat.ready;
    const hadFaction = !!seat.faction;
    seat.side = s;
    seat.faction = null;
    if (wasReady && seat.id !== state.testSeats[0].id) seat.ready = false;
    syncActiveSeat();
    refreshRoom();
    toast('「' + seat.name + '」进' + sideName(s) +
      (wasReady ? '，准备已取消' : '') + (hadFaction ? '，国家阵营已清空' : ''));
  }

  function toggleTestSeatReady(id) {
    const seat = testSeatById(id);
    if (!seat || seat.id === (state.testSeats[0] && state.testSeats[0].id)) return;
    if (!canChooseSide()) {
      toast('先选一张攻防战地图，再点准备');
      return;
    }
    seat.ready = !seat.ready;
    syncActiveSeat();
    refreshRoom();
  }

  function setAllTestSeatsReady(ready) {
    if (!canChooseSide()) {
      toast('先选一张攻防战地图，再点准备');
      return;
    }
    state.testSeats.forEach(function (s, i) {
      if (i > 0) s.ready = !!ready;
    });
    syncActiveSeat();
    refreshRoom();
    toast(ready ? '本机玩家已全部准备' : '已取消全部准备');
  }

  function resetTestSeats() {
    state.testSeats.forEach(function (s) {
      s.side = null;
      s.faction = null;
      s.ready = false;
    });
    syncActiveSeat();
    refreshRoom();
    toast('已清空站位和阵营');
  }

  function renderTestPanel() {
    const bar = el('online-test');
    if (!bar) return;
    hideEl('online-test', !state.test);
    if (!state.test) return;

    const locked = state.phase === 'battle';
    const seatCanChoose = canChooseSide() && !locked;
    bar.classList.toggle('is-locked', locked);
    setText('online-test-note', locked
      ? '对局中 · 编制已锁定'
      : (!state.map ? '先选地图' : '点名字切换操控'));

    Array.prototype.forEach.call(bar.querySelectorAll('[data-test-scenario]'), function (btn) {
      const n = Number(btn.getAttribute('data-test-scenario'));
      const on = state.testSeats.length === n;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.disabled = locked;
    });
    setText('online-test-count', state.testSeats.length + ' 名本机玩家');

    ['online-test-ready-all', 'online-test-ready-none', 'online-test-clear'].forEach(function (id) {
      const b = el(id);
      if (!b) return;
      b.disabled = locked || (id !== 'online-test-clear' && !seatCanChoose);
    });

    const box = el('online-test-seats');
    if (!box) return;
    box.innerHTML = '';
    state.testSeats.forEach(function (seat, i) {
      const isHost = i === 0;
      const active = seat.id === state.activeSeat;
      const row = document.createElement('div');
      row.className = 'online-test-seat' +
        (active ? ' is-active' : '') +
        (isHost ? ' is-host' : '') +
        (seat.side ? ' is-' + seat.side : '') +
        (seat.ready ? ' is-ready' : '');

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'online-test-seat-name';
      name.setAttribute('data-test-seat', seat.id);
      name.title = '切换到「' + seat.name + '」';
      name.textContent = seat.name;
      if (isHost) {
        const em = document.createElement('em');
        em.textContent = '房主';
        name.appendChild(em);
      }
      if (active) {
        const em = document.createElement('em');
        em.className = 'is-active-tag';
        em.textContent = '操控中';
        name.appendChild(em);
      }
      row.appendChild(name);

      SIDES.forEach(function (side) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'online-test-side is-' + side.id + (seat.side === side.id ? ' is-on' : '');
        b.setAttribute('data-seat', seat.id);
        b.setAttribute('data-seat-side', side.id);
        b.textContent = side.short;
        b.title = '把「' + seat.name + '」放到' + side.name;
        b.disabled = !seatCanChoose || (seat.side !== side.id && sideCount(side.id, seat.id) >= MAX_PER_SIDE);
        row.appendChild(b);
      });

      if (isHost) {
        const host = document.createElement('span');
        host.className = 'online-test-seat-host';
        host.textContent = '在线';
        row.appendChild(host);
      } else {
        const ready = document.createElement('button');
        ready.type = 'button';
        ready.className = 'online-test-ready' + (seat.ready ? ' is-ready' : '');
        ready.setAttribute('data-seat', seat.id);
        ready.setAttribute('data-seat-ready', '1');
        ready.disabled = !seatCanChoose;
        ready.textContent = seat.ready ? '已准备' : '准备';
        row.appendChild(ready);
      }

      box.appendChild(row);
    });
  }

  function startTest() {
    if (state.connecting) return;
    const name = readName();
    state.gen++;
    if (state.net) {
      try { state.net.disconnect(); } catch (e) { /* ignore */ }
    }
    resetRoom();
    closeMapDialog(true);
    hideAlert();
    state.test = true;
    state.role = 'host';
    state.name = name;
    state.roomCode = 'TEST';
    state.joined = true;
    state.phase = 'lobby';
    state.net = null;
    state.netStatus = 'local';
    ensureTestSeats(2);
    setStatus('local');
    setView('room');
    pushLog('本地测试已启动 · 一台电脑操控 2 名本机玩家');
    toast('本地测试：先选地图，再选攻守和国家阵营');
    renderRoom();
    mount.focus({ preventScroll: true });
    setTimeout(function () {
      if (!state.test || state.view !== 'room' || state.map || state.dialogOpen || state.alertOpen) return;
      openMapDialog();
    }, 320);
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
      hint.textContent = '创建后会生成 8 位房间码。房间最多 4 人：攻方 2 人、守方 2 人（房主算一位）。';
    } else {
      hint.textContent = '输入房主发来的 8 位房间码。房主和你要使用同一个中继。';
    }
  }

  function renderStatus() {
    setStatus(state.netStatus);
  }

  function playerRow(p) {
    const li = document.createElement('li');
    li.className = 'online-player' +
      (p.role === 'host' ? ' is-host' : '') +
      (p.online ? '' : ' is-offline') +
      (p.self ? ' is-self' : '') +
      (p.side ? ' is-' + p.side : '');

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
    if (p.side) {
      const cap = sideCaptain(p.side);
      if (cap && cap.id === p.id) {
        const em = document.createElement('em');
        em.className = 'is-leader-tag';
        em.textContent = '队长';
        b.appendChild(em);
      }
    }
    const small = document.createElement('small');
    small.textContent = p.side
      ? (sideDef(p.side).text + ' · ' + (p.role === 'host' ? '房主' : '玩家'))
      : (p.role === 'host' ? '房主 · 未选攻守' : '未选攻守');
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
      st.textContent = state.phase === 'battle' ? '参战' : '已准备';
    } else {
      st.textContent = '未准备';
    }

    li.appendChild(av);
    li.appendChild(main);
    li.appendChild(st);
    return li;
  }

  function emptySlot(side) {
    const li = document.createElement('li');
    li.className = 'online-player is-empty';
    const av = document.createElement('span');
    av.className = 'online-avatar';
    av.textContent = '＋';
    const main = document.createElement('span');
    main.className = 'online-player-main';
    const b = document.createElement('b');
    b.textContent = '空位';
    const small = document.createElement('small');
    small.textContent = '等待加入 · ' + sideName(side);
    main.appendChild(b);
    main.appendChild(small);
    li.appendChild(av);
    li.appendChild(main);
    return li;
  }

  function renderPlayers() {
    const box = el('online-players');
    if (!box) return;
    box.innerHTML = '';

    const list = roster();
    const groups = { attacker: [], defender: [], none: [] };
    list.forEach(function (p) {
      groups[p.side && groups[p.side] ? p.side : 'none'].push(p);
    });

    setText('online-player-count', state.test
      ? (list.length + ' 人')
      : (Math.min(list.length, MAX_PLAYERS) + ' / ' + MAX_PLAYERS));

    SIDES.forEach(function (side) {
      const head = document.createElement('li');
      head.className = 'online-team-head is-' + side.id;
      const tag = document.createElement('span');
      tag.className = 'online-team-tag';
      const dot = document.createElement('i');
      const label = document.createElement('b');
      label.textContent = side.name;
      tag.appendChild(dot);
      tag.appendChild(label);

      const fac = sideFaction(side.id);
      const fchip = document.createElement('span');
      fchip.className = 'online-team-faction' + (fac ? ' is-set' : '');
      fchip.textContent = fac ? factionName(fac) : '阵营未定';

      const left = document.createElement('span');
      left.className = 'online-team-left';
      left.appendChild(tag);
      left.appendChild(fchip);

      const count = document.createElement('span');
      count.className = 'online-team-count';
      count.textContent = groups[side.id].length + ' / ' + MAX_PER_SIDE;
      head.appendChild(left);
      head.appendChild(count);
      box.appendChild(head);
      groups[side.id].forEach(function (p) { box.appendChild(playerRow(p)); });
      if (!state.test) {
        for (let i = groups[side.id].length; i < MAX_PER_SIDE; i++) box.appendChild(emptySlot(side.id));
      }
    });

    if (groups.none.length) {
      const head = document.createElement('li');
      head.className = 'online-team-head is-none';
      const tag = document.createElement('span');
      tag.className = 'online-team-tag';
      const label = document.createElement('b');
      label.textContent = '未选阵营';
      tag.appendChild(label);
      const count = document.createElement('span');
      count.className = 'online-team-count';
      count.textContent = String(groups.none.length);
      head.appendChild(tag);
      head.appendChild(count);
      box.appendChild(head);
      groups.none.forEach(function (p) { box.appendChild(playerRow(p)); });
    }
  }

  function renderSidePick() {
    const box = el('online-side-pick');
    if (!box) return;
    const c = teamCounts();
    const locked = state.phase === 'battle';
    const selectable = canChooseSide();

    box.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'online-side-head';
    const hb = document.createElement('b');
    hb.textContent = locked ? '攻守编成' : '选择攻守';
    const hs = document.createElement('span');
    hs.textContent = locked
      ? '对局中 · 已锁定'
      : ('攻守各 ' + MAX_PER_SIDE + ' 人 · 最多 ' + MAX_PLAYERS + ' 人');
    head.appendChild(hb);
    head.appendChild(hs);
    box.appendChild(head);

    if (locked) {
      const lock = document.createElement('div');
      lock.className = 'online-side-locked';
      SIDES.forEach(function (side) {
        const chip = document.createElement('span');
        chip.className = 'online-side-lockchip is-' + side.id;
        const dot = document.createElement('i');
        const text = document.createElement('b');
        text.textContent = side.name;
        const num = document.createElement('span');
        num.textContent = (c[side.id] || 0) + ' 人';
        chip.appendChild(dot);
        chip.appendChild(text);
        chip.appendChild(num);
        lock.appendChild(chip);
      });
      box.appendChild(lock);
      const lockNote = document.createElement('p');
      lockNote.className = 'online-side-note';
      lockNote.textContent = '对局已开始，攻守已锁定。';
      box.appendChild(lockNote);
      return;
    }

    const btns = document.createElement('div');
    btns.className = 'online-side-btns';

    SIDES.forEach(function (side) {
      const count = c[side.id] || 0;
      const full = count >= MAX_PER_SIDE;
      const active = state.side === side.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'online-side-btn is-' + side.id +
        (active ? ' is-active' : '') + (full && !active ? ' is-full' : '');
      btn.setAttribute('data-side', side.id);
      btn.disabled = !selectable || (full && !active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');

      const icon = document.createElement('span');
      icon.className = 'online-side-icon';
      icon.textContent = side.short;

      const main = document.createElement('span');
      main.className = 'online-side-main';
      const b = document.createElement('b');
      b.textContent = side.name;
      const small = document.createElement('small');
      small.textContent = active ? '你在这个阵营' : (full ? '已满' : (selectable ? '点击加入' : '待选地图'));
      main.appendChild(b);
      main.appendChild(small);

      const cnt = document.createElement('span');
      cnt.className = 'online-side-count';
      cnt.textContent = count + ' / ' + MAX_PER_SIDE;

      btn.appendChild(icon);
      btn.appendChild(main);
      btn.appendChild(cnt);
      btns.appendChild(btn);
    });
    box.appendChild(btns);

    const note = document.createElement('p');
    note.className = 'online-side-note';
    if (!state.map) {
      note.textContent = '先让房主选择地图；作战模式由地图决定，选好后才开放攻守。';
    } else if (state.map.mode !== 'attack') {
      note.textContent = '争夺战还在设计，当前只开放攻防战。';
    } else if (state.test) {
      const seat = activeTestSeat();
      note.textContent = '当前操控「' + (seat ? seat.name : '本机玩家') + '」· ' +
        (seat ? sideName(seat.side) : '未选攻守') + '；点测试条上的名字切换玩家。';
    } else if (!state.side) {
      note.textContent = '点击攻方或守方加入。攻守各最多 2 人，双方各至少 1 人才能开局。';
    } else if (c.unassigned > 0) {
      note.textContent = '你在' + sideName(state.side) + '；还有 ' + c.unassigned + ' 人没选攻守。';
    } else {
      note.textContent = '你在' + sideName(state.side) + '；换攻守会取消准备。';
    }
    box.appendChild(note);
  }

  function flowStep(box, id, no, label, note, status) {
    const step = box.querySelector('[data-step="' + id + '"]');
    if (!step) return;
    step.className = 'online-flow-step is-' + status;
    step.querySelector('.online-flow-no').textContent = status === 'done' ? '✓' : (status === 'blocked' ? '!' : no);
    step.querySelector('.online-flow-text b').textContent = label;
    step.querySelector('.online-flow-text small').textContent = note;
  }

  function renderFlow() {
    const box = el('online-flow');
    if (!box) return;
    const c = teamCounts();
    const guests = onlineRoster().filter(function (p) { return p.role !== 'host'; });
    const readyN = guests.filter(function (p) { return p.ready; }).length;
    const map = state.map;
    const attack = !!map && map.mode === 'attack';
    const battle = state.phase === 'battle';
    const sideDone = teamsReady();
    const fa = sideFaction('attacker');
    const fd = sideFaction('defender');
    const conflict = !!fa && !!fd && fa === fd;
    const facReady = !!fa && !!fd && fa !== fd;

    flowStep(box, 'map', '01', '选择地图',
      map ? ((state.mapWrapper && state.mapWrapper.title) || '已选择') : '房主从地图库或 JSON 选图',
      map ? 'done' : 'active');

    flowStep(box, 'mode', '02', '确定模式',
      !map ? '等待地图' : (attack ? '攻防战 · 最多 4 人' : '争夺战 · 开发中'),
      !map ? 'wait' : (attack ? 'done' : 'blocked'));

    flowStep(box, 'side', '03', battle ? '攻守编成' : '选择攻守',
      !attack ? '地图选好后开放' :
        (sideDone ? ('攻 ' + c.attacker + ' · 守 ' + c.defender) :
          ('攻 ' + c.attacker + ' / 守 ' + c.defender + (c.unassigned ? ' · ' + c.unassigned + ' 人待选' : ''))),
      sideDone ? 'done' : (attack ? 'active' : 'wait'));

    flowStep(box, 'faction', '04', battle ? '阵营编成' : '选择阵营',
      !attack ? '地图选好后开放' :
        (!sideDone ? '先选好攻守' :
          (conflict ? '双方不能相同' :
            (fa && fd ? (factionName(fa) + ' vs ' + factionName(fd)) :
              (fa ? ('攻方 ' + factionName(fa) + ' · 守方待选') :
                (fd ? ('守方 ' + factionName(fd) + ' · 攻方待选') : '双方待选'))))),
      conflict ? 'blocked' : (facReady ? 'done' : (sideDone ? 'active' : 'wait')));

    flowStep(box, 'ready', '05', '准备开局',
      battle ? '对局进行中' :
        (!sideDone ? '先完成攻守编成' :
          (!facReady ? '先选国家阵营' :
            (guests.length ? ('已准备 ' + readyN + ' / ' + guests.length) : '等待玩家加入'))),
      battle ? 'done' :
        (facReady && sideDone ? 'active' : 'wait'));
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
    setText('online-mode-desc', has
      ? (modeDesc(state.map.mode) + (state.map.mode === 'attack' ? ' 本局最多 4 人：攻方 2、守方 2。' : ' 争夺战暂未开放。'))
      : '');

    scheduleDraw();
  }

  function canStart() {
    return state.role === 'host' && state.phase === 'lobby' && !startReason();
  }

  function startReason() {
    if (state.role !== 'host') return '';
    if (state.phase === 'battle') return '对局已开始';
    if (state.phase === 'prepare') return 'A 阶段战前准备中';
    if (!state.test && state.netStatus !== 'connected') return '连接中断，正在重连…';
    if (!state.map) return '先选择一张地图';
    if (state.map.mode !== 'attack') return '争夺战还在设计，暂不支持开局';

    const list = onlineRoster();
    if (list.length < 2) return '等待玩家加入（当前 ' + list.length + ' / ' + MAX_PLAYERS + '）';
    if (list.length > MAX_PLAYERS) return '房间人数超出 ' + MAX_PLAYERS + ' 人';

    const c = teamCounts();
    if (!state.test && !state.side) return '先选择你的攻守';
    if (c.unassigned > 0) {
      const first = list.filter(function (p) { return !p.side; })[0];
      return '「' + truncName(first && first.name) + '」还没选攻守';
    }
    if (!c.attacker) return '攻方还没有玩家';
    if (!c.defender) return '守方还没有玩家';
    if (c.attacker > MAX_PER_SIDE || c.defender > MAX_PER_SIDE) return '一方人数超出（各最多 2 人）';

    const fa = sideFaction('attacker');
    const fd = sideFaction('defender');
    if (!fa) return '攻方还没选国家阵营';
    if (!fd) return '守方还没选国家阵营';
    if (fa === fd) return '双方阵营不能相同，请换一个';

    const guests = list.filter(function (p) { return p.role !== 'host'; });
    const notReady = guests.filter(function (p) { return !p.ready; });
    if (notReady.length) return '等待「' + truncName(notReady[0].name) + '」准备';
    return '';
  }

  function compositionText() {
    const c = teamCounts();
    const fa = sideFaction('attacker');
    const fd = sideFaction('defender');
    return '攻方' + (fa ? ' · ' + factionName(fa) : '') + ' ' + c.attacker + ' 人 · ' +
      '守方' + (fd ? ' · ' + factionName(fd) : '') + ' ' + c.defender + ' 人';
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
    hideEl('online-ready', state.test || !(!isHost && lobby));
    hideEl('online-back-lobby', !(isHost && !lobby));

    if (start) {
      const why = startReason();
      start.disabled = !!why;
      start.title = why || '所有玩家已选阵营并准备，开始对局';
    }

    if (ready) {
      ready.textContent = state.ready ? '取消准备' : '准备';
      ready.classList.toggle('on', state.ready);
      ready.disabled = (!state.test && state.netStatus !== 'connected') || !canChooseSide();
      ready.title = canChooseSide()
        ? (state.side ? '' : '先在右侧选择攻方或守方')
        : '等房主选好攻防战地图后再准备';
    }

    if (pick) pick.textContent = (state.map ? '更换地图' : '选择地图');

    const note = el('online-ready-note');
    if (!note) return;
    if (state.phase === 'battle') {
      note.textContent = '对局进行中 · 地图已锁定 · ' + compositionText();
      return;
    }
    if (isHost) {
      const why = startReason();
      note.textContent = why ? why : '双方就绪，可以开始 · ' + compositionText();
    } else {
      if (!state.map) note.textContent = '等待房主选择地图';
      else if (state.map.mode !== 'attack') note.textContent = '争夺战还在设计，先打攻防战';
      else if (!state.side) note.textContent = '先在右侧选择攻方或守方';
      else if (state.ready) note.textContent = '已准备，等待房主开始';
      else note.textContent = '已选' + sideName(state.side) + '，点「准备」';
    }
  }

  function renderPhaseNote() {
    const phaseNote = el('online-phase-note');
    if (!phaseNote) return;
    const isHost = state.role === 'host';
    if (state.phase === 'battle') {
      phaseNote.textContent = '对局进行中 · ' + compositionText();
    } else if (isHost) {
      const why = startReason();
      phaseNote.textContent = why || '编成完成，可以开始';
    } else if (!state.map) {
      phaseNote.textContent = '等待房主选择地图';
    } else if (!state.side) {
      phaseNote.textContent = '选择攻方或守方后准备';
    } else {
      phaseNote.textContent = state.ready ? '已准备，等待房主开始' : '点击准备，等待房主开始';
    }
  }

  function renderBanner() {
    const box = el('online-banner');
    if (!box) return;
    let text = '';
    let cls = '';
    if (state.test) {
      text = state.phase === 'battle'
        ? '本地测试 · 对局已开始 · ' + compositionText()
        : '本地测试模式 · 不连接任何中继 · 你同时操控 ' + state.testSeats.length + ' 名本机玩家';
      cls = state.phase === 'battle' ? 'is-live' : 'is-test';
    } else if (state.role === 'guest' && state.host && state.host.online === false) {
      text = '房主已离开，房间已关闭';
      cls = 'is-danger';
    } else if (state.netStatus === 'reconnecting' || state.netStatus === 'offline' ||
               state.netStatus === 'closed' || state.netStatus === 'error') {
      text = state.netStatus === 'error' ? '连接异常，正在尝试恢复…' : '连接中断，正在重连…';
      cls = 'is-warn';
    } else if (state.phase === 'battle') {
      text = '对局已开始 · 地图已锁定 · ' + compositionText();
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
    setText('online-role-label', state.test
      ? '本地测试 · 不联网'
      : (isHost ? '房主 · 创建者' : '玩家 · 已加入'));
    const fmt = state.test ? 'TEST' : NET.formatCode(state.roomCode);
    setText('online-code-display', fmt);
    setText('online-code-box', fmt);
    const relayShort = (broker().name || '').split(' · ')[0];
    setText('online-code-note', state.test
      ? '本地测试不连接中继；刷新页面即退出。'
      : (isFileProtocol()
        ? '中继 ' + relayShort + ' · 本地文件打开：发房间码，并让对方拿到同一份网页。'
        : '中继 ' + relayShort + ' · 发给同学，输入同一串代码即可加入。'));
    hideEl('online-copy', state.test);
    hideEl('online-invite', state.test || isFileProtocol());

    renderMapPanel();
    renderPlayers();
    renderSidePick();
    renderFactionPick();
    renderFlow();
    renderTestPanel();
    renderActions();
    renderBanner();
    renderPhaseNote();
    renderLogs();
    syncFactionView();
    if (state.phase === 'prepare') renderPrep();

    document.title = state.test ? ('本地测试 · 兵棋') : (fmt ? ('房间 ' + fmt + ' · 兵棋') : TITLE);
  }

  /* 房间里的流程条 / 阵营选择是 online.js 运行时搭的：
   * index.html 只提供房间骨架，军械库和百科也是同样的做法。 */
  function ensureDynamicUI() {
    const room = el('online-room');
    if (!room) return;

    if (!el('online-flow')) {
      const flow = document.createElement('div');
      flow.id = 'online-flow';
      flow.className = 'online-flow';
      flow.setAttribute('aria-label', '开局流程');
      [
        ['map', '01', '选择地图'],
        ['mode', '02', '确定模式'],
        ['side', '03', '选择攻守'],
        ['faction', '04', '选择阵营'],
        ['ready', '05', '准备开局'],
      ].forEach(function (d) {
        const step = document.createElement('div');
        step.className = 'online-flow-step is-wait';
        step.setAttribute('data-step', d[0]);
        const no = document.createElement('span');
        no.className = 'online-flow-no';
        no.textContent = d[1];
        const text = document.createElement('span');
        text.className = 'online-flow-text';
        const b = document.createElement('b');
        b.textContent = d[2];
        const small = document.createElement('small');
        small.textContent = '—';
        text.appendChild(b);
        text.appendChild(small);
        step.appendChild(no);
        step.appendChild(text);
        flow.appendChild(step);
      });
      const grid = room.querySelector('.online-room-grid');
      const banner = el('online-banner');
      if (banner && banner.parentNode === room) banner.insertAdjacentElement('afterend', flow);
      else if (grid && grid.parentNode === room) room.insertBefore(flow, grid);
      else room.appendChild(flow);
    }

    const flow = el('online-flow');
    if (flow && !el('online-test')) {
      const bar = document.createElement('section');
      bar.id = 'online-test';
      bar.className = 'online-test hidden';
      bar.setAttribute('aria-label', '本地测试');
      bar.innerHTML =
        '<div class="online-test-head">' +
          '<span class="online-test-title"><b>本地测试</b><em>TEST</em></span>' +
          '<span id="online-test-note" class="online-test-note">不连中继</span>' +
          '<span id="online-test-count" class="online-test-count">0 名本机玩家</span>' +
        '</div>' +
        '<div class="online-test-scenarios" role="group" aria-label="本机玩家人数">' +
          '<button type="button" data-test-scenario="2" aria-pressed="false">1v1</button>' +
          '<button type="button" data-test-scenario="3" aria-pressed="false">2v1</button>' +
          '<button type="button" data-test-scenario="4" aria-pressed="false">2v2</button>' +
        '</div>' +
        '<div id="online-test-seats" class="online-test-seats"></div>' +
        '<div class="online-test-actions">' +
          '<button id="online-test-ready-all" type="button" class="btn small">全部准备</button>' +
          '<button id="online-test-ready-none" type="button" class="btn small">全部取消</button>' +
          '<button id="online-test-clear" type="button" class="btn small">清空站位</button>' +
        '</div>';
      flow.insertAdjacentElement('afterend', bar);
    }

    if (!el('online-side-pick')) {
      const box = document.createElement('div');
      box.id = 'online-side-pick';
      box.className = 'online-side-pick';
      const players = el('online-players');
      if (players && players.parentNode) players.parentNode.appendChild(box);
      else if (room) room.appendChild(box);
    }

    if (!el('online-faction-view')) {
      const view = document.createElement('section');
      view.id = 'online-faction-view';
      view.className = 'online-faction-view hidden';
      view.setAttribute('aria-label', '选择国家阵营');
      view.innerHTML =
        '<div class="online-faction-view-head">' +
          '<div>' +
            '<p class="online-kicker">NATION SELECT <span>/</span> BOTH SIDES</p>' +
            '<h2>选择国家阵营</h2>' +
            '<p class="online-faction-view-lead">双方队长各选一国，双方不能相同。目前只开放美国 / 德国，苏联 / 英国 / 中国暂未开放。</p>' +
          '</div>' +
          '<button id="online-faction-back" type="button" class="btn">返回房间</button>' +
        '</div>' +
        '<div id="online-faction-board" class="online-faction-board"></div>' +
        '<div class="online-faction-view-foot">' +
          '<span id="online-faction-status" class="online-faction-status">—</span>' +
          '<div class="online-faction-view-actions">' +
            '<button id="online-faction-done" type="button" class="btn primary" disabled>双方选好后继续</button>' +
          '</div>' +
        '</div>';
      const grid = room.querySelector('.online-room-grid');
      if (grid && grid.parentNode === room) room.insertBefore(view, grid);
      else room.appendChild(view);
    }

    if (!el('online-prep')) {
      const prep = document.createElement('section');
      prep.id = 'online-prep';
      prep.className = 'online-prep hidden';
      prep.setAttribute('aria-label', 'A 阶段战前准备');
      prep.innerHTML =
        '<canvas id="online-prep-map" class="online-prep-map" aria-hidden="true"></canvas>' +
        '<div class="online-prep-veil" aria-hidden="true"></div>' +
        '<div class="online-prep-inner">' +
          '<header class="online-prep-head">' +
            '<div class="online-prep-title">' +
              '<p class="online-kicker">PHASE A <span>/</span> BATTLE PREPARATION</p>' +
              '<h2>A 阶段 · 战前准备</h2>' +
              '<p id="online-prep-sub" class="online-prep-sub">—</p>' +
            '</div>' +
            '<div class="online-prep-head-right">' +
              '<div id="online-prep-seats" class="online-prep-seats"></div>' +
              '<span id="online-prep-status" class="online-prep-status">—</span>' +
            '</div>' +
          '</header>' +
          '<div class="online-prep-grid">' +
            '<section id="online-prep-me" class="online-prep-panel is-me"></section>' +
            '<aside id="online-prep-opp" class="online-prep-panel is-opp"></aside>' +
          '</div>' +
          '<input id="online-prep-file" type="file" accept=".json,application/json" hidden>' +
        '</div>';
      const grid = room.querySelector('.online-room-grid');
      if (grid && grid.parentNode === room) room.insertBefore(prep, grid);
      else room.appendChild(prep);
    }

    if (!el('online-faction')) {
      const box = document.createElement('div');
      box.id = 'online-faction';
      box.className = 'online-faction';
      const players = el('online-players');
      if (players && players.parentNode) players.parentNode.appendChild(box);
      else if (room) room.appendChild(box);
    }

    const card = mount.querySelector('.online-entry-card');
    if (card && !el('online-test-start')) {
      const entry = document.createElement('div');
      entry.className = 'online-test-entry';
      entry.innerHTML =
        '<span class="online-test-entry-label"><b>本地测试</b><em>TEST</em></span>' +
        '<span class="online-test-entry-note">不连接中继，一台电脑操控 1v1 / 2v1 / 2v2。</span>' +
        '<button id="online-test-start" type="button" class="btn">进入</button>';
      card.appendChild(entry);
    }
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
    state.joinedAt = 0;
    state.guests.clear();
    state.map = null;
    state.mapWrapper = null;
    state.selectedMapId = '';
    state.side = null;
    state.faction = null;
    state.factionReady = false;
    state.deckReady = false;
    state.prep = createPrep();
    state.hostFactions = null;
    state.factionView = false;
    state.factionPrompted = false;
    state.prepError = '';
    state.hostTeams = null;
    state.test = false;
    state.testSeats.length = 0;
    state.activeSeat = '';
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
          refreshRoom();
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
        mode: null,
        side: null,
        faction: null,
        maxPlayers: MAX_PLAYERS,
        map: null,
        teams: null,
        factions: null,
      });
      if (gen !== state.gen) { net.disconnect(); return; }
      state.joined = true;
      setView('room');
      pushLog('房间已创建，等待玩家加入');
      // 房主不改地址栏：刷新后应该回主菜单，而不是拿自己的房间码当客人加入。
      renderRoom();
      mount.focus({ preventScroll: true });
      // 建房后的第一步就是选地图：自动把地图库弹出来，省得同学找不到入口。
      setTimeout(function () {
        if (gen !== state.gen || state.view !== 'room' || state.role !== 'host') return;
        if (state.phase === 'battle' || state.map || state.dialogOpen || state.alertOpen) return;
        openMapDialog();
      }, 320);
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
    state.joinedAt = Date.now();
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
      await net.setGuestState({ side: null, faction: null, ready: false });
      await waitForHost(gen);
      // 等一小会儿，收取其他玩家 retained 状态，判断房间是否已满（2v2 最多 4 人）
      await sleep(FULL_WAIT_MS);
      if (gen !== state.gen) return;
      if (otherGuests().length >= MAX_PLAYERS - 1) {
        throw new Error('房间已满（' + MAX_PLAYERS + ' / ' + MAX_PLAYERS + '）');
      }
      if (!state.host || state.host.online === false) throw new Error('房主已离开');
      if (state.host.phase === 'battle') throw new Error('对局已经开始，暂时不能加入');

      state.joined = true;
      state.phase = state.host.phase || 'lobby';
      state.side = null;
      state.faction = null;
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
      const nextPhase = h.phase === 'battle' ? 'battle' : (h.phase === 'prepare' ? 'prepare' : 'lobby');
      const wasPhase = state.phase;
      const wasBattle = state.phase === 'battle';
      state.phase = nextPhase;
      state.hostTeams = nextPhase === 'battle' && Array.isArray(h.teams) ? h.teams : null;
      state.hostFactions = nextPhase !== 'lobby' && h.factions ? h.factions : null;
      // 房主状态说“还没有地图”时，清掉可能从旧会话 retained 下来的地图
      if (!h.map && state.map) {
        state.map = null;
        state.mapWrapper = null;
        state.selectedMapId = '';
      }
      if (nextPhase === 'battle' && !wasBattle) pushLog('房主开始了对局');
      if (nextPhase === 'prepare' && wasPhase === 'lobby') pushLog('双方阵营已确认，进入战前准备');
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
    } else if (normalizeSide(prev.presence.side) !== normalizeSide(g.side)) {
      pushLog('「' + (g.name || '玩家') + '」选择了' + sideName(g.side));
    } else if (normalizeFaction(prev.presence.faction) !== normalizeFaction(g.faction)) {
      pushLog('「' + (g.name || '玩家') + '」阵营：' + factionName(g.faction));
    } else if (!!prev.presence.ready !== !!g.ready) {
      pushLog('「' + (g.name || '玩家') + '」' + (g.ready ? '已准备' : '取消准备'));
    }
    if (state.view === 'room') refreshRoom();
    if (state.role === 'host' && state.phase === 'lobby') maybePrepare();
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
      refreshRoom();
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
    setText('online-map-dialog-hint', '支持编辑器导出的 .json · 当前只开放攻防战');
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
      const attack = entry.parsed.mode === 'attack';
      const row = document.createElement('div');
      row.className = 'online-map-item' +
        (entry.id === state.selectedMapId ? ' is-current' : '') +
        (attack ? '' : ' is-disabled');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'online-map-item-pick';
      pick.setAttribute('data-pick', entry.id);
      if (!attack) {
        pick.setAttribute('aria-disabled', 'true');
        pick.title = '争夺战还在设计，暂时不能开局';
      }

      const thumb = document.createElement('canvas');
      thumb.className = 'online-map-thumb';

      const main = document.createElement('span');
      main.className = 'online-map-item-main';
      const b = document.createElement('b');
      b.textContent = entry.title;
      const small = document.createElement('small');
      small.textContent = modeName(entry.parsed.mode) + ' · ' +
        entry.parsed.cols + ' × ' + entry.parsed.rows + ' · ' +
        entry.parsed.cells.length + ' 格' + (attack ? '' : ' · 暂未开放');
      main.appendChild(b);
      main.appendChild(small);

      const badge = document.createElement('span');
      badge.className = 'online-map-item-badge' + (entry.source === 'draft' ? ' is-draft' : '');
      badge.textContent = entry.id === state.selectedMapId ? '使用中' :
        (!attack ? '争夺战 · 开发中' : (entry.source === 'draft' ? '编辑器' : '选择'));

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
    if (entry.parsed.mode !== 'attack') {
      showAlert('争夺战还没开放', '这张地图是「争夺战」。争夺战的点位与胜利条件还在设计，' +
        '线上对战先只做攻防战。请在地图编辑器里把模式改成攻防战，或换一张攻防战地图。',
        function () { openMapDialog(); });
      return;
    }
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
        mode: entry.parsed.mode,
        side: state.side,
        faction: state.faction,
        maxPlayers: MAX_PLAYERS,
        map: mapMeta(entry.parsed, entry.title),
        teams: null,
        factions: null,
      });
    }
    closeMapDialog(true);
    renderRoom();
    pushLog('房主选择了「' + entry.title + '」 · ' + modeName(entry.parsed.mode));
    toast('已选择「' + entry.title + '」 · ' + modeName(entry.parsed.mode));
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
      if (r.parsed.mode !== 'attack') {
        throw new Error('这张图是争夺战，规则还在设计，线上对战暂时只支持攻防战');
      }
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
    const prepSeat = e.target.closest ? e.target.closest('[data-prep-seat]') : null;
    if (prepSeat) {
      setActiveTestSeat(prepSeat.getAttribute('data-prep-seat'));
      if (state.phase === 'prepare') renderPrep();
      return;
    }
    const prepCorps = e.target.closest ? e.target.closest('[data-prep-corps]') : null;
    if (prepCorps) {
      prepChooseCorps(prepCorps.getAttribute('data-prep-corps'));
      return;
    }
    const prepDivision = e.target.closest ? e.target.closest('[data-prep-division]') : null;
    if (prepDivision) {
      prepChooseDivision(prepDivision.getAttribute('data-prep-division'));
      return;
    }
    const prepUnit = e.target.closest ? e.target.closest('[data-prep-unit]') : null;
    if (prepUnit) {
      prepAdjust(prepUnit.getAttribute('data-prep-unit'), Number(prepUnit.getAttribute('data-prep-delta')) || 0);
      return;
    }
    if (e.target.closest && e.target.closest('[data-prep-change-corps]')) { prepClearCorps(); return; }
    if (e.target.closest && e.target.closest('[data-prep-change-division]')) { prepClearDivision(); return; }
    if (e.target.closest && e.target.closest('[data-prep-export]')) { exportPrepDeck(); return; }
    if (e.target.closest && e.target.closest('[data-prep-import]')) {
      const f = el('online-prep-file');
      if (f) f.click();
      return;
    }
    if (e.target.closest && e.target.closest('[data-prep-confirm]')) { confirmPrepDeck(); return; }
    if (e.target.closest && e.target.closest('[data-prep-unlock]')) { unlockPrepDeck(); return; }
    if (e.target.closest && e.target.closest('[data-prep-retry]')) {
      state.prepError = '';
      prepDataPromise = null;
      loadPrepData().then(function () { renderPrep(); }).catch(function () { renderPrep(); });
      return;
    }

    const testStart = e.target.closest ? e.target.closest('#online-test-start') : null;
    if (testStart) {
      startTest();
      return;
    }

    const scen = e.target.closest ? e.target.closest('[data-test-scenario]') : null;
    if (scen) {
      setupTestScenario(Number(scen.getAttribute('data-test-scenario')));
      return;
    }

    const seatSide = e.target.closest ? e.target.closest('[data-seat-side]') : null;
    if (seatSide) {
      setTestSeatSide(seatSide.getAttribute('data-seat'), seatSide.getAttribute('data-seat-side'));
      return;
    }

    const seatReady = e.target.closest ? e.target.closest('[data-seat-ready]') : null;
    if (seatReady) {
      toggleTestSeatReady(seatReady.getAttribute('data-seat'));
      return;
    }

    const seatPick = e.target.closest ? e.target.closest('[data-test-seat]') : null;
    if (seatPick) {
      setActiveTestSeat(seatPick.getAttribute('data-test-seat'));
      return;
    }

    if (e.target.closest && e.target.closest('#online-test-ready-all')) { setAllTestSeatsReady(true); return; }
    if (e.target.closest && e.target.closest('#online-test-ready-none')) { setAllTestSeatsReady(false); return; }
    if (e.target.closest && e.target.closest('#online-test-clear')) { resetTestSeats(); return; }

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

    const sideBtn = e.target.closest ? e.target.closest('[data-side]') : null;
    if (sideBtn) {
      pickSide(sideBtn.getAttribute('data-side'));
      return;
    }

    if (e.target.closest && e.target.closest('#online-faction-open')) {
      openFactionView();
      return;
    }
    if (e.target.closest && e.target.closest('#online-faction-back')) {
      closeFactionView();
      return;
    }
    if (e.target.closest && e.target.closest('#online-faction-done')) {
      confirmFaction();
      return;
    }
    const factionStep = e.target.closest ? e.target.closest('[data-step="faction"]') : null;
    if (factionStep) {
      openFactionView();
      return;
    }

    const factionBtn = e.target.closest ? e.target.closest('[data-faction]') : null;
    if (factionBtn) {
      pickFaction(factionBtn.getAttribute('data-faction-side') || state.side, factionBtn.getAttribute('data-faction'));
      return;
    }

    const factionRandom = e.target.closest ? e.target.closest('[data-faction-random-side]') : null;
    if (factionRandom) {
      randomFaction(factionRandom.getAttribute('data-faction-random-side'));
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
    if (!state.ready) {
      if (!canChooseSide()) { toast('等房主选好攻防战地图再准备'); return; }
      if (!state.side) { toast('先选择攻方或守方'); return; }
    }
    state.ready = !state.ready;
    if (state.net) {
      await state.net.setGuestState({ side: state.side, faction: state.faction, ready: state.ready });
    }
    renderActions();
    renderPlayers();
    renderSidePick();
    renderFlow();
    renderPhaseNote();
  });

  el('online-start').addEventListener('click', async function () {
    if (state.phase !== 'lobby') return;
    if (!canStart()) return;
    if (!state.test && !state.net) return;
    const factions = {
      attacker: sideFaction('attacker'),
      defender: sideFaction('defender'),
    };
    const teams = onlineRoster().map(function (p) {
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        side: p.side,
        faction: sideFaction(p.side),
      };
    });
    state.phase = 'battle';
    state.factionView = false;
    state.hostTeams = teams;
    state.hostFactions = factions;
    if (state.net) {
      await state.net.setHostState({
        phase: 'battle',
        mode: state.map ? state.map.mode : null,
        side: state.side,
        faction: state.faction,
        maxPlayers: MAX_PLAYERS,
        map: state.map ? mapMeta(state.map, state.mapWrapper.title) : null,
        teams: teams,
        factions: factions,
        startedAt: Date.now(),
      });
    }
    pushLog('对局开始 · ' + compositionText());
    renderRoom();
  });

  el('online-back-lobby').addEventListener('click', async function () {
    if (state.role !== 'host') return;
    if (!state.test && !state.net) return;
    state.phase = 'lobby';
    state.factionView = false;
    state.hostTeams = null;
    state.hostFactions = null;
    if (state.net) {
      await state.net.setHostState({
        phase: 'lobby',
        mode: state.map ? state.map.mode : null,
        side: state.side,
        faction: state.faction,
        maxPlayers: MAX_PLAYERS,
        map: state.map ? mapMeta(state.map, state.mapWrapper.title) : null,
        teams: null,
        factions: null,
      });
    }
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
    const prep = el('online-prep');
    if (prep) new ResizeObserver(schedulePrepMap).observe(prep);
  }
  window.addEventListener('resize', scheduleDraw);
  window.addEventListener('resize', schedulePrepMap);

  /* =============================================================
   * 初始化
   * ============================================================= */

  loadPrefs();
  ensureDynamicUI();
  const prepFileInput = el('online-prep-file');
  if (prepFileInput) {
    prepFileInput.addEventListener('change', function () {
      const f = this.files && this.files[0];
      this.value = '';
      if (f) importPrepDeck(f);
    });
  }
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
  } else {
    // 开发 / 验收用：index.html?test=1 直接进本地测试房，不连中继。
    const testParam = queryParam('test');
    if (testParam === '1' || testParam === 'local') {
      open();
      setTimeout(startTest, 80);
    }
  }

  window.Online = {
    open: open,
    close: close,
    leaveRoom: leaveRoom,
    isOpen: function () { return state.open; },
    roomCode: function () { return state.roomCode; },
    startTest: startTest,
    isTest: function () { return state.test; },
    maxPlayers: MAX_PLAYERS,
    maxPerSide: MAX_PER_SIDE,
    sides: SIDES,
    factions: FACTIONS,
    sideFaction: function (side) { return sideFaction(side); },
    state: state,
  };
})();
