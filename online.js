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
 *   - 房间码 4 位数字，地图和房间状态用房间码派生的 AES-GCM 密钥加密；
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
    decks: null,            // 部署用双方卡组快照：{ attacker:[单位名], defender:[单位名] }
    deploy: null,           // 部署状态：{ units:[{id,side,name,c,r}], ready:{attacker,defender} }
    deploySel: '',          // 本机当前选中的待部署单位名
    reinforceSel: '',
    reinforcePeek: false,
    deploySeq: 0,
    deployDist: null,       // { map, dist:[...] } 出兵点逐圈距离缓存
    battle: null,           // 战斗状态：activeSide / round / units / selectedId / ghost / counter
    battleSeq: 0,
    battleSeenAction: '',
    battleTip: null,
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
    return { corpsId: '', divisionId: '', units: {}, nukes: 0, ready: false };
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

  function mapLayout(w, h, parsed) {
    if (!parsed) return null;
    const cols = parsed.cols, rows = parsed.rows;
    const b = HG.mapBounds(cols, rows, 1);
    const pad = Math.max(8, Math.min(w, h) * 0.055);
    const scale = Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h);
    if (!isFinite(scale) || scale <= 0) return null;
    const offX = (w - b.w * scale) / 2;
    const offY = (h - b.h * scale) / 2;
    const toScreenY = function (py) {
      return offY + b.h * scale - (py - b.minY * scale);
    };
    function center(c, r) {
      const p = HG.center(c, r, scale);
      return { x: offX + (p[0] - b.minX * scale), y: toScreenY(p[1]) };
    }
    function toCell(x, y) {
      const px = (x - offX) + b.minX * scale;
      const py = (offY + b.h * scale - y) + b.minY * scale;
      const p = HG.pixelToCell(px, py, scale);
      const c = Math.round(p[0]), r = Math.round(p[1]);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
      return { c: c, r: r };
    }
    return { cols: cols, rows: rows, b: b, scale: scale, offX: offX, offY: offY, toScreenY: toScreenY, center: center, toCell: toCell };
  }

  function drawBoard(ctx, w, h, parsed, withMarkers) {
    const L = mapLayout(w, h, parsed);
    if (!L) return;
    const cols = L.cols, rows = L.rows, b = L.b, scale = L.scale;
    const offX = L.offX, offY = L.offY, toScreenY = L.toScreenY;
    const zone = parsed.mode === 'attack' && parsed.deploy ? parsed.deploy.zone : null;
    const lw = Math.max(0.55, scale * 0.055);

    // 坐标契约（见 协作规则.md）：行 0 在最下方、行号向上增。
    // Canvas 的 y 轴向下，所以把地图的纵向翻一次，和 3D 默认视角保持一致。
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

  /* ---------------- 部署阶段：数据、逐圈规则、绘制 ---------------- */

  /* 单位模型索引：单位名 → 阵营 → [模型文件, ARMORY_MODELS 键]。
   * 模型由军械库的 armory-models/ 只读加载，不修改模型源文件。 */
  const UNIT_MODEL_INDEX = {
    "105炮兵营": { us: ["us-40s-arty.js", "us|40s|arty|105炮兵营"], de: ["de-40s-arty.js", "de|40s|arty|105炮兵营"] },
    "150炮兵营": { de: ["de-40s-arty.js", "de|40s|arty|150炮兵营"] },
    "155炮兵营": { us: ["us-40s-arty.js", "us|40s|arty|155炮兵营"] },
    "20防空炮营": { de: ["de-40s-aa.js", "de|40s|aa|20防空炮营"] },
    "222装甲侦察营": { de: ["de-40s-recon.js", "de|40s|recon|222装甲侦察营"] },
    "40防空炮营": { us: ["us-40s-aa.js", "us|40s|aa|40防空炮营"] },
    "75谢尔曼中坦营": { us: ["us-40s-armor.js", "us|40s|armor|75谢尔曼中坦营"] },
    "76谢尔曼中坦营": { us: ["us-40s-armor.js", "us|40s|armor|76谢尔曼中坦营"] },
    "88防空炮营": { de: ["de-40s-aa.js", "de|40s|aa|88防空炮营"] },
    "90防空炮营": { us: ["us-40s-aa.js", "us|40s|aa|90防空炮营"] },
    "B25轰炸机": { us: ["us-40s-air.js", "us|40s|air|B25轰炸机"] },
    "B29轰炸机": { us: ["us-40s-air.js", "us|40s|air|B29轰炸机"] },
    "Bf109战斗机": { de: ["de-40s-air.js", "de|40s|air|Bf109战斗机"] },
    "F5侦察机": { us: ["us-40s-air.js", "us|40s|air|F5侦察机"] },
    "F6战斗侦察机": { us: ["us-40s-air.js", "us|40s|air|F6战斗侦察机"] },
    "Fw189侦察机": { de: ["de-40s-air.js", "de|40s|air|Fw189侦察机"] },
    "Fw190战斗轰炸机": { de: ["de-40s-air.js", "de|40s|air|Fw190战斗轰炸机"] },
    "Ju88轰炸机": { de: ["de-40s-air.js", "de|40s|air|Ju88轰炸机"] },
    "M10中型坦歼营": { us: ["us-40s-at.js", "us|40s|at|M10中型坦歼营"] },
    "M12自行火炮营": { us: ["us-40s-arty.js", "us|40s|arty|M12自行火炮营"] },
    "M15自行防空炮营": { us: ["us-40s-aa.js", "us|40s|aa|M15自行防空炮营"] },
    "M16自行防空炮营": { us: ["us-40s-aa.js", "us|40s|aa|M16自行防空炮营"] },
    "M7自行火炮营": { us: ["us-40s-arty.js", "us|40s|arty|M7自行火炮营"] },
    "Me262战斗机": { de: ["de-40s-air.js", "de|40s|air|Me262战斗机"] },
    "P38战斗机": { us: ["us-40s-air.js", "us|40s|air|P38战斗机"] },
    "P47战斗轰炸机": { us: ["us-40s-air.js", "us|40s|air|P47战斗轰炸机"] },
    "P51战斗机": { us: ["us-40s-air.js", "us|40s|air|P51战斗机"] },
    "T95超重坦营": { us: ["us-40s-at.js", "us|40s|at|T95超重坦营"] },
    "东风自行防空炮营": { de: ["de-40s-aa.js", "de|40s|aa|东风自行防空炮营"] },
    "人民冲锋队": { de: ["de-40s-inf.js", "de|40s|inf|人民冲锋队"] },
    "伞兵营": { us: ["us-40s-inf.js", "us|40s|inf|伞兵营"] },
    "侦察营": { us: ["us-40s-recon.js", "us|40s|recon|侦察营"], de: ["de-40s-recon.js", "de|40s|recon|侦察营"] },
    "医疗连": { us: ["us-40s-support.js", "us|40s|support|医疗连"], de: ["de-40s-support.js", "de|40s|support|医疗连"] },
    "卡车自行防空炮营": { de: ["de-40s-aa.js", "de|40s|aa|卡车自行防空炮营"] },
    "反坦克小组": { us: ["us-40s-at.js", "us|40s|at|反坦克小组"], de: ["de-40s-at.js", "de|40s|at|反坦克小组"] },
    "反坦克敢死队": { de: ["de-40s-at.js", "de|40s|at|反坦克敢死队"] },
    "反坦克营": { us: ["us-40s-at.js", "us|40s|at|反坦克营"], de: ["de-40s-at.js", "de|40s|at|反坦克营"] },
    "反炮兵小组": { us: ["us-40s-arty.js", "us|40s|arty|反炮兵小组"], de: ["de-40s-arty.js", "de|40s|arty|反炮兵小组"] },
    "四号中坦营": { de: ["de-40s-armor.js", "de|40s|armor|四号中坦营"] },
    "四号中型坦歼营": { de: ["de-40s-at.js", "de|40s|at|四号中型坦歼营"] },
    "四号突击炮营": { de: ["de-40s-at.js", "de|40s|at|四号突击炮营"] },
    "地狱猫装甲侦察营": { us: ["us-40s-recon.js", "us|40s|recon|地狱猫装甲侦察营"] },
    "宪兵连": { us: ["us-40s-support.js", "us|40s|support|宪兵连"], de: ["de-40s-support.js", "de|40s|support|宪兵连"] },
    "山地步兵营": { us: ["us-40s-inf.js", "us|40s|inf|山地步兵营"] },
    "山地猎兵营": { de: ["de-40s-inf.js", "de|40s|inf|山地猎兵营"] },
    "工兵营": { us: ["us-40s-support.js", "us|40s|support|工兵营"], de: ["de-40s-support.js", "de|40s|support|工兵营"] },
    "巨无霸重坦营": { us: ["us-40s-armor.js", "us|40s|armor|巨无霸重坦营"] },
    "摩托化运输队": { us: ["us-40s-support.js", "us|40s|support|摩托化运输队"], de: ["de-40s-support.js", "de|40s|support|摩托化运输队"] },
    "斯图亚特轻坦营": { us: ["us-40s-armor.js", "us|40s|armor|斯图亚特轻坦营"] },
    "机械化步兵营": { us: ["us-40s-inf.js", "us|40s|inf|机械化步兵营"] },
    "桥": { us: ["us-40s-fort.js", "us|40s|fort|桥"] },
    "步兵营": { us: ["us-40s-inf.js", "us|40s|inf|步兵营"], de: ["de-40s-inf.js", "de|40s|inf|步兵营"] },
    "海军陆战队营": { us: ["us-40s-inf.js", "us|40s|inf|海军陆战队营"] },
    "游骑兵营": { us: ["us-40s-inf.js", "us|40s|inf|游骑兵营"] },
    "潘兴重坦营": { us: ["us-40s-armor.js", "us|40s|armor|潘兴重坦营"] },
    "灰狗装甲侦察营": { us: ["us-40s-recon.js", "us|40s|recon|灰狗装甲侦察营"] },
    "猎兵营": { de: ["de-40s-inf.js", "de|40s|inf|猎兵营"] },
    "猎虎重型坦歼营": { de: ["de-40s-at.js", "de|40s|at|猎虎重型坦歼营"] },
    "猎豹重型坦歼营": { de: ["de-40s-at.js", "de|40s|at|猎豹重型坦歼营"] },
    "突击工兵营": { us: ["us-40s-inf.js", "us|40s|inf|突击工兵营"], de: ["de-40s-inf.js", "de|40s|inf|突击工兵营"] },
    "突击步兵营": { de: ["de-40s-inf.js", "de|40s|inf|突击步兵营"] },
    "管风琴火箭炮营": { us: ["us-40s-arty.js", "us|40s|arty|管风琴火箭炮营"] },
    "美洲狮装甲侦察营": { de: ["de-40s-recon.js", "de|40s|recon|美洲狮装甲侦察营"] },
    "虎式重坦营": { de: ["de-40s-armor.js", "de|40s|armor|虎式重坦营"] },
    "虎王重坦营": { de: ["de-40s-armor.js", "de|40s|armor|虎王重坦营"] },
    "装甲掷弹兵营": { de: ["de-40s-inf.js", "de|40s|inf|装甲掷弹兵营"] },
    "豹式中坦营": { de: ["de-40s-armor.js", "de|40s|armor|豹式中坦营"] },
    "超级潘兴重坦营": { us: ["us-40s-armor.js", "us|40s|armor|超级潘兴重坦营"] },
    "追猎者轻型坦歼营": { de: ["de-40s-at.js", "de|40s|at|追猎者轻型坦歼营"] },
    "野蜂自行火炮营": { de: ["de-40s-arty.js", "de|40s|arty|野蜂自行火炮营"] },
    "防御基座": { us: ["us-40s-fort.js", "us|40s|fort|防御基座"] },
    "黄蜂自行火炮营": { de: ["de-40s-arty.js", "de|40s|arty|黄蜂自行火炮营"] },
    "黄鼠狼轻型坦歼营": { de: ["de-40s-at.js", "de|40s|at|黄鼠狼轻型坦歼营"] },
    "鼠式超重坦营": { de: ["de-40s-armor.js", "de|40s|armor|鼠式超重坦营"] },
  };

  const UNIT_MODEL_ALIASES = {
    '山地营': '山地步兵营',
    '战斗工兵营': '突击工兵营',
    '海军陆战队步兵营': '海军陆战队营',
    'M13自行防空炮营': 'M15自行防空炮营',
    '运输车': '摩托化运输队',
    '野蜂自行火炮': '野蜂自行火炮营',
    '黄蜂自行火炮': '黄蜂自行火炮营',
  };

  // 与军械库的 MODEL_YAW 一致：个别模型正面反了，单独转 180°。
  const UNIT_MODEL_YAW = {
    'us|40s|air|F6战斗侦察机': Math.PI,
  };

  /* 把军械库里的 3D 单位模型渲染成透明棋子贴图；模型文件按需加载，失败时退回文字棋子。 */
  const UNIT_MODEL_STATE = {};
  const UNIT_MODEL_WAITERS = {};
  let unitModelRefreshQueued = false;
  function scheduleUnitModelRefresh() {
    if (unitModelRefreshQueued) return;
    unitModelRefreshQueued = true;
    requestAnimationFrame(function () {
      unitModelRefreshQueued = false;
      if (!B3) return;
      refreshBattle3DUnits();
      syncBattle3DHUD();
    });
  }
  const UNIT_SPRITE_CACHE = {};
  let unitSpriteRenderer = null;
  let unitSpriteBroken = false;

  function unitModelInfo(name, faction) {
    const key = UNIT_MODEL_ALIASES[name] || name;
    const entry = UNIT_MODEL_INDEX[key];
    if (!entry) return null;
    const pair = entry[faction] || entry.us || entry.de;
    if (!pair) return null;
    const parts = String(pair[1]).split('|');
    return {
      file: pair[0],
      key: pair[1],
      bag: parts.slice(0, 3).join('|'),
      faction: faction,
    };
  }

  function unitModelBag(bag) {
    return window.ARMORY_MODELS && window.ARMORY_MODELS[bag] ? window.ARMORY_MODELS[bag] : null;
  }

  /* 取某个单位的模型记录：优先“按单位分包”的数据，其次老的整体兵种包 */
  function unitModelRecord(info) {
    if (!info) return null;
    const per = window.ARMORY_UNIT_MODELS && window.ARMORY_UNIT_MODELS[info.key];
    if (per) return per;
    const bag = unitModelBag(info.bag);
    return bag ? bag[info.key] : null;
  }

  /* 缓存戳：打包时 index.html 会注入 window.__BUILD__，动态加载的脚本也带上，
   * 否则 GitHub Pages 的 max-age=600 会让改完的模型/代码在别人那儿还是旧的。 */
  function withBuild(url) {
    const v = window.__BUILD__;
    if (!v) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(v);
  }

  /* 单位索引（单位 key → 单个模型文件）。第一次要模型时才加载，只要几 KB。 */
  let unitIndexState = '';
  let unitIndexWaiters = [];

  function ensureUnitIndex(cb) {
    if (window.ARMORY_UNIT_FILES) { if (cb) cb(); return; }
    if (unitIndexState === 'loading') { unitIndexWaiters.push(cb); return; }
    if (unitIndexState === 'error') { if (cb) cb(); return; }
    unitIndexState = 'loading';
    unitIndexWaiters = [cb];
    const flush = function () {
      const q = unitIndexWaiters;
      unitIndexWaiters = [];
      q.forEach(function (fn) { try { if (fn) fn(); } catch (e) { /* ignore */ } });
    };
    const el = document.createElement('script');
    el.src = withBuild('armory-models/unit-index.js');
    el.async = true;
    el.onload = function () { unitIndexState = window.ARMORY_UNIT_FILES ? 'ready' : 'error'; flush(); };
    el.onerror = function () { unitIndexState = 'error'; flush(); };
    document.head.appendChild(el);
  }

  function loadUnitModelBag(info, cb) {
    if (!info) { if (cb) cb(); return; }
    if (unitModelRecord(info)) { if (cb) cb(); return; }
    const stateKey = info.key;
    if (UNIT_MODEL_STATE[stateKey] === 'loading') {
      (UNIT_MODEL_WAITERS[stateKey] = UNIT_MODEL_WAITERS[stateKey] || []).push(cb);
      return;
    }
    if (UNIT_MODEL_STATE[stateKey] === 'error') { if (cb) cb(); return; }
    UNIT_MODEL_STATE[stateKey] = 'loading';
    UNIT_MODEL_WAITERS[stateKey] = [cb];
    // 先保证索引到了，再按单位拿单个文件（拿不到就退回整包，保证不会缺模型）
    ensureUnitIndex(function () {
      const idx = window.ARMORY_UNIT_FILES;
      const src = idx && idx[info.key] ? idx[info.key] : ('armory-models/' + info.file);
      const s = document.createElement('script');
      s.src = withBuild(src);
      s.async = true;
      s.onload = function () {
        UNIT_MODEL_STATE[stateKey] = 'ready';
        const q = UNIT_MODEL_WAITERS[stateKey] || [];
        UNIT_MODEL_WAITERS[stateKey] = null;
        q.forEach(function (fn) { try { if (fn) fn(); } catch (e) { /* ignore */ } });
        if (B3) scheduleUnitModelRefresh();
        scheduleDraw();
      };
      s.onerror = function () {
        UNIT_MODEL_STATE[stateKey] = 'error';
        const q = UNIT_MODEL_WAITERS[stateKey] || [];
        UNIT_MODEL_WAITERS[stateKey] = null;
        q.forEach(function (fn) { try { if (fn) fn(); } catch (e) { /* ignore */ } });
        scheduleDraw();
      };
      document.head.appendChild(s);
    });
  }

  function ensureDeployModels() {
    if (!state.decks) return;
    const seen = {};
    ['attacker', 'defender'].forEach(function (side) {
      const faction = sideFaction(side);
      (state.decks[side] || []).forEach(function (name) {
        const info = unitModelInfo(name, faction);
        if (!info || seen[info.bag]) return;
        seen[info.bag] = 1;
        loadUnitModelBag(info, null);
      });
    });
  }

  function unitMapFacing() {
    const map = state.map;
    if (!map) return 0;
    // MapIO 的 facing 是 0–5 的方向下标：东 / 东北 / 西北 / 西 / 西南 / 东南。
    const n = Number(map.facing);
    if (!isFinite(n)) return 0;
    return (((Math.floor(n) % 6) + 6) % 6) * Math.PI / 3;
  }

  function prepUnitHp(name, faction) {
    const f = state.prepData && state.prepData.factions ? state.prepData.factions[faction] : null;
    const info = f && f.units ? f.units[name] : null;
    const hp = info ? Number(info.hp) : 0;
    return isFinite(hp) && hp > 0 ? hp : 6;
  }

  function prepUnitMove(name, faction) {
    const f = state.prepData && state.prepData.factions ? state.prepData.factions[faction] : null;
    const info = f && f.units ? f.units[name] : null;
    const mv = info ? Number(info.move) : 0;
    return isFinite(mv) && mv > 0 ? mv : 4;
  }

  function battleUnitHp(unit) {
    if (unit && isFinite(unit.hp) && unit.hp > 0) return Math.min(6, Math.max(1, Math.round(unit.hp)));
    return 6;
  }

  function unitFacingFor(unit) {
    // 桌游血量朝向：满 6 血朝地图默认方向；每掉 1 血逆时针转 60°。
    const hp = battleUnitHp(unit);
    return unitMapFacing() + (6 - hp) * Math.PI / 3;
  }

  function decodeUnitGeometry(b64) {
    const THREE = window.THREE;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dv = new DataView(bytes.buffer);
    const nv = dv.getUint16(0, true);
    const pos = new Float32Array(nv * 3);
    let o = 2;
    for (let i = 0; i < nv * 3; i++) {
      pos[i] = dv.getUint16(o, true) / 65535 * 2 - 1;
      o += 2;
    }
    const nidx = (bytes.length - o) >> 1;
    const idx = new Uint16Array(nidx);
    for (let i = 0; i < nidx; i++) idx[i] = dv.getUint16(o + i * 2, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    // 模型自带六边形底座：最低层就是六个底座角；用外框中心作为几何中心。
    // 不能按整个模型（含炮管/车身）的包围盒中心对齐。
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < pos.length; i += 3) {
      if (pos[i] < minZ) minZ = pos[i];
      if (pos[i] > maxZ) maxZ = pos[i];
    }
    const baseSpan = Math.max(0.0001, (maxZ - minZ) * 0.035);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sn = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 2] <= minZ + baseSpan) {
        minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
        minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
        sn++;
      }
    }
    geo.userData.baseCenter = sn
      ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
      : { x: 0, y: 0 };
    let baseRadius = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 2] <= minZ + baseSpan) {
        const dx = pos[i] - geo.userData.baseCenter.x;
        const dy = pos[i + 1] - geo.userData.baseCenter.y;
        const rr = Math.hypot(dx, dy);
        if (rr > baseRadius) baseRadius = rr;
      }
    }
    geo.userData.baseRadius = baseRadius || 0;
    return geo;
  }

  function getUnitSpriteRenderer() {
    if (unitSpriteRenderer || unitSpriteBroken) return unitSpriteRenderer;
    const THREE = window.THREE;
    if (!THREE) { unitSpriteBroken = true; return null; }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(160, 160, false);
      renderer.setClearColor(0x000000, 0);
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.88;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
      camera.position.set(0, 2.6, 3.8);
      camera.lookAt(0, 0.62, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 0.32));
      scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x2b313a, 0.20));
      const key = new THREE.DirectionalLight(0xffffff, 0.70);
      key.position.set(3.2, 5.2, 4.4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xdfe8f5, 0.26);
      fill.position.set(-3.2, 2.0, 2.0);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xe0a458, 0.10);
      rim.position.set(-1.5, 1.2, -3.2);
      scene.add(rim);

      unitSpriteRenderer = { THREE: THREE, renderer: renderer, scene: scene, camera: camera };
    } catch (e) {
      unitSpriteBroken = true;
      unitSpriteRenderer = null;
    }
    return unitSpriteRenderer;
  }

  function trimUnitSprite(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return canvas; }
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return canvas;
    const pad = 3;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
    return out;
  }

  function renderUnitSprite(rec, facing, key) {
    const vr = getUnitSpriteRenderer();
    if (!vr) return null;
    const THREE = vr.THREE;
    let geo = null, mat = null, mesh = null, group = null;
    try {
      geo = decodeUnitGeometry(rec.b64);
      mat = new THREE.MeshStandardMaterial({
        color: 0x6b7683,
        roughness: 0.92,
        metalness: 0,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      mesh = new THREE.Mesh(geo, mat);
      // 与军械库查看器相同：模型正面 +X，先 Z-up→Y-up，再转到默认朝向。
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.y = facing + (UNIT_MODEL_YAW[key] || 0);
      group = new THREE.Group();
      group.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      mesh.position.x -= center.x;
      mesh.position.z -= center.z;
      mesh.position.y -= box.min.y;
      const max = Math.max(size.x, size.z, size.y * 1.1, 0.001);
      group.scale.setScalar(1.5 / max);
      vr.scene.add(group);
      vr.renderer.render(vr.scene, vr.camera);
      const out = document.createElement('canvas');
      out.width = out.height = 160;
      const ctx = out.getContext('2d');
      ctx.drawImage(vr.renderer.domElement, 0, 0);
      return trimUnitSprite(out);
    } catch (e) {
      return null;
    } finally {
      if (group) vr.scene.remove(group);
      if (geo) geo.dispose();
      if (mat) mat.dispose();
    }
  }

  function unitModelSprite(name, faction) {
    const info = unitModelInfo(name, faction);
    if (!info) return null;
    const rec = unitModelRecord(info);
    if (!rec) {
      loadUnitModelBag(info, function () { scheduleDraw(); });
      return null;
    }
    const facing = unitMapFacing();
    const cacheKey = info.key + '|' + facing.toFixed(3);
    if (UNIT_SPRITE_CACHE[cacheKey]) return UNIT_SPRITE_CACHE[cacheKey];
    const spr = renderUnitSprite(rec, facing, info.key);
    if (spr) UNIT_SPRITE_CACHE[cacheKey] = spr;
    return spr;
  }

  function drawUnitBase(ctx, p, scale, side, selected) {
    const R = scale * 0.88;
    const pts = HG.corners(p.x, p.y, R);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = side === 'attacker' ? 'rgba(92, 34, 26, 0.94)' : 'rgba(27, 45, 75, 0.95)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.6, scale * 0.05);
    ctx.strokeStyle = selected ? '#f4d6a0' : (side === 'attacker' ? 'rgba(224, 87, 63, 0.95)' : 'rgba(74, 134, 224, 0.95)');
    ctx.stroke();
    const inner = HG.corners(p.x, p.y, R * 0.76);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      if (i === 0) ctx.moveTo(inner[i][0], inner[i][1]);
      else ctx.lineTo(inner[i][0], inner[i][1]);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawUnitModel(ctx, p, scale, unit, selected) {
    drawUnitBase(ctx, p, scale, unit.side, selected);
    const spr = unitModelSprite(unit.name, sideFaction(unit.side));
    if (spr) {
      const maxH = scale * 1.92;
      const maxW = scale * 1.72;
      const ratio = Math.min(maxW / spr.width, maxH / spr.height);
      const w = spr.width * ratio;
      const h = spr.height * ratio;
      const footY = p.y + scale * 0.16;
      ctx.drawImage(spr, p.x - w / 2, footY - h, w, h);
    } else {
      // 模型还没加载或该单位没有模型：保留一个清楚的文字棋子。
      ctx.beginPath();
      ctx.arc(p.x, p.y - scale * 0.12, Math.max(7, scale * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(12, 17, 24, 0.82)';
      ctx.fill();
      ctx.fillStyle = '#f4f6f8';
      ctx.font = '600 ' + Math.max(8, Math.round(scale * 0.24)) + 'px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(unit.name).slice(0, 2), p.x, p.y - scale * 0.10);
    }
  }

  /* =============================================================
   * 3D 作战场景（复用地图编辑器的地形图块 / 相机手感）
   * ============================================================= */

  let B3 = null;
  let B3_TILE_DATA = null;
  let B3_TILE_GEOS = null;

  function b64Bytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function b3TileData() {
    if (B3_TILE_DATA) return B3_TILE_DATA;
    const MODEL = window.BQ3D;
    if (!MODEL || !MODEL.data) return null;
    const bytes = b64Bytes(MODEL.data);
    const dv = new DataView(bytes.buffer);
    let o = 4;
    const version = dv.getUint8(o); o += 1;
    const n = dv.getUint8(o); o += 1;
    const tiles = {};
    for (let i = 0; i < n; i++) {
      const nameLen = dv.getUint8(o); o += 1;
      let name = '';
      for (let k = 0; k < nameLen; k++) name += String.fromCharCode(bytes[o + k]);
      o += nameLen;
      const vcount = dv.getUint32(o, true); o += 4;
      const tcount = dv.getUint32(o, true); o += 4;
      const wide = dv.getUint8(o); o += 1;
      const pos = new Float32Array(bytes.slice(o, o + vcount * 12).buffer); o += vcount * 12;
      const nrm = new Float32Array(bytes.slice(o, o + vcount * 12).buffer); o += vcount * 12;
      const ib = wide ? 4 : 2;
      const idxBytes = bytes.slice(o, o + tcount * 3 * ib); o += tcount * 3 * ib;
      const idx = wide ? new Uint32Array(idxBytes.buffer) : new Uint16Array(idxBytes.buffer);
      tiles[name] = { positions: pos, normals: nrm, indices: idx, version: version };
    }
    B3_TILE_DATA = tiles;
    return tiles;
  }

  function b3TileGeometries() {
    if (B3_TILE_GEOS) return B3_TILE_GEOS;
    const THREE = window.THREE;
    const data = b3TileData();
    const out = {};
    if (!THREE || !data) return out;
    Object.keys(data).forEach(function (id) {
      const td = data[id];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(td.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(td.normals, 3));
      g.setIndex(new THREE.BufferAttribute(td.indices, 1));
      g.rotateX(-Math.PI / 2);
      g.computeBoundingSphere();
      out[id] = g;
    });
    B3_TILE_GEOS = out;
    return out;
  }

  let battleChoiceDragBound = false;

  function bindBattleChoiceDrag() {
    if (battleChoiceDragBound) return;
    const box = el('battle-choice');
    if (!box) return;
    battleChoiceDragBound = true;
    let drag = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button,input,select,textarea,a')) return;
      const parent = box.offsetParent || box.parentElement;
      if (!parent) return;
      const pr = parent.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      drag = { dx: e.clientX - br.left, dy: e.clientY - br.top, parent: parent };
      if (box.setPointerCapture) {
        try { box.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      e.preventDefault();
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag) return;
      const pr = drag.parent.getBoundingClientRect();
      let x = e.clientX - pr.left - drag.dx;
      let y = e.clientY - pr.top - drag.dy;
      x = Math.max(4, Math.min(pr.width - box.offsetWidth - 4, x));
      y = Math.max(4, Math.min(pr.height - box.offsetHeight - 4, y));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    });
    const end = function () { drag = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('lostpointercapture', end);
  }

  function ensureBattle3D() {
    const canvas = el('online-battle3d');
    if (!canvas || !window.THREE) return null;
    bindBattleChoiceDrag();
    if (B3) return B3;
    const THREE = window.THREE;
    const MODEL = window.BQ3D;
    if (!MODEL) return null;

    try {
      const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      // 2 倍屏上 1.5 已经够清晰，渲染像素少 44%，核显差别很大
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      if (THREE.ColorManagement) {
        if ('enabled' in THREE.ColorManagement) THREE.ColorManagement.enabled = true;
        if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
      }
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      // PCF 比 PCFSoft 便宜很多，阴影边缘略硬，但地图上看不出来
      renderer.shadowMap.type = THREE.PCFShadowMap;
      // 场景是静态的：只有单位/建筑变化时才重算阴影贴图，转视角/平移不再重算
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;   // 第一帧先算一次

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x171b21);

      const camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
      const hemi = new THREE.HemisphereLight(0xd6e4f5, 0x2a2620, 0.18);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xfff3e2, 0.95);
      key.position.set(120, 150, 90);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      key.shadow.bias = -0.0008;
      key.shadow.normalBias = 0.5;
      scene.add(key);
      scene.add(key.target);
      const rim = new THREE.DirectionalLight(0x9cbcff, 0.16);
      rim.position.set(-160, 70, -150);
      scene.add(rim);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: 0x30363e, roughness: 0.95, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.6;
      ground.receiveShadow = true;
      scene.add(ground);

      const boardGroup = new THREE.Group();
      const zoneGroup = new THREE.Group();
      const flagGroup = new THREE.Group();
      const eligibleGroup = new THREE.Group();
      const unitsGroup = new THREE.Group();
      const ghostGroup = new THREE.Group();
      const floatGroup = new THREE.Group();
      const apGroup = new THREE.Group();
      const airGroup = new THREE.Group();
      const confusionGroup = new THREE.Group();
      const flightGroup = new THREE.Group();
      const aaGroup = new THREE.Group();
      const buildingGroup = new THREE.Group();
      const buildingGhostGroup = new THREE.Group();
      const buildingProjectGroup = new THREE.Group();
      const rangeGroup = new THREE.Group();
      const moveRangeGroup = new THREE.Group();
      const bombHintGroup = new THREE.Group();
      const counterBatteryGroup = new THREE.Group();
      scene.add(boardGroup);
      scene.add(zoneGroup);
      scene.add(flagGroup);
      scene.add(eligibleGroup);
      scene.add(unitsGroup);
      scene.add(ghostGroup);
      scene.add(floatGroup);
      scene.add(apGroup);
      scene.add(airGroup);
      scene.add(confusionGroup);
      scene.add(flightGroup);
      scene.add(aaGroup);
      scene.add(buildingGroup);
      scene.add(buildingGhostGroup);
      scene.add(buildingProjectGroup);
      scene.add(rangeGroup);
      scene.add(moveRangeGroup);
      scene.add(bombHintGroup);
      scene.add(counterBatteryGroup);

      B3 = {
        canvas: canvas,
        renderer: renderer,
        scene: scene,
        camera: camera,
        key: key,
        lights: { hemi: hemi, key: key, rim: rim },
        ground: ground,
        boardGroup: boardGroup,
        zoneGroup: zoneGroup,
        flagGroup: flagGroup,
        eligibleGroup: eligibleGroup,
        unitsGroup: unitsGroup,
        ghostGroup: ghostGroup,
        floatGroup: floatGroup,
        apGroup: apGroup,
        airGroup: airGroup,
        confusionGroup: confusionGroup,
        flightGroup: flightGroup,
        aaGroup: aaGroup,
        buildingGroup: buildingGroup,
        buildingGhostGroup: buildingGhostGroup,
        buildingProjectGroup: buildingProjectGroup,
        rangeGroup: rangeGroup,
        moveRangeGroup: moveRangeGroup,
        bombHintGroup: bombHintGroup,
        counterBatteryGroup: counterBatteryGroup,
        floats: [],
        flights: [],
        tileMeshes: [],
        cam: { yaw: 0, pitch: 0.86, dist: 320, tx: 0, ty: 0, tz: 0 },
        mapRef: null,
        need: true,
        width: 0,
        height: 0,
        everSized: false,
        unitGeoCache: {},
        buildingGeoCache: {},
        unitMats: {
          us: new THREE.MeshStandardMaterial({
            color: 0x0000ff, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide,
          }),
          de: new THREE.MeshStandardMaterial({
            color: 0x50565e, roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide,
          }),
        },
        hovered: null,
        hexBaseGeo: null,
        hexPlateGeo: null,
        drag: null,
        spaceDown: false,
        keys: { w: false, a: false, s: false, d: false },
        lastFrame: 0,
        raf: 0,
      };


      b3ApplyDayNight();
      bindBattle3DControls();
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(function () { resizeBattle3D(); });
        ro.observe(canvas.parentElement || canvas);
        B3.ro = ro;
      }
      window.addEventListener('resize', resizeBattle3D);
      const loop = function () {
        if (!B3) return;
        const now = performance.now();
        const dt = B3.lastFrame ? Math.min(0.06, (now - B3.lastFrame) / 1000) : 0;
        B3.lastFrame = now;
        if (dt && B3.keys && (B3.keys.w || B3.keys.a || B3.keys.s || B3.keys.d)) {
          b3KeyboardPan(dt);
        }
        if (B3.floats && B3.floats.length) b3UpdateFloats(performance.now());
        if (B3.flights && B3.flights.length) b3UpdateAirFlights(performance.now());
        if (B3.need) {
          B3.need = false;
          if (B3.shadowDirty) {
            B3.shadowDirty = false;
            B3.renderer.shadowMap.needsUpdate = true;
          }
          try { B3.renderer.render(B3.scene, B3.camera); } catch (e) { /* ignore */ }
        }
        B3.raf = requestAnimationFrame(loop);
      };
      B3.raf = requestAnimationFrame(loop);
      return B3;
    } catch (e) {
      return null;
    }
  }

  function b3Layout() {
    const M = window.BQ3D;
    if (!M || !state.map) return null;
    const HEXR = M.hexR, PITCH = M.pitch, ROWH = M.rowHeight;
    const OX = -PITCH * (state.map.cols - 0.5) / 2;
    const OZ = ROWH * (state.map.rows - 1) / 2;
    return {
      HEXR: HEXR, PITCH: PITCH, ROWH: ROWH, TOP: M.top,
      OX: OX, OZ: OZ,
      cell: function (c, r) {
        const p = HG.center(c, r, HEXR);
        return [p[0] + OX, -p[1] + OZ];
      },
    };
  }

  function b3HexPlateGeo() {
    if (B3.hexPlateGeo) return B3.hexPlateGeo;
    const L = b3Layout();
    const THREE = window.THREE;
    if (!L || !THREE) return null;
    const pts = HG.corners(0, 0, L.HEXR * 0.93);
    const shape = new THREE.Shape();
    pts.forEach(function (p, i) { if (i === 0) shape.moveTo(p[0], p[1]); else shape.lineTo(p[0], p[1]); });
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    B3.hexPlateGeo = geo;
    return geo;
  }

  function b3HexBaseGeo() {
    if (B3.hexBaseGeo) return B3.hexBaseGeo;
    const L = b3Layout();
    const THREE = window.THREE;
    if (!L || !THREE) return null;
    const pts = HG.corners(0, 0, L.HEXR * 0.85);
    const shape = new THREE.Shape();
    pts.forEach(function (p, i) { if (i === 0) shape.moveTo(p[0], p[1]); else shape.lineTo(p[0], p[1]); });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    B3.hexBaseGeo = geo;
    return geo;
  }

  function b3ClearGroup(group) {
    group.traverse(function (obj) {
      if (obj.material && obj.material._b3Dispose) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
        obj.material._b3Dispose = false;
      }
      if (obj.geometry && obj.geometry.userData && obj.geometry.userData.b3Dispose) {
        obj.geometry.dispose();
        obj.geometry.userData.b3Dispose = false;
      }
    });
    while (group.children.length) group.remove(group.children[0]);
  }

  function buildBattle3D() {
    const b = ensureBattle3D();
    if (!b || !state.map) return;
    const THREE = window.THREE;
    const M = window.BQ3D;
    const L = b3Layout();
    if (!M || !L) return;

    b3ClearGroup(b.boardGroup);
    b3ClearGroup(b.zoneGroup);
    b3ClearGroup(b.flagGroup);
    b3ClearGroup(b.eligibleGroup);
    b3ClearGroup(b.ghostGroup);
    b.tileMeshes = [];

    const geos = b3TileGeometries();
    const maxCount = Math.max(1, state.map.cols * state.map.rows);
    TERRAINS.forEach(function (t, i) {
      const geo = geos[t.id];
      if (!geo) return;
      const mat = new THREE.MeshStandardMaterial({
        color: t.color3d != null ? t.color3d : 0x9aa5b2,
        roughness: 0.78,
        metalness: 0.02,
      });
      mat._b3Dispose = true;
      const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
      // 地图块不投阴影：它们本身几乎贴地，影子看不出来，但阴影 pass 要重画上百万面
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      b.boardGroup.add(mesh);
      b.tileMeshes[i] = mesh;
    });

    const counts = new Array(TERRAINS.length).fill(0);
    const mtx = new THREE.Matrix4();
    for (let r = 0; r < state.map.rows; r++) {
      for (let c = 0; c < state.map.cols; c++) {
        const tid = state.map.cells[r * state.map.cols + c];
        const mesh = b.tileMeshes[tid];
        if (!mesh) continue;
        const n = counts[tid]++;
        const p = L.cell(c, r);
        mtx.makeTranslation(p[0], 0, p[1]);
        mesh.setMatrixAt(n, mtx);
      }
    }
    b.tileMeshes.forEach(function (mesh, i) {
      if (!mesh) return;
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
    });

    const bw = L.PITCH * (state.map.cols + 0.5);
    const bh = L.ROWH * state.map.rows + L.HEXR * 2;
    const span = Math.max(bw, bh) * 1.6;
    b.ground.geometry.dispose();
    b.ground.geometry = new THREE.PlaneGeometry(span * 2.4, span * 2.4);
    const s = Math.max(bw, bh) * 0.9;
    b.key.shadow.camera.left = -s;
    b.key.shadow.camera.right = s;
    b.key.shadow.camera.top = s;
    b.key.shadow.camera.bottom = -s;
    b.key.shadow.camera.near = 1;
    b.key.shadow.camera.far = 1600;
    b.key.shadow.camera.updateProjectionMatrix();
    b.key.position.set(s * 1.1, s * 1.9, s * 0.9);
    b.key.target.position.set(0, 0, 0);

    // 守方部署区：淡蓝色高亮
    const zone = state.map.mode === 'attack' && state.map.deploy ? state.map.deploy.zone : null;
    if (zone && zone.size) {
      const plate = b3HexPlateGeo();
      const zmat = new THREE.MeshBasicMaterial({
        color: 0x4a86e0, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide,
      });
      zmat._b3Dispose = true;
      const zim = new THREE.InstancedMesh(plate, zmat, zone.size);
      let n = 0;
      zone.forEach(function (idx) {
        const c = idx % state.map.cols, r = Math.floor(idx / state.map.cols);
        const p = L.cell(c, r);
        mtx.makeTranslation(p[0], L.TOP + 0.25, p[1]);
        zim.setMatrixAt(n++, mtx);
      });
      zim.count = n;
      b.zoneGroup.add(zim);
    }

    // 出兵点 / 指挥部旗
    const d = state.map.deploy || {};
    function addFlag(p, color, kind) {
      if (!p) return;
      const w = L.cell(p.c, p.r);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 7, 6),
        new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 0.8 })
      );
      pole.position.y = L.TOP + 3.5;
      g.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(kind === 'hq' ? 4.2 : 3.8, kind === 'hq' ? 2.4 : 2.0),
        new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide })
      );
      flag.position.set(kind === 'hq' ? 2.1 : 1.9, L.TOP + 6.0, 0);
      g.add(flag);
      g.position.set(w[0], 0, w[1]);
      b.flagGroup.add(g);
    }
    addFlag(d.spawn, 0xe0573f, 'spawn');
    addFlag(d.hqA, 0xe0a458, 'hq');
    addFlag(d.hqD, 0x4a86e0, 'hq');

    b.mapRef = state.map;
    fitBattle3D();
    refreshBattle3DUnits();
    b.need = true;
  }

  function updateBattle3DCamera() {
    if (!B3) return;
    const c = B3.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    B3.camera.position.set(
      c.tx + c.dist * cp * Math.sin(c.yaw),
      c.ty + c.dist * sp,
      c.tz + c.dist * cp * Math.cos(c.yaw)
    );
    B3.camera.lookAt(c.tx, c.ty, c.tz);
  }

  function fitBattle3D() {
    if (!B3 || !state.map) return;
    const THREE = window.THREE;
    const L = b3Layout();
    if (!L) return;
    const c = B3.cam;
    c.tx = 0; c.ty = 0; c.tz = 0;
    const bw = L.PITCH * (state.map.cols + 0.5 + 12);
    const bh = L.ROWH * state.map.rows + L.HEXR * 2;
    let dist = Math.max(bw, bh) * 1.45;
    const corners = [
      [-bw / 2, L.TOP, -bh / 2], [bw / 2, L.TOP, bh / 2],
      [-bw / 2, L.TOP, bh / 2], [bw / 2, L.TOP, -bh / 2],
    ];
    const v = new THREE.Vector3();
    for (let it = 0; it < 5; it++) {
      c.dist = dist;
      updateBattle3DCamera();
      B3.camera.updateMatrixWorld(true);
      let k = 0;
      corners.forEach(function (p) {
        v.set(p[0], p[1], p[2]).project(B3.camera);
        k = Math.max(k, Math.abs(v.x), Math.abs(v.y));
      });
      if (!isFinite(k) || k <= 0.001) break;
      dist = dist * (k / 0.9);
    }
    c.dist = Math.max(45, Math.min(1400, dist * 1.05));
    updateBattle3DCamera();
    B3.need = true;
  }

  function resizeBattle3D() {
    if (!B3) return;
    const canvas = B3.canvas;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    B3.width = w; B3.height = h;
    B3.renderer.setSize(w, h, false);
    B3.camera.aspect = w / h;
    B3.camera.updateProjectionMatrix();
    if (!B3.everSized) {
      B3.everSized = true;
      fitBattle3D();
    }
    B3.need = true;
  }

  function b3PickCell(clientX, clientY) {
    if (!B3 || !state.map) return null;
    const THREE = window.THREE;
    const rect = B3.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, B3.camera);
    const L = b3Layout();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(L.TOP + 1));
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const X = hit.x - L.OX;
    const Y = L.OZ - hit.z;
    const p = HG.pixelToCell(X, Y, L.HEXR);
    const c = Math.round(p[0]), r = Math.round(p[1]);
    if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return null;
    return { c: c, r: r };
  }

  function b3CellScreenPoint(c, r) {
    if (!B3 || !state.map) return null;
    const THREE = window.THREE;
    const L = b3Layout();
    if (!L) return null;
    const w = L.cell(c, r);
    const v = new THREE.Vector3(w[0], L.TOP + 2, w[1]).project(B3.camera);
    const rect = B3.canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  function bindBattle3DControls() {
    const canvas = B3.canvas;
    let down = null;
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (B3) B3.lastPointer = { x: e.clientX, y: e.clientY };
      if (e.altKey || e.button === 2) {
        B3.drag = {
          mode: e.button === 2 ? 'right' : 'orbit',
          x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false,
        };
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 1 || (e.button === 0 && (B3.spaceDown || e.shiftKey))) {
        B3.drag = { mode: 'pan', x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0) {
        down = { x: e.clientX, y: e.clientY, moved: false };
        B3.drag = { mode: 'click', x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (B3) B3.lastPointer = { x: e.clientX, y: e.clientY };
      const d = B3 && B3.drag;
      if (!d) {
        b3HoverAt(e.clientX, e.clientY);
        if (state.buildMode) b3UpdateBuildingGhost(e.clientX, e.clientY);
        return;
      }
      if (d.mode === 'orbit' || d.mode === 'right' || d.mode === 'pan') b3SetUnitHover(null);
      if (d.mode === 'orbit' || d.mode === 'right') {
        if (d.mode === 'right' && !d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
        if (d.mode === 'right' && !d.moved) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        B3.cam.yaw -= dx * 0.007;
        B3.cam.pitch = Math.max(0.12, Math.min(1.52, B3.cam.pitch + dy * 0.006));
        d.x = e.clientX; d.y = e.clientY;
        updateBattle3DCamera();
        B3.need = true;
      } else if (d.mode === 'pan') {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        b3Pan(dx, dy);
        d.x = e.clientX; d.y = e.clientY;
        updateBattle3DCamera();
        B3.need = true;
      } else if (d.mode === 'click' && down) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
      }
    });
    canvas.addEventListener('pointerup', function (e) {
      const drag = B3 && B3.drag;
      const cell = b3PickCell(e.clientX, e.clientY);
      const picked = b3PickUnitAt(e.clientX, e.clientY);
      if (drag && drag.mode === 'click' && down && !down.moved) {
        if (state.phase === 'battle' && state.battle) {
          if (picked && (picked.airBase || !cell)) battleClickAt(picked.c, picked.r, 'left');
          else if (cell) battleClickAt(cell.c, cell.r, 'left');
        } else if (cell) deployPlaceAt(cell.c, cell.r);
      } else if (drag && drag.mode === 'right' && !drag.moved) {
        if (state.phase === 'battle' && state.battle) {
          if (picked && (picked.airBase || !cell)) battleClickAt(picked.c, picked.r, 'right');
          else if (cell) battleClickAt(cell.c, cell.r, 'right');
        }
      }
      down = null;
      if (B3) B3.drag = null;
      canvas.style.cursor = 'grab';
      if (B3) b3HoverAt(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', function () {
      if (B3 && !B3.drag) b3SetUnitHover(null);
      b3SetBuildingHover(null);
      b3ClearBuildingGhost();
    });
    canvas.addEventListener('pointercancel', function () {
      down = null;
      if (B3) B3.drag = null;
      canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!B3) return;
      B3.cam.dist = Math.max(45, Math.min(1400, B3.cam.dist * Math.exp(e.deltaY * 0.0012)));
      updateBattle3DCamera();
      B3.need = true;
    }, { passive: false });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) {
        if (B3) B3.spaceDown = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space' && B3) B3.spaceDown = false;
    });
    const moveCode = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
    window.addEventListener('keydown', function (e) {
      if (!B3 || state.phase !== 'battle') return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      const k = moveCode[e.code];
      if (!k) return;
      B3.keys[k] = true;
      e.preventDefault();
    }, true);
    window.addEventListener('keyup', function (e) {
      if (!B3) return;
      const k = moveCode[e.code];
      if (!k) return;
      B3.keys[k] = false;
    }, true);
    window.addEventListener('blur', function () {
      if (!B3 || !B3.keys) return;
      B3.keys.w = B3.keys.a = B3.keys.s = B3.keys.d = false;
    });
  }

  function b3KeyboardPan(dt) {
    if (!B3 || !B3.cam || !B3.keys) return;
    const c = B3.cam;
    const forward = (B3.keys.w ? 1 : 0) - (B3.keys.s ? 1 : 0);
    const strafe = (B3.keys.d ? 1 : 0) - (B3.keys.a ? 1 : 0);
    if (!forward && !strafe) return;
    const s = c.dist * 1.15 * Math.max(0, Math.min(0.06, dt));
    c.tx += (-Math.sin(c.yaw) * forward + Math.cos(c.yaw) * strafe) * s;
    c.tz += (-Math.cos(c.yaw) * forward - Math.sin(c.yaw) * strafe) * s;
    updateBattle3DCamera();
    B3.need = true;
  }

  function b3Pan(dx, dy) {
    if (!B3) return;
    const THREE = window.THREE;
    const c = B3.cam;
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const viewH = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const s = c.dist * 0.0016;
    c.tx += (-right.x * dx + viewH.x * dy) * s;
    c.tz += (-right.z * dx + viewH.z * dy) * s;
  }

  function b3UnitMesh(name, faction, hp) {
    const b = B3;
    if (!b) return null;
    const info = unitModelInfo(name, faction);
    if (!info) return null;
    const rec = unitModelRecord(info);
    if (!rec) {
      loadUnitModelBag(info, function () {
        if (B3) scheduleUnitModelRefresh();
      });
      return null;
    }
    const THREE = window.THREE;
    let geo = b.unitGeoCache[info.key];
    if (!geo) {
      try { geo = decodeUnitGeometry(rec.b64); } catch (e) { return null; }
      b.unitGeoCache[info.key] = geo;
    }
    const mat = (b.unitMats[faction] || b.unitMats.de).clone();
    mat._b3Dispose = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.b3Mesh = true;
    mesh.userData.b3Model = true;
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = -Math.PI / 2;
    const modelYaw = unitFacingFor({ hp: hp }) + (UNIT_MODEL_YAW[info.key] || 0);
    mesh.rotation.y = modelYaw;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.z, size.y * 1.1, 0.001);
    const baseR = (geo.userData && geo.userData.baseRadius) || 0;
    // 所有单位按“自带六边形底座”统一缩放；车身/炮管长短不再影响底座大小。
    const s = baseR > 0.0001
      ? (b3Layout().HEXR * 0.80) / baseR
      : (b3Layout().HEXR * 1.55) / max;
    mesh.scale.setScalar(s);
    const bc = (geo.userData && geo.userData.baseCenter) || { x: 0, y: 0 };
    // 底座局部中心要先跟着模型朝向旋转，再反向平移，否则偏心的炮座（如德军 105 炮）会歪。
    const ca = Math.cos(modelYaw), sa = Math.sin(modelYaw);
    mesh.position.x = -(bc.x * ca - bc.y * sa) * s;
    mesh.position.z = (bc.x * sa + bc.y * ca) * s;
    const box2 = new THREE.Box3().setFromObject(mesh);
    mesh.position.y -= box2.min.y;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  function b3NumberSprite(text) {
    const THREE = window.THREE;
    const L = b3Layout();
    if (!THREE || !L) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.font = '700 76px "Consolas", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(8, 12, 18, 0.95)';
    g.strokeText(String(text), 64, 68);
    g.fillStyle = '#ffd79a';
    g.fillText(String(text), 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    mat._b3Dispose = true;
    const sp = new THREE.Sprite(mat);
    sp.scale.set(L.HEXR * 1.7, L.HEXR * 1.7, 1);
    sp.position.y = L.TOP + L.HEXR * 2.35;
    sp.userData.b3Dispose = true;
    return sp;
  }

  function buildBattle3DUnit(unit) {
    const L = b3Layout();
    if (!L) return null;
    const THREE = window.THREE;
    const faction = sideFaction(unit.side);
    const g = new THREE.Group();
    const w = unit.airBase ? airPadWorld(unit.side, unit.c, unit.r) : L.cell(unit.c, unit.r);
    let unitLift = 0;
    if (!unit.airBase && state.battle) {
      const bb = battleBuildingAt(unit.c, unit.r);
      if (bb) {
        const bm = b3BuildingMesh(bb.t);
        if (bm && isFinite(bm.userData.b3DeckY)) {
          unitLift = Math.max(0, bm.userData.b3DeckY - (L.TOP - 0.28));
        }
      }
    }
    g.position.set(w[0], unitLift, w[1]);
    g.userData.b3Unit = unit;
    g.userData.b3BaseY = unitLift;

    // 不再额外加整块托盘：模型自带六边形底座，直接落在地图格凹槽里。
    const model = b3UnitMesh(unit.name, faction, unit.hp);
    let transportTop = L.TOP + 3.0;
    if (model) {
      model.position.y += L.TOP - 0.28;
      g.add(model);
      try {
        const box = new THREE.Box3().setFromObject(model);
        if (isFinite(box.max.y)) transportTop = Math.max(L.TOP + 2.2, box.max.y + 0.15);
      } catch (err) { /* keep fallback */ }
    } else {
      const fbMat = new THREE.MeshStandardMaterial({
        color: faction === 'us' ? 0x163fb7 : 0x50565e, roughness: 0.8,
      });
      fbMat._b3Dispose = true;
      const fb = new THREE.Mesh(
        new THREE.CylinderGeometry(L.HEXR * 0.32, L.HEXR * 0.42, 3.6, 6),
        fbMat
      );
      fb.position.y = L.TOP + 1.2;
      fb.userData.b3Model = true;
      g.add(fb);
      transportTop = L.TOP + 3.2;
    }
    if (!unit.airBase && battleTrait(unit, 'transport')) {
      const cargo = unit.carryingId ? battleUnitById(unit.carryingId) : null;
      if (cargo && cargo.embarked) {
        const cm = b3UnitMesh(cargo.name, sideFaction(cargo.side), cargo.hp);
        if (cm) {
          cm.scale.multiplyScalar(0.85);
          cm.updateMatrixWorld(true);
          let cargoBottom = 0;
          try {
            const cb = new THREE.Box3().setFromObject(cm);
            if (isFinite(cb.min.y)) cargoBottom = cb.min.y;
          } catch (err) { /* keep fallback */ }
          cm.position.y += (transportTop - 0.55) - cargoBottom;
          cm.userData.b3Model = true;
          g.add(cm);
        }
      }
    }
    const battle = state.phase === 'battle' ? state.battle : null;
    const spent = !!(battle && unit.alive && battleMySide() && unit.side === battleMySide() &&
      (Number(unit.mp) <= 0 || unit.pushLocked || unit.actionLocked));
    if (spent) {
      const gray = new THREE.Color(0x747b82);
      g.traverse(function (obj) {
        if (!obj.isMesh || !obj.userData || !obj.userData.b3Model || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(function (mat) {
          if (mat.color && mat.color.lerp) mat.color.lerp(gray, 0.72);
          mat.transparent = true;
          mat.opacity = Math.min(Number(mat.opacity) || 1, 0.48);
          mat.depthWrite = false;
          mat.needsUpdate = true;
        });
      });
    }
    const selectedId = battle ? battle.selectedId : null;
    const selectedUnit = battle && selectedId ? battleUnitById(selectedId) : null;
    const localSide = battleMySide();
    const selectedLocal = !!(selectedUnit && localSide && selectedUnit.side === localSide);
    const selectedThis = battle
      ? (selectedId === unit.id && selectedLocal)
      : (state.deploySel === unit.name && !state.deploy.ready[unit.side]);
    const inRange = !!(battle && selectedLocal && selectedUnit.side !== unit.side && unit.alive &&
      ((battleHexDistance(selectedUnit.c, selectedUnit.r, unit.c, unit.r) <= BATTLE_RANGE &&
        battleUnitCanSee(selectedUnit, unit)) ||
       battleArtilleryCanTarget(selectedUnit, unit)));
    const counterPick = !!(battle && battle.counter && battle.counter.chooserSide === localSide &&
      battle.counter.targetIds.indexOf(unit.id) !== -1);
    let ringColor = 0;
    if (selectedThis) ringColor = 0x8fffb0;
    else if (inRange) ringColor = 0xff5a3c;
    else if (counterPick) ringColor = 0x1e40ff;
    if (ringColor && THREE) {
      [0.84, 0.90, 0.96, 1.02].forEach(function (r) {
        const pts = HG.corners(0, 0, L.HEXR * r).map(function (p) {
          return new THREE.Vector3(p[0], L.TOP + 0.46, -p[1]);
        });
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: ringColor, transparent: true, opacity: 1, depthTest: false,
          })
        );
        line.material._b3Dispose = true;
        line.renderOrder = 20;
        g.add(line);
      });
      // 外圈淡光，远看也能分辨
      const glowPts = HG.corners(0, 0, L.HEXR * 1.08).map(function (p) {
        return new THREE.Vector3(p[0], L.TOP + 0.46, -p[1]);
      });
      const glow = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(glowPts),
        new THREE.LineBasicMaterial({ color: ringColor, transparent: true, opacity: 0.45, depthTest: false })
      );
      glow.material._b3Dispose = true;
      glow.renderOrder = 19;
      g.add(glow);
    }
    if (selectedThis && battle) {
      const num = b3NumberSprite(unit.mp);
      if (num) {
        num.userData.b3Dispose = true;
        g.add(num);
      }
    }
    return g;
  }

  function b3ApplyDayNight() {
    if (!B3 || !B3.lights) return;
    const night = battleIsNight();
    B3.lights.hemi.intensity = night ? 0.06 : 0.18;
    B3.lights.key.intensity = night ? 0.34 : 0.95;
    B3.lights.rim.intensity = night ? 0.05 : 0.16;
    if (B3.lights.hemi.color) B3.lights.hemi.color.setHex(night ? 0x6b83a8 : 0xd6e4f5);
    if (B3.lights.hemi.groundColor) B3.lights.hemi.groundColor.setHex(night ? 0x080b10 : 0x2a2620);
    if (B3.lights.key.color) B3.lights.key.color.setHex(night ? 0x9db7e8 : 0xfff3e2);
    if (B3.lights.rim.color) B3.lights.rim.color.setHex(night ? 0x5577b8 : 0x9cbcff);
    if (B3.scene && B3.scene.background && B3.scene.background.setHex) {
      B3.scene.background.setHex(night ? 0x0b0e13 : 0x171b21);
    }
    B3.need = true;
  }

  function b3SetUnitHover(g) {
    if (!B3 || B3.hovered === g) return;
    const old = B3.hovered;
    B3.hovered = g;
    if (old) {
      old.position.y = old.userData.b3BaseY || 0;
      old.traverse(function (obj) {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = false;
          obj.material.opacity = 1;
          obj.material.depthWrite = true;
          obj.material.needsUpdate = true;
        }
      });
    }
    if (g) {
      g.position.y = (g.userData.b3BaseY || 0) + 2.1;
      g.traverse(function (obj) {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = 0.22;
          obj.material.depthWrite = false;
          obj.material.needsUpdate = true;
        }
      });
    }
    refreshBattle3DRangeHint();
    B3.need = true;
  }

  function b3SetBuildingHover(mesh) {
    if (!B3 || B3.hoveredBuilding === mesh) return;
    const old = B3.hoveredBuilding;
    if (old && old.material) {
      old.material.transparent = false;
      old.material.opacity = 1;
      old.material.depthWrite = true;
      old.material.needsUpdate = true;
      old.position.y = old.userData.b3BaseY || old.position.y;
    }
    B3.hoveredBuilding = mesh || null;
    if (mesh) {
      mesh.userData.b3BaseY = mesh.position.y;
      mesh.material.transparent = true;
      mesh.material.opacity = 0.24;
      mesh.material.depthWrite = false;
      mesh.material.needsUpdate = true;
      mesh.position.y = mesh.userData.b3BaseY + 2.1;
    }
    B3.need = true;
  }

  function b3HoverAt(clientX, clientY) {
    if (!B3 || !state.map || B3.drag) return;
    const THREE = window.THREE;
    const rect = B3.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, B3.camera);
    const hits = ray.intersectObjects(B3.unitsGroup.children, true);
    let found = null;
    for (let i = 0; i < hits.length; i++) {
      let p = hits[i].object;
      while (p && !p.userData.b3Unit) p = p.parent;
      if (p && p.userData.b3Unit) { found = p; break; }
    }
    b3SetUnitHover(found);
    if (found) {
      // 单位站在建筑上时，悬停单位也要把脚下建筑一起虚化抬起。
      let bmesh = null;
      const u = found.userData.b3Unit;
      if (u && B3.buildingGroup) {
        B3.buildingGroup.children.forEach(function (m) {
          const bb = m.userData && m.userData.b3Building;
          if (bb && bb.c === u.c && bb.r === u.r) bmesh = m;
        });
      }
      b3SetBuildingHover(bmesh);
    } else if (B3.buildingGroup) {
      const bhits = ray.intersectObjects(B3.buildingGroup.children, true);
      let bfound = null;
      for (let i = 0; i < bhits.length; i++) {
        let p = bhits[i].object;
        while (p && !p.userData.b3Building) p = p.parent;
        if (p && p.userData.b3Building) { bfound = p; break; }
      }
      b3SetBuildingHover(bfound);
    }
    if (found && state.battle && state.battle.counter &&
        state.battle.counter.targetIds.indexOf(found.userData.b3Unit.id) !== -1) {
      const cu = battleUnitById(state.battle.counter.counterUnitId);
      const calc = cu ? battleCounterRaw(cu, found.userData.b3Unit) : { raw: 0 };
      battleShowTip(clientX, clientY, (cu ? cu.name : '被攻击单位') + ' 反击预计 -' + battleFmt(calc.raw));
    } else {
      battleShowTip(clientX, clientY, '');
    }
  }

  function b3PickUnitAt(clientX, clientY) {
    if (!B3 || !state.map) return null;
    const THREE = window.THREE;
    const rect = B3.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, B3.camera);
    const hits = ray.intersectObjects(B3.unitsGroup.children, true);
    for (let i = 0; i < hits.length; i++) {
      let p = hits[i].object;
      while (p && !p.userData.b3Unit) p = p.parent;
      if (p && p.userData.b3Unit) return p.userData.b3Unit;
    }
    return null;
  }

  function refreshBattle3DApRings() {
    if (!B3 || !B3.apGroup) return;
    b3ClearGroup(B3.apGroup);
    const b = state.battle;
    if (!b || !b.selectedId) return;
    const unit = battleUnitById(b.selectedId);
    if (!unit || !unit.alive) return;
    if (!battleMySide() || unit.side !== battleMySide()) return;
    const info = battleInfoFor(unit);
    const L = b3Layout();
    const THREE = window.THREE;
    if (!info || !L || !THREE) return;
    const urban = !!(battleTerrainRule(unit.c, unit.r) && battleTerrainRule(unit.c, unit.r).urban);
    const key1 = urban ? 'urban' : 'r1';
    const ap1 = Number(info.ap && info.ap[key1]) || 0;
    const ap2 = Number(info.ap && info.ap.r2) || 0;
    const cellsAt = function (d) {
      const out = [];
      for (let r = 0; r < state.map.rows; r++) {
        for (let c = 0; c < state.map.cols; c++) {
          if (battleHexDistance(unit.c, unit.r, c, r) === d) out.push({ c: c, r: r });
        }
      }
      return out;
    };
    const rings = [
      { d: 1, color: 0x7fe7ff, ap: ap1, name: urban ? '巷战穿甲' : '射程1穿甲' },
      { d: 2, color: 0x3e9bd6, ap: ap2, name: '射程2穿甲' },
    ];
    rings.forEach(function (ring) {
      const cells = cellsAt(ring.d);
      cells.forEach(function (p) {
        const pts = HG.corners(0, 0, L.HEXR * 0.76).map(function (q) {
          return new THREE.Vector3(q[0], L.TOP + 0.18, -q[1]);
        });
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: ring.color, transparent: true, opacity: ring.d === 1 ? 0.62 : 0.32, depthTest: false,
          })
        );
        line.material._b3Dispose = true;
        line.renderOrder = 14;
        const cell = L.cell(p.c, p.r);
        line.position.set(cell[0], 0, cell[1]);
        B3.apGroup.add(line);
      });
      if (!cells.length) return;
      cells.sort(function (a, b) { return (b.r - a.r) || (b.c - a.c); });
      const anchor = cells[0];
      const sp = b3CostSprite(ring.name + ' ' + battleFmt(ring.ap), { color: '#9feaff' });
      if (sp) {
        const cell = L.cell(anchor.c, anchor.r);
        sp.position.set(cell[0], L.TOP + L.HEXR * 1.18, cell[1]);
        sp.scale.multiplyScalar(0.72);
        B3.apGroup.add(sp);
      }
    });
  }

  function airPadWorld(side, c, r) {
    const L = b3Layout();
    if (!L) return null;
    const center = airPadCenter(side);
    const cw = L.cell(center.c, center.r);
    const p = L.cell(c, r);
    // 飞机模型通常比地面单位宽，机场格距单独放大，避免机翼穿到相邻格。
    const spread = 1.65;
    return [cw[0] + (p[0] - cw[0]) * spread, cw[1] + (p[1] - cw[1]) * spread];
  }

  function refreshBattle3DAirPads() {
    if (!B3 || !B3.airGroup) return;
    b3ClearGroup(B3.airGroup);
    const THREE = window.THREE;
    const L = b3Layout();
    const plate = b3HexPlateGeo();
    if (!THREE || !L || !plate) return;
    ['attacker', 'defender'].forEach(function (side) {
      const count = airPadCount(side);
      const radius = airPadRadius(count);
      const cells = airPadCells(side, Math.max(1, count));
      const color = side === 'attacker' ? 0x4a86e0 : 0x8a95a5;
      const mat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide,
      });
      mat._b3Dispose = true;
      cells.forEach(function (p) {
        const w = airPadWorld(side, p.c, p.r) || L.cell(p.c, p.r);
        const m = new THREE.Mesh(plate, mat);
        m.position.set(w[0], L.TOP + 0.04, w[1]);
        B3.airGroup.add(m);
        const pts = HG.corners(0, 0, L.HEXR * 0.84).map(function (q) {
          return new THREE.Vector3(q[0], L.TOP + 0.10, -q[1]);
        });
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.68, depthTest: false })
        );
        line.material._b3Dispose = true;
        line.position.set(w[0], 0, w[1]);
        B3.airGroup.add(line);
      });
      const center = airPadCenter(side);
      const cw = L.cell(center.c, center.r);
      const label = b3CostSprite('空军 · ' + factionName(sideFaction(side)), { color: '#dcecff', big: true });
      if (label) {
        label.position.set(cw[0], L.TOP + L.HEXR * 3.1, cw[1]);
        label.scale.multiplyScalar(0.78);
        B3.airGroup.add(label);
      }
    });
  }

  function refreshBattle3DConfusionLabels() {
    if (!B3 || !B3.confusionGroup) return;
    b3ClearGroup(B3.confusionGroup);
    const b = state.battle;
    const side = battleMySide();
    const L = b3Layout();
    if (!b || !side || !L) return;
    battleAliveUnits().forEach(function (target) {
      const locks = (target.lockedBy || []).map(battleUnitById).filter(function (u) {
        return u && u.alive && u.side === side;
      });
      if (!target.confused && (target.side === side || locks.length < 2)) return;
      const opts = battleFacingStats(target, locks);
      const chance = opts.length ? Math.min.apply(null, opts.map(function (o) { return o.chance; })) : 0;
      if (!target.confused && chance <= 0) return;
      const text = target.confused ? '混乱' : ('混乱 ' + Math.round(chance * 100) + '%');
      const p = L.cell(target.c, target.r);
      const sp = b3CostSprite(text, { color: '#ff4f57' });
      if (!sp) return;
      sp.position.set(p[0], L.TOP + L.HEXR * 2.7, p[1]);
      sp.scale.multiplyScalar(0.72);
      B3.confusionGroup.add(sp);
    });
  }

  function refreshBattle3DUnits() {
    if (B3) B3.shadowDirty = true;   // 单位/建筑变了，下一帧重算阴影
    if (!B3 || !state.map) return;
    b3ApplyDayNight();
    if (B3.zoneGroup) B3.zoneGroup.visible = state.phase === 'deploy';
    if (B3.hovered) b3SetUnitHover(null);
    B3.hovered = null;
    b3ClearGroup(B3.unitsGroup);
    const source = state.phase === 'battle' && state.battle
      ? battleAliveUnits()
      : deployUnits();
    source.forEach(function (u) {
      const g = buildBattle3DUnit(u);
      if (g) B3.unitsGroup.add(g);
    });
    refreshBattle3DEligible();
    refreshBattle3DApRings();
    refreshBattle3DAirPads();
    refreshBattle3DConfusionLabels();
    refreshBattle3DBuildings();
    refreshBattle3DRangeHint();
    refreshBattle3DMoveRange();
    refreshBattle3DBombHint();
    refreshBattleCounterBatteryMarks();
    B3.need = true;
  }

  const BUILDING_YAW = 0; // 地图 X+ 为正北，建筑模型局部 +X 直接对齐
  const BUILDING_SOCKET_DEPTH = 0.75;

  function b3CreaseBuildingNormals(geo, creaseDeg) {
    const THREE = window.THREE;
    if (!THREE || !geo) return;
    const pos = geo.attributes.position;
    const idx = geo.index;
    if (!pos || !idx) return;
    const cosLimit = Math.cos(creaseDeg * Math.PI / 180);
    const triCount = idx.count / 3;
    const triN = new Float32Array(triCount * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      a.fromBufferAttribute(pos, idx.getX(t * 3));
      b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
      c.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac).normalize();
      triN[t * 3] = n.x; triN[t * 3 + 1] = n.y; triN[t * 3 + 2] = n.z;
    }
    const outPos = [], outN = [];
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        let nx = 0, ny = 0, nz = 0;
        for (let t2 = 0; t2 < triCount; t2++) {
          let shares = false;
          for (let m = 0; m < 3; m++) if (idx.getX(t2 * 3 + m) === vi) { shares = true; break; }
          if (!shares) continue;
          const d = triN[t * 3] * triN[t2 * 3] + triN[t * 3 + 1] * triN[t2 * 3 + 1] + triN[t * 3 + 2] * triN[t2 * 3 + 2];
          if (d < cosLimit) continue;
          nx += triN[t2 * 3]; ny += triN[t2 * 3 + 1]; nz += triN[t2 * 3 + 2];
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        outPos.push(x, y, z); outN.push(nx / len, ny / len, nz / len);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
    geo.setIndex(null);
  }

  function b3BuildingColor(type) {
    const def = window.Markers && window.Markers.BUILDING_BY_ID && window.Markers.BUILDING_BY_ID[type];
    if (def && /^#[0-9a-f]{6}$/i.test(def.color || '')) return parseInt(def.color.slice(1), 16);
    if (type === 'bridge') return 0xc8a469;
    if (type === 'road') return 0x9c9891;
    if (type === 'trench') return 0xa08565;
    if (type === 'bunker') return 0x8d8d86;
    return 0x9aa2ab;
  }

  function b3BuildingMesh(type, ghost) {
    if (!B3 || !window.BUILDING_MODELS) return null;
    const rec = window.BUILDING_MODELS[type];
    if (!rec || !rec.b64) return null;
    const THREE = window.THREE;
    const L = b3Layout();
    if (!THREE || !L) return null;
    let geo = B3.buildingGeoCache[type];
    if (!geo) {
      try { geo = decodeUnitGeometry(rec.b64); } catch (e) { return null; }
      b3CreaseBuildingNormals(geo, 35);
      B3.buildingGeoCache[type] = geo;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: b3BuildingColor(type),
      roughness: 0.92, metalness: 0,
      transparent: !!ghost, opacity: ghost ? 0.38 : 1, depthWrite: !ghost,
    });
    mat._b3Dispose = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.b3BuildingMesh = true;
    mesh.userData.b3Model = true;
    // 和地图编辑器一致：建筑模型是 Z-up，先转 Y-up；局部 +X 保持地图 +X（正北）。
    mesh.rotation.x = -Math.PI / 2;
    const dims = rec.dims || [1, 1, 1];
    const span = Math.max(dims[0], dims[1], dims[2]) || 1;
    mesh.scale.setScalar(span / 2);
    mesh.position.set(0, 0, 0);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.userData.b3GroundY = (L.TOP - BUILDING_SOCKET_DEPTH) - box.min.y;
    // 桥/道路模型中间是凹槽；单位站到第二层底面（内槽）而不是地图格面。
    let deckZ = 0;
    try {
      const posAttr = geo.attributes.position;
      const zs = [];
      for (let i = 0; i < posAttr.count; i++) {
        const z = Math.round(posAttr.getZ(i) * 100000) / 100000;
        if (zs.indexOf(z) === -1) zs.push(z);
      }
      zs.sort(function (a, b) { return a - b; });
      if (zs.length > 1) deckZ = zs[1];
      else if (zs.length) deckZ = zs[0];
    } catch (e) { deckZ = 0; }
    const deckFix = { bridge: -0.05, trench: -0.05, bunker: 0, road: -0.05, hq: 0, base: 0 };
    if (Object.prototype.hasOwnProperty.call(deckFix, type)) deckZ = deckFix[type];
    mesh.userData.b3DeckY = mesh.userData.b3GroundY + deckZ * (span / 2);
    return mesh;
  }

  function b3UpdateBuildingGhost(clientX, clientY) {
    if (!B3 || !B3.buildingGhostGroup) return;
    b3ClearGroup(B3.buildingGhostGroup);
    if (!state.buildMode || !state.battle) { B3.need = true; return; }
    const unit = state.battle.selectedId ? battleUnitById(state.battle.selectedId) : null;
    if (!unit || !battleTrait(unit, 'engineer')) return;
    const cell = b3PickCell(clientX, clientY);
    if (!cell) { B3.need = true; return; }
    const type = state.buildMode;
    const valid = battleBuildAllowed(unit, cell.c, cell.r, type);
    const mesh = b3BuildingMesh(type, true);
    if (!mesh) return;
    if (!valid) {
      mesh.material.color.setHex(0xff5a55);
      mesh.material.opacity = 0.28;
    } else {
      mesh.material.color.setHex(b3BuildingColor(type));
    }
    const w = b3Layout().cell(cell.c, cell.r);
    mesh.position.set(w[0], mesh.userData.b3GroundY || 0, w[1]);
    B3.buildingGhostGroup.add(mesh);
    B3.need = true;
  }

  function b3ClearBuildingGhost() {
    if (!B3 || !B3.buildingGhostGroup) return;
    b3ClearGroup(B3.buildingGhostGroup);
    B3.need = true;
  }

  function refreshBattle3DBuildings() {
    if (B3) B3.shadowDirty = true;   // 单位/建筑变了，下一帧重算阴影
    if (!B3 || !B3.buildingGroup || !state.map) return;
    B3.hoveredBuilding = null;
    b3ClearGroup(B3.buildingGroup);
    const list = (state.battle && state.battle.buildings) || [];
    const L = b3Layout();
    if (!L) return;
    list.forEach(function (b) {
      const mesh = b3BuildingMesh(b.t);
      if (!mesh) return;
      mesh.userData.b3Building = b;
      const w = L.cell(b.c, b.r);
      mesh.position.set(w[0], mesh.userData.b3GroundY || 0, w[1]);
      B3.buildingGroup.add(mesh);
    });
    if (B3.buildingProjectGroup) {
      b3ClearGroup(B3.buildingProjectGroup);
      const p = state.battle && state.battle.engineerProject;
      if (p) {
        const mesh = b3BuildingMesh('bunker', true);
        if (mesh) {
          mesh.material.opacity = 0.28;
          const w = L.cell(p.c, p.r);
          mesh.position.set(w[0], mesh.userData.b3GroundY || 0, w[1]);
          B3.buildingProjectGroup.add(mesh);
          const label = b3CostSprite('碉堡施工中', { color: '#ffd58a' });
          if (label) {
            label.position.set(w[0], L.TOP + L.HEXR * 2.8, w[1]);
            B3.buildingProjectGroup.add(label);
          }
        }
      }
    }
    B3.need = true;
  }

  function refreshBattle3DRangeHint() {
    if (!B3 || !B3.rangeGroup || !state.map || !state.battle) return;
    const THREE = window.THREE;
    const L = b3Layout();
    if (!THREE || !L) return;
    b3ClearGroup(B3.rangeGroup);
    const hovered = B3.hovered && B3.hovered.userData ? B3.hovered.userData.b3Unit : null;
    const unit = hovered || battleUnitById(state.battle.selectedId);
    if (!unit || !unit.alive) { B3.need = true; return; }
    const reconR = battleIsRecon(unit) ? battleReconRadius(unit) : 0;
    const aa = battleAntiAirSpec(unit);
    const aaR = aa ? aa.radius : 0;
    const radius = Math.max(reconR, aaR);
    if (radius <= 0) { B3.need = true; return; }
    const plate = b3HexPlateGeo();
    if (!plate) return;
    for (let r = 0; r < state.map.rows; r++) {
      for (let c = 0; c < state.map.cols; c++) {
        if (battleHexDistance(unit.c, unit.r, c, r) > radius) continue;
        const w = L.cell(c, r);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff3b3b, transparent: true, opacity: 0.13,
          depthWrite: false, side: THREE.DoubleSide,
        });
        mat._b3Dispose = true;
        const m = new THREE.Mesh(plate, mat);
        m.position.set(w[0], L.TOP + 0.07, w[1]);
        B3.rangeGroup.add(m);
        const pts = HG.corners(0, 0, L.HEXR * 0.86).map(function (p) {
          return new THREE.Vector3(p[0], L.TOP + 0.11, -p[1]);
        });
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.42, depthTest: false })
        );
        line.material._b3Dispose = true;
        line.position.set(w[0], 0, w[1]);
        B3.rangeGroup.add(line);
      }
    }
    const labelText = (reconR && aaR) ? ('侦察 ' + reconR + ' / 防空 ' + aaR)
      : (reconR ? ('侦察 ' + reconR) : ('防空 ' + aaR));
    const label = b3CostSprite(labelText, { color: '#ff6b6b' });
    if (label) {
      const w = L.cell(unit.c, unit.r);
      label.position.set(w[0], L.TOP + L.HEXR * 2.8, w[1]);
      B3.rangeGroup.add(label);
    }
    B3.need = true;
  }

  function battleCostText(n) {
    return (Math.round(Number(n || 0) * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }

  function b3CostSprite(text, opts) {
    const THREE = window.THREE;
    const L = b3Layout();
    if (!THREE || !L) return null;
    opts = opts || {};
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.font = (opts.big ? '700 44px' : '700 36px') + ' "Consolas", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(8, 12, 18, 0.95)';
    g.strokeText(text, 128, 50);
    g.fillStyle = opts.color || '#ffd79a';
    g.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    mat._b3Dispose = true;
    const sp = new THREE.Sprite(mat);
    const w = opts.big ? L.HEXR * 3.0 : L.HEXR * 2.5;
    sp.scale.set(w, w * 96 / 256, 1);
    sp.position.y = opts.big ? L.TOP + L.HEXR * 3.0 : L.TOP + L.HEXR * 2.15;
    sp.userData.b3Dispose = true;
    return sp;
  }

  function b3AddDamageFloat(unit, amount, color) {
    if (!B3 || !unit) return;
    const L = b3Layout();
    const THREE = window.THREE;
    if (!L || !THREE) return;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.font = '700 80px "Consolas", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(8, 12, 18, 0.95)';
    g.strokeText(amount > 0 ? ('-' + amount) : '0', 128, 70);
    g.fillStyle = color || '#ff6b57';
    g.fillText(amount > 0 ? ('-' + amount) : '0', 128, 70);
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(L.HEXR * 2.6, L.HEXR * 1.3, 1);
    const w = unit.airBase
      ? (airPadWorld(unit.side, unit.c, unit.r) || L.cell(unit.c, unit.r))
      : L.cell(unit.c, unit.r);
    const baseY = L.TOP + L.HEXR * 2.55;
    sp.position.set(w[0], baseY, w[1]);
    B3.floatGroup.add(sp);
    B3.floats.push({ sprite: sp, born: performance.now(), baseY: baseY });
    B3.need = true;
  }

  function b3HideAntiAirRange() {
    if (!B3 || !B3.aaGroup) return;
    b3ClearGroup(B3.aaGroup);
  }

  function b3ShowAntiAirRange(aa, spec) {
    if (!B3 || !B3.aaGroup || !aa || !spec) return;
    b3ClearGroup(B3.aaGroup);
    const THREE = window.THREE;
    const L = b3Layout();
    const plate = b3HexPlateGeo();
    if (!THREE || !L || !plate) return;
    for (let r = 0; r < state.map.rows; r++) {
      for (let c = 0; c < state.map.cols; c++) {
        if (battleHexDistance(aa.c, aa.r, c, r) > spec.radius) continue;
        const w = L.cell(c, r);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff2f3d, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide,
        });
        mat._b3Dispose = true;
        const m = new THREE.Mesh(plate, mat);
        m.position.set(w[0], L.TOP + 0.08, w[1]);
        B3.aaGroup.add(m);
        const pts = HG.corners(0, 0, L.HEXR * 0.86).map(function (q) {
          return new THREE.Vector3(q[0], L.TOP + 0.12, -q[1]);
        });
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0xff4a50, transparent: true, opacity: 0.9, depthTest: false })
        );
        line.material._b3Dispose = true;
        line.position.set(w[0], 0, w[1]);
        B3.aaGroup.add(line);
      }
    }
    const p = L.cell(aa.c, aa.r);
    const label = b3CostSprite('防空拦截', { color: '#ff4a50' });
    if (label) {
      label.position.set(p[0], L.TOP + L.HEXR * 2.5, p[1]);
      label.scale.multiplyScalar(0.7);
      B3.aaGroup.add(label);
    }
    B3.need = true;
  }

  function b3StartAirFlight(unit, target, hit, delay) {
    if (!B3 || !B3.flightGroup || !unit || !target) return;
    const L = b3Layout();
    if (!L) return;
    const src = B3.unitsGroup.children.filter(function (g) {
      return g.userData && g.userData.b3Unit && g.userData.b3Unit.id === unit.id;
    })[0];
    if (!src) return;
    const clone = src.clone(true);
    clone.userData = { b3FlightClone: true };
    clone.visible = true;
    B3.flightGroup.add(clone);
    src.visible = false;
    const start0 = battleAirTakeoffWorld(unit.side, target) || [src.position.x, src.position.z];
    const from = [start0[0], src.position.y, start0[1]];
    const dest0 = hit ? hit.point : L.cell(target.c, target.r);
    const dest = [dest0[0], from[1], dest0[1]];
    clone.position.set(from[0], from[1], from[2]);
    B3.flights.push({
      clone: clone, from: from, dest: dest,
      aa: hit ? hit.aa : null, spec: hit ? hit.spec : null,
      warningShown: false,
      started: performance.now() + Math.max(0, Number(delay) || 0) * 1000,
      out: hit ? 0.55 : 0.8,
      hold: hit ? 1.1 : 0,
      back: hit ? 0.55 : 0.8,
    });
    B3.need = true;
  }

  function b3UpdateAirFlights(now) {
    if (!B3 || !B3.flights) return;
    const keep = [];
    B3.flights.forEach(function (f) {
      const t = (now - f.started) / 1000;
      if (t < 0) {
        if (f.clone) f.clone.position.set(f.from[0], f.from[1], f.from[2]);
        keep.push(f);
        return;
      }
      let p;
      if (t <= f.out) {
        const k = Math.max(0, Math.min(1, t / f.out));
        p = [f.from[0] + (f.dest[0] - f.from[0]) * k,
             f.from[1] + (f.dest[1] - f.from[1]) * k,
             f.from[2] + (f.dest[2] - f.from[2]) * k];
      } else if (t <= f.out + (f.hold || 0)) {
        p = f.dest.slice();
        if (f.aa && !f.warningShown) {
          f.warningShown = true;
          b3ShowAntiAirRange(f.aa, f.spec);
        }
      } else if (t <= f.out + (f.hold || 0) + f.back) {
        if (f.warningShown) {
          f.warningShown = false;
          b3HideAntiAirRange();
        }
        const k = Math.max(0, Math.min(1, (t - f.out - (f.hold || 0)) / f.back));
        p = [f.dest[0] + (f.from[0] - f.dest[0]) * k,
             f.dest[1] + (f.from[1] - f.dest[1]) * k,
             f.dest[2] + (f.from[2] - f.dest[2]) * k];
      } else {
        if (f.warningShown) b3HideAntiAirRange();
        if (f.clone && f.clone.parent) f.clone.parent.remove(f.clone);
        B3.need = true;
        return;
      }
      if (f.clone) f.clone.position.set(p[0], p[1], p[2]);
      keep.push(f);
    });
    B3.flights = keep;
    B3.need = true;
  }

  function b3UpdateFloats(now) {
    if (!B3 || !B3.floats) return;
    const keep = [];
    B3.floats.forEach(function (f) {
      const t = now - f.born;
      if (t > 1500) {
        B3.floatGroup.remove(f.sprite);
        if (f.sprite.material.map) f.sprite.material.map.dispose();
        f.sprite.material.dispose();
        return;
      }
      f.sprite.position.y = f.baseY + t * 0.0035;
      f.sprite.material.opacity = Math.max(0, 1 - t / 1500);
      keep.push(f);
    });
    B3.floats = keep;
    B3.need = true;
  }

  function refreshBattle3DGhost() {
    if (!B3 || !state.map) return;
    b3ClearGroup(B3.ghostGroup);
    const b = state.battle;
    if (!b || !b.ghost) return;
    const unit = battleUnitById(b.ghost.unitId);
    if (!unit || !battleMySide() || unit.side !== battleMySide()) return;
    const L = b3Layout();
    const THREE = window.THREE;
    if (!L || !THREE) return;
    const path = b.ghost.path || [];
    const start = L.cell(unit.c, unit.r);
    const pts = [new THREE.Vector3(start[0], L.TOP + 1.0, start[1])];
    let cum = 0;
    const plate = b3HexPlateGeo();
    path.forEach(function (p) {
      const w = L.cell(p.c, p.r);
      pts.push(new THREE.Vector3(w[0], L.TOP + 1.0, w[1]));
      const step = battleTerrainCost(unit, p.c, p.r);
      cum += step;
      if (plate) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xf0c56d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
        });
        mat._b3Dispose = true;
        const m = new THREE.Mesh(plate, mat);
        m.position.set(w[0], L.TOP + 0.48, w[1]);
        B3.ghostGroup.add(m);
      }
      const label = b3CostSprite('-' + battleCostText(step), { color: '#ffd79a' });
      if (label) {
        label.position.x += w[0];
        label.position.z += w[1];
        B3.ghostGroup.add(label);
      }
    });
    if (pts.length > 1) {
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(10, pts.length * 10), 0.48, 6, false);
      tubeGeo.userData.b3Dispose = true;
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0.95, depthWrite: false,
      });
      tubeMat._b3Dispose = true;
      B3.ghostGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    }
    const dest = L.cell(b.ghost.c, b.ghost.r);
    const total = b3CostSprite('共 -' + battleCostText(b.ghost.cost) +
      (battleRiverResetAt(b.ghost.c, b.ghost.r) ? ' · 上河0' : ''), { big: true, color: '#fff0c8' });
    if (total) {
      total.position.x += dest[0];
      total.position.z += dest[1];
      B3.ghostGroup.add(total);
    }
    const model = b3UnitMesh(unit.name, sideFaction(unit.side), unit.hp);
    if (model) {
      model.position.y += L.TOP - 0.18;
      model.traverse(function (obj) {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = 0.46;
          obj.material.depthWrite = false;
          obj.material.needsUpdate = true;
        }
      });
      model.position.x += dest[0];
      model.position.z += dest[1];
      B3.ghostGroup.add(model);
    }
    B3.need = true;
  }

  function refreshBattle3DEligible() {
    if (!B3 || !state.map) return;
    b3ClearGroup(B3.eligibleGroup);
    let side = null;
    let cells = [];
    if (state.battle && state.battle.reinforce && state.battle.reinforce.stage === 'deploy' &&
        battleCanReinforce(battleMySide())) {
      side = battleMySide();
      cells = battleReinforceEligible(side).map(function (p) {
        return p.r * state.map.cols + p.c;
      });
    } else if (state.phase === 'deploy' && canDeploy()) {
      side = myDeploySide();
      const info = deployEligibleFor(side);
      cells = info.cells;
    } else {
      return;
    }
    if (!cells.length) return;
    const THREE = window.THREE;
    const plate = b3HexPlateGeo();
    const L = b3Layout();
    if (!plate || !L) return;
    const color = side === 'attacker' ? 0xe0573f : 0x4a86e0;
    cells.forEach(function (idx) {
      const c = idx % state.map.cols, r = Math.floor(idx / state.map.cols);
      const p = L.cell(c, r);
      const mat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide,
      });
      mat._b3Dispose = true;
      const m = new THREE.Mesh(plate, mat);
      m.position.set(p[0], L.TOP + 0.42, p[1]);
      B3.eligibleGroup.add(m);
    });
  }

  function syncBattle3DView() {
    const view = el('online-battle-view');
    if (!view) return;
    if ((state.phase !== 'prepare' && state.phase !== 'deploy' && state.phase !== 'battle') || state.view !== 'room') {
      view.classList.add('hidden');
      return;
    }
    view.classList.remove('hidden');
    const b = ensureBattle3D();
    if (!b) return;
    if (b.mapRef !== state.map) buildBattle3D();
    resizeBattle3D();
    refreshBattle3DUnits();
    refreshBattle3DGhost();
    syncBattle3DHUD();
    b.need = true;
  }

  function syncBattle3DHUD() {
    const view = el('online-battle-view');
    if (!view || state.view !== 'room') return;
    const deploy = state.phase === 'deploy';
    const side = myDeploySide();
    const faction = sideFaction(side);
    const opp = otherSide(side);
    const oppFaction = sideFaction(opp);
    const data = state.prepData && state.prepData.factions ? state.prepData.factions[faction] : null;
    const deck = deployDeck(side);
    const remaining = deployRemainingList(side);
    const selectedName = side ? deploySelectedName() : '';
    const remainCount = remaining.reduce(function (n, u) { return n + u.remaining; }, 0);
    const placed = deployUnits().filter(function (u) { return u.side === side; }).length;
    const ready = !!(state.deploy && side && state.deploy.ready[side]);
    const captain = side ? selfIsCaptain(side) : false;
    const battle = state.phase === 'battle' ? state.battle : null;
    const activeSide = battle ? battle.activeSide : null;
    const selected = battle && battle.selectedId ? battleUnitById(battle.selectedId) : null;
    const selectedLocal = !!(selected && side && selected.side === side);
    const activeCan = battle ? battleCanControl(activeSide) : false;
    const counterMine = !!(battle && battle.counter && battleCanControl(battle.counter.chooserSide));

    setText('online-battle-title', deploy
      ? 'A 阶段 · 部署'
      : (battle
        ? (battle.reinforce
          ? (battlePhaseLabel(battle.phase) + ' 阶段 · 增援')
          : (battlePhaseLabel(battle.phase) + ' 阶段 · 第 ' + battle.round + ' 回合'))
        : 'A 阶段 · 第 1 回合'));
    const clockRound = battle ? battle.round : 1;
    const clockNight = battle ? battleIsNight() : false;
    const clockNext = battle ? battleNextPhaseInfo(clockRound) : { label: '', left: 0 };
    setText('online-battle-round', '第 ' + clockRound + ' 回合');
    setText('online-battle-daynight', clockNight ? '夜晚' : '白天');
    setText('online-battle-day', '第 ' + battleDayOfRound(clockRound) + ' 天');
    setText('online-battle-next', clockNext.label
      ? ('下一阶段 ' + clockNext.label + ' · 还有 ' + clockNext.left + ' 回合')
      : (battle ? '最终阶段' : '下一阶段 —'));
    const clockBox = el('online-battle-clock');
    if (clockBox) clockBox.classList.toggle('is-night', clockNight);
    setText('online-battle-turn', deploy
      ? '双方同时部署'
      : (battle && battle.reinforce
        ? (battle.reinforce.stage === 'pick' ? '双方配卡中' : '双方部署增援')
        : (counterMine
          ? '请选择反击单位'
          : (battle ? (battle.activeSide === side ? '你的回合' : sideName(battle.activeSide) + '行动中') : '—'))));
    setText('online-battle-side', side
      ? (battle
        ? ('你方 ' + sideName(side) + ' · ' + factionName(faction) + (captain ? ' · 队长' : '') +
          (selectedLocal ? (' · ' + selected.name + ' · 血 ' + selected.hp + '/' + selected.maxHp + ' · 行动力 ' + selected.mp) : '') +
          (selectedLocal && selected.guardStop ? ' · 警戒停止（不能移动）' : '') +
          (selectedLocal && selected.pushLocked ? ' · 已推进（本回合不能再行动）' : '') +
          (selectedLocal && selected.actionLocked ? ' · 已行动（本回合不能再行动）' : '') +
          (selectedLocal && selected.confused ? ' · 混乱（不能主动进攻）' : '') +
          (selectedLocal && selected.carryingId ? (function () {
            const c = battleUnitById(selected.carryingId);
            return c ? (' · 载有 ' + c.name) : '';
          })() : '') +
          (selectedLocal && battleTrait(selected, 'transport')
            ? (selected.carryingId ? ' · 点【卸下】后选择相邻空格' : ' · 右键相邻友军装载') : '') +
          (selectedLocal && selected.cooldownRound && selected.cooldownRound >= battle.round
            ? ' · 新部署冷却（本回合不能行动）'
            : '') +
          (battle.ghost ? (' · 移动消耗 ' + battleCostText(battle.ghost.cost) +
            (battleRiverResetAt(battle.ghost.c, battle.ghost.r)
              ? ' · 上河后行动力清零'
              : '')) : ''))
        : ('你方 ' + sideName(side) + ' · ' + factionName(faction) + (captain ? ' · 队长' : ' · 队员') + ' · ' + placed + ' / ' + deck.length + ' 已放置'))
      : '—');
    setText('online-battle-opp', side
      ? (battle
        ? ('对手 ' + sideName(opp) + ' · ' + factionName(oppFaction) + (battle.counter ? ' · 反击选择中' : ''))
        : ('对手 ' + sideName(opp) + ' · ' + factionName(oppFaction) + ' · ' + (state.deploy && state.deploy.ready[opp] ? '已部署' : '部署中')))
      : '—');

    const unitsBox = el('online-battle-units');
    if (unitsBox) {
      unitsBox.innerHTML = '';
      if (unitsBox.parentElement) unitsBox.parentElement.classList.toggle('hidden', !deploy);
      if (deploy) {
        remaining.forEach(function (u) {
          const info = data && data.units ? data.units[u.name] : null;
          const price = info ? info.price : '—';
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'battle-unit-card' +
            (selectedName === u.name ? ' is-selected' : '') +
            (u.remaining === 0 ? ' is-done' : '');
          card.setAttribute('data-battle-pick', u.name);
          card.disabled = !captain || ready || u.remaining === 0;
          const name = document.createElement('span');
          name.className = 'battle-unit-name';
          name.textContent = u.name;
          const pr = document.createElement('span');
          pr.className = 'battle-unit-price';
          const pb = document.createElement('b');
          pb.textContent = price;
          const ps = document.createElement('small');
          ps.textContent = '动员点';
          pr.appendChild(pb);
          pr.appendChild(ps);
          const meta = document.createElement('span');
          meta.className = 'battle-unit-meta';
          const left = document.createElement('span');
          left.textContent = '剩余 ' + u.remaining + ' / ' + u.total;
          const right = document.createElement('b');
          right.textContent = info ? ('血 ' + info.hp + ' · 行 ' + info.move) : '';
          meta.appendChild(left);
          meta.appendChild(right);
          card.appendChild(name);
          card.appendChild(pr);
          card.appendChild(meta);
          unitsBox.appendChild(card);
        });
      }
    }

    const seats = el('online-battle-seats');
    if (seats) {
      seats.innerHTML = '';
      if (state.test) {
        seats.classList.remove('hidden');
        state.testSeats.forEach(function (seat) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'prep-seat' + (seat.id === state.activeSeat ? ' is-active' : '');
          btn.setAttribute('data-battle-seat', seat.id);
          btn.textContent = seat.name;
          seats.appendChild(btn);
        });
      } else {
        seats.classList.add('hidden');
      }
    }

    const undo = el('online-battle-undo');
    const done = el('online-battle-done');
    const back = el('online-battle-back');
    const end = el('online-battle-end-turn');
    if (undo) undo.disabled = !deploy || !captain || ready || placed <= 0;
    if (done) {
      done.textContent = ready ? '已部署完成' : '部署完成';
      done.disabled = !deploy || !captain || ready || remainCount > 0;
      done.classList.toggle('hidden', !deploy);
    }
    if (end) {
      end.classList.toggle('hidden', !battle);
      end.disabled = !battle || !activeCan || !!battle.counter || !!battle.reinforce;
      end.textContent = battle && battle.activeSide === side ? '结束回合' : '等待对方';
    }
    if (back) back.classList.toggle('hidden', !(state.role === 'host' && (state.phase === 'deploy' || state.phase === 'battle')));
    if (undo) undo.classList.toggle('hidden', !deploy);
    const saveGame = el('online-save-game');
    const loadGame = el('online-load-game');
    if (saveGame) {
      saveGame.classList.toggle('hidden', !(deploy || battle));
      saveGame.disabled = !(deploy || battle);
    }
    if (loadGame) {
      const canLoad = (state.test || state.role === 'host') && (deploy || battle);
      loadGame.classList.toggle('hidden', !canLoad);
      loadGame.disabled = !canLoad;
    }

    const choice = el('battle-choice');
    if (choice && (!battle || !battle.choice)) choice.classList.add('hidden');
    battleCounterUI();
    renderBattleReinforce();
    renderBattleAirIntercept();
    renderBattleFacingChoice();
    renderBattleBuildPanel();
    renderBattleTransportPanel();
    if (!battle || !battle.counter) battleShowTip(0, 0, '');

    const loading = el('online-battle-loading');
    if (loading) {
      const loadingSome = Object.keys(UNIT_MODEL_STATE).some(function (k) { return UNIT_MODEL_STATE[k] === 'loading'; });
      loading.classList.toggle('hidden', !loadingSome);
    }
    view.classList.toggle('is-battle', !deploy);
  }

  function myDeploySide() {
    return normalizeSide(state.side);
  }

  function deployUnits() {
    return state.deploy && Array.isArray(state.deploy.units) ? state.deploy.units : [];
  }

  function deployUnitAt(c, r, units) {
    const list = units || deployUnits();
    for (let i = 0; i < list.length; i++) {
      if (list[i].c === c && list[i].r === r) return list[i];
    }
    return null;
  }

  function deployDeck(side) {
    return state.decks && Array.isArray(state.decks[side]) ? state.decks[side] : [];
  }

  function deployRemainingList(side) {
    const deck = deployDeck(side);
    const counts = {};
    deck.forEach(function (name) { counts[name] = (counts[name] || 0) + 1; });
    const placed = {};
    deployUnits().forEach(function (u) {
      if (u.side === side) placed[u.name] = (placed[u.name] || 0) + 1;
    });
    const seen = {};
    const out = [];
    deck.forEach(function (name) {
      if (seen[name]) return;
      if (battleIsAirUnit(name, side)) return;
      seen[name] = true;
      out.push({ name: name, total: counts[name], placed: placed[name] || 0, remaining: Math.max(0, counts[name] - (placed[name] || 0)) });
    });
    return out;
  }

  function deploySelectedName() {
    const side = myDeploySide();
    if (!side) return '';
    const list = deployRemainingList(side).filter(function (u) { return u.remaining > 0; });
    let name = state.deploySel;
    if (!name || !list.some(function (u) { return u.name === name; })) {
      name = list.length ? list[0].name : '';
      state.deploySel = name;
    }
    return name;
  }

  function canDeploySide(side) {
    if (state.phase !== 'deploy' || !state.deploy) return false;
    if (!side) return false;
    return selfIsCaptain(side) && !state.deploy.ready[side];
  }

  function canDeploy() {
    return canDeploySide(myDeploySide());
  }

  function deployDistances() {
    const map = state.map;
    const spawn = map && map.mode === 'attack' && map.deploy ? map.deploy.spawn : null;
    if (!spawn) return null;
    if (state.deployDist && state.deployDist.map === map) return state.deployDist.dist;
    const n = map.cols * map.rows;
    const dist = new Array(n);
    for (let i = 0; i < n; i++) dist[i] = -1;
    const queue = new Array(n);
    let head = 0, tail = 0;
    const start = spawn.r * map.cols + spawn.c;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      const c = idx % map.cols, r = Math.floor(idx / map.cols);
      const nb = HG.neighbors(c, r);
      for (let i = 0; i < nb.length; i++) {
        const nc = nb[i][0], nr = nb[i][1];
        if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
        const ni = nr * map.cols + nc;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[idx] + 1;
        queue[tail++] = ni;
      }
    }
    state.deployDist = { map: map, dist: dist };
    return dist;
  }

  // 当前这一方还能放的格子。进攻方按“先布满当前圈，再下一圈”返回当前圈。
  function deployEligibleFor(side, units) {
    side = normalizeSide(side);
    const map = state.map;
    const empty = { ring: 0, cells: [] };
    if (!map || !state.deploy || !side) return empty;
    const useUnits = units || deployUnits();
    const cols = map.cols, rows = map.rows;
    const occupied = {};
    useUnits.forEach(function (u) { occupied[u.r * cols + u.c] = u; });

    if (side === 'defender') {
      const zone = map.mode === 'attack' && map.deploy ? map.deploy.zone : null;
      if (!zone) return empty;
      const cells = [];
      zone.forEach(function (idx) {
        if (!occupied[idx]) cells.push(idx);
      });
      cells.sort(function (a, b) { return a - b; });
      return { ring: 0, cells: cells };
    }

    const spawn = map.mode === 'attack' && map.deploy ? map.deploy.spawn : null;
    if (!spawn) return empty;
    const dist = deployDistances();
    if (!dist) return empty;
    let max = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > max) max = dist[i];
    for (let d = 0; d <= max; d++) {
      const blanks = [];
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] !== d) continue;
        const u = occupied[i];
        if (u && u.side === 'defender') continue; // 敌方占住的格子不可用，但不会卡住出兵
        if (!u) blanks.push(i);
      }
      if (blanks.length) {
        blanks.sort(function (a, b) { return a - b; });
        return { ring: d, cells: blanks };
      }
    }
    return { ring: max + 1, cells: [] };
  }

  function deployCellReason(side, c, r, units) {
    side = normalizeSide(side);
    const map = state.map;
    if (!map) return '还没有地图';
    if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return '超出地图';
    const useUnits = units || deployUnits();
    if (deployUnitAt(c, r, useUnits)) return '该格已有单位';
    const idx = r * map.cols + c;
    if (side === 'defender') {
      const zone = map.mode === 'attack' && map.deploy ? map.deploy.zone : null;
      if (!zone || !zone.has(idx)) return '只能放在蓝色防守部署区';
      return '';
    }
    if (side !== 'attacker') return '还没有选择攻守';
    const spawn = map.mode === 'attack' && map.deploy ? map.deploy.spawn : null;
    if (!spawn) return '地图没有设置进攻方出兵点';
    const dist = deployDistances();
    if (!dist || dist[idx] < 0) return '必须从出兵点开始放置';
    const info = deployEligibleFor(side, useUnits);
    if (info.cells.indexOf(idx) === -1) {
      if (info.cells.length) return '先布满足迹范围（第 ' + info.ring + ' 圈，还剩 ' + info.cells.length + ' 格）';
      return '当前没有可放置的格子';
    }
    return '';
  }

  function deployPublish() {
    if (!state.net || state.test) return;
    if (!state.deploy) return;
    if (state.role === 'host') {
      state.net.setHostState({ deploy: state.deploy });
    } else if (state.role === 'guest') {
      const side = myDeploySide();
      if (!side) return;
      const own = deployUnits().filter(function (u) { return u.side === side; });
      state.net.setGuestState({
        deploy: { units: own, ready: !!state.deploy.ready[side] },
      });
    }
  }

  function deployRemove(unit) {
    if (!unit || !state.deploy) return;
    const side = myDeploySide();
    if (!canDeploySide(side) || unit.side !== side) return;
    state.deploy.units = deployUnits().filter(function (u) { return u.id !== unit.id; });
    state.deploy.ready[side] = false;
    deployPublish();
    renderDeployPanel();
    scheduleDraw();
  }

  function deployUndo() {
    const side = myDeploySide();
    if (!canDeploySide(side)) return;
    const own = deployUnits().filter(function (u) { return u.side === side; });
    if (!own.length) return;
    deployRemove(own[own.length - 1]);
  }

  function deployPlaceAt(c, r) {
    if (!canDeploy()) return;
    const side = myDeploySide();
    const units = deployUnits();
    const existing = deployUnitAt(c, r, units);
    if (existing) {
      if (existing.side === side) deployRemove(existing);
      else toast('该格已有敌方单位');
      return;
    }
    const name = deploySelectedName();
    if (!name) { toast('没有可部署的单位'); return; }
    const why = deployCellReason(side, c, r, units);
    if (why) { toast(why); return; }
    state.deploySeq++;
    const id = 'u-' + String(state.selfId || 'local') + '-' + Date.now().toString(36) + '-' + state.deploySeq;
    state.deploy.units.push({ id: id, side: side, name: name, c: c, r: r });
    state.deploy.ready[side] = false;
    const remain = deployRemainingList(side).filter(function (u) { return u.remaining > 0; });
    if (!remain.some(function (u) { return u.name === name; })) {
      state.deploySel = remain.length ? remain[0].name : '';
    }
    deployPublish();
    renderDeployPanel();
    scheduleDraw();
  }

  function deployMaybeEnterBattle() {
    if (state.phase !== 'deploy' || !state.deploy) return;
    if (!state.deploy.ready.attacker || !state.deploy.ready.defender) return;
    if (!state.test && state.role !== 'host') return;
    enterBattle();
  }

  /* =============================================================
   * A 阶段战斗：选中 / 移动 / 攻击 / 锁定 / 反击 / 回合
   * ============================================================= */

  const BATTLE_MAX_MP = 6;
  const BATTLE_RANGE = 2;
  const BATTLE_VISION = 2;

  function battleHexAxial(c, r) {
    return { x: c - ((r - (r & 1)) / 2), z: r };
  }

  function battleHexDistance(c1, r1, c2, r2) {
    const a = battleHexAxial(c1, r1), b = battleHexAxial(c2, r2);
    const dx = a.x - b.x, dz = a.z - b.z, dy = -dx - dz;
    return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dy));
  }

  function battleZoneRegions() {
    const map = state.map;
    if (!map || !map.deploy || !map.deploy.zone) return [];
    const zone = map.deploy.zone;
    const inZone = {};
    zone.forEach(function (idx) { inZone[idx] = true; });
    const seen = {};
    const regions = [];
    zone.forEach(function (start) {
      if (seen[start]) return;
      const queue = [start];
      const cells = [];
      seen[start] = true;
      let min = start;
      while (queue.length) {
        const cur = queue.shift();
        cells.push(cur);
        if (cur < min) min = cur;
        const c = cur % map.cols, r = Math.floor(cur / map.cols);
        HG.neighbors(c, r).forEach(function (p) {
          const nc = p[0], nr = p[1];
          if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) return;
          const ni = nr * map.cols + nc;
          if (!inZone[ni] || seen[ni]) return;
          seen[ni] = true;
          queue.push(ni);
        });
      }
      regions.push({ id: 'z' + min, cells: cells });
    });
    return regions;
  }

  function battleUpdateZoneOwners(battle) {
    const b = battle || state.battle;
    if (!b || !state.map) return {};
    if (!b.zoneOwners) b.zoneOwners = {};
    const regions = battleZoneRegions();
    const status = {};
    regions.forEach(function (reg) {
      if (!b.zoneOwners[reg.id]) b.zoneOwners[reg.id] = 'defender';
      const set = {};
      reg.cells.forEach(function (idx) { set[idx] = true; });
      let a = false, d = false;
      (b.units || []).forEach(function (u) {
        if (!u.alive || !set[u.r * state.map.cols + u.c]) return;
        if (u.side === 'attacker') a = true;
        else if (u.side === 'defender') d = true;
      });
      let owner = b.zoneOwners[reg.id];
      let contested = false;
      if (a && d) {
        contested = true;
      } else if (a) {
        owner = 'attacker';
        b.zoneOwners[reg.id] = owner;
      } else if (d) {
        owner = 'defender';
        b.zoneOwners[reg.id] = owner;
      }
      status[reg.id] = { region: reg, owner: owner, contested: contested };
    });
    b.zoneStatus = status;
    return status;
  }

  function battleReinforceIsAirborne(side, phase) {
    const div = battleReinforceData(side, phase);
    return !!(div && div.type === 'airborne');
  }

  function battleAirborneCenters(side) {
    if (!state.battle || !state.battle.reinforce) return [];
    if (!battleReinforceIsAirborne(side, state.battle.reinforce.phase)) return [];
    const enemies = battleAliveUnits().filter(function (u) { return u.side !== side; });
    return battleAliveUnits().filter(function (u) { return u.side === side; }).map(function (u) {
      return {
        id: u.id, name: u.name, c: u.c, r: u.r,
        safe: !enemies.some(function (e) { return battleHexDistance(u.c, u.r, e.c, e.r) <= 2; }),
      };
    });
  }

  // 空降师：选定一个友军圆心；先布满半径 1 的空格，再允许半径 2。
  function battleAirborneDropCells(side) {
    const b = state.battle;
    if (!b || !b.reinforce) return [];
    if (!battleReinforceIsAirborne(side, b.reinforce.phase)) return [];
    const air = b.reinforce.airborne && b.reinforce.airborne[side];
    if (!air || air.mode !== 'unit' || !air.unitId) return [];
    const center = battleUnitById(air.unitId);
    if (!center || !center.alive || center.side !== side) return [];
    const enemies = battleAliveUnits().filter(function (u) { return u.side !== side; });
    if (enemies.some(function (e) { return battleHexDistance(center.c, center.r, e.c, e.r) <= 2; })) return [];
    const map = state.map;
    const ring = function (dist) {
      const out = [];
      for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
          if (battleHexDistance(center.c, center.r, c, r) !== dist) continue;
          if (battleUnitAt(c, r)) continue;
          out.push({ c: c, r: r, center: center.id, ring: dist });
        }
      }
      return out;
    };
    const inner = ring(1);
    return inner.length ? inner : ring(2);
  }

  function battleReinforceGroundPlaced(side) {
    const r = state.battle && state.battle.reinforce;
    if (!r) return 0;
    return (r.placed[side] || []).filter(function (p) {
      return !battleIsAirUnit(p.name, side);
    }).length;
  }


  function battleReinforceSpawnCells(side) {
    const out = [];
    const map = state.map;
    if (side !== 'attacker' || !map || !map.deploy || !map.deploy.spawn) return out;
    const rawSpawn = map.deploy.spawn;
    const sp = Array.isArray(rawSpawn) ? rawSpawn : [rawSpawn.c, rawSpawn.r];
    // 从出兵点一圈一圈往外找；出兵点和内圈被 A 阶段单位占满时，自动用下一圈。
    const maxRing = Math.max(map.cols, map.rows) + 1;
    for (let d = 0; d <= maxRing; d++) {
      const ring = [];
      for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
          if (battleHexDistance(sp[0], sp[1], c, r) !== d) continue;
          if (battleUnitAt(c, r)) continue;
          ring.push({ c: c, r: r, spawn: true, ring: d });
        }
      }
      if (ring.length) return ring;
    }
    return out;
  }

  function battleReinforceEligible(side) {
    side = normalizeSide(side);
    if (!side || !state.battle || !state.battle.reinforce) return [];
    const rr = state.battle.reinforce;
    const air = rr.airborne && rr.airborne[side];
    if (battleReinforceIsAirborne(side, rr.phase) && air && air.mode === 'unit') {
      const cells = [];
      const seen = {};
      battleAirborneDropCells(side).forEach(function (p) {
        const idx = p.r * state.map.cols + p.c;
        if (seen[idx]) return;
        seen[idx] = true;
        cells.push({ c: p.c, r: p.r, airborne: true, ring: p.ring });
      });
      battleReinforceSpawnCells(side).forEach(function (p) {
        const idx = p.r * state.map.cols + p.c;
        if (seen[idx]) return;
        seen[idx] = true;
        cells.push({ c: p.c, r: p.r, spawn: true });
      });
      return cells;
    }
    battleUpdateZoneOwners(state.battle);
    const map = state.map;
    const cells = [];
    const seen = {};
    const status = state.battle.zoneStatus || {};
    Object.keys(status).forEach(function (id) {
      const st = status[id];
      if (st.contested || st.owner !== side) return;
      st.region.cells.forEach(function (idx) {
        const c = idx % map.cols, r = Math.floor(idx / map.cols);
        if (seen[idx] || battleUnitAt(c, r)) return;
        seen[idx] = true;
        cells.push({ c: c, r: r });
      });
    });
    // 进攻方没有踩住防守区时，仍可从出兵点附近进场；空降师也一样。
    battleReinforceSpawnCells(side).forEach(function (p) {
      const idx = p.r * map.cols + p.c;
      if (seen[idx]) return;
      seen[idx] = true;
      cells.push({ c: p.c, r: p.r });
    });
    return cells;
  }

  function battleReinforceCandidates(side, phase) {
    const data = prepFaction(side);
    if (!data) return [];
    phase = String(phase || '').toLowerCase();
    const used = (state.battle && state.battle.usedDivisions && state.battle.usedDivisions[side]) || [];
    return data.divisions.filter(function (d) {
      if (used.indexOf(d.id) !== -1) return false;
      return phase === 'c' ? d.phase === 'C' : d.phase === 'AB';
    });
  }

  function battleReinforceData(side, phase) {
    phase = String(phase || '').toLowerCase();
    const data = prepFaction(side);
    if (!data) return null;
    const picks = state.battle && state.battle.reinforce && state.battle.reinforce.picks[side];
    const id = picks && picks.divisionId;
    if (id) {
      const chosen = data.divisions.filter(function (d) { return d.id === id; })[0];
      if (chosen) return chosen;
    }
    const candidates = battleReinforceCandidates(side, phase);
    return candidates[0] || null;
  }

  function battleCorpsUsed(side, name) {
    if (!state.battle || !state.battle.units) return 0;
    return state.battle.units.filter(function (u) {
      return u.side === side && u.name === name;
    }).length;
  }

  function battleReinforceEntries(side, phase) {
    phase = String(phase || '').toLowerCase();
    const data = prepFaction(side);
    const div = battleReinforceData(side, phase);
    const out = [];
    if (!data || !div) return out;
    const keys = phase === 'b' ? ['A', 'B'] : ['C'];
    keys.forEach(function (key) {
      (div.pool && div.pool[key] || []).forEach(function (u) {
        const old = out.filter(function (x) { return x.name === u.name; })[0];
        if (old) old.max += u.max;
        else out.push({ name: u.name, max: u.max, info: prepUnitInfo(data, u.name) });
      });
    });
    const prep = sidePrep(side);
    const corps = prepCorps(data, prep);
    if (corps && corps.units) {
      corps.units.forEach(function (u) {
        const left = Math.max(0, Number(u.max) - battleCorpsUsed(side, u.name));
        if (left <= 0) return;
        const old = out.filter(function (x) { return x.name === u.name; })[0];
        if (old) old.max = Math.max(old.max, left);
        else out.push({ name: u.name, max: left, info: prepUnitInfo(data, u.name) });
      });
    }
    return out;
  }

  function battleReinforceFunds(div, side, phase) {
    if (!div) return 0;
    phase = String(phase || '').toLowerCase();
    if (phase === 'c') return Number(div.fundsC) || 0;
    return Number(side === 'attacker' ? (div.attack && div.attack.B) : (div.defense && div.defense.B)) || 0;
  }

  function battleReinforceHasNuke(side) {
    const data = prepFaction(side);
    const deck = (state.decks && state.decks[side]) || [];
    const deckNuke = deck.some(function (name) {
      return /核弹/.test(String((prepUnitInfo(data, name) || {}).traits || ''));
    });
    const fieldNuke = !!state.battle && (state.battle.units || []).some(function (u) {
      return u.side === side && /核弹/.test(String((prepUnitInfo(data, u.name) || {}).traits || ''));
    });
    if (deckNuke || fieldNuke) return true;
    const r = state.battle && state.battle.reinforce;
    const pick = r && r.picks && r.picks[side];
    if (!pick) return false;
    return battleReinforceEntries(side, r.phase).some(function (e) {
      return (Number(pick.units[e.name]) || 0) > 0 &&
        /核弹/.test(String(e.info && e.info.traits || ''));
    });
  }

  function battleNukeFundsBonus(side, phase) {
    phase = String(phase || '').toLowerCase();
    if (phase === 'b') {
      const opp = sidePrep(otherSide(side));
      return Math.max(0, Number(opp && opp.nukes) || 0) * 100;
    }
    if (phase === 'c') {
      const carry = state.battle && state.battle.nukeCarry;
      return Math.max(0, Number(carry && carry[side]) || 0);
    }
    return 0;
  }

  function battleReinforceStats(side, phase) {
    phase = String(phase || '').toLowerCase();
    const div = battleReinforceData(side, phase);
    const entries = battleReinforceEntries(side, phase);
    const byName = {};
    entries.forEach(function (e) { byName[e.name] = e; });
    const picks = state.battle && state.battle.reinforce && state.battle.reinforce.picks[side];
    const units = picks && picks.units || {};
    const nukes = Math.max(0, Number(picks && picks.nukes) || 0);
    let main = 0, support = 0, air = 0, cost = nukes * 100, total = 0;
    Object.keys(units).forEach(function (name) {
      const e = byName[name];
      const n = Number(units[name]) || 0;
      if (!e || n <= 0) return;
      total += n;
      cost += n * (e.info.price || 0);
      const slot = prepSlotClass(e.info);
      if (slot === 'air') air += n;
      else if (slot === 'main') main += n;
      else support += n;
    });
    return {
      div: div, entries: entries, units: units,
      main: main, support: support, air: air, total: total, cost: cost, nukes: nukes,
      mainLimit: div ? div.slots.main : 0,
      supportLimit: div ? div.slots.support : 0,
      planeLimit: div ? (div.planes == null ? Infinity : div.planes) : 0,
      funds: battleReinforceFunds(div, side, phase) + battleNukeFundsBonus(side, phase),
    };
  }

  function battleReinforceBegin(b, phase) {
    if (phase === 'c' && b.reinforce) {
      const last = b.nukeLastPhase || {};
      const pa = Math.max(0, Number(last.attacker) || 0);
      const pd = Math.max(0, Number(last.defender) || 0);
      b.nukeCarry = {
        attacker: pd * 100,
        defender: pa * 100,
      };
    }
    const make = function (side) {
      const div = battleReinforceData(side, phase);
      return { divisionId: div ? div.id : '', units: {}, nukes: 0 };
    };
    b.reinforce = {
      phase: phase === 'c' ? 'C' : 'B',
      round: b.round,
      stage: 'pick',
      picks: { attacker: make('attacker'), defender: make('defender') },
      ready: { attacker: false, defender: false },
      done: { attacker: false, defender: false },
      placed: { attacker: [], defender: [] },
      airborne: {
        attacker: { mode: 'zone', unitId: '' },
        defender: { mode: 'zone', unitId: '' },
      },
      seq: 0,
    };
    battleUpdateZoneOwners(b);
    b.log.push(battlePhaseLabel(phase) + ' 阶段增援开始：双方配卡后部署');
  }

  function battleReinforceCanControl(side) {
    if (!state.battle || !state.battle.reinforce || state.phase !== 'battle') return false;
    if (battleMySide() !== side) return false;
    return state.test || selfIsCaptain(side);
  }

  function battleCanReinforce(side) {
    return battleReinforceCanControl(side);
  }

  function battleInitialUsedDivisions() {
    const out = { attacker: [], defender: [] };
    ['attacker', 'defender'].forEach(function (side) {
      const prep = sidePrep(side);
      if (prep && prep.divisionId) out[side].push(prep.divisionId);
    });
    return out;
  }

  function battleIsAirUnit(name, side) {
    const data = prepFaction(side);
    const info = data && data.units ? data.units[name] : null;
    return prepUnitClass(info) === 'air';
  }

  function airPadCenter(side) {
    return side === 'attacker'
      ? { c: -3, r: Math.floor(state.map.rows / 2) }
      : { c: state.map.cols + 2, r: Math.floor(state.map.rows / 2) };
  }

  function airPadRadius(count) {
    let radius = 1;
    while (1 + 3 * radius * (radius + 1) < Math.max(1, count)) radius++;
    return radius;
  }

  function airPadCells(side, count) {
    const center = airPadCenter(side);
    const radius = airPadRadius(count);
    const cells = [];
    for (let r = center.r - radius; r <= center.r + radius; r++) {
      for (let c = center.c - radius; c <= center.c + radius; c++) {
        const d = battleHexDistance(center.c, center.r, c, r);
        if (d <= radius) cells.push({ c: c, r: r, ring: d });
      }
    }
    cells.sort(function (a, b) { return (a.ring - b.ring) || (a.r - b.r) || (a.c - b.c); });
    return cells;
  }

  function airPadCount(side) {
    if (state.phase === 'deploy') {
      return deployUnits().filter(function (u) {
        return u.side === side && (u.airBase || battleIsAirUnit(u.name, side));
      }).length;
    }
    return state.battle ? battleAliveUnits().filter(function (u) {
      return u.side === side && u.airBase;
    }).length : 0;
  }

  function autoDeployAircraft() {
    if (!state.deploy || !state.decks) return;
    ['attacker', 'defender'].forEach(function (side) {
      const existing = state.deploy.units.some(function (u) { return u.side === side && u.airBase; });
      if (existing) return;
      const airNames = (state.decks[side] || []).filter(function (name) {
        return battleIsAirUnit(name, side);
      });
      const slots = airPadCells(side, airNames.length);
      airNames.forEach(function (name, i) {
        if (!slots[i]) return;
        state.deploy.units.push({
          id: 'air-' + side + '-' + Date.now().toString(36) + '-' + i,
          side: side, name: name, c: slots[i].c, r: slots[i].r, airBase: true,
        });
      });
    });
  }

  function battleAutoDeployAir(side) {
    const b = state.battle;
    const r = b && b.reinforce;
    if (!r) return;
    const pick = r.picks[side] || {};
    const airNames = Object.keys(pick.units || {}).filter(function (name) {
      return battleIsAirUnit(name, side);
    });
    const already = (r.placed[side] || []).filter(function (p) {
      return battleIsAirUnit(p.name, side);
    }).length;
    const total = airNames.reduce(function (n, name) { return n + Number(pick.units[name] || 0); }, 0);
    if (already >= total) return;
    const slots = airPadCells(side, total);
    let idx = already;
    const faction = sideFaction(side);
    airNames.forEach(function (name) {
      const want = Number(pick.units[name]) || 0;
      for (let i = 0; i < want; i++) {
        const slot = slots[idx++];
        if (!slot) break;
        const hp = prepUnitHp(name, faction);
        const id = 'air-' + side + '-' + Date.now().toString(36) + '-' + (r.seq = (r.seq || 0) + 1);
        b.units.push({
          id: id, side: side, name: name, c: slot.c, r: slot.r,
          hp: hp, maxHp: hp, mp: 0, maxMp: prepUnitMove(name, faction),
          alive: true, lockedBy: [], reinforceNew: true, cooldownRound: b.round, airBase: true,
        });
        r.placed[side] = (r.placed[side] || []).concat([{ id: id, name: name, c: slot.c, r: slot.r }]);
      }
    });
    if (r.placed[side].length) b.log.push(sideName(side) + ' 空军进入机场');
  }

  function initBattleState() {
    const units = deployUnits().map(function (u) {
      const faction = sideFaction(u.side);
      const hp = prepUnitHp(u.name, faction);
      return {
        id: u.id, side: u.side, name: u.name, c: u.c, r: u.r,
        hp: hp, maxHp: hp, mp: 0, maxMp: prepUnitMove(u.name, faction),
        alive: true, lockedBy: [], airBase: !!u.airBase,
      };
    });
    const battle = {
      round: 1,
      phase: 'a',
      activeSide: 'attacker',
      units: units,
      buildings: [],
      counterBatteryMarks: [],
      nukeStock: {
        attacker: Math.max(0, Number((sidePrep('attacker') || {}).nukes) || 0),
        defender: Math.max(0, Number((sidePrep('defender') || {}).nukes) || 0),
      },
      nukeCarry: { attacker: 0, defender: 0 },
      selectedId: null,
      ghost: null,
      counter: null,
      choice: null,
      lastAction: '',
      log: [],
      zoneOwners: {},
      usedDivisions: battleInitialUsedDivisions(),
    };
    battleResetMp(battle, 'attacker');
    battleUpdateZoneOwners(battle);
    return battle;
  }

  function battleUnitById(id) {
    if (!state.battle || !id) return null;
    return state.battle.units.filter(function (u) { return u.id === id; })[0] || null;
  }

  function battleAliveUnits() {
    if (!state.battle) return [];
    return state.battle.units.filter(function (u) { return u.alive && !u.embarked; });
  }

  function battleUnitsFor(side) {
    return battleAliveUnits().filter(function (u) { return u.side === side; });
  }

  function battleUnitAt(c, r) {
    return battleAliveUnits().filter(function (u) { return u.c === c && u.r === r; })[0] || null;
  }

  function battleBuildingAt(c, r) {
    const list = (state.battle && state.battle.buildings) || [];
    return list.filter(function (b) { return b.c === c && b.r === r; })[0] || null;
  }

  function battleRiverResetAt(c, r) {
    const rule = battleTerrainRule(c, r);
    if (!rule || !rule.riverReset) return false;
    const b = battleBuildingAt(c, r);
    return !(b && b.t === 'bridge');
  }

  function battleCancelEngineerProject(unit, reason) {
    const b = state.battle;
    const p = b && b.engineerProject;
    if (!p || !unit || p.side !== unit.side) return;
    b.engineerProject = null;
    b.log.push(unit.name + ' 的碉堡工程中断：' + (reason || '已执行其他行动'));
  }

  function battleBuildAllowed(unit, c, r, type) {
    if (!unit || !unit.alive || !battleTrait(unit, 'engineer') || !state.map) return false;
    if (['road', 'bridge', 'trench', 'bunker'].indexOf(type) === -1) return false;
    if (!isFinite(c) || !isFinite(r)) return false;
    if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return false;
    if (battleHexDistance(unit.c, unit.r, c, r) > 1) return false;
    const occ = battleUnitAt(c, r);
    if (occ && occ.id !== unit.id) return false;
    if (battleBuildingAt(c, r)) return false;
    const tile = TERRAINS[state.map.cells[r * state.map.cols + c]];
    if (!tile) return false;
    // 沼泽：不能修建任何建筑。
    if (tile.id === 'swamp') return false;
    if (type === 'bridge') return tile.id === 'river';
    if (type === 'road' || type === 'trench') {
      return tile.id !== 'river' && tile.id !== 'swamp';
    }
    if (type === 'bunker') {
      // 碉堡只能建在平原、山地、丘陵、森林。
      return ['plain', 'hill', 'mountain', 'forest'].indexOf(tile.id) !== -1;
    }
    return false;
  }

  function battleMySide() {
    return myDeploySide();
  }

  function battleCanControl(side) {
    if (!state.battle || state.phase !== 'battle') return false;
    const mine = battleMySide();
    if (!mine || mine !== side) return false;
    if (state.battle.counter && state.battle.counter.chooserSide === side) return true;
    return state.battle.activeSide === side;
  }

  function battleCanCounter(side) {
    const mine = battleMySide();
    const s = normalizeSide(side);
    return !!(mine && s && mine === s && state.battle &&
      state.battle.counter && state.battle.counter.chooserSide === s);
  }

  function battleResetMp(battle, side) {
    if (!battle) return;
    const round = Number(battle.round) || 1;
    battle.units.forEach(function (u) {
      if (u.side === side && u.cooldownRound && round > u.cooldownRound) u.cooldownRound = 0;
      const cooling = u.side === side && u.cooldownRound && round <= u.cooldownRound;
      u.mp = u.alive && u.side === side && !cooling ? battleMaxMp(u) : 0;
      if (u.side === side) {
        u.guardStop = false;
        u.guardBy = [];
        u.pushLocked = false;
        u.actionLocked = false;
        u.artyShots = 0;
        if (u.rocketReloadRound && round > u.rocketReloadRound) u.rocketReloadRound = 0;
      }
    });
  }

  function battleActionLockUnit(unit) {
    if (!unit || battleIsAir(unit) || battleTrait(unit, 'guerrilla')) return;
    unit.actionLocked = true;
  }

  function battleMaxMp(unit) {
    if (unit && unit.airBase) return 2;
    return unit.maxMp || BATTLE_MAX_MP;
  }

  function battlePhaseOfRound(round) {
    try {
      if (window.MapIO && MapIO.phaseOfRound) {
        return MapIO.phaseOfRound(state.map && state.map.phases, round) || 'a';
      }
    } catch (e) { /* ignore */ }
    return 'a';
  }

  function battlePhaseLabel(p) {
    return p === 'c' ? 'C' : (p === 'b' ? 'B' : 'A');
  }

  function battleDayOfRound(round) {
    return Math.floor((Math.max(1, Number(round) || 1) - 1) / 3) + 1;
  }

  function battleNextPhaseInfo(round) {
    const phases = (state.map && state.map.phases) || {};
    const list = [['B', phases.b], ['C', phases.c]].filter(function (x) {
      return isFinite(x[1]) && Number(x[1]) > Number(round);
    }).sort(function (a, b) { return a[1] - b[1]; });
    if (!list.length) return { label: '', left: 0 };
    return { label: list[0][0], left: Number(list[0][1]) - Number(round) };
  }

  function battleIsMech(unit) {
    if (battleTrait(unit, 'motorized') || battleTrait(unit, 'mechanized')) return true;
    const n = String(unit && unit.name || '');
    if (/反坦克/.test(n)) return false;
    return /坦克营|中坦营|重坦营|装甲|机械化|摩托化|自行|坦歼|突击炮|灰狗|地狱猫|斯图亚特|谢尔曼|潘兴|巨无霸|T95|M10|M7|M12|管风琴|黄鼠狼|追猎者|猎豹|猎虎|鼠式|虎式|虎王|豹式/.test(n);
  }

  function battleTerrainRule(c, r) {
    if (!state.map) return null;
    const t = TERRAINS[state.map.cells[r * state.map.cols + c]];
    return t && t.rule ? t.rule : null;
  }

  function battleTerrainCost(unit, c, r) {
    const rule = battleTerrainRule(c, r);
    if (!rule) return 1;
    const bld = battleBuildingAt(c, r);
    if (bld) {
      if (bld.t === 'road') return battleIsMech(unit) ? 0.5 : 1;
      if (bld.t === 'bridge') return 1;
      if (bld.t === 'trench') return battleIsMech(unit) ? 2 : 1;
      return 1;
    }
    if (battleTrait(unit, 'mountain') && state.map) {
      const tile = TERRAINS[state.map.cells[r * state.map.cols + c]];
      if (tile && tile.id === 'hill') return 1;
      if (tile && tile.id === 'mountain') return 2;
    }
    const mv = battleIsMech(unit) ? rule.moveMech : rule.move;
    return isFinite(mv) ? mv : (isFinite(rule.move) ? rule.move : 1);
  }

  function battleIsMain(unit) {
    if (!unit) return false;
    const info = battleInfoFor(unit);
    if (info) return info.cat === 'main' || Number(info.hp) >= 4;
    return battleMaxHp(unit) >= 4;
  }

  // 两个同阵营主战单位相隔恰好 1 个空格时，中间格是警戒格。
  function battleCounterBatteryKind(unit) {
    if (!unit) return '';
    if (battleTrait(unit, 'counterBatteryRadar')) return 'radar';
    if (battleTrait(unit, 'acousticCounterBattery') || battleTrait(unit, 'counterBattery')) return 'acoustic';
    return '';
  }

  function battleCounterBatteryRange(unit) {
    const tr = battleTrait(unit, 'counterBatteryRadar') ||
      battleTrait(unit, 'acousticCounterBattery') ||
      battleTrait(unit, 'counterBattery');
    return tr && isFinite(tr.radius) ? Number(tr.radius) : 3;
  }

  function battleCounterBatteryRecord(firingUnit) {
    const b = state.battle;
    if (!b || !firingUnit || !battleArtillerySpec(firingUnit)) return;
    const listenerSide = otherSide(firingUnit.side);
    const units = battleAliveUnits().filter(function (u) {
      return u.side === listenerSide && battleCounterBatteryKind(u) &&
        battleHexDistance(u.c, u.r, firingUnit.c, firingUnit.r) <= battleCounterBatteryRange(u);
    });
    const radar = units.some(function (u) { return battleCounterBatteryKind(u) === 'radar'; });
    const acoustic = units.filter(function (u) { return battleCounterBatteryKind(u) === 'acoustic'; }).length;
    if (!radar && acoustic < 2) return;
    b.counterBatteryMarks = b.counterBatteryMarks || [];
    if (b.counterBatteryMarks.some(function (m) {
      return m.c === firingUnit.c && m.r === firingUnit.r && m.forSide === listenerSide && m.round === b.round;
    })) return;
    b.counterBatteryMarks.push({
      c: firingUnit.c, r: firingUnit.r, forSide: listenerSide, round: b.round,
      source: radar ? 'radar' : 'acoustic',
    });
    b.log.push(sideName(listenerSide) + (radar ? ' 反炮兵雷达' : ' 声学反炮兵') +
      ' 记录炮位：' + firingUnit.c + ',' + firingUnit.r + '（下回合可直接攻击）');
  }

  function battleCounterBatteryMarkAt(side, c, r) {
    return ((state.battle && state.battle.counterBatteryMarks) || []).filter(function (m) {
      return m.forSide === side && m.c === c && m.r === r;
    })[0] || null;
  }

  function battleClearCounterBatteryMark(side, c, r) {
    if (!state.battle || !state.battle.counterBatteryMarks) return;
    state.battle.counterBatteryMarks = state.battle.counterBatteryMarks.filter(function (m) {
      return !(m.forSide === side && m.c === c && m.r === r);
    });
  }

  function battleGuardCells(side) {
    const map = {};
    const mains = battleAliveUnits().filter(function (u) {
      return u.side === side && battleIsMain(u) && !u.confused;
    });
    for (let i = 0; i < mains.length; i++) {
      for (let j = i + 1; j < mains.length; j++) {
        const a = mains[i], b = mains[j];
        if (battleHexDistance(a.c, a.r, b.c, b.r) !== 2) continue;
        HG.neighbors(a.c, a.r).forEach(function (p) {
          const c = p[0], r = p[1];
          if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
          if (battleHexDistance(c, r, b.c, b.r) !== 1) return;
          if (battleUnitAt(c, r)) return;
          const idx = r * state.map.cols + c;
          const old = map[idx] || [];
          if (old.indexOf(a.id) === -1) old.push(a.id);
          if (old.indexOf(b.id) === -1) old.push(b.id);
          map[idx] = old;
        });
      }
    }
    // 中坦/重坦自带一圈警戒区。
    battleAliveUnits().forEach(function (u) {
      if (u.side !== side || u.confused || (!battleTrait(u, 'heavyTank') && !battleTrait(u, 'mediumTank'))) return;
      HG.neighbors(u.c, u.r).forEach(function (p) {
        const c = p[0], r = p[1];
        if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
        if (battleUnitAt(c, r)) return;
        const idx = r * state.map.cols + c;
        const old = map[idx] || [];
        if (old.indexOf(u.id) === -1) old.push(u.id);
        map[idx] = old;
      });
    });
    // 碉堡自带一圈警戒区；若碉堡上的己方单位混乱，则警戒区失效。
    ((state.battle && state.battle.buildings) || []).forEach(function (b) {
      if (b.t !== 'bunker' || b.side !== side) return;
      const occupant = battleUnitAt(b.c, b.r);
      if (occupant && occupant.side === side && occupant.confused) return;
      HG.neighbors(b.c, b.r).forEach(function (p) {
        const c = p[0], r = p[1];
        if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
        if (battleUnitAt(c, r)) return;
        const idx = r * state.map.cols + c;
        if (!map[idx]) map[idx] = ['bunker'];
      });
    });
    return map;
  }

  function battleGuardInfoAt(side, c, r) {
    if (!state.map) return null;
    const cell = battleGuardCells(side)[r * state.map.cols + c];
    return cell && cell.length ? cell : null;
  }

  function battleFindPath(unit, tc, tr) {
    const map = state.map;
    if (!map || !unit) return null;
    if (tc < 0 || tr < 0 || tc >= map.cols || tr >= map.rows) return null;
    if (unit.c === tc && unit.r === tr) return null;
    if (battleUnitAt(tc, tr)) return null;
    const n = map.cols * map.rows;
    const dist = new Array(n);
    const prev = new Array(n);
    const used = new Array(n);
    for (let i = 0; i < n; i++) { dist[i] = Infinity; prev[i] = -1; used[i] = false; }
    const start = unit.r * map.cols + unit.c;
    const target = tr * map.cols + tc;
    dist[start] = 0;
    const occupied = {};
    battleAliveUnits().forEach(function (u) {
      // 友军可以被跨过，只有敌军阻挡路线；终点仍不能落在任何单位上。
      if (u.id !== unit.id && u.side !== unit.side) occupied[u.r * map.cols + u.c] = true;
    });
    const guardMap = battleGuardCells(otherSide(unit.side));
    for (let loop = 0; loop < n; loop++) {
      let cur = -1, best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!used[i] && dist[i] < best) { best = dist[i]; cur = i; }
      }
      if (cur < 0) break;
      if (cur === target) break;
      used[cur] = true;
      const cc = cur % map.cols, cr = Math.floor(cur / map.cols);
      // 上河后行动力清零；有桥的河流格可以当作普通过路格。
      if (cur !== start && battleRiverResetAt(cc, cr)) continue;
      // 进入警戒格必须停下，不能从警戒格继续往外走。
      if (cur !== start && guardMap[cur]) continue;
      const nb = HG.neighbors(cc, cr);
      for (let k = 0; k < nb.length; k++) {
        const nc = nb[k][0], nr = nb[k][1];
        if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
        const ni = nr * map.cols + nc;
        if (occupied[ni] && ni !== target) continue;
        const nd = dist[cur] + battleTerrainCost(unit, nc, nr);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = cur;
        }
      }
    }
    if (!isFinite(dist[target])) return null;
    const path = [];
    let cur = target;
    while (cur !== start && cur >= 0) {
      path.push({ c: cur % map.cols, r: Math.floor(cur / map.cols) });
      cur = prev[cur];
    }
    path.reverse();
    return { cost: dist[target], path: path };
  }

  function battleReachableCells(unit) {
    const out = {};
    const map = state.map;
    if (!map || !unit || unit.airBase || unit.actionLocked || unit.pushLocked || unit.guardStop) return out;
    if (Number(unit.mp) <= 0) return out;
    const n = map.cols * map.rows;
    const dist = new Array(n);
    const used = new Array(n);
    for (let i = 0; i < n; i++) { dist[i] = Infinity; used[i] = false; }
    const start = unit.r * map.cols + unit.c;
    dist[start] = 0;
    const occupied = {};
    battleAliveUnits().forEach(function (u) {
      if (u.id !== unit.id && u.side !== unit.side) occupied[u.r * map.cols + u.c] = true;
    });
    const guardMap = battleGuardCells(otherSide(unit.side));
    for (let loop = 0; loop < n; loop++) {
      let cur = -1, best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!used[i] && dist[i] < best) { best = dist[i]; cur = i; }
      }
      if (cur < 0 || best > unit.mp) break;
      used[cur] = true;
      const cc = cur % map.cols, cr = Math.floor(cur / map.cols);
      if (cur !== start && !battleUnitAt(cc, cr)) out[cur] = best;
      if (cur !== start && battleRiverResetAt(cc, cr)) continue;
      if (cur !== start && guardMap[cur]) continue;
      const nb = HG.neighbors(cc, cr);
      for (let k = 0; k < nb.length; k++) {
        const nc = nb[k][0], nr = nb[k][1];
        if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
        const ni = nr * map.cols + nc;
        if (occupied[ni]) continue;
        const nd = best + battleTerrainCost(unit, nc, nr);
        if (nd < dist[ni]) dist[ni] = nd;
      }
    }
    return out;
  }

  function refreshBattle3DMoveRange() {
    if (!B3 || !B3.moveRangeGroup || !state.map || !state.battle) return;
    const THREE = window.THREE;
    const L = b3Layout();
    const plate = b3HexPlateGeo();
    if (!THREE || !L || !plate) return;
    b3ClearGroup(B3.moveRangeGroup);
    const unit = battleUnitById(state.battle.selectedId);
    if (!unit || !unit.alive || unit.side !== battleMySide() || unit.actionLocked ||
        unit.pushLocked || unit.guardStop || battleIsAir(unit)) {
      B3.need = true;
      return;
    }
    const cells = battleReachableCells(unit);
    Object.keys(cells).forEach(function (key) {
      const idx = Number(key);
      const cost = cells[key];
      const c = idx % state.map.cols, r = Math.floor(idx / state.map.cols);
      const w = L.cell(c, r);
      const ready = unit.mp - cost >= 2;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4a86e0, transparent: true, opacity: ready ? 0.75 : 0.28,
        depthWrite: false, side: THREE.DoubleSide,
      });
      mat._b3Dispose = true;
      const m = new THREE.Mesh(plate, mat);
      m.position.set(w[0], L.TOP + 0.09, w[1]);
      B3.moveRangeGroup.add(m);
    });
    B3.need = true;
  }

  function refreshBattleCounterBatteryMarks() {
    if (!B3 || !B3.counterBatteryGroup || !state.map || !state.battle) return;
    const THREE = window.THREE;
    const L = b3Layout();
    if (!THREE || !L) return;
    b3ClearGroup(B3.counterBatteryGroup);
    const side = battleMySide();
    if (!side) return;
    (state.battle.counterBatteryMarks || []).forEach(function (m) {
      if (m.forSide !== side) return;
      const w = L.cell(m.c, m.r);
      const y = L.TOP + 0.26;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff1414, transparent: true, opacity: 0.95,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      mat._b3Dispose = true;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(L.HEXR * 0.62, L.HEXR * 0.82, 32),
        mat
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w[0], y, w[1]);
      ring.renderOrder = 30;
      B3.counterBatteryGroup.add(ring);
      const barMat = new THREE.MeshBasicMaterial({
        color: 0xff0808, transparent: true, opacity: 0.95,
        depthTest: false, depthWrite: false,
      });
      barMat._b3Dispose = true;
      const barX = new THREE.Mesh(
        new THREE.BoxGeometry(L.HEXR * 1.7, 0.10, L.HEXR * 0.20),
        barMat
      );
      barX.position.set(w[0], y, w[1]);
      barX.renderOrder = 31;
      B3.counterBatteryGroup.add(barX);
      const barZ = new THREE.Mesh(
        new THREE.BoxGeometry(L.HEXR * 0.20, 0.10, L.HEXR * 1.7),
        barMat
      );
      barZ.position.set(w[0], y, w[1]);
      barZ.renderOrder = 31;
      B3.counterBatteryGroup.add(barZ);
      const dot = new THREE.Mesh(
        new THREE.CylinderGeometry(L.HEXR * 0.16, L.HEXR * 0.16, 0.14, 16),
        barMat
      );
      dot.position.set(w[0], y + 0.06, w[1]);
      dot.renderOrder = 32;
      B3.counterBatteryGroup.add(dot);
    });
    B3.need = true;
  }

  function refreshBattle3DBombHint() {
    if (!B3 || !B3.bombHintGroup || !state.map) return;
    const THREE = window.THREE;
    const L = b3Layout();
    const plate = b3HexPlateGeo();
    if (!THREE || !L || !plate) return;
    b3ClearGroup(B3.bombHintGroup);
    const hint = state.b3BombHint;
    const target = hint && battleUnitById(hint.targetId);
    if (!target) { B3.need = true; return; }
    const cells = battleBombCells(target, hint.dir);
    cells.forEach(function (cell) {
      const w = L.cell(cell.c, cell.r);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff3b30, transparent: true, opacity: 0.38,
        depthWrite: false, side: THREE.DoubleSide,
      });
      mat._b3Dispose = true;
      const m = new THREE.Mesh(plate, mat);
      m.position.set(w[0], L.TOP + 0.13, w[1]);
      B3.bombHintGroup.add(m);
      const pts = HG.corners(0, 0, L.HEXR * 0.88).map(function (p) {
        return new THREE.Vector3(p[0], L.TOP + 0.16, -p[1]);
      });
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.8, depthTest: false })
      );
      line.material._b3Dispose = true;
      line.position.set(w[0], 0, w[1]);
      B3.bombHintGroup.add(line);
    });
    const first = L.cell(target.c, target.r);
    const label = b3CostSprite('重轰覆盖', { color: '#ff6b57' });
    if (label) {
      label.position.set(first[0], L.TOP + L.HEXR * 3.0, first[1]);
      B3.bombHintGroup.add(label);
    }
    B3.need = true;
  }

  function battleInfoFor(unit) {
    if (!unit) return null;
    const f = state.prepData && state.prepData.factions ? state.prepData.factions[sideFaction(unit.side)] : null;
    return f && f.units ? (f.units[unit.name] || null) : null;
  }

  function battleDistanceKey(a, b) {
    const d = battleHexDistance(a.c, a.r, b.c, b.r);
    if (d <= 1) {
      const ar = battleTerrainRule(a.c, a.r);
      const br = battleTerrainRule(b.c, b.r);
      return ((ar && ar.urban) || (br && br.urban)) ? 'urban' : 'r1';
    }
    return 'r2';
  }

  function battleArmorValue(info, zone) {
    if (!info || !info.av) return 0;
    if (zone === 'side') return Number(info.av.side) || 0;
    if (zone === 'rear') return Number(info.av.rear) || 0;
    return Number(info.av.front) || 0;
  }

  const BATTLE_FACING_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  function battleDirectionIndex(fromC, fromR, toC, toR) {
    const a = HG.toAxial(fromC, fromR);
    const e = HG.toAxial(toC, toR);
    const q = e[0] - a[0], r = e[1] - a[1];
    if (!q && !r) return 0;
    // 转成六边形世界向量后按“单位方向向量”比较，不能直接用轴坐标点积：
    // 轴坐标下相邻方向长度不同，会在 (0,-1) 这类方向上出现平票，误判成相邻的另一个方向。
    const vx = q + r * 0.5;
    const vy = r * Math.sqrt(3) / 2;
    let best = 0, bestScore = -Infinity;
    BATTLE_FACING_DIRS.forEach(function (d, i) {
      const dx = d[0] + d[1] * 0.5;
      const dy = d[1] * Math.sqrt(3) / 2;
      const score = (vx * dx + vy * dy) / Math.hypot(dx, dy);
      if (score > bestScore + 1e-9) { bestScore = score; best = i; }
    });
    return best;
  }

  function battleFacingDiff(facing, dir) {
    let d = Math.abs((Number(facing) || 0) - (Number(dir) || 0));
    if (d > 3) d = 6 - d;
    return d;
  }

  function battleFacingZone(facing, dir) {
    const d = battleFacingDiff(facing, dir);
    // 六边形每档 60°：0° 和 ±60° 都是正面；120° 为侧面；180° 为后方。
    if (d <= 1) return 'front';
    if (d === 2) return 'side';
    return 'rear';
  }

  function battleFacingStats(target, attackers) {
    const list = (attackers || []).filter(function (u) { return u && u.alive; });
    const out = [];
    for (let f = 0; f < 6; f++) {
      const calcs = list.map(function (a) {
        return {
          a: a,
          c: battleAttackRawOne(a, target, battleDistanceKey(a, target), null, f),
          dir: battleDirectionIndex(target.c, target.r, a.c, a.r),
        };
      });
      let bestPen = 0;
      calcs.forEach(function (x) { if (!x.c.indirect && x.c.pen > bestPen) bestPen = x.c.pen; });
      let damage = 0;
      let confusion = 0;
      calcs.forEach(function (x) {
        const zone = battleFacingZone(f, x.dir);
        // 合作进攻穿透：直射单位全队取最高穿透等级；炮兵固定伤害保留自身规则。
        damage += x.c.indirect ? x.c.raw :
          x.c.base * bestPen * (1 - x.c.protect) * x.c.night * x.c.airMod;
        if (battleHexDistance(x.a.c, x.a.r, target.c, target.r) === 1 &&
            (zone === 'side' || zone === 'rear') &&
            battleIsMain(x.a) && (Number(x.a.maxHp) || Number(x.a.hp) || 0) >= 4) {
          confusion++;
        }
      });
      const terrain = battleTerrainRule(target.c, target.r);
      const chaos = terrain && isFinite(terrain.chaos) ? Number(terrain.chaos) : 0;
      out.push({
        facing: f, damage: damage, pen: bestPen, count: confusion,
        // 全队都无法穿透时不计算混乱。
        chance: bestPen > 0.2 ? Math.min(1, Math.max(0, (confusion + chaos) / 6)) : 0,
      });
    }
    return out;
  }

  function battleAutoFacing(target, attackers) {
    const opts = battleFacingStats(target, attackers);
    const minD = Math.min.apply(null, opts.map(function (o) { return o.damage; }));
    const minC = Math.min.apply(null, opts.map(function (o) { return o.chance; }));
    const both = opts.filter(function (o) { return o.damage <= minD + 1e-9 && o.chance <= minC + 1e-9; });
    return {
      options: opts,
      minDamage: minD,
      minConfusion: minC,
      conflict: both.length === 0,
      facing: both.length ? both[0].facing : opts.filter(function (o) { return o.damage <= minD + 1e-9; })[0].facing,
    };
  }

  function battleHasArmor(info) {
    if (!info || !info.av) return false;
    return (Number(info.av.front) || 0) > 0 ||
      (Number(info.av.side) || 0) > 0 ||
      (Number(info.av.rear) || 0) > 0;
  }

  function battleIsTransportTarget(unit) {
    return !!(unit && unit.carryingId && battleTrait(unit, 'transport'));
  }

  function battlePenMod(ap, av) {
    const d = (Number(ap) || 0) - (Number(av) || 0);
    if (d > 3) return 1.0;
    if (d > 0) return 0.5;
    if (d >= -3) return 0.33;
    return 0.2;
  }

  function battleAttackBase(info, targetInfo, key, forceSoft) {
    if (!info || !info.attack) return 0;
    const p = info.attack[key] || [0, 0];
    return Number(p[(forceSoft || !battleHasArmor(targetInfo)) ? 0 : 1]) || 0;
  }

  function battleAttackAP(info, key) {
    if (!info || !info.ap) return 0;
    return Number(info.ap[key]) || 0;
  }

  function battleIsAir(unit) {
    if (!unit) return false;
    if (unit.airBase) return true;
    const info = battleInfoFor(unit);
    return !!(info && info.cat === 'air');
  }

  const TRAIT_MODULES = {};
  let TRAIT_PARSE_CACHE = {};

  function traitRegister(def) {
    if (!def || !def.id) return;
    TRAIT_MODULES[def.id] = def;
  }

  function parseTraitText(text) {
    const raw = String(text || '');
    if (TRAIT_PARSE_CACHE[raw]) return TRAIT_PARSE_CACHE[raw];
    const out = {};
    Object.keys(TRAIT_MODULES).forEach(function (id) {
      const def = TRAIT_MODULES[id];
      let parsed = null;
      try { parsed = def.parse ? def.parse(raw) : null; } catch (e) { parsed = null; }
      if (parsed) out[id] = parsed;
    });
    TRAIT_PARSE_CACHE[raw] = out;
    return out;
  }

  function battleTraitValues(unit) {
    const info = unit ? battleInfoFor(unit) : null;
    return parseTraitText(info && info.traits);
  }

  function battleTrait(unit, id) {
    return battleTraitValues(unit)[id] || null;
  }

  function battleTraitHook(unit, hook, ctx) {
    const values = battleTraitValues(unit);
    Object.keys(values).forEach(function (id) {
      const def = TRAIT_MODULES[id];
      if (def && def.hooks && def.hooks[hook]) def.hooks[hook](values[id], unit, ctx || {});
    });
  }

  traitRegister({
    id: 'recon',
    label: '侦察',
    parse: function (text) {
      if (!/侦察|侦查/.test(text)) return null;
      const m = text.match(/侦[察查]半径\s*(\d+)/);
      return { radius: m ? Math.max(1, parseInt(m[1], 10)) : BATTLE_VISION };
    },
    hooks: {},
  });

  traitRegister({
    id: 'artillery',
    label: '曲射',
    parse: function (text) {
      if (!/曲射/.test(text)) return null;
      const dm = text.match(/曲射伤害\s*([0-9.]+)/);
      const rm = text.match(/(?:^|[^杀伤])半径\s*(\d+)/);
      return {
        damage: dm ? Number(dm[1]) || 0 : 1,
        range: rm ? Math.max(3, parseInt(rm[1], 10)) : 3,
      };
    },
    hooks: {},
  });

  traitRegister({
    id: 'rocket',
    label: '火箭炮',
    parse: function (text) {
      if (!/火箭炮/.test(text)) return null;
      const dm = text.match(/伤害\s*([0-9.]+)/);
      return { damage: dm ? Number(dm[1]) || 0 : 2, range: 7, blast: 1 };
    },
    hooks: {},
  });

  traitRegister({
    id: 'antiAir',
    label: '防空',
    parse: function (text) {
      if (!/防空/.test(text)) return null;
      const rm = text.match(/防空半径\s*(\d+)/);
      if (!rm) return { supportOnly: true };
      const dm = text.match(/伤害\s*([0-9.]+)/);
      return { radius: Math.max(1, parseInt(rm[1], 10)), damage: dm ? Number(dm[1]) || 0 : 1 };
    },
    hooks: {},
  });

  traitRegister({
    id: 'intercept',
    label: '拦截',
    parse: function (text) {
      const m = text.match(/拦截伤害\s*([0-9.]+)/);
      return m ? { damage: Number(m[1]) || 0 } : null;
    },
    hooks: {},
  });

  traitRegister({
    id: 'airGround',
    label: '空中压制',
    parse: function (text) {
      const m = text.match(/空中压制\s*([0-9.]+)\s*\/\s*([0-9.]+)/);
      return m ? { soft: Number(m[1]) || 0, hard: Number(m[2]) || 0 } : null;
    },
    hooks: {},
  });

  traitRegister({
    id: 'heavyBomber',
    label: '重轰',
    parse: function (text) {
      return /重轰/.test(text) ? { airGround: { soft: 3, hard: 2 } } : null;
    },
    hooks: {},
  });

  traitRegister({
    id: 'motorized',
    label: '摩托化',
    parse: function (text) { return /摩托化/.test(text) ? {} : null; },
    hooks: {},
  });

  traitRegister({
    id: 'mechanized',
    label: '机械化',
    parse: function (text) { return /机械化/.test(text) ? {} : null; },
    hooks: {},
  });

  ['hidden', 'engineer', 'medical', 'militaryPolice', 'counterBattery', 'acousticCounterBattery',
    'counterBatteryRadar', 'transport',
    'mountain', 'political', 'airborne', 'demolition', 'heartbreak', 'heavyTank', 'mediumTank',
    'highAltitude', 'nuke', 'guerrilla'].forEach(function (id) {
    const labels = {
      hidden: '隐蔽', engineer: '工程', medical: '医疗', militaryPolice: '宪兵',
      counterBattery: '反炮兵', acousticCounterBattery: '声学反炮兵', counterBatteryRadar: '反炮兵雷达',
      transport: '地面运输', mountain: '山地作战',
      political: '政治军队', airborne: '空降', demolition: '爆破', heartbreak: '碎心',
      heavyTank: '重坦', mediumTank: '中坦', highAltitude: '高空', nuke: '核弹', guerrilla: '游击队',
    };
    traitRegister({
      id: id,
      label: labels[id],
      parse: function (text) { return text.indexOf(labels[id]) !== -1 ? {} : null; },
      hooks: {},
    });
  });

  traitRegister({
    id: 'acousticCounterBattery',
    label: '声学反炮兵',
    parse: function (text) {
      if (!/声学反炮兵/.test(text)) return null;
      const m = text.match(/声学反炮兵\s*([0-9]+)/);
      return { radius: m ? Math.max(1, parseInt(m[1], 10)) : 3 };
    },
    hooks: {},
  });

  traitRegister({
    id: 'counterBatteryRadar',
    label: '反炮兵雷达',
    parse: function (text) {
      if (!/反炮兵雷达/.test(text)) return null;
      const m = text.match(/反炮兵雷达\s*([0-9]+)/);
      return { radius: m ? Math.max(1, parseInt(m[1], 10)) : 3 };
    },
    hooks: {},
  });

  traitRegister({
    id: 'hidden',
    label: '隐蔽',
    parse: function (text) { return /隐蔽/.test(text) ? {} : null; },
    hooks: {
      counterDamage: function () { return 0; },
    },
  });

  function battleCounterScale(unit) {
    return unit && battleTrait(unit, 'hidden') ? 0 : 1;
  }

  function battleAirGroundStats(unit) {
    const ag = battleTrait(unit, 'airGround');
    if (ag) return ag;
    const hb = battleTrait(unit, 'heavyBomber');
    return hb ? hb.airGround : { soft: 0, hard: 0 };
  }

  function battleAirIntercept(unit) {
    const tr = battleTrait(unit, 'intercept');
    return tr ? tr.damage : 0;
  }

  function battleAntiAirSpec(unit) {
    if (!unit || battleIsAir(unit)) return null;
    const tr = battleTrait(unit, 'antiAir');
    return tr && tr.radius ? { radius: tr.radius, damage: tr.damage } : null;
  }

  function battleSideHasAir(side) {
    return battleAliveUnits().some(function (u) { return u.side === side && battleIsAir(u); });
  }

  function battleSideHasAA(side) {
    return battleAliveUnits().some(function (u) { return u.side === side && !!battleAntiAirSpec(u); });
  }

  let battleAirSupCache = null;

  function battleAirSuperiorityFor(air, target) {
    if (!air || !battleIsAir(air) || !target) return false;
    // 只有本次出击的飞机才谈制空；目标方有可拦截飞机或防空支援时不成立。
    if (battleAntiAirCover(target.side, target).length) return false;
    const enemyAir = battleAliveUnits().some(function (u) {
      return u.side === target.side && battleIsAir(u) && battleAirIntercept(u) > 0;
    });
    return !enemyAir;
  }

  function battleAirHasOwnVision(air, target) {
    if (!battleIsAir(air) || !target) return false;
    const own = battleAliveUnits().filter(function (u) { return u.side === air.side && !battleIsAir(u); });
    for (let i = 0; i < own.length; i++) {
      const u = own[i];
      if (battleIsRecon(u) &&
          battleHexDistance(u.c, u.r, target.c, target.r) <= battleReconRadius(u)) return true;
      if (battleHexDistance(u.c, u.r, target.c, target.r) === 1) return true;
    }
    return false;
  }

  function battleAirCanTarget(air, target) {
    if (!battleIsAir(air) || !target || target.side === air.side || battleIsAir(target)) return false;
    if (battleLockedBySide(target, air.side)) return true;
    return battleAirHasOwnVision(air, target);
  }

  function battleIsReconPlane(unit) {
    return !!(unit && unit.alive && battleIsAir(unit) && battleIsRecon(unit));
  }

  function battleReconAvailable(unit) {
    if (!battleIsReconPlane(unit) || !state.battle) return false;
    return !(unit.reconUsedRound && Number(unit.reconUsedRound) >= Number(state.battle.round || 0));
  }

  function battleSetReconMission(unit, c, r) {
    unit.c = c;
    unit.r = r;
    unit.airBase = false;
    unit.reconActiveRound = Number(state.battle.round) || 1;
    unit.reconUsedRound = Number(state.battle.round) || 1;
    unit.reconCell = { c: c, r: r };
    state.battle.selectedId = unit.id;
    state.battle.log.push(unit.name + ' 侦察 ' + c + ',' + r + '（持续到本回合结束）');
    battleRefresh();
  }

  function battleBeginReconIntercept(unit, c, r) {
    const b = state.battle;
    const defender = otherSide(unit.side);
    const opts = battleAirInterceptOptions(defender);
    if (!b || !opts.length) return false;
    b.airIntercept = {
      kind: 'recon',
      key: 're-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      attackerSide: unit.side,
      defenderSide: defender,
      attackerIds: [unit.id],
      targetName: '侦察格 ' + c + ',' + r,
      reconC: c,
      reconR: r,
      attackerCount: 1,
      role: 'recon',
    };
    b.selectedId = null;
    b.log.push(unit.name + ' 前往 ' + c + ',' + r + ' 侦察，等待' + sideName(defender) + '选择拦截飞机');
    battleRefresh();
    return true;
  }

  function battleNukeStrike(air, target) {
    const b = state.battle;
    if (!b || !air || !target) return;
    const centerHp = Number(target.hp) || 0;
    battleDamageUnit(target, centerHp + 999);
    b3AddDamageFloat(target, centerHp + 999, '#ff3b2f');
    battleAliveUnits().forEach(function (u) {
      if (u.id === target.id || u.airBase || battleIsAir(u)) return;
      const d = battleHexDistance(u.c, u.r, target.c, target.r);
      if (d < 1 || d > 2) return;
      let dmg = d === 1 ? 4 : 2;
      const bld = battleBuildingAt(u.c, u.r);
      if (bld && bld.t === 'bunker') dmg *= 0.1;
      battleDamageUnit(u, dmg);
      b3AddDamageFloat(u, dmg, '#ff6b57');
    });
    b.log.push(air.name + ' 投掷核弹 ' + target.name + '：中心必死，半径1受到4伤，半径2受到2伤，敌友不分');
  }

  function battleBeginAirIntercept(unit, target, attackerIds, role) {
    const b = state.battle;
    const opts = battleAirInterceptOptions(target.side);
    if (!b || !opts.length) return false;
    b.airIntercept = {
      key: 'ai-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      attackerSide: unit.side,
      defenderSide: target.side,
      attackerIds: attackerIds.slice(),
      targetId: target.id,
      targetName: target.name,
      attackerCount: attackerIds.length,
      role: role || 'bomb',
    };
    b.selectedId = null;
    b.log.push(unit.name + ' 出击 ' + target.name + '，等待' + sideName(target.side) + '选择拦截飞机');
    battleRefresh();
    return true;
  }

  function battleResolveReconIntercept(ids) {
    const b = state.battle;
    const ai = b && b.airIntercept;
    if (!b || !ai || ai.kind !== 'recon') return;
    const recon = battleUnitById((ai.attackerIds || [])[0]);
    const c = Number(ai.reconC), r = Number(ai.reconR);
    if (!recon || !recon.alive) {
      b.airIntercept = null;
      battleRefresh();
      return;
    }
    if (battleIsNight()) {
      b.airIntercept = null;
      b.log.push('夜间侦察机返航，侦察任务取消');
      battleRefresh();
      return;
    }
    const opts = battleAirInterceptOptions(ai.defenderSide);
    const interceptors = (ids || []).map(battleUnitById).filter(function (u) {
      return u && u.alive && opts.some(function (o) { return o.id === u.id; });
    }).slice(0, 2);
    interceptors.forEach(function (it, i) {
      it.interceptUsedRound = Number(b.round) || 1;
      b3StartAirFlight(it, { c: c, r: r }, null, i * 0.22);
    });
    interceptors.forEach(function (it) {
      if (!it.alive || !recon.alive) return;
      let dmg = battleAirIntercept(it);
      if (battleHighAltitude(recon) && !battleHighAltitude(it)) dmg *= 0.2;
      if (dmg <= 0) return;
      battleDamageUnit(recon, dmg);
      b3AddDamageFloat(recon, dmg, '#ffb36b');
      b.log.push(it.name + ' 拦截侦察机 ' + recon.name + '：' + battleFmt(dmg) +
        (recon.alive ? '，侦察机继续任务' : '，侦察机被击落'));
    });
    // 武装侦察机可以同时还击参与拦截的战斗机。
    if (recon.alive && battleAirIntercept(recon) > 0) {
      const targetFighter = interceptors.filter(function (it) { return it.alive; })[0];
      if (targetFighter) {
        const back = battleAirIntercept(recon);
        battleDamageUnit(targetFighter, back);
        b3AddDamageFloat(targetFighter, back, '#ff6b57');
        b.log.push(recon.name + ' 还击 ' + targetFighter.name + '：' + battleFmt(back));
      }
    }
    b.airIntercept = null;
    if (recon.alive) {
      battleSetReconMission(recon, c, r);
    } else {
      b.selectedId = null;
      battleRefresh();
    }
    battleCheckAutoEnd();
  }

  function battleResolveAirIntercept(ids) {
    const b = state.battle;
    const ai = b && b.airIntercept;
    if (!ai) return;
    if (ai.kind === 'recon') {
      battleResolveReconIntercept(ids);
      return;
    }
    const target = battleUnitById(ai.targetId);
    const attackers = ai.attackerIds.map(battleUnitById).filter(function (u) { return u && u.alive; });
    const opts = battleAirInterceptOptions(ai.defenderSide);
    const interceptors = (ids || []).map(battleUnitById).filter(function (u) {
      return u && u.alive && opts.some(function (o) { return o.id === u.id; });
    }).slice(0, 2);
    if (!target || !target.alive || !attackers.length) {
      b.airIntercept = null;
      battleRefresh();
      return;
    }
    const aborted = {};
    interceptors.forEach(function (it, i) {
      it.interceptUsedRound = Number(b.round) || 1;
      b3StartAirFlight(it, target, null, i * 0.22);
    });
    // 敌方防空会拦截防守方派出的拦截机；被防空咬住就退出本次拦截。
    interceptors.forEach(function (it) {
      const hit = battleAirPathIntercept(it, target);
      if (!hit || !it.alive) return;
      battleDamageUnit(it, hit.spec.damage);
      b3AddDamageFloat(it, hit.spec.damage, '#ffb36b');
      aborted[it.id] = true;
      b.log.push(hit.aa.name + ' 拦截防守方飞机 ' + it.name + '：' + hit.spec.damage +
        (it.alive ? '，该机退出拦截任务' : '，该机被击落'));
    });
    // 防守方防空“参战支援”：己方拦截机与敌机交战时，半径 +1 内的防空可加入，只打敌机。
    const defenderAA = battleAliveUnits().filter(function (u) {
      if (u.side !== ai.defenderSide) return false;
      const spec = battleAntiAirSpec(u);
      if (!spec) return false;
      return interceptors.some(function (it) {
        return it.alive && battleHexDistance(u.c, u.r, it.c, it.r) <= spec.radius + 1;
      }) || (target && battleHexDistance(u.c, u.r, target.c, target.r) <= spec.radius + 1);
    });
    defenderAA.forEach(function (aa) {
      const spec = battleAntiAirSpec(aa);
      if (!spec) return;
      const alive = attackers.filter(function (a) { return a.alive; });
      if (!alive.length) return;
      battleDamageUnit(alive[0], spec.damage);
      b3AddDamageFloat(alive[0], spec.damage, '#ff6b57');
      b.log.push(aa.name + ' 参战支援，防空射击 ' + alive[0].name + '：' + spec.damage);
    });
    const maxAttackerSpeed = attackers.reduce(function (m, a) { return Math.max(m, battleAirSpeed(a)); }, 0);
    interceptors.forEach(function (it) {
      if (!it.alive || aborted[it.id]) return;
      const aliveAttackers = attackers.filter(function (a) { return a.alive; });
      if (!aliveAttackers.length) return;
      const base = battleAirIntercept(it);
      if (base <= 0) return;
      const fast = battleAirSpeed(it) > maxAttackerSpeed;
      const hits = [];
      if (fast && aliveAttackers.length === 1) {
        hits.push({ u: aliveAttackers[0], d: base * 1.5, extra: true });
      } else {
        hits.push({ u: aliveAttackers[0], d: base, extra: false });
        if (fast && aliveAttackers.length > 1) hits.push({ u: aliveAttackers[1], d: base, extra: true });
      }
      hits.forEach(function (h) {
        if (battleHighAltitude(h.u) && !battleHighAltitude(it)) h.d *= 0.2;
        battleDamageUnit(h.u, h.d);
        b3AddDamageFloat(h.u, h.d, '#ff6b57');
        b.log.push(it.name + ' 拦截 ' + h.u.name + '：' + battleFmt(h.d) +
          (h.extra ? '（速度决胜）' : ''));
      });
    });
    const survivors = attackers.filter(function (a) { return a.alive; });
    if (survivors.length) {
      const bombTargets = ai.dir != null ? battleBombTargets(target, ai.dir) : [target];
      const logs = [];
      bombTargets.forEach(function (tgt) {
        let raw = 0;
        survivors.forEach(function (a) {
          const stats = battleAirGroundStats(a);
          const info = battleInfoFor(tgt);
          raw += (battleIsTransportTarget(tgt) ? stats.soft : (battleHasArmor(info) ? stats.hard : stats.soft)) *
            (battleAirSuperiorityFor(a, tgt) ? 1.5 : 1) * (1 - battleProtectAt(tgt.c, tgt.r));
        });
        const dmg = battleRollDamage(raw);
        battleDamageUnit(tgt, dmg);
        b3AddDamageFloat(tgt, dmg, '#ff6b57');
        logs.push(tgt.name + ' -' + dmg + '（' + battleFmt(raw) + '）');
      });
      b.log.push('空袭命中 ' + target.name + '：' + logs.join('；'));
    } else {
      b.log.push('空袭被拦截机击退，目标未受损');
    }
    attackers.forEach(function (a) {
      a.mp = Math.max(0, a.mp - battleAirActionCost(a, target, 'bomb'));
    });
    survivors.forEach(function (a, i) { b3StartAirFlight(a, target, null, i * 0.28); });
    if (b.airIntercept) {
      target.lockedBy = [];
      target.lockCosts = {};
    }
    b.airIntercept = null;
    b.selectedId = null;
    battleRefresh();
    battleCheckAutoEnd();
  }

  function battleAirInterceptOptions(side) {
    const round = state.battle ? Number(state.battle.round) || 0 : 0;
    return battleAliveUnits().filter(function (u) {
      return u.side === side && battleIsAir(u) && battleAirIntercept(u) > 0 &&
        !(u.interceptUsedRound && Number(u.interceptUsedRound) >= round);
    }).slice(0, 2);
  }

  function battleAirSpeed(unit) {
    const info = battleInfoFor(unit);
    return info ? Number(info.move) || 0 : 0;
  }

  function battleHighAltitude(unit) {
    return !!(unit && battleTrait(unit, 'highAltitude'));
  }

  function battleHeavyBomber(unit) {
    return !!(unit && battleTrait(unit, 'heavyBomber'));
  }

  function battleAAEffectiveRadius(spec, air) {
    if (!spec) return 0;
    return Math.max(0, Number(spec.radius || 0) - (battleHighAltitude(air) ? 1 : 0));
  }

  function battleBombCells(target, dir) {
    const cells = [];
    if (!target) return cells;
    cells.push({ c: target.c, r: target.r });
    if (dir == null || !state.map) return cells;
    const d = Number(dir);
    if (!isFinite(d) || d < 0 || d > 5) return cells;
    const opposite = (d + 3) % 6;
    HG.neighbors(target.c, target.r).forEach(function (p) {
      const c = p[0], r = p[1];
      if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
      const pd = battleDirectionIndex(target.c, target.r, c, r);
      if (pd !== d && pd !== opposite) return;
      cells.push({ c: c, r: r });
    });
    return cells;
  }

  function battleBombTargets(target, dir) {
    const list = [target];
    battleBombCells(target, dir).forEach(function (cell) {
      if (cell.c === target.c && cell.r === target.r) return;
      battleAliveUnits().forEach(function (u) {
        if (u.airBase || u.c !== cell.c || u.r !== cell.r) return;
        if (list.indexOf(u) === -1) list.push(u);
      });
    });
    return list;
  }

  function battleAirActionCost(air, target, role) {
    if (!air) return 2;
    if (role === 'intercept' || battleIsAir(target)) return 2;
    return battleHeavyBomber(air) ? 2 : 1;
  }

  function battleAntiAirCover(side, target) {
    return battleAliveUnits().filter(function (u) {
      if (u.side === side) return false;
      const spec = battleAntiAirSpec(u);
      return spec && battleHexDistance(u.c, u.r, target.c, target.r) <= battleAAEffectiveRadius(spec, target);
    });
  }

  function battleAirTakeoffCell(side, target) {
    const deploy = state.map && state.map.deploy;
    const list = deploy ? (side === 'attacker' ? deploy.airA : deploy.airD) : null;
    if (list && list.length) {
      let best = null, bestD = Infinity;
      list.forEach(function (p) {
        const c = p.c != null ? p.c : p[0], r = p.r != null ? p.r : p[1];
        const d = target ? battleHexDistance(c, r, target.c, target.r) : 0;
        if (d < bestD) { bestD = d; best = { c: c, r: r }; }
      });
      if (best) return best;
    }
    return airPadCenter(side);
  }

  function battleAirTakeoffWorld(side, target) {
    const L = b3Layout();
    if (!L) return null;
    const p = battleAirTakeoffCell(side, target);
    return L.cell(p.c, p.r);
  }

  function battleAirPathIntercept(unit, target) {
    const L = b3Layout();
    if (!L) return null;
    const from = battleAirTakeoffWorld(unit.side, target);
    const to = L.cell(target.c, target.r);
    if (!from || !to) return null;
    const dx = to[0] - from[0], dz = to[1] - from[1];
    const len2 = dx * dx + dz * dz || 1;
    let best = null;
    battleAliveUnits().forEach(function (aa) {
      if (aa.side === unit.side) return;
      const spec = battleAntiAirSpec(aa);
      if (!spec) return;
      const p = L.cell(aa.c, aa.r);
      let t = ((p[0] - from[0]) * dx + (p[1] - from[1]) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = from[0] + dx * t, pz = from[1] + dz * t;
      const dist = Math.hypot(px - p[0], pz - p[1]);
      if (dist <= battleAAEffectiveRadius(spec, unit) * L.PITCH * 1.05 && (!best || t < best.t)) {
        best = { aa: aa, spec: spec, t: t, point: [px, pz], target: to, from: from };
      }
    });
    return best;
  }

  function battleArtillerySpec(unit) {
    const art = battleTrait(unit, 'artillery');
    const rocket = battleTrait(unit, 'rocket');
    if (art) return { damage: art.damage, range: art.range, rocket: !!rocket };
    if (rocket) return { damage: rocket.damage, range: rocket.range, rocket: true };
    return null;
  }

  function battleArtilleryIsIndirect(attacker, target) {
    const spec = battleArtillerySpec(attacker);
    if (!spec || !target) return false;
    const d = battleHexDistance(attacker.c, attacker.r, target.c, target.r);
    return d >= 3 && d <= spec.range;
  }

  function battleArtilleryHasOwnVision(attacker, target) {
    const own = battleAliveUnits().filter(function (u) { return u.side === attacker.side; });
    for (let i = 0; i < own.length; i++) {
      const u = own[i];
      if (u.id === attacker.id) continue;
      if (battleIsRecon(u) &&
          battleHexDistance(u.c, u.r, target.c, target.r) <= battleReconRadius(u)) return true;
    }
    return false;
  }

  function battleArtilleryCanTarget(attacker, target) {
    if (!battleArtilleryIsIndirect(attacker, target)) return false;
    if (battleCounterBatteryMarkAt(attacker.side, target.c, target.r)) return true;
    if (battleLockedBySide(target, attacker.side)) return true;
    return battleArtilleryHasOwnVision(attacker, target);
  }

  function battleArtilleryCanFire(unit) {
    const spec = battleArtillerySpec(unit);
    if (!spec) return false;
    if (Number(unit.mp) < 1) return false;
    if (spec.rocket && unit.rocketReloadRound && Number(state.battle.round) <= Number(unit.rocketReloadRound)) return false;
    return Number(unit.artyShots || 0) < (spec.rocket ? 1 : 2);
  }

  function battleRocketArea(target) {
    return battleAliveUnits().filter(function (u) {
      return !u.airBase && battleHexDistance(u.c, u.r, target.c, target.r) <= 1;
    });
  }

  function battleProtectAt(c, r) {
    const rule = battleTerrainRule(c, r);
    let protect = rule && isFinite(rule.protect) ? Number(rule.protect) : 0;
    const b = battleBuildingAt(c, r);
    if (b) {
      if (b.t === 'bunker') protect = Math.max(protect, 0.9);
      else if (b.t === 'trench') protect = protect + 0.2;
    }
    return Math.max(0, Math.min(1, protect));
  }

  function battleBunkerDamageMod(unit) {
    const b = unit ? battleBuildingAt(unit.c, unit.r) : null;
    return b && b.t === 'bunker' ? 1.5 : 1;
  }

  function battleIsNight() {
    return !!state.battle && ((Math.max(1, state.battle.round) - 1) % 3 === 2);
  }

  function battleAttackRawOne(attacker, target, key, penOverride, facing) {
    const ai = battleInfoFor(attacker);
    const ti = battleInfoFor(target);
    const arty = battleArtillerySpec(attacker);
    const indirect = !!(arty && battleHexDistance(attacker.c, attacker.r, target.c, target.r) >= 3 &&
      battleHexDistance(attacker.c, attacker.r, target.c, target.r) <= arty.range);
    if (indirect) {
      const base = Number(arty.damage) || 1;
      const pen = battleHasArmor(ti) && !battleIsTransportTarget(target) ? 0.5 : 1;
      const targetBld = battleBuildingAt(target.c, target.r);
      // 火箭炮无视地形修正，但碉堡的“本格抗性”仍生效。
      const protect = arty.rocket
        ? (targetBld && targetBld.t === 'bunker' ? 0.9 : 0)
        : battleProtectAt(target.c, target.r);
      return {
        raw: base * pen * (1 - protect),
        base: base, ap: 0, av: battleArmorValue(ti), pen: pen,
        protect: protect, night: 1, key: key, indirect: true, rocket: arty.rocket,
      };
    }
    const zone = facing == null ? 'front' : battleFacingZone(facing, battleDirectionIndex(target.c, target.r, attacker.c, attacker.r));
    const base = battleAttackBase(ai, ti, key, battleIsTransportTarget(target)) * battleBunkerDamageMod(attacker);
    const ap = battleAttackAP(ai, key);
    const av = battleArmorValue(ti, zone);
    const pen = penOverride != null ? penOverride : battlePenMod(ap, av);
    const protect = battleProtectAt(target.c, target.r);
    const night = battleIsNight() ? 0.5 : 1;
    return {
      raw: base * pen * (1 - protect) * night,
      base: base, ap: ap, av: av, pen: pen, zone: zone,
      protect: protect, night: night, key: key, airMod: 1,
    };
  }

  function battleAttackRaw(attacker, target, participants, facing) {
    const key = battleDistanceKey(attacker, target);
    const list = (participants && participants.length ? participants : [attacker])
      .map(battleUnitById).filter(function (u) { return u && u.alive; });
    let base = 0;
    let bestPen = 0;
    const ones = list.map(function (u) {
      return battleAttackRawOne(u, target, battleDistanceKey(u, target), null, facing);
    });
    ones.forEach(function (one) {
      if (!one.indirect && one.pen > bestPen) bestPen = one.pen;
    });
    const parts = [];
    let raw = 0;
    list.forEach(function (u, i) {
      const one = ones[i];
      const adjusted = one.indirect ? one :
        battleAttackRawOne(u, target, battleDistanceKey(u, target), bestPen, facing);
      base += adjusted.base;
      raw += adjusted.raw;
      parts.push({ unit: u, base: adjusted.base, pen: adjusted.pen, raw: adjusted.raw });
    });
    const protect = battleProtectAt(target.c, target.r);
    const night = battleIsNight() ? 0.5 : 1;
    return {
      raw: raw,
      base: base, pen: bestPen, protect: protect, night: night,
      key: key, parts: parts,
    };
  }

  function battleAttackTotal(calc) {
    return calc && calc.parts ? calc.parts.reduce(function (s, p) { return s + (Number(p.raw) || 0); }, 0) : 0;
  }

  function battleResolveFocus(attacker, target, participants, facing) {
    // 集火只在最后掷一次骰：先把所有参与单位的伤害期望求和，避免 1.5 + 1.5 变成 1/2 两次随机。
    const calc = battleAttackRaw(attacker, target, participants, facing);
    return { calc: calc, dmg: battleRollDamage(calc.raw) };
  }

  function battleHeartbreakMod(unit) {
    return unit && battleTrait(unit, 'heartbreak') ? 2 : 1;
  }

  function battleCounterRaw(counterUnit, target, facing) {
    const key = battleDistanceKey(counterUnit, target);
    const ai = battleInfoFor(counterUnit);
    const ti = battleInfoFor(target);
    const zone = facing == null ? 'front' : battleFacingZone(facing, battleDirectionIndex(target.c, target.r, counterUnit.c, counterUnit.r));
    const base = battleAttackBase(ai, ti, key, battleIsTransportTarget(target)) * battleBunkerDamageMod(counterUnit);
    const ap = battleAttackAP(ai, key);
    const av = battleArmorValue(ti, zone);
    const pen = battlePenMod(ap, av);
    const protect = battleProtectAt(target.c, target.r);
    const night = battleIsNight() ? 0.75 : 1;
    const coef = ai && isFinite(ai.counter) ? Number(ai.counter) : 1;
    return {
      raw: base * coef * pen * (1 - protect) * night * battleCounterScale(target) * battleHeartbreakMod(target),
      base: base, coef: coef, ap: ap, av: av, pen: pen,
      protect: protect, night: night, key: key, zone: zone,
    };
  }

  function battlePushRaw(attacker, target) {
    const ai = battleInfoFor(attacker);
    const ti = battleInfoFor(target);
    // 推进时己方按当前距离攻值（不额外改成巷战），敌方反击固定按巷战列；减伤取两者被推动前所在格。
    const atkKey = battleDistanceKey(attacker, target);
    const atkBase = battleAttackBase(ai, ti, atkKey, battleIsTransportTarget(target)) * battleBunkerDamageMod(attacker);
    const atkAP = battleAttackAP(ai, atkKey);
    const atkAV = battleArmorValue(ti);
    const atkPen = battlePenMod(atkAP, atkAV);
    const atkProtect = battleProtectAt(target.c, target.r);
    const atkNight = battleIsNight() ? 0.5 : 1;
    const defBase = battleAttackBase(ti, ai, 'urban');
    const defAP = battleAttackAP(ti, 'urban');
    const defAV = battleArmorValue(ai);
    const defPen = battlePenMod(defAP, defAV);
    const defProtect = battleProtectAt(attacker.c, attacker.r);
    const defNight = battleIsNight() ? 0.75 : 1;
    const coef = ti && isFinite(ti.counter) ? Number(ti.counter) : 1;
    return {
      attackRaw: atkBase * atkPen * (1 - atkProtect) * atkNight,
      counterRaw: defBase * coef * defPen * (1 - defProtect) * defNight * battleCounterScale(attacker) * battleHeartbreakMod(attacker),
      attackPen: atkPen, counterPen: defPen,
    };
  }


  function battleRollDamage(raw) {
    const n = Math.max(0, Number(raw) || 0);
    const whole = Math.floor(n);
    const frac = n - whole;
    return whole + (Math.random() < frac ? 1 : 0);
  }

  function battleDamageUnit(unit, dmg) {
    if (!unit || !unit.alive) return 0;
    const n = Math.max(0, Number(dmg) || 0);
    const cargo = unit.carryingId ? battleUnitById(unit.carryingId) : null;
    if (unit.confused) {
      unit.hp = 0;
      unit.alive = false;
      if (cargo && cargo.embarked) battleDamageUnit(cargo, n);
      if (cargo && cargo.alive) {
        cargo.embarked = false;
        cargo.c = unit.c;
        cargo.r = unit.r;
        cargo.transportId = null;
        cargo.mp = 0;
      }
      return n;
    }
    unit.hp -= n;
    if (unit.hp <= 0) { unit.hp = 0; unit.alive = false; }
    if (cargo && cargo.embarked) battleDamageUnit(cargo, n);
    if (cargo && !cargo.alive) unit.carryingId = null;
    if (!unit.alive && unit.carryingId) {
      const c = battleUnitById(unit.carryingId);
      if (c) {
        c.embarked = false;
        c.c = unit.c;
        c.r = unit.r;
        c.transportId = null;
        c.mp = 0;
      }
      unit.carryingId = null;
    }
    if (!unit.alive && state.battle && state.battle.engineerProject &&
        state.battle.engineerProject.engineerId === unit.id) {
      state.battle.engineerProject = null;
    }
    return n;
  }

  function battleMilitaryPoliceNear(unit) {
    if (!unit || !unit.side) return false;
    return battleAliveUnits().some(function (u) {
      return u.side === unit.side && battleTrait(u, 'militaryPolice') &&
        battleHexDistance(u.c, u.r, unit.c, unit.r) <= 1;
    });
  }

  function battleMilitaryPoliceCure() {
    const b = state.battle;
    if (!b || state.phase !== 'battle') return;
    b.units.forEach(function (u) {
      if (!u.alive || !u.confused) return;
      if (battleTrait(u, 'political')) {
        u.confused = false;
        u.lastConfusionRoll = null;
        return;
      }
      if (!battleMilitaryPoliceNear(u)) return;
      u.confused = false;
      b.log.push(u.name + ' 进入友方宪兵半径，混乱解除');
    });
  }

  function battleConfusedBlocksAction(unit, type) {
    if (!unit || !unit.confused) return false;
    return ['attack', 'focus', 'push', 'airAttack', 'aaAttack'].indexOf(type) !== -1;
  }

  function battleTryConfusion(target, attackers, facing, canPen) {
    if (canPen === false) return false;
    if (!target || !target.alive || !attackers || attackers.length < 2) return false;
    // 政治军队永远不会混乱。
    if (battleTrait(target, 'political')) return false;
    // 友方宪兵半径 1 内免疫混乱。
    if (battleMilitaryPoliceNear(target)) return false;
    const stats = battleFacingStats(target, attackers);
    const opt = stats.filter(function (o) { return o.facing === Number(facing); })[0];
    if (!opt || opt.chance <= 0) return false;
    const roll = Math.random();
    target.lastConfusionRoll = { chance: opt.chance, roll: roll, success: roll < opt.chance };
    if (roll >= opt.chance) return false;
    target.confused = true;
    return true;
  }

  function battleFmt(n) {
    return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }

  function battleIsRecon(unit) {
    if (!unit) return false;
    return !!battleTrait(unit, 'recon') || /侦察|侦查/.test(String(unit.name || ''));
  }

  function battleReconRadius(unit) {
    const tr = battleTrait(unit, 'recon');
    if (tr) return tr.radius;
    return battleIsRecon(unit) ? BATTLE_VISION : 0;
  }

  function battleSightBlocked(c, r) {
    const rule = battleTerrainRule(c, r);
    return !!(rule && rule.blocksSight);
  }

  function battleLineBlocked(viewer, target) {
    const dist = battleHexDistance(viewer.c, viewer.r, target.c, target.r);
    if (dist <= 0) return false;
    // 目标脚下的地形不挡视线；只看两单位之间的格子。
    if (dist <= 1) return false;
    const an = HG.neighbors(viewer.c, viewer.r);
    const bn = HG.neighbors(target.c, target.r);
    const common = [];
    an.forEach(function (a) {
      bn.forEach(function (b) {
        if (a[0] === b[0] && a[1] === b[1]) {
          if (a[0] >= 0 && a[1] >= 0 && state.map && a[0] < state.map.cols && a[1] < state.map.rows) {
            common.push(a);
          }
        }
      });
    });
    if (!common.length) return false;
    return common.every(function (p) { return battleSightBlocked(p[0], p[1]); });
  }

  function battleLockedBySide(target, side) {
    if (!target || !target.lockedBy || !target.lockedBy.length) return false;
    return target.lockedBy.some(function (id) {
      const u = battleUnitById(id);
      return u && u.alive && u.side === side;
    });
  }

  function battleHasDirectVision(viewer, target) {
    if (!viewer || !target) return false;
    const d = battleHexDistance(viewer.c, viewer.r, target.c, target.r);
    // 相邻单位一定互相看见；森林/房区只挡更远的视线。
    if (d <= 1) return true;
    if (battleIsRecon(viewer)) return d <= battleReconRadius(viewer);
    return d <= BATTLE_VISION && !battleLineBlocked(viewer, target);
  }

  // 普通单位只看自己的视野；侦察单位的视野实时共享给全队；
  // 被己方锁定的目标暴露给全队。没有侦察时，A 不能借用 B 的视野。
  function battleUnitHasOwnVision(viewer, target) {
    if (!viewer || !target || !target.alive) return false;
    if (target.side === viewer.side) return true;
    if (battleHasDirectVision(viewer, target)) return true;
    const own = battleAliveUnits().filter(function (u) { return u.side === viewer.side; });
    for (let i = 0; i < own.length; i++) {
      const u = own[i];
      if (!battleIsRecon(u)) continue;
      if (battleHexDistance(u.c, u.r, target.c, target.r) <= battleReconRadius(u)) return true;
    }
    return false;
  }

  function battleUnitCanSee(viewer, target) {
    if (!viewer || !target || !target.alive) return false;
    if (target.side === viewer.side) return true;
    if (battleCounterBatteryMarkAt(viewer.side, target.c, target.r)) return true;
    if (battleLockedBySide(target, viewer.side)) return true;
    return battleUnitHasOwnVision(viewer, target);
  }

  function battleCounterTargets(counterUnit, ids) {
    if (!counterUnit) return [];
    const lethal = !counterUnit.alive;
    const units = (ids || []).map(battleUnitById).filter(Boolean);
    // 有隐蔽单位参与时，非隐蔽参与者已经暴露，不能再因为视野判定被一起排除。
    const hasHidden = units.some(function (u) { return battleTrait(u, 'hidden'); });
    const valid = units.filter(function (u) {
      return u && u.alive && u.side !== counterUnit.side &&
        !battleTrait(u, 'hidden') &&
        (lethal || hasHidden || battleUnitCanSee(counterUnit, u));
    });
    if (valid.length) return valid;
    // 联机时若目标阵营数据异常，仍保留非隐蔽参与者作为反击目标，避免整次攻击被跳过。
    return units.filter(function (u) {
      return u && u.alive && !battleTrait(u, 'hidden');
    });
  }

  function battleAttackCost(attacker, target) {
    if (!attacker || !target) return 2;
    if (battleArtilleryIsIndirect(attacker, target)) return 1;
    const own = battleAliveUnits().filter(function (u) { return u.side === attacker.side; });
    for (let i = 0; i < own.length; i++) {
      const u = own[i];
      if (battleIsRecon(u) &&
          battleHexDistance(u.c, u.r, target.c, target.r) <= battleReconRadius(u)) {
        return 1;
      }
    }
    return 2;
  }

  function battleLockPaid(target, unitId) {
    const v = target && target.lockCosts ? Number(target.lockCosts[unitId]) : NaN;
    return isFinite(v) ? v : 2;
  }

  function battlePushDestination(attacker, target) {
    if (!attacker || !target) return null;
    if (battleHexDistance(attacker.c, attacker.r, target.c, target.r) !== 1) return null;
    const a = HG.toAxial(attacker.c, attacker.r);
    const e = HG.toAxial(target.c, target.r);
    const dc = e[0] - a[0], dr = e[1] - a[1];
    const off = HG.toOffset(e[0] + dc, e[1] + dr);
    const c = off[0], r = off[1];
    if (!state.map || c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return null;
    if (battleUnitAt(c, r)) return null;
    return [c, r];
  }

  function battleEnemiesInRange(unit) {
    if (!unit) return [];
    return battleAliveUnits().filter(function (u) {
      if (u.side === unit.side) return false;
      if (battleHexDistance(unit.c, unit.r, u.c, u.r) <= BATTLE_RANGE &&
          battleUnitCanSee(unit, u)) return true;
      return battleArtilleryCanTarget(unit, u);
    });
  }

  function battleRefresh() {
    if (!B3) return;
    battleAirSupCache = null;
    if (state.battle) battleUpdateZoneOwners(state.battle);
    battleMilitaryPoliceCure();
    refreshBattle3DUnits();
    refreshBattle3DGhost();
    syncBattle3DHUD();
    B3.need = true;
  }

  function battlePublish() {
    if (!state.battle) return;
    if (state.net && !state.test && state.role === 'host') {
      state.net.setHostState({ battle: state.battle });
    }
  }

  function battleClearTransient() {
    if (!state.battle) return;
    state.battle.selectedId = null;
    state.battle.ghost = null;
    state.battle.choice = null;
    state.battle.counter = null;
    hideEl('battle-choice', true);
    hideEl('battle-facing-choice', true);
    hideEl('battle-counter', true);
    hideEl('battle-tip', true);
  }

  function battleRequest(action) {
    if (!state.battle) return;
    action = action || {};
    action.id = String(state.selfId || 'local') + '-' + Date.now().toString(36) + '-' + (++state.battleSeq);
    if (state.test || state.role === 'host') {
      battleApply(action);
      battlePublish();
    } else if (state.role === 'guest') {
      // 客人的动作要绕一圈到房主再回来，体感很慢。
      // 移动 / 换位是纯确定性的（不含随机伤害），本地先算一遍，房主状态回来后再校正。
      const optimistic = action.type === 'move' || action.type === 'swap';
      if (optimistic) {
        state.optimistic = true;
        try { battleApply(action); } finally { state.optimistic = false; }
        scheduleDraw();
      }
      if (state.net) state.net.setGuestState({ battleAction: action });
      toast(optimistic ? '已移动，等待房主确认' : '已提交，等待房主结算');
    }
  }

  function battleValidateSide(side) {
    return normalizeSide(side) === state.battle.activeSide;
  }

  function battleApplyReinforce(action) {
    const b = state.battle;
    const r = b && b.reinforce;
    if (!r) return;
    const side = normalizeSide(action.side);
    if (!side) return;
    if (action.type === 'reinforcePick') {
      if (r.stage !== 'pick') return;
      const pick = r.picks[side];
      if (!pick) return;
      if (action.divisionId) {
        const div = battleReinforceCandidates(side, r.phase).filter(function (d) { return d.id === action.divisionId; })[0];
        if (!div) return;
        pick.divisionId = div.id;
        pick.units = {};
        r.ready[side] = false;
        battleRefresh();
        return;
      }
      const stats = battleReinforceStats(side, r.phase);
      const entry = stats.entries.filter(function (e) { return e.name === action.name; })[0];
      if (!entry) return;
      const cur = Number(pick.units[action.name]) || 0;
      const delta = Number(action.delta) || 0;
      if (delta > 0) {
        if (cur >= entry.max) return;
        if (stats.cost + (entry.info.price || 0) > stats.funds) return;
        const slot = prepSlotClass(entry.info);
        if (slot === 'air' && stats.air + 1 > stats.planeLimit) return;
        if (slot === 'main' && stats.main + 1 > stats.mainLimit) return;
        if (slot === 'support' && stats.support + 1 > stats.supportLimit) return;
        pick.units[action.name] = cur + 1;
      } else if (delta < 0 && cur > 0) {
        if (cur <= 1) delete pick.units[action.name];
        else pick.units[action.name] = cur - 1;
      } else {
        return;
      }
      r.ready[side] = false;
      battleRefresh();
      return;
    }
    if (action.type === 'reinforceAirborne') {
      if (r.stage !== 'deploy' || !battleReinforceIsAirborne(side, r.phase)) return;
      if (battleReinforceGroundPlaced(side) > 0) return;
      if (!r.airborne) r.airborne = {};
      if (!r.airborne[side]) r.airborne[side] = { mode: 'zone', unitId: '' };
      if (action.mode === 'zone') {
        r.airborne[side] = { mode: 'zone', unitId: '' };
      } else {
        const center = battleUnitById(action.unitId);
        if (!center || !center.alive || center.side !== side) return;
        const enemies = battleAliveUnits().filter(function (u) { return u.side !== side; });
        if (enemies.some(function (e) { return battleHexDistance(center.c, center.r, e.c, e.r) <= 2; })) {
          toast('该友军半径 2 内有敌军，不能作为空降圆心');
          return;
        }
        r.airborne[side] = { mode: 'unit', unitId: center.id };
      }
      battleRefresh();
      return;
    }
    if (action.type === 'reinforceNuke') {
      if (r.stage !== 'pick' || !battleReinforceHasNuke(side) || r.ready[side]) return;
      const stats = battleReinforceStats(side, r.phase);
      const pick = r.picks[side];
      const cur = Math.max(0, Number(pick.nukes) || 0);
      const delta = Number(action.delta) || 0;
      if (delta > 0) {
        if (stats.cost + 100 > stats.funds) return;
        pick.nukes = cur + 1;
      } else {
        pick.nukes = Math.max(0, cur - 1);
      }
      r.ready[side] = false;
      battleRefresh();
      return;
    }
    if (action.type === 'reinforceConfirm') {
      if (r.stage !== 'pick' || r.ready[side]) return;
      const stats = battleReinforceStats(side, r.phase);
      if (stats.total <= 0) return;
      const pick = r.picks[side];
      const nukes = Math.max(0, Number(pick && pick.nukes) || 0);
      b.nukeLastPhase = b.nukeLastPhase || { attacker: 0, defender: 0 };
      b.nukeLastPhase[side] = nukes;
      if (nukes > 0) {
        b.nukeStock = b.nukeStock || { attacker: 0, defender: 0 };
        b.nukeStock[side] = (Number(b.nukeStock[side]) || 0) + nukes;
        pick.nukes = 0;
      }
      r.ready[side] = true;
      battleAutoDeployAir(side);
      if (r.ready.attacker && r.ready.defender) {
        r.stage = 'deploy';
        b.log.push(battlePhaseLabel(r.phase.toLowerCase()) + ' 阶段增援配卡完成，进入部署');
      }
      battleRefresh();
      return;
    }
    if (action.type === 'reinforceUndeploy') {
      if (r.stage !== 'deploy') return;
      const list = r.placed[side] || [];
      let idx = -1;
      for (let i = 0; i < list.length; i++) if (list[i].id === action.targetId) { idx = i; break; }
      if (idx < 0) return;
      const drop = list.slice(idx);
      const dropIds = {};
      drop.forEach(function (p) { dropIds[p.id] = true; });
      b.units = b.units.filter(function (u) { return !dropIds[u.id]; });
      r.placed[side] = list.slice(0, idx);
      r.done[side] = false;
      r.done.attacker = false;
      r.done.defender = false;
      b.log.push(sideName(side) + ' 撤回 ' + drop.length + ' 个增援单位');
      battleUpdateZoneOwners(b);
      battleRefresh();
      return;
    }
    if (action.type === 'reinforceDeploy') {
      if (r.stage !== 'deploy') return;
      const pick = r.picks[side];
      const want = Number(pick && pick.units[action.name]) || 0;
      if (!want) return;
      const already = (r.placed[side] || []).filter(function (p) { return p.name === action.name; }).length;
      if (already >= want) return;
      const cells = battleReinforceEligible(side);
      if (!cells.some(function (p) { return p.c === action.c && p.r === action.r; })) return;
      if (battleUnitAt(action.c, action.r)) return;
      const faction = sideFaction(side);
      const hp = prepUnitHp(action.name, faction);
      const airborne = battleReinforceIsAirborne(side, r.phase);
      r.seq = (r.seq || 0) + 1;
      const id = 'r-' + side + '-' + Date.now().toString(36) + '-' + r.seq;
      b.units.push({
        id: id, side: side, name: action.name, c: action.c, r: action.r,
        hp: hp, maxHp: hp, mp: 0, maxMp: prepUnitMove(action.name, faction),
        alive: true, lockedBy: [], reinforceNew: true,
        cooldownRound: airborne ? 0 : b.round,
        airborneDeploy: airborne,
      });
      r.placed[side] = (r.placed[side] || []).concat([{ id: id, name: action.name, c: action.c, r: action.r }]);
      b.log.push(sideName(side) + ' 增援部署 ' + action.name);
      battleUpdateZoneOwners(b);
      battleRefresh();
      return;
    }
    if (action.type === 'reinforceDone') {
      if (r.stage !== 'deploy') return;
      const pick = r.picks[side];
      const want = Object.keys(pick.units || {}).reduce(function (n, k) { return n + Number(pick.units[k] || 0); }, 0);
      const cellsLeft = battleReinforceEligible(side).length;
      if ((r.placed[side] || []).length < want && cellsLeft > 0) return;
      r.done[side] = true;
      if (r.done.attacker && r.done.defender) {
        b.units.forEach(function (u) {
          if (u.reinforceNew) {
            const air = !!u.airborneDeploy;
            u.reinforceNew = false;
            u.airborneDeploy = false;
            if (air) {
              u.cooldownRound = 0;
              u.mp = u.side === b.activeSide ? battleMaxMp(u) : 0;
            } else {
              u.cooldownRound = b.round;
              u.mp = 0;
            }
          }
        });
        b.log.push(battlePhaseLabel(r.phase.toLowerCase()) + ' 阶段增援部署完成');
        if (!b.usedDivisions) b.usedDivisions = { attacker: [], defender: [] };
        ['attacker', 'defender'].forEach(function (s) {
          const id = r.picks[s] && r.picks[s].divisionId;
          if (!id) return;
          if (!b.usedDivisions[s]) b.usedDivisions[s] = [];
          if (b.usedDivisions[s].indexOf(id) === -1) b.usedDivisions[s].push(id);
        });
        b.reinforce = null;
        battleUpdateZoneOwners(b);
        battleRefresh();
        battleCheckAutoEnd();
      } else {
        battleRefresh();
      }
    }
  }

  function battleApply(action) {
    if (!state.battle || !action) return;
    const b = state.battle;
    if (String(action.type || '').indexOf('reinforce') === 0) {
      battleApplyReinforce(action);
      return;
    }
    let unit = battleUnitById(action.unitId);
    if (action.type === 'endTurn') {      if (battleValidateSide(action.side)) battleNextTurn();
      return;
    }
    if (action.type === 'airIntercept') {
      if (!b.airIntercept || normalizeSide(action.side) !== b.airIntercept.defenderSide) return;
      battleResolveAirIntercept(action.ids || []);
      return;
    }
    if (action.type === 'faceChoose') {
      const fc = b.facingChoice;
      if (!fc || normalizeSide(action.side) !== fc.defenderSide) return;
      const facing = Number(action.facing);
      if (!isFinite(facing) || facing < 0 || facing > 5) return;
      const pending = fc.action;
      b.facingChoice = null;
      action = Object.assign({}, pending, { facing: facing });
      hideEl('battle-facing-choice', true);
      unit = battleUnitById(action.unitId);
    }
    if (action.type === 'counterSkip') {
      if (!b.counter || b.counter.chooserSide !== normalizeSide(action.side)) return;
      b.counter = null;
      hideEl('battle-counter', true);
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'counter') {
      if (!b.counter || b.counter.chooserSide !== normalizeSide(action.side)) return;
      if (b.counter.targetIds.indexOf(action.counterId) === -1) return;
      const cu = battleUnitById(b.counter.counterUnitId);
      const au = battleUnitById(action.counterId);
      if (cu && au && au.alive) {
        const calc = battleCounterRaw(cu, au, au.facing == null ? 0 : au.facing);
        const dmg = battleRollDamage(calc.raw);
        battleDamageUnit(au, dmg);
        b3AddDamageFloat(au, dmg, '#ffb36b');
        b.log.push(cu.name + ' 反击 ' + au.name + '：' + battleFmt(calc.raw) + ' → ' + dmg);
      }
      b.counter = null;
      hideEl('battle-counter', true);
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (b.counter) return;
    if (!unit || !unit.alive) return;
    if (!battleValidateSide(action.side) || action.side !== unit.side) return;
    if (unit.embarked) return;
    if (unit.actionLocked && action.type !== 'unlock') return;
    if (battleConfusedBlocksAction(unit, action.type)) return;
    if (unit.pushLocked) return;
    if (unit.guardStop && ['attack', 'focus', 'lock', 'unlock'].indexOf(action.type) === -1) return;
    if (action.type === 'move') {
      if (unit.guardStop) return;
      let cost = 0;
      if (b.ghost && b.ghost.unitId === unit.id && b.ghost.c === action.c && b.ghost.r === action.r) {
        cost = b.ghost.cost;
      } else {
        const res = battleFindPath(unit, action.c, action.r);
        if (!res || res.cost > unit.mp) return;
        cost = res.cost;
      }
      const guard = battleGuardInfoAt(otherSide(unit.side), action.c, action.r);
      unit.c = action.c; unit.r = action.r;
      battleSyncCargo(unit);
      unit.mp = Math.max(0, unit.mp - cost);
      unit.guardStop = !!guard;
      unit.guardBy = guard || [];
      if (battleRiverResetAt(action.c, action.r)) {
        unit.mp = 0;
        b.log.push(unit.name + ' 上河，行动力清零');
      }
      if (guard) {
        b.log.push(unit.name + ' 进入警戒格，必须停止移动；本回合仍可攻击/集火/锁定');
        toast('进入警戒格，必须停止；仍可攻击/集火/锁定');
      }
      b.ghost = null;
      b.selectedId = unit.id;
      b.log.push(unit.name + ' 移动 ' + cost + ' 行动力');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'swap') {
      const other = battleUnitById(action.targetId);
      if (!other || !other.alive || other.side !== unit.side) return;
      if (battleHexDistance(unit.c, unit.r, other.c, other.r) !== 1) return;
      if (unit.pushLocked || other.pushLocked) return;
      const unitCost = battleTerrainCost(unit, other.c, other.r);
      const otherCost = battleTerrainCost(other, unit.c, unit.r);
      if (unit.mp < unitCost || other.mp < otherCost) return;
      const c = unit.c, r = unit.r;
      unit.c = other.c; unit.r = other.r;
      other.c = c; other.r = r;
      battleSyncCargo(unit);
      battleSyncCargo(other);
      unit.mp = Math.max(0, unit.mp - unitCost);
      other.mp = Math.max(0, other.mp - otherCost);
      if (battleRiverResetAt(unit.c, unit.r)) {
        unit.mp = 0;
        b.log.push(unit.name + ' 换位上河，行动力清零');
      }
      if (battleRiverResetAt(other.c, other.r)) {
        other.mp = 0;
        b.log.push(other.name + ' 换位上河，行动力清零');
      }
      b.ghost = null;
      b.selectedId = unit.id;
      b.log.push(unit.name + ' 与 ' + other.name + ' 互换位置（' +
        battleFmt(unitCost) + ' + ' + battleFmt(otherCost) + ' 行动力）');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'counterBatteryStrike') {
      const spec = battleArtillerySpec(unit);
      const c = Number(action.c), r = Number(action.r);
      if (!spec || !battleCounterBatteryMarkAt(unit.side, c, r)) return;
      if (battleHexDistance(unit.c, unit.r, c, r) > spec.range || unit.mp < 1) return;
      unit.mp -= 1;
      unit.artyShots = Number(unit.artyShots || 0) + 1;
      battleClearCounterBatteryMark(unit.side, c, r);
      b.selectedId = unit.id;
      b.log.push(unit.name + ' 炮击反炮兵标记格 ' + c + ',' + r + '（1 行动力）');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'airRecon') {
      if (!battleIsReconPlane(unit) || !battleReconAvailable(unit)) return;
      if (battleIsNight()) { toast('夜间飞机不能起飞'); return; }
      const c = Number(action.c), r = Number(action.r);
      if (!state.map || !isFinite(c) || !isFinite(r)) return;
      if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
      if (unit.mp < 1) return;
      unit.reconUsedRound = Number(b.round) || 1;
      const aaHit = battleAirPathIntercept(unit, { c: c, r: r });
      if (aaHit) {
        battleDamageUnit(unit, aaHit.spec.damage);
        b3AddDamageFloat(unit, aaHit.spec.damage, '#ffb36b');
        b.log.push(aaHit.aa.name + ' 拦截侦察机 ' + unit.name + '：' + aaHit.spec.damage +
          (unit.alive ? '，侦察任务中止' : '，侦察机被击落'));
        unit.mp = Math.max(0, unit.mp - 1);
        b.selectedId = null;
        battleRefresh();
        battleCheckAutoEnd();
        return;
      }
      if (battleAirInterceptOptions(otherSide(unit.side)).length) {
        unit.mp = Math.max(0, unit.mp - 1);
        battleBeginReconIntercept(unit, c, r);
        return;
      }
      unit.mp = Math.max(0, unit.mp - 1);
      battleSetReconMission(unit, c, r);
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'nukeAttack') {
      const target = battleUnitById(action.targetId);
      if (!battleIsAir(unit) || !battleTrait(unit, 'nuke') || !target || !target.alive || target.side === unit.side) return;
      if (!b.nukeStock || Number(b.nukeStock[unit.side]) <= 0) return;
      if (battleIsNight()) { toast('夜间飞机不能起飞'); return; }
      if (unit.mp < 2) return;
      b.nukeStock[unit.side] = Math.max(0, Number(b.nukeStock[unit.side]) - 1);
      unit.mp -= 2;
      b.selectedId = null;
      battleNukeStrike(unit, target);
      b3StartAirFlight(unit, target, null, 0);
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'airAttack') {
      const target = battleUnitById(action.targetId);
      if (!battleIsAir(unit) || !target || !target.alive || target.side === unit.side) return;
      if (battleIsNight()) { toast('夜间飞机不能起飞'); return; }
      const role = action.role || (battleIsAir(target) ? 'intercept' : 'bomb');
      const heavyDir = (battleHeavyBomber(unit) && !battleIsAir(target))
        ? (Number.isFinite(Number(action.dir)) ? Math.max(0, Math.min(5, Number(action.dir))) : 0)
        : null;
      const airCost = battleAirActionCost(unit, target, role);
      if (unit.mp < airCost) return;
      if (battleIsAir(target) && role !== 'intercept') return;
      if (!battleIsAir(target) && role !== 'bomb') return;
      const targetLocked = (target.lockedBy || []).some(function (id) {
        const u = battleUnitById(id);
        return u && u.alive;
      });
      if (targetLocked && !action.focus && !battleAirHasOwnVision(unit, target)) return;
      if (!battleIsAir(target) && !battleAirCanTarget(unit, target)) return;
      if (!battleIsAir(target) && battleAirInterceptOptions(target.side).length) {
        battleBeginAirIntercept(unit, target, [unit.id], role);
        if (b.airIntercept) b.airIntercept.dir = heavyDir;
        return;
      }
      if (battleIsAir(target)) {
        let dmg = battleAirIntercept(unit);
        if (battleHighAltitude(target) && !battleHighAltitude(unit)) dmg *= 0.2;
        if (dmg <= 0) return;
        battleDamageUnit(target, dmg);
        b3AddDamageFloat(target, dmg, '#ff6b57');
        unit.mp -= airCost;
        b.selectedId = null;
        b.log.push(unit.name + ' 空战 ' + target.name + '：' + dmg);
        battleRefresh();
        battleCheckAutoEnd();
        return;
      }
      if (!battleAirCanTarget(unit, target)) return;
      const intercept = battleAirPathIntercept(unit, target);
      if (intercept) {
        battleDamageUnit(unit, intercept.spec.damage);
        b3AddDamageFloat(unit, intercept.spec.damage, '#ffb36b');
        if (!unit.alive) {
          b.log.push(intercept.aa.name + ' 拦截 ' + unit.name + '：' + intercept.spec.damage + '，飞机被击落');
          unit.mp = Math.max(0, unit.mp - airCost);
          b.selectedId = null;
          battleRefresh();
          battleCheckAutoEnd();
          return;
        }
        if (!battleHeavyBomber(unit)) {
          b.log.push(intercept.aa.name + ' 拦截 ' + unit.name + '：' + intercept.spec.damage + '，任务中止');
          b3StartAirFlight(unit, target, intercept);
          unit.mp = Math.max(0, unit.mp - airCost);
          b.selectedId = null;
          battleRefresh();
          battleCheckAutoEnd();
          return;
        }
        b.log.push(intercept.aa.name + ' 拦截 ' + unit.name + '：' + intercept.spec.damage +
          '，重轰强行突破，继续轰炸');
      }
      const participants = [unit];
      let airCount = 1;
      if (action.focus) {
        (target.lockedBy || []).forEach(function (id) {
          const u = battleUnitById(id);
          if (!u || !u.alive || u.side !== unit.side) return;
          if (battleIsAir(u)) {
            if (airCount >= 2) return;
            airCount++;
          }
          if (participants.indexOf(u) === -1) participants.push(u);
        });
      }
      const facingInfo = battleAutoFacing(target, participants);
      const facing = facingInfo.facing;
      target.facing = facing;
      const bombTargets = heavyDir != null ? battleBombTargets(target, heavyDir) : [target];
      const hitLogs = [];
      bombTargets.forEach(function (tgt) {
        let raw = 0;
        participants.forEach(function (p) {
          if (battleIsAir(p)) {
            const stats = battleAirGroundStats(p);
            const info = battleInfoFor(tgt);
            const base = battleIsTransportTarget(tgt) ? stats.soft :
              (battleHasArmor(info) ? stats.hard : stats.soft);
            const mod = battleAirSuperiorityFor(p, tgt) ? 1.5 : 1;
            raw += base * mod * (1 - battleProtectAt(tgt.c, tgt.r));
          } else {
            raw += battleAttackRawOne(p, tgt, battleDistanceKey(p, tgt), null, facing).raw;
          }
        });
        const dmg = battleRollDamage(raw);
        battleDamageUnit(tgt, dmg);
        b3AddDamageFloat(tgt, dmg, '#ff6b57');
        hitLogs.push(tgt.name + ' -' + dmg + '（' + battleFmt(raw) + '）');
      });
      if (participants.some(function (p) { return p.id !== unit.id; })) {
        target.lockedBy = [];
        target.lockCosts = {};
      }
      const airStarts = participants.filter(battleIsAir).slice(0, 2);
      airStarts.forEach(function (a, i) { b3StartAirFlight(a, target, null, i * 0.28); });
      unit.mp -= airCost;
      b.selectedId = null;
      b.log.push(unit.name + (heavyDir != null ? ' 重轰覆盖 ' : ' 空中压制 ') + target.name + '：' +
        hitLogs.join('；') +
        (participants.length > 1 ? ('（' + participants.length + ' 个单位集火）') : ''));
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'aaAttack') {
      const target = battleUnitById(action.targetId);
      const spec = battleAntiAirSpec(unit);
      if (!spec || !target || !target.alive || !battleIsAir(target) || target.side === unit.side) return;
      if (battleHexDistance(unit.c, unit.r, target.c, target.r) > battleAAEffectiveRadius(spec, target)) return;
      if (unit.mp < 1) return;
      battleDamageUnit(target, spec.damage);
      b3AddDamageFloat(target, spec.damage, '#ff6b57');
      unit.mp -= 1;
      b.selectedId = null;
      b.log.push(unit.name + ' 防空炮击 ' + target.name + '：' + spec.damage);
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'push') {
      const target = battleUnitById(action.targetId);
      if (!target || !target.alive || target.side === unit.side) return;
      if ((target.lockedBy || []).some(function (id) {
        const u = battleUnitById(id);
        return u && u.alive;
      })) return;
      if (!battleUnitCanSee(unit, target)) return;
      if (unit.mp < 3) return;
      const dest = battlePushDestination(unit, target);
      if (!dest) return;
      const calc = battlePushRaw(unit, target);
      const targetWasConfused = !!target.confused;
      const atkDmg = battleRollDamage(calc.attackRaw);
      const defDmg = targetWasConfused ? 0 : battleRollDamage(calc.counterRaw);
      const targetFrom = { c: target.c, r: target.r };
      battleDamageUnit(target, atkDmg);
      b3AddDamageFloat(target, atkDmg, '#ff6b57');
      if (!targetWasConfused) {
        battleDamageUnit(unit, defDmg);
        b3AddDamageFloat(unit, defDmg, '#ffb36b');
      }
      let pushed = false;
      let advanced = false;
      if (target.alive) {
        target.c = dest[0]; target.r = dest[1];
        pushed = true;
      }
      // 推进成功后，攻击方踏进目标原来的格子；目标阵亡时同样前进。
      if (unit.alive) {
        unit.c = targetFrom.c; unit.r = targetFrom.r;
        advanced = true;
      }
      battleSyncCargo(target);
      battleSyncCargo(unit);
      unit.mp = Math.max(0, unit.mp - 3);
      unit.pushLocked = true;
      battleActionLockUnit(unit);
      b.selectedId = null;
      b.log.push(unit.name + ' 推进 ' + target.name +
        '：造成 ' + atkDmg +
        (targetWasConfused ? '，目标混乱无法反击' : ('，遭到巷战反击 ' + defDmg)) +
        (pushed ? ('，目标推到 ' + dest[0] + ',' + dest[1]) : '，目标阵亡') +
        (advanced ? ('，' + unit.name + '前进到 ' + targetFrom.c + ',' + targetFrom.r) : '，攻击方阵亡未前进') +
        '（推进后本回合不能行动）');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'abandonBuild') {
      if (!unit || !unit.alive || !battleValidateSide(action.side) || action.side !== unit.side) return;
      battleCancelEngineerProject(unit, '主动放弃');
      battleRefresh();
      return;
    }
    if (action.type === 'build') {
      if (!unit || !unit.alive || !battleValidateSide(action.side) || action.side !== unit.side) return;
      const type = action.buildingType;
      const cost = type === 'trench' || type === 'bunker' ? 4 : 2;
      if (!battleTrait(unit, 'engineer') || unit.mp < cost) return;
      const c = Number(action.c), r = Number(action.r);
      if (!battleBuildAllowed(unit, c, r, type)) return;
      const label = { road: '修路', bridge: '架桥', trench: '挖战壕', bunker: '修建碉堡' }[type] || '工程作业';

      // 碉堡：连续两回合各投入 4 行动力；中断或换格则失效。
      if (type === 'bunker' && b.engineerProject) {
        const p = b.engineerProject;
        if (p.side === unit.side && p.c === c && p.r === r && b.round === p.round + 1) {
          unit.mp -= 4;
          b.engineerProject = null;
          b.buildings = b.buildings || [];
          b.buildings.push({ c: c, r: r, t: 'bunker', builtBy: unit.id, side: unit.side });
          b.log.push(unit.name + ' 完成碉堡：' + c + ',' + r + '（第二回合 -4 行动力）');
          battleRefresh();
          battleCheckAutoEnd();
          return;
        }
        b.engineerProject = null;
        b.log.push(unit.name + ' 的碉堡工程中断：未连续两回合完成');
      }

      if (type === 'bunker') {
        unit.mp -= 4;
        b.engineerProject = { c: c, r: r, engineerId: unit.id, side: unit.side, round: b.round, stage: 1 };
        b.log.push(unit.name + ' 开始构筑碉堡：' + c + ',' + r + '（第一回合 -4 行动力，下一回合继续）');
        battleRefresh();
        battleCheckAutoEnd();
        return;
      }

      unit.mp -= cost;
      b.buildings = b.buildings || [];
      b.buildings.push({ c: c, r: r, t: type, builtBy: unit.id, side: unit.side });
      b.log.push(unit.name + ' 工程作业：在 ' + c + ',' + r + ' ' + label + '（-' + cost + ' 行动力）');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'transportLoad') {
      if (!unit || !unit.alive || !battleValidateSide(action.side) || action.side !== unit.side) return;
      const passenger = battleUnitById(action.targetId);
      if (!battleCanTransportLoad(unit, passenger)) return;
      unit.carryingId = passenger.id;
      passenger.embarked = true;
      passenger.transportId = unit.id;
      passenger.c = unit.c;
      passenger.r = unit.r;
      passenger.mp = 0;
      passenger.loadRound = Number(b.round) || 1;
      b.selectedId = unit.id;
      b.log.push(passenger.name + ' 登上 ' + unit.name + '（本回合不能再行动）');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'transportUnload') {
      if (!unit || !unit.alive || !battleValidateSide(action.side) || action.side !== unit.side) return;
      const passenger = unit.carryingId ? battleUnitById(unit.carryingId) : null;
      if (!passenger || !passenger.alive || !passenger.embarked) return;
      const c = Number(action.c), r = Number(action.r);
      if (!isFinite(c) || !isFinite(r) || !state.map) return;
      if (c < 0 || r < 0 || c >= state.map.cols || r >= state.map.rows) return;
      if (battleHexDistance(unit.c, unit.r, c, r) !== 1) return;
      if (battleUnitAt(c, r)) return;
      unit.carryingId = null;
      passenger.embarked = false;
      passenger.transportId = null;
      passenger.c = c;
      passenger.r = r;
      passenger.mp = 0;
      passenger.unloadRound = Number(b.round) || 1;
      b.selectedId = unit.id;
      b.log.push(passenger.name + ' 从 ' + unit.name + ' 下车（行动力清零）');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'medical') {
      if (!unit || !unit.alive || !battleValidateSide(action.side) || action.side !== unit.side) return;
      if (!battleTrait(unit, 'medical')) return;
      const target = battleUnitById(action.targetId);
      if (!target || !target.alive || target.side !== unit.side || target.id === unit.id) return;
      if (battleHexDistance(unit.c, unit.r, target.c, target.r) > 1) return;
      const maxHp = Number(target.maxHp) || battleMaxHp(target);
      if (target.hp >= maxHp) return;
      target.hp = Math.min(maxHp, target.hp + 1);
      unit.mp = 0;
      unit.alive = false;
      unit.hp = 0;
      b.selectedId = null;
      b.log.push(unit.name + ' 与 ' + target.name + ' 合并，目标恢复 1 血，医疗单位消失');
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
    if (action.type === 'attack' || action.type === 'lock' || action.type === 'focus' || action.type === 'unlock') {
      const target = battleUnitById(action.targetId);
      if (!target || !target.alive || target.side === unit.side) return;
      if (action.type === 'unlock') {
        const was = (target.lockedBy || []).indexOf(unit.id) !== -1;
        if (!was) return;
        const refund = battleLockPaid(target, unit.id);
        target.lockedBy = (target.lockedBy || []).filter(function (id) { return id !== unit.id; });
        if (target.lockCosts) delete target.lockCosts[unit.id];
        unit.mp = Math.min(battleMaxMp(unit), unit.mp + refund);
        unit.actionLocked = false;
        b.selectedId = unit.id;
        b.log.push(unit.name + ' 取消锁定 ' + target.name + '，返还 ' + refund + ' 行动力');
        battleRefresh();
        return;
      }
      const targetLocked = (target.lockedBy || []).some(function (id) {
        const u = battleUnitById(id);
        return u && u.alive;
      });
      if (targetLocked && action.type === 'attack' &&
          !battleUnitHasOwnVision(unit, target) &&
          !battleArtilleryHasOwnVision(unit, target)) return;
      const indirect = battleArtilleryIsIndirect(unit, target);
      if (!battleUnitCanSee(unit, target) && !indirect) return;
      if (battleHexDistance(unit.c, unit.r, target.c, target.r) > BATTLE_RANGE && !indirect) return;
      if (indirect && action.type !== 'attack' && action.type !== 'focus') return;
      if (indirect) {
        if (!battleArtilleryCanFire(unit)) return;
        const spec = battleArtillerySpec(unit);
        const cost = 1;
        if (unit.mp < cost) return;
        const hits = [];
        if (action.type === 'focus') {
          const participants = [unit.id];
          (target.lockedBy || []).forEach(function (id) {
            const u = battleUnitById(id);
            if (u && u.alive && u.side === unit.side && participants.indexOf(id) === -1) participants.push(id);
          });
          const parts = participants.map(battleUnitById).filter(Boolean);
          const facingInfo = battleAutoFacing(target, parts);
          const facing = facingInfo.facing;
          target.facing = facing;
          const resolved = battleResolveFocus(unit, target, participants, facing);
          const calc = resolved.calc;
          const dmg = resolved.dmg;
          battleDamageUnit(target, dmg);
          b3AddDamageFloat(target, dmg, '#ff6b57');
          target.lastConfusionRoll = null;
          if (target.alive && calc.pen <= 0.2) {
            b.log.push('全队最高穿透仍无法击穿，不计算混乱');
          } else if (target.alive && battleTryConfusion(target, parts, facing, calc.pen > 0.2)) {
            b.log.push(target.name + ' 陷入混乱');
          } else if (target.lastConfusionRoll) {
            b.log.push('混乱判定 ' + Math.round(target.lastConfusionRoll.chance * 100) + '%：未触发');
          }
          // 曲射本身不触发反击，但参与集火的直射单位仍然可以成为反击目标。
          const directParts = parts.filter(function (p) {
            return p && !battleArtilleryIsIndirect(p, target);
          });
          const cannotCounter = !!target.confused;
          const counterTargets = cannotCounter ? [] : battleCounterTargets(target, directParts.map(function (p) { return p.id; }));
          if (cannotCounter) {
            b.counter = null;
            b.log.push(target.name + ' 处于混乱，无法反击');
          } else if (counterTargets.length) {
            b.counter = {
              counterUnitId: target.id,
              chooserSide: target.side,
              targetIds: counterTargets.map(function (u) { return u.id; }),
              lethal: !target.alive,
            };
          } else {
            b.counter = null;
          }
          hits.push(target.name + ' -' + dmg);
        } else {
          const targets = spec.rocket ? battleRocketArea(target) : [target];
          targets.forEach(function (t) {
            const calc = battleAttackRawOne(unit, t, battleDistanceKey(unit, t));
            const dmg = battleRollDamage(calc.raw);
            battleDamageUnit(t, dmg);
            b3AddDamageFloat(t, dmg, t.side === unit.side ? '#ffcc66' : '#ff6b57');
            hits.push(t.name + ' -' + dmg);
          });
        }
        unit.mp -= cost;
        unit.artyShots = Number(unit.artyShots || 0) + 1;
        if (spec.rocket) unit.rocketReloadRound = b.round + 1;
        battleCounterBatteryRecord(unit);
        battleClearCounterBatteryMark(unit.side, target.c, target.r);
        if (action.type === 'focus') {
          target.lockedBy = [];
          target.lockCosts = {};
        }
        b.selectedId = null;
        b.log.push(unit.name + (spec.rocket ? ' 火箭炮覆盖 ' : (action.type === 'focus' ? ' 集火曲射 ' : ' 曲射 ')) + target.name +
          '：' + hits.join('、') + '（1 行动力，曲射无反击）');
        battleRefresh();
        battleCheckAutoEnd();
        return;
      }
      if (action.type === 'lock') {
        if ((target.lockedBy || []).indexOf(unit.id) !== -1) {
          b.selectedId = unit.id;
          battleRefresh();
          return;
        }
        const lockCost = battleAttackCost(unit, target);
        if (unit.mp < lockCost) return;
        target.lockedBy = (target.lockedBy || []).concat(unit.id);
        target.lockCosts = target.lockCosts || {};
        target.lockCosts[unit.id] = lockCost;
        unit.mp -= lockCost;
        battleActionLockUnit(unit);
        b.selectedId = unit.id;
        b.log.push(unit.name + ' 锁定 ' + target.name + '（-' + lockCost + ' 行动力，可改攻击/集火；回合结束解除）');
        battleRefresh();
        return;
      }
      const ownLock = (target.lockedBy || []).indexOf(unit.id) !== -1;
      if (ownLock) {
        const refund = battleLockPaid(target, unit.id);
        target.lockedBy = (target.lockedBy || []).filter(function (id) { return id !== unit.id; });
        if (target.lockCosts) delete target.lockCosts[unit.id];
        unit.mp = Math.min(battleMaxMp(unit), unit.mp + refund);
        b.log.push(unit.name + ' 把锁定改为' + (action.type === 'focus' ? '集火' : '攻击') + '，返还 ' + refund + ' 行动力');
      }
      const participants = [unit.id];
      if (action.type === 'focus') {
        (target.lockedBy || []).forEach(function (id) {
          const u = battleUnitById(id);
          if (u && u.alive && u.side === unit.side && participants.indexOf(id) === -1) participants.push(id);
        });
      }
      const participantsUnits = participants.map(battleUnitById).filter(Boolean);
      const facingInfo = battleAutoFacing(target, participantsUnits);
      let facing = Number(action.facing);
      const hasChosenFacing = isFinite(facing) && facing >= 0 && facing <= 5;
      if (facingInfo.conflict && !hasChosenFacing) {
        b.facingChoice = {
          key: 'fc-' + Date.now().toString(36),
          attackerSide: unit.side,
          defenderSide: target.side,
          targetName: target.name,
          options: facingInfo.options,
          action: { type: action.type, unitId: unit.id, targetId: target.id, side: unit.side },
        };
        b.selectedId = null;
        battleRefresh();
        return;
      }
      if (!hasChosenFacing) facing = facingInfo.facing;
      target.facing = facing;
      unit.facing = battleAutoFacing(unit, [target]).facing;
      const resolved = battleResolveFocus(unit, target, participants, facing);
      const calc = resolved.calc;
      const cost = battleAttackCost(unit, target);
      if (unit.mp < cost) return;
      const dmg = resolved.dmg;
      battleDamageUnit(target, dmg);
      b3AddDamageFloat(target, dmg, '#ff6b57');
      battleClearCounterBatteryMark(unit.side, target.c, target.r);
      if (action.type === 'focus') {
        target.lockedBy = [];
        target.lockCosts = {};
        target.lastConfusionRoll = null;
        if (target.alive && calc.pen <= 0.2) {
          b.log.push('全队最高穿透仍无法击穿，不计算混乱');
        } else if (target.alive && battleTryConfusion(target, participantsUnits, facing, calc.pen > 0.2)) {
          b.log.push(target.name + ' 陷入混乱');
        } else if (target.lastConfusionRoll) {
          b.log.push('混乱判定 ' + Math.round(target.lastConfusionRoll.chance * 100) + '%：未触发');
        }
      }
      unit.mp -= cost;
      battleActionLockUnit(unit);
      b.selectedId = null;
      b.log.push(unit.name + (action.type === 'focus' ? ' 集火 ' : ' 攻击 ') + target.name +
        '：' + battleFmt(calc.raw) + ' → ' + dmg +
        '（穿透 ' + battleFmt(calc.pen) + '，地形 -' + Math.round(calc.protect * 100) + '%' +
        (calc.night < 1 ? '，夜间' : '') + '，' + cost + ' 行动力）');
      // 混乱单位被击中直接消灭，且不能再反击；本次被集火打出混乱也同样无法反击。
      const cannotCounter = !!target.confused;
      const counterTargets = cannotCounter ? [] : battleCounterTargets(target, participants);
      if (cannotCounter) {
        b.counter = null;
        b.log.push(target.name + ' 处于混乱，无法反击');
      } else if (counterTargets.length) {
        b.counter = {
          counterUnitId: target.id,
          chooserSide: target.side,
          targetIds: counterTargets.map(function (u) { return u.id; }),
          lethal: !target.alive,
        };
      } else {
        b.counter = null;
        b.log.push(target.name + ' 没有可见的反击目标');
      }
      battleRefresh();
      battleCheckAutoEnd();
      return;
    }
  }

  function battleNextTurn() {
    const b = state.battle;
    if (!b || b.counter || b.reinforce || b.facingChoice) return;
    const leavingSide = b.activeSide;
    const slots = airPadCells(leavingSide, 8);
    let slotIndex = 0;
    b.units.forEach(function (u) {
      if (u.side !== leavingSide || !u.alive || !u.reconActiveRound) return;
      const slot = slots[slotIndex++] || airPadCells(leavingSide, 1)[0];
      u.reconActiveRound = 0;
      u.reconCell = null;
      u.airBase = true;
      if (slot) { u.c = slot.c; u.r = slot.r; }
    });
    b.counterBatteryMarks = (b.counterBatteryMarks || []).filter(function (m) {
      return m.forSide !== leavingSide;
    });
    battleClearTransient();
    b.units.forEach(function (u) { u.lockedBy = []; u.lockCosts = {}; });
    if (b.activeSide === 'attacker') {
      b.activeSide = 'defender';
      battleResetMp(b, 'defender');
    } else {
      const prevPhase = b.phase;
      b.activeSide = 'attacker';
      b.round += 1;
      b.phase = battlePhaseOfRound(b.round);
      battleResetMp(b, 'attacker');
      b.log.push('第 ' + b.round + ' 回合 · ' + battlePhaseLabel(b.phase) + ' 阶段');
      if (b.phase !== prevPhase && (b.phase === 'b' || b.phase === 'c')) {
        battleReinforceBegin(b, b.phase);
      }
    }
    if (b.engineerProject && b.engineerProject.round < b.round - 1) {
      b.engineerProject = null;
      b.log.push('碉堡工程因超过连续回合而失效');
    }
    b.selectedId = null;
    b.ghost = null;
    battleRefresh();
  }

  function gameSaveObject() {
    if (!state.map || !state.mapWrapper || !state.phase) return null;
    const mapOut = Object.assign({}, state.mapWrapper.map || {});
    if (state.map) {
      mapOut.phases = state.map.phases;
      mapOut.facing = state.map.facing;
      if (state.map.holes) mapOut.holes = state.map.holes;
    }
    return {
      format: 'bingqi-online-save',
      version: 1,
      savedAt: new Date().toISOString(),
      mode: state.test ? 'test' : 'online',
      phase: state.phase,
      map: mapOut,
      mapTitle: state.mapWrapper.title || '作战地图',
      factions: state.hostFactions || null,
      teams: state.hostTeams || null,
      decks: state.decks || null,
      deploy: state.deploy || null,
      battle: state.battle || null,
      testSeats: state.test ? state.testSeats.map(function (s) {
        return {
          id: s.id, name: s.name, side: s.side, faction: s.faction,
          factionReady: !!s.factionReady, deckReady: !!s.deckReady,
          prep: s.prep ? JSON.parse(JSON.stringify(s.prep)) : null,
          ready: !!s.ready,
        };
      }) : null,
      activeSeat: state.test ? state.activeSeat : '',
      side: state.side || null,
      faction: state.faction || null,
    };
  }

  function saveGameFile() {
    if (!state.map || (state.phase !== 'battle' && state.phase !== 'deploy')) {
      toast('当前没有可保存的战局');
      return;
    }
    const data = gameSaveObject();
    if (!data) { toast('保存失败'); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    downloadText('bingqi-save-' + stamp + '.json', JSON.stringify(data, null, 2));
    toast('战局已导出');
  }

  function loadGameFile() {
    if (state.role === 'guest' && !state.test) {
      toast('只有房主或本地测试可以载入战局');
      return;
    }
    const input = el('online-save-file');
    if (input) input.click();
  }

  function loadGameSave(data) {
    try {
      if (!data || data.format !== 'bingqi-online-save' || Number(data.version) !== 1) {
        throw new Error('不是有效的兵棋战局存档');
      }
      if (data.phase !== 'battle' && data.phase !== 'deploy') throw new Error('存档阶段不支持');
      if (!data.map) throw new Error('存档缺少地图');
      const isTestSave = data.mode === 'test';
      if (state.role === 'guest' && !state.test) throw new Error('只有房主或本地测试可以载入战局');
      if (state.test && !isTestSave) throw new Error('这是联机存档，请在房主房间里载入');
      if (!state.test && state.role === 'host' && isTestSave) throw new Error('这是本地测试存档，请在本地测试里载入');
      if (!state.test && state.role !== 'host') throw new Error('当前不在可载入的房间中');
      const parsed = parseMap(data.map);
      loadPrepData().then(function () {
        state.map = parsed.parsed;
        state.mapWrapper = { title: data.mapTitle || '作战地图', map: parsed.map };
        state.selectedMapId = '';
        state.hostFactions = data.factions || state.hostFactions;
        state.hostTeams = data.teams || state.hostTeams;
        state.decks = data.decks || null;
        state.deploy = data.deploy || null;
        state.battle = data.battle || null;
        state.phase = data.phase;
        state.ghost = null;
        state.choice = null;
        state.deploySel = '';
        state.reinforceSel = '';
        state.deployDist = null;
        state.mapError = '';
        if (state.test) {
          if (data.testSeats && data.testSeats.length) {
            state.testSeats = data.testSeats;
            state.activeSeat = data.activeSeat || state.testSeats[0].id;
            ensureTestSeats(state.testSeats.length);
            syncActiveSeat();
          }
          if (data.side) state.side = data.side;
          if (data.faction) state.faction = data.faction;
        }
        ensureDeployModels();
        if (state.role === 'host' && state.net && !state.test) {
          state.net.publishMap(state.mapWrapper);
          state.net.setHostState({
            phase: state.phase,
            mode: state.map.mode,
            map: mapMeta(state.map, state.mapWrapper.title),
            decks: state.decks,
            deploy: state.deploy,
            battle: state.battle,
            factions: state.hostFactions,
            teams: state.hostTeams,
          });
          state.battleSeenAction = '';
        }
        state.view = 'room';
        renderRoom();
        window.dispatchEvent(new Event('resize'));
        pushLog('已载入战局存档 · ' + (state.mapWrapper.title || '作战地图'));
        toast('战局已载入');
      }).catch(function (err) {
        showAlert('载入失败', String((err && err.message) || err));
      });
    } catch (err) {
      showAlert('载入失败', String((err && err.message) || err));
    }
  }


  function battleEndTurn() {
    if (!state.battle || state.battle.counter || state.battle.reinforce || state.battle.airIntercept || state.battle.facingChoice) return;
    if (!battleCanControl(state.battle.activeSide)) return;
    battleRequest({ type: 'endTurn', side: state.battle.activeSide });
  }

  function battleHasPendingLock() {
    const b = state.battle;
    if (!b) return false;
    return b.units.some(function (u) {
      if (!u.alive || u.side !== b.activeSide) return false;
      return b.units.some(function (t) {
        return t.alive && t.lockedBy && t.lockedBy.indexOf(u.id) !== -1;
      });
    });
  }

  function battleCheckAutoEnd() {
    const b = state.battle;
    // 客人做乐观更新时不本地推进回合，等房主的状态回来
    if (state.optimistic) return;
    if (!b || b.counter || b.reinforce || b.airIntercept || b.facingChoice) return;
    if (battleHasPendingLock()) return;
    const active = battleUnitsFor(b.activeSide);
    if (!active.length) { battleNextTurn(); return; }
    if (!active.some(function (u) { return u.mp > 0 && !u.pushLocked && !u.actionLocked; })) battleNextTurn();
  }

  function battleSelect(unitId) {
    if (!state.battle) return;
    state.battle.selectedId = unitId;
    state.battle.ghost = null;
    state.battle.choice = null;
    state.transportMode = null;
    hideEl('battle-choice', true);
    battleRefresh();
  }

  function battleSetGhost(unit, c, r) {
    if (!state.battle || !unit) return;
    if (unit.pushLocked) {
      toast('推进后本回合不能再行动');
      return;
    }
    if (unit.guardStop) {
      toast('进入警戒格后本回合不能再移动，只能攻击警戒单位');
      return;
    }
    let res = battleFindPath(unit, c, r);
    if (!res) { toast('不能移动到该格'); return; }
    let ghostC = c, ghostR = r;
    if (res.cost > unit.mp) {
      // 点到行动力之外的格子：把虚影沿路线退到最远还能停下的空格。
      let acc = 0;
      const cut = [];
      res.path.forEach(function (step) {
        const stepCost = battleTerrainCost(unit, step.c, step.r);
        if (acc + stepCost > unit.mp + 1e-9) return;
        acc += stepCost;
        cut.push({ c: step.c, r: step.r, cost: acc });
      });
      while (cut.length && battleUnitAt(cut[cut.length - 1].c, cut[cut.length - 1].r)) cut.pop();
      if (!cut.length) {
        toast('行动力不足，附近没有可停的格子');
        return;
      }
      const last = cut[cut.length - 1];
      ghostC = last.c;
      ghostR = last.r;
      res = { cost: last.cost, path: cut };
      toast('行动力不足，虚影停在最近可达格');
    }
    state.battle.ghost = { unitId: unit.id, c: ghostC, r: ghostR, cost: res.cost, path: res.path };
    state.battle.selectedId = unit.id;
    state.battle.choice = null;
    hideEl('battle-choice', true);
    battleRefresh();
  }

  function battleClickAt(c, r, button) {
    const b = state.battle;
    if (!b) return;
    if (b.airIntercept || b.facingChoice) return;
    if (state.buildMode) {
      const unit = b.selectedId ? battleUnitById(b.selectedId) : null;
      if (!unit || !battleTrait(unit, 'engineer') || !battleCanControl(unit.side)) {
        state.buildMode = null;
        renderBattleBuildPanel();
        return;
      }
      const type = state.buildMode;
      battleRequest({
        type: 'build', side: unit.side, unitId: unit.id,
        c: c, r: r, buildingType: type,
      });
      state.buildMode = null;
      b3ClearBuildingGhost();
      renderBattleBuildPanel();
      return;
    }
    if (b.reinforce) {
      const side = battleMySide();
      const rClicked = battleUnitAt(c, r);
      if (b.reinforce.stage === 'deploy' && battleCanReinforce(side)) {
        if (button === 'right') {
          if (rClicked && rClicked.reinforceNew && rClicked.side === side) {
            battleRequest({ type: 'reinforceUndeploy', side: side, targetId: rClicked.id });
          }
          return;
        }
        if (rClicked && rClicked.side === side && battleReinforceIsAirborne(side, b.reinforce.phase)) {
          if (battleReinforceGroundPlaced(side)) {
            toast('已经开始部署，空降圆心不能再更改');
          } else {
            battleRequest({ type: 'reinforceAirborne', side: side, mode: 'unit', unitId: rClicked.id });
          }
          return;
        }
        const sel = state.reinforceSel;
        if (!sel) { toast('先在左侧选择要部署的增援单位'); return; }
        battleRequest({ type: 'reinforceDeploy', side: side, name: sel, c: c, r: r });
      }
      return;
    }
    const clicked = battleUnitAt(c, r);
    if (button === 'left') {
      if (b.counter) {
        if (clicked && b.counter.targetIds.indexOf(clicked.id) !== -1 &&
            battleCanCounter(b.counter.chooserSide)) {
          battleRequest({ type: 'counter', side: b.counter.chooserSide, counterId: clicked.id });
        }
        return;
      }
      if (b.ghost) { b.ghost = null; battleRefresh(); return; }
      if (!battleCanControl(b.activeSide)) return;
      if (clicked && clicked.side === b.activeSide) {
        battleSelect(clicked.id === b.selectedId ? null : clicked.id);
      } else {
        battleSelect(null);
      }
      return;
    }
    if (button !== 'right' || b.counter) return;
    if (!battleCanControl(b.activeSide)) return;
    const selected = battleUnitById(b.selectedId);
    if (!selected) {
      if (clicked && clicked.side === b.activeSide) battleSelect(clicked.id);
      return;
    }
    if (selected.actionLocked) {
      if (clicked && clicked.side !== selected.side &&
          (clicked.lockedBy || []).indexOf(selected.id) !== -1) {
        battleOpenChoice(selected, clicked);
      } else {
        toast('该单位本回合已行动，只能取消锁定');
      }
      return;
    }
    if (selected.confused && clicked && clicked.side !== selected.side) {
      toast('混乱单位不能主动进攻，只能移动');
      return;
    }
    if (b.ghost && b.ghost.c === c && b.ghost.r === r) {
      battleRequest({ type: 'move', side: b.activeSide, unitId: selected.id, c: c, r: r });
      return;
    }
    if (battleIsAir(selected)) {
      if (battleIsReconPlane(selected)) {
        if (battleIsNight()) { toast('夜间飞机不能起飞'); return; }
        if (!battleReconAvailable(selected)) { toast('该侦察机本回合已经侦察过'); return; }
        battleOpenReconChoice(selected, c, r);
        return;
      }
      if (clicked && clicked.side !== selected.side) {
        if (battleIsNight()) { toast('夜间飞机不能起飞'); return; }
        if (!battleIsAir(clicked) && !battleAirCanTarget(selected, clicked)) {
          toast('没有目标视野：需要侦察或友军正在交战');
          return;
        }
        battleOpenAirChoice(selected, clicked);
      } else {
        toast('空军只能攻击敌方单位');
      }
      return;
    }
    const aaSpec = battleAntiAirSpec(selected);
    if (aaSpec && clicked && clicked.side !== selected.side && battleIsAir(clicked)) {
      if (battleHexDistance(selected.c, selected.r, clicked.c, clicked.r) > battleAAEffectiveRadius(aaSpec, clicked)) {
        toast('目标不在防空半径内');
        return;
      }
      battleRequest({ type: 'aaAttack', side: b.activeSide, unitId: selected.id, targetId: clicked.id });
      return;
    }
    if (clicked && clicked.side !== selected.side && battleIsAir(clicked)) {
      toast('地面单位不能攻击空军，请用防空单位');
      return;
    }
    if (clicked) {
      if (clicked.side === selected.side) {
        const selectedTransport = battleTrait(selected, 'transport');
        const clickedTransport = battleTrait(clicked, 'transport');
        if (battleCanTransportLoad(selected, clicked) || battleCanTransportLoad(clicked, selected)) {
          const tr = battleCanTransportLoad(selected, clicked) ? selected : clicked;
          const ps = tr === selected ? clicked : selected;
          battleOpenTransportChoice(tr, ps);
          return;
        }
        if (selectedTransport || clickedTransport) {
          if (selectedTransport && selected.carryingId) {
            toast('运输车已满载，先右键相邻空格卸下乘客');
          } else if (clickedTransport && clicked.carryingId) {
            toast('该运输车已满载');
          } else {
            toast('该单位不能上车：只能装载非机械化/摩托化地面单位');
          }
          return;
        }
        if (battleIsMedic(selected) && selected.id !== clicked.id &&
            battleHexDistance(selected.c, selected.r, clicked.c, clicked.r) <= 1) {
          battleOpenMedicalChoice(selected, clicked);
          return;
        }
        if (selected.pushLocked || clicked.pushLocked) {
          toast('推进后本回合不能再行动');
          return;
        }
        const swapC1 = battleTerrainCost(selected, clicked.c, clicked.r);
        const swapC2 = battleTerrainCost(clicked, selected.c, selected.r);
        if (selected.mp < swapC1 || clicked.mp < swapC2) {
          toast('换位行动力不足（需 ' + battleFmt(swapC1) + ' + ' + battleFmt(swapC2) + '）');
          return;
        }
        if (selected.guardStop) {
          toast('进入警戒格后本回合不能再移动/换位');
          return;
        }
        if (battleHexDistance(selected.c, selected.r, clicked.c, clicked.r) === 1) {
          battleRequest({ type: 'swap', side: b.activeSide, unitId: selected.id, targetId: clicked.id });
        } else {
          toast('只能和相邻友军互换位置');
        }
        return;
      }
      const artyTarget = battleArtilleryCanTarget(selected, clicked);
      if (!battleUnitCanSee(selected, clicked) && !artyTarget) {
        toast('没有该单位的视野');
        return;
      }
      if (battleHexDistance(selected.c, selected.r, clicked.c, clicked.r) > BATTLE_RANGE && !artyTarget) {
        toast('目标不在射程内');
        return;
      }
      battleOpenChoice(selected, clicked);
      return;
    }
    if (state.transportMode === 'unload') {
      if (!selected.carryingId || clicked ||
          battleHexDistance(selected.c, selected.r, c, r) !== 1) {
        toast('请选择运输车相邻的空格卸下乘客');
        return;
      }
      state.transportMode = null;
      renderBattleTransportPanel();
      battleRequest({ type: 'transportUnload', side: selected.side, unitId: selected.id, c: c, r: r });
      return;
    }
    if (!clicked && selected && battleCounterBatteryMarkAt(selected.side, c, r)) {
      const spec = battleArtillerySpec(selected);
      if (spec && battleHexDistance(selected.c, selected.r, c, r) <= spec.range) {
        battleRequest({ type: 'counterBatteryStrike', side: selected.side, unitId: selected.id, c: c, r: r });
        return;
      }
    }
    battleSetGhost(selected, c, r);
  }

  function battleIsMedic(unit) {
    return !!(unit && unit.alive && battleTrait(unit, 'medical'));
  }

  function battleCanTransportLoad(transport, passenger) {
    if (!transport || !passenger || !transport.alive || !passenger.alive) return false;
    if (!battleTrait(transport, 'transport') || transport.carryingId) return false;
    if (passenger.embarked || passenger.side !== transport.side || passenger.id === transport.id) return false;
    if (battleIsAir(passenger) || battleTrait(passenger, 'transport')) return false;
    if (battleIsMech(passenger)) return false;
    if (passenger.loadRound && Number(passenger.loadRound) >= (Number(state.battle && state.battle.round) || 0)) return false;
    return battleHexDistance(transport.c, transport.r, passenger.c, passenger.r) <= 1;
  }

  function battleSyncCargo(unit) {
    if (!unit || !unit.carryingId) return;
    const c = battleUnitById(unit.carryingId);
    if (c && c.embarked) { c.c = unit.c; c.r = unit.r; }
  }

  function battleOpenTransportChoice(transport, passenger) {
    const box = el('battle-choice');
    if (!box) return;
    state.battle.choice = { attackerId: transport.id, defenderId: passenger.id };
    box.innerHTML = '<h4>' + battleReinforceEsc(transport.name) + ' ← ' + battleReinforceEsc(passenger.name) + '</h4>' +
      '<div class="battle-choice-hint">上车后乘客随运输车移动，乘客本回合不能再行动；运输车被攻击时按软伤结算，乘客受到相同伤害。</div>';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = '装载乘客';
    b.setAttribute('data-battle-action', 'transportLoad');
    box.appendChild(b);
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'btn small';
    c.textContent = '取消';
    c.setAttribute('data-battle-action', 'cancel');
    box.appendChild(c);
    box.classList.remove('hidden');
    box.setAttribute('data-attacker', transport.id);
    box.setAttribute('data-defender', passenger.id);
    box.setAttribute('data-facing', '');
  }

  function battleOpenMedicalChoice(medic, target) {
    const box = el('battle-choice');
    if (!box) return;
    const maxHp = Number(target.maxHp) || battleMaxHp(target);
    const canHeal = target.hp < maxHp;
    state.battle.choice = { attackerId: medic.id, defenderId: target.id };
    box.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = medic.name + ' → ' + target.name;
    box.appendChild(h);
    const hint = document.createElement('div');
    hint.className = 'battle-choice-hint';
    hint.textContent = canHeal
      ? '医疗合并：目标恢复 1 点血量，医疗单位立即消失。'
      : '目标血量已满，无法医疗合并。';
    box.appendChild(hint);
    const add = function (label, type, disabled) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = label;
      b.disabled = !!disabled;
      b.setAttribute('data-battle-action', type);
      box.appendChild(b);
    };
    add('医疗合并 · 目标 +1 血', 'medical', !canHeal);
    add('换位', 'swap', false);
    add('取消', 'cancel', false);
    box.classList.remove('hidden');
    box.setAttribute('data-attacker', medic.id);
    box.setAttribute('data-defender', target.id);
    box.setAttribute('data-facing', '');
    const view = el('online-battle-view');
    if (view && B3 && B3.lastPointer) {
      const vp = view.getBoundingClientRect();
      box.style.left = Math.max(10, Math.min(vp.width - 216, B3.lastPointer.x - vp.left + 10)) + 'px';
      box.style.top = Math.max(10, Math.min(vp.height - 190, B3.lastPointer.y - vp.top + 10)) + 'px';
    }
  }

  function battleOpenReconChoice(air, c, r) {
    const box = el('battle-choice');
    if (!box) return;
    const available = battleReconAvailable(air);
    box.innerHTML = '<h4>' + battleReinforceEsc(air.name) + ' → ' + c + ',' + r + '</h4>' +
      '<div class="battle-choice-hint">侦察机飞抵该格后提供视野，持续到本回合结束；每回合只能侦察一次。会被防空拦截，也会触发敌方战斗机拦截。</div>';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = available ? '侦察此格 · 1 行动力' : '本回合已侦察';
    b.disabled = !available;
    b.setAttribute('data-battle-action', 'airRecon');
    box.appendChild(b);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn small';
    cancel.textContent = '取消';
    cancel.setAttribute('data-battle-action', 'cancel');
    box.appendChild(cancel);
    box.classList.remove('hidden');
    box.setAttribute('data-attacker', air.id);
    box.setAttribute('data-defender', '');
    box.setAttribute('data-recon-c', String(c));
    box.setAttribute('data-recon-r', String(r));
    state.battle.choice = { attackerId: air.id, defenderId: '' };
  }

  function battleOpenAirChoice(air, target, roleOverride) {
    const box = el('battle-choice');
    if (!box) return;
    state.b3BombHint = null;
    refreshBattle3DBombHint();
    const ground = battleAirGroundStats(air);
    const intercept = battleAirIntercept(air);
    const canBomb = ground.soft > 0 || ground.hard > 0;
    const canIntercept = intercept > 0;
    const multi = canBomb && canIntercept;
    let role = roleOverride || (battleIsAir(target) ? 'intercept' : 'bomb');
    if (role === 'intercept' && !canIntercept) role = 'bomb';
    if (role === 'bomb' && !canBomb) role = 'intercept';
    const targetLocked = (target.lockedBy || []).some(function (id) {
      const u = battleUnitById(id);
      return u && u.alive;
    });
    const canNormalAir = !targetLocked || battleAirHasOwnVision(air, target);
    state.battle.choice = { attackerId: air.id, defenderId: target.id };
    box.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = air.name + ' → ' + target.name + '（剩余 ' + air.mp + '）';
    box.appendChild(h);
    box.setAttribute('data-air-selected-role', role);
    if (multi) {
      const roleHint = document.createElement('div');
      roleHint.className = 'battle-choice-hint';
      roleHint.textContent = '选择本次出航用途：';
      box.appendChild(roleHint);
      box.appendChild((function () {
        const wrap = document.createElement('div');
        wrap.className = 'battle-choice-roles';
        [['bomb', '对地轰炸'], ['intercept', '防空拦截']].forEach(function (r) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn small' + (role === r[0] ? ' is-on' : '');
          b.setAttribute('data-air-role', r[0]);
          b.textContent = r[1];
          wrap.appendChild(b);
        });
        return wrap;
      })());
    }
    function add(label, type, focus, disabled) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = label;
      b.disabled = !!disabled;
      b.setAttribute('data-battle-action', type);
      if (focus) b.setAttribute('data-air-focus', '1');
      box.appendChild(b);
    }
    const mismatch = (battleIsAir(target) && role !== 'intercept') || (!battleIsAir(target) && role !== 'bomb');
    const airCost = battleAirActionCost(air, target, role);
    if (role === 'bomb' && battleHeavyBomber(air) && !battleIsAir(target)) {
      const dirHint = document.createElement('div');
      dirHint.className = 'battle-choice-hint';
      dirHint.textContent = '重轰：选择轰炸延伸方向，目标格前后各一格都会受到伤害。';
      box.appendChild(dirHint);
      const wrap = document.createElement('div');
      wrap.className = 'battle-choice-roles';
      const dirNames = [['0', '东西'], ['1', '东北—西南'], ['2', '西北—东南']];
      dirNames.forEach(function (item) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn small' + (item[0] === '0' ? ' is-on' : '');
        b.setAttribute('data-air-dir', item[0]);
        b.textContent = item[1];
        wrap.appendChild(b);
      });
      box.appendChild(wrap);
      box.setAttribute('data-air-dir', '0');
      state.b3BombHint = { targetId: target.id, dir: 0 };
      refreshBattle3DBombHint();
    }
    add((role === 'intercept' ? '攻击 · 空战' : '攻击 · 对地轰炸') + ' · ' + airCost + ' 行动力',
      'airAttack', false, mismatch || air.mp < airCost || !canNormalAir);
    if (targetLocked) {
      add('集火 · ' + (role === 'intercept' ? '空战' : '对地轰炸') + ' · ' + airCost + ' 行动力',
        'airAttack', true, mismatch || air.mp < airCost);
    }
    if (!battleIsAir(target) && battleTrait(air, 'nuke') && Number(state.battle.nukeStock && state.battle.nukeStock[air.side]) > 0) {
      add('核弹 · 剩余 ' + state.battle.nukeStock[air.side] + ' 枚 · 2 行动力', 'nukeAttack', false, air.mp < 2);
    }
    const hint = document.createElement('div');
    hint.className = 'battle-choice-hint';
    hint.textContent = multi
      ? '多功能飞机需先选定用途；对地轰炸会沿起飞点直线飞行并检查防空，空战攻击敌机。'
      : '单一功能飞机自动使用对应任务；出击会检查防空拦截。';
    box.appendChild(hint);
    add('取消', 'cancel', false, false);
    box.classList.remove('hidden');
    box.setAttribute('data-attacker', air.id);
    box.setAttribute('data-defender', target.id);
    const view = el('online-battle-view');
    if (view) {
      const vp = view.getBoundingClientRect();
      const p = B3 && B3.lastPointer ? B3.lastPointer : { x: vp.left + vp.width / 2, y: vp.top + vp.height / 2 };
      box.style.left = Math.max(10, Math.min(vp.width - 260, p.x - vp.left + 10)) + 'px';
      box.style.top = Math.max(10, Math.min(vp.height - 220, p.y - vp.top + 10)) + 'px';
    }
  }

  function battleOpenChoice(attacker, defender) {
    const box = el('battle-choice');
    if (!box) return;
    state.b3BombHint = null;
    refreshBattle3DBombHint();
    if (!attacker) return;
    if (Number(attacker.mp) <= 0 && !attacker.actionLocked) {
      toast('该单位本回合已无行动力');
      return;
    }
    if (attacker.pushLocked) {
      toast('推进后本回合不能再行动');
      return;
    }
    if (attacker.actionLocked) {
      const own = (defender.lockedBy || []).indexOf(attacker.id) !== -1;
      if (!own) { toast('该单位本回合已行动'); return; }
      const refund = battleLockPaid(defender, attacker.id);
      box.innerHTML = '<h4>' + battleReinforceEsc(attacker.name) + ' · 已行动</h4>' +
        '<div class="battle-choice-hint">锁定后本回合不能再行动；取消锁定后可恢复正常行动。</div>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = '取消锁定 · 返还 ' + refund + ' 行动力';
      b.setAttribute('data-battle-action', 'unlock');
      box.appendChild(b);
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'btn small';
      c.textContent = '取消';
      c.setAttribute('data-battle-action', 'cancel');
      box.appendChild(c);
      box.classList.remove('hidden');
      box.setAttribute('data-attacker', attacker.id);
      box.setAttribute('data-defender', defender.id);
      box.setAttribute('data-facing', '');
      state.battle.choice = { attackerId: attacker.id, defenderId: defender.id };
      return;
    }
    if (!battleUnitCanSee(attacker, defender) && !battleArtilleryCanTarget(attacker, defender)) {
      toast('没有该单位的视野');
      return;
    }
    const indirect = battleArtilleryIsIndirect(attacker, defender);
    const artySpec = indirect ? battleArtillerySpec(attacker) : null;
    const guardMode = !!attacker.guardStop;
    const locked = (defender.lockedBy || []).filter(function (id) {
      const u = battleUnitById(id);
      return u && u.alive;
    });
    state.battle.choice = { attackerId: attacker.id, defenderId: defender.id };
    box.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = attacker.name + ' → ' + defender.name + '（剩余 ' + attacker.mp + '）';
    box.appendChild(h);
    function add(label, type, disabled) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = label;
      btn.disabled = !!disabled;
      btn.setAttribute('data-battle-action', type);
      box.appendChild(btn);
    }
    const atkCost = battleAttackCost(attacker, defender);
    const ownLocked = locked.indexOf(attacker.id) !== -1;
    const otherLocked = locked.filter(function (id) { return id !== attacker.id; });
    const targetLocked = locked.length > 0;
    const ownVision = battleUnitHasOwnVision(attacker, defender);
    const canNormal = !targetLocked || ownVision;
    box.setAttribute('data-locked', targetLocked ? '1' : '0');
    const facingUnits = [attacker].concat(otherLocked.map(function (id) { return battleUnitById(id); }).filter(Boolean));
    const facingInfo = battleAutoFacing(defender, facingUnits);
    const chosenFacing = facingInfo.facing;
    const needFacing = false;
    const one = battleAttackRaw(attacker, defender, [attacker.id], chosenFacing);
    const lockCost = battleAttackCost(attacker, defender);
    const ownLockRefund = ownLocked ? battleLockPaid(defender, attacker.id) : 0;
    const availMp = attacker.mp + ownLockRefund;
    box.setAttribute('data-facing', '');
    if (indirect) {
      const canFire = battleArtilleryCanFire(attacker);
      const label = (artySpec.rocket ? '火箭炮覆盖' : '曲射') + ' · -' + battleFmt(one.raw) +
        (artySpec.rocket ? ' · 半径1' : '') + ' · 1 行动力' +
        (canFire ? '' : (artySpec.rocket && attacker.rocketReloadRound && state.battle.round <= attacker.rocketReloadRound
          ? ' · 装填中' : ' · 本回合曲射次数已用完'));
      const canNormalArty = !targetLocked || battleArtilleryHasOwnVision(attacker, defender);
      if (canNormalArty) add(label, 'attack', !canFire);
      if (targetLocked) {
        const focus = battleAttackRaw(attacker, defender,
          [attacker.id].concat(otherLocked), chosenFacing);
        add('集火曲射 · 总伤害 -' + battleFmt(battleAttackTotal(focus)) + ' · 1 行动力（目标已锁定）', 'focus', !canFire);
      }
      const hint = document.createElement('div');
      hint.className = 'battle-choice-hint';
      hint.textContent = '曲射不受反击；伤害固定，装甲目标 ×0.5，无视昼夜。必须有己方侦察单位共享目标视野，或目标已被己方锁定。' +
        (artySpec.rocket ? ' 火箭炮会命中目标及半径 1 内所有地面单位，敌友不分、无视地形。' : '');
      box.appendChild(hint);
      add('取消', 'cancel', false);
      box.classList.remove('hidden');
      box.setAttribute('data-attacker', attacker.id);
      box.setAttribute('data-defender', defender.id);
      const view = el('online-battle-view');
      if (view) {
        const vp = view.getBoundingClientRect();
        const p = B3 && B3.lastPointer ? B3.lastPointer : { x: vp.left + vp.width / 2, y: vp.top + vp.height / 2 };
        box.style.left = Math.max(10, Math.min(vp.width - 216, p.x - vp.left + 10)) + 'px';
        box.style.top = Math.max(10, Math.min(vp.height - 190, p.y - vp.top + 10)) + 'px';
      }
      return;
    }
    const counterCan = battleUnitCanSee(defender, attacker);
    const counterCalc = counterCan ? battleCounterRaw(defender, attacker, attacker.facing == null ? 0 : attacker.facing) : null;
    const attackLabel = '攻击 · -' + battleFmt(one.raw) +
      (counterCalc ? (' / 反击 -' + battleFmt(counterCalc.raw)) : ' · 无反击') +
      ' · ' + atkCost + ' 行动力';
    if (canNormal) add(attackLabel, 'attack', availMp < atkCost || needFacing);
    else add('仅靠锁定共享视野 · 只能集火', 'attack', true);
    if (!targetLocked && !guardMode && battleHexDistance(attacker.c, attacker.r, defender.c, defender.r) === 1) {
      const pd = battlePushDestination(attacker, defender);
      const pc = battlePushRaw(attacker, defender);
      add('推进 · -' + battleFmt(pc.attackRaw) + ' / 反击 -' + battleFmt(pc.counterRaw) + ' · 3 行动力', 'push', !pd || attacker.mp < 3);
    }
    if (targetLocked || otherLocked.length) {
      const focusParts = [attacker.id].concat(otherLocked);
      const focus = battleAttackRaw(attacker, defender, focusParts, chosenFacing);
      add('集火 · 总伤害 -' + battleFmt(battleAttackTotal(focus)) + ' · ' + atkCost + ' 行动力（' + (otherLocked.length + 1) + ' 个单位）', 'focus', availMp < atkCost || needFacing);
    }
    if (!ownLocked) {
      add((otherLocked.length ? '继续锁定' : '锁定') + ' · 消耗 ' + lockCost + ' 行动力', 'lock', attacker.mp < lockCost);
    }
    if (ownLocked) {
      add('取消锁定 · 返还 ' + ownLockRefund + ' 行动力', 'unlock', false);
    }
    add('取消', 'cancel', false);
    const hint = document.createElement('div');
    hint.className = 'battle-choice-hint';
    hint.textContent = guardMode
      ? '进入警戒格后必须停止移动；本回合仍可攻击/集火/锁定任意目标，但不能再移动/换位/推进。'
      : (ownLocked
        ? '你已锁定该目标；目标被锁定后只能集火，也可点“取消锁定”返还 ' + ownLockRefund + ' 行动力。'
        : (targetLocked
          ? (ownVision
            ? '目标虽被锁定，但你有独立视野，可以单独攻击或集火。'
            : '你只能借助锁定共享看到目标，普通攻击不可用，必须集火。')
          : '锁定后本回合内可改攻击/集火；回合结束时未触发集火则自动解除。')) +
        ' 推进按巷战伤害结算双方，推进后本回合不能再行动。' +
        ' 全队最高穿透仍无法击穿时不计算混乱。' +
        (facingInfo.conflict ? ' 伤害与混乱最低朝向冲突，攻击后由防守方选择本次朝向。' : '');
    box.appendChild(hint);
    box.classList.remove('hidden');
    box.setAttribute('data-attacker', attacker.id);
    box.setAttribute('data-defender', defender.id);
    const view = el('online-battle-view');
    if (view) {
      const vp = view.getBoundingClientRect();
      const p = B3 && B3.lastPointer ? B3.lastPointer : { x: vp.left + vp.width / 2, y: vp.top + vp.height / 2 };
      const x = p.x - vp.left, y = p.y - vp.top;
      box.style.left = Math.max(10, Math.min(vp.width - 216, x + 10)) + 'px';
      box.style.top = Math.max(10, Math.min(vp.height - 190, y + 10)) + 'px';
    }
  }

  function battleReinforceEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderBattleTransportPanel() {
    const box = el('battle-transport-panel');
    if (!box) return;
    const b = state.battle;
    const unit = b && b.selectedId ? battleUnitById(b.selectedId) : null;
    if (!b || !unit || !unit.alive || unit.side !== battleMySide() || !battleCanControl(unit.side) ||
        !battleTrait(unit, 'transport') || b.airIntercept || b.facingChoice || b.counter || b.reinforce) {
      state.transportMode = null;
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    if (state.transportMode && !unit.carryingId) state.transportMode = null;
    const cargo = unit.carryingId ? battleUnitById(unit.carryingId) : null;
    let html = '<span class="build-title">' + (state.transportMode === 'unload'
      ? '选择相邻空格卸下 ' + battleReinforceEsc(cargo ? cargo.name : '乘客')
      : (cargo ? '运输车 · 载有 ' + battleReinforceEsc(cargo.name) : '运输车 · 空载')) + '</span>';
    if (state.transportMode === 'unload') {
      html += '<button type="button" class="btn small" data-transport-cancel="1">取消卸下</button>';
    } else if (cargo) {
      html += '<button type="button" class="btn small" data-transport-unload="1">卸下</button>';
    } else {
      html += '<span class="build-hint">右键相邻友军装载</span>';
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderBattleBuildPanel() {
    const box = el('battle-build-panel');
    if (!box) return;
    const b = state.battle;
    const unit = b && b.selectedId ? battleUnitById(b.selectedId) : null;
    const my = battleMySide();
    if (!b || !unit || !unit.alive || unit.side !== my || !battleCanControl(unit.side) ||
        !battleTrait(unit, 'engineer') || b.airIntercept || b.facingChoice || b.counter || b.reinforce) {
      if (state.buildMode) state.buildMode = null;
      b3ClearBuildingGhost();
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const project = b.engineerProject && b.engineerProject.side === unit.side ? b.engineerProject : null;
    const names = { road: '道路', bridge: '桥', trench: '战壕', bunker: '碉堡' };
    let html = '<span class="build-title">' +
      (state.buildMode
        ? '工程作业：点击半径 1 格内的目标格放置' + (names[state.buildMode] || '建筑')
        : (project
          ? '碉堡工程进行中：下一回合在同一格继续（4 行动力）'
          : '工程兵：选择作业')) + '</span>';
    if (state.buildMode) {
      html += '<button type="button" class="btn small" data-build-cancel="1">取消</button>';
    } else if (project) {
      html += '<button type="button" class="btn small" data-build-type="bunker"' +
        (unit.mp < 4 ? ' disabled' : '') + '>继续修碉堡</button>' +
        '<button type="button" class="btn small" data-build-abandon="1">放弃工程</button>';
    } else {
      html += '<button type="button" class="btn small" data-build-type="road"' +
        (unit.mp < 2 ? ' disabled' : '') + '>修路 2</button>' +
        '<button type="button" class="btn small" data-build-type="bridge"' +
        (unit.mp < 2 ? ' disabled' : '') + '>架桥 2</button>' +
        '<button type="button" class="btn small" data-build-type="trench"' +
        (unit.mp < 4 ? ' disabled' : '') + '>战壕 4</button>' +
        '<button type="button" class="btn small" data-build-type="bunker"' +
        (unit.mp < 4 ? ' disabled' : '') + '>碉堡 4×2</button>';
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderBattleFacingChoice() {
    const box = el('battle-facing-choice');
    if (!box) return;
    const b = state.battle;
    const fc = b && b.facingChoice;
    if (!fc || !battleMySide() || battleMySide() !== fc.defenderSide) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const names = ['东', '东南', '西南', '西', '西北', '东北'];
    let html = '<h4>防守方选择朝向 · ' + battleReinforceEsc(fc.targetName || '目标') + '</h4>' +
      '<div class="battle-choice-hint">伤害最低和混乱最低的朝向不一致。请由防守方决定本次正面朝向；每个按钮显示结算伤害和混乱概率。</div>' +
      '<div class="facing-choice-row">';
    (fc.options || []).forEach(function (o) {
      html += '<button type="button" class="btn small" data-facing-choice="' + o.facing + '">' +
        '朝' + names[o.facing] + ' · 伤害 ' + battleFmt(o.damage) +
        ' · <span style="color:#ff5a5c">混乱 ' + Math.round(o.chance * 100) + '%</span></button>';
    });
    html += '</div>';
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderBattleAirIntercept() {
    const box = el('battle-air-intercept');
    if (!box) return;
    const b = state.battle;
    const ai = b && b.airIntercept;
    const my = battleMySide();
    if (!ai || !my || my !== ai.defenderSide) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const key = String(ai.key || '');
    if (state.airInterceptKey !== key) {
      state.airInterceptKey = key;
      state.airInterceptSel = battleAirInterceptOptions(ai.defenderSide).map(function (u) { return u.id; }).slice(0, 2);
    }
    const opts = battleAirInterceptOptions(ai.defenderSide);
    const sel = (state.airInterceptSel || []).filter(function (id) {
      return opts.some(function (u) { return u.id === id; });
    }).slice(0, 2);
    state.airInterceptSel = sel;
    let html = '<h4>防空拦截 · 选择出战飞机</h4>' +
      '<div class="battle-choice-hint">敌方出击 ' + (ai.attackerCount || 1) +
      ' 架（机型未知），目标为 ' + battleReinforceEsc(ai.targetName || '地面单位') +
      '。只能选择带拦截功能的飞机，最多 2 架；默认全部拦截。</div>' +
      '<div class="air-intercept-row">';
    opts.forEach(function (u) {
      html += '<button type="button" class="btn small' + (sel.indexOf(u.id) !== -1 ? ' is-on' : '') +
        '" data-air-intercept-id="' + battleReinforceEsc(u.id) + '">' +
        battleReinforceEsc(u.name) + ' · HP ' + u.hp + ' · 拦截 ' + battleFmt(battleAirIntercept(u)) + '</button>';
    });
    html += '</div><div class="air-intercept-row" style="margin-top:8px">' +
      '<button type="button" class="btn small primary" data-air-intercept-confirm="1">确认拦截</button>' +
      '<button type="button" class="btn small" data-air-intercept-none="1">不拦截</button>' +
      '</div>';
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderBattleReinforce() {
    const panel = el('battle-reinforce');
    const peek = el('battle-reinforce-peek');
    const b = state.battle;
    const r = b && b.reinforce;
    if (!panel) return;
    if (!r) {
      panel.classList.add('hidden');
      panel.classList.remove('is-pick', 'is-deploy', 'is-peek');
      panel.innerHTML = '';
      if (peek) peek.classList.add('hidden');
      return;
    }
    if (r.stage === 'deploy') state.reinforcePeek = false;
    panel.classList.toggle('is-pick', r.stage === 'pick');
    panel.classList.toggle('is-deploy', r.stage === 'deploy');
    panel.classList.toggle('is-peek', r.stage === 'pick' && !!state.reinforcePeek);
    if (peek) {
      peek.classList.toggle('hidden', r.stage !== 'pick');
      peek.textContent = state.reinforcePeek ? '返回配卡' : '查看战场';
    }
    const side = battleMySide();
    const can = side ? battleCanReinforce(side) : false;
    const pick = side ? r.picks[side] : null;
    const stats = side ? battleReinforceStats(side, r.phase) : null;
    const phase = r.phase;
    const readyText = function (s) {
      if (r.stage === 'pick') return r.ready[s] ? '已配卡' : '配卡中';
      return r.done[s] ? '已部署' : '部署中';
    };
    let html = '';
    html += '<div class="br-head"><div><b>' + phase + ' 阶段增援</b><span>' +
      (r.stage === 'pick' ? '配卡' : '部署') + '</span></div>' +
      '<em>' + readyText('attacker') + ' / ' + readyText('defender') + '</em></div>';
    if (!can || !pick || !stats) {
      html += '<p class="br-wait">等待本侧队长操作增援…</p>';
      html += '<div class="br-foot">' + readyText('attacker') + ' · ' + readyText('defender') + '</div>';
      panel.innerHTML = html;
      panel.classList.remove('hidden');
      return;
    }
    if (r.stage === 'pick') {
      if (battleReinforceIsAirborne(side, r.phase)) {
        html += '<div class="br-air">空降师：可在无敌军半径 2 内的友军周围直接空降；空降单位本回合即可行动。</div>';
      }
      html += '<div class="br-budget">预算 <b>' + stats.cost + '</b> / ' + stats.funds +
        ' · 主战 ' + stats.main + '/' + stats.mainLimit +
        ' · 辅助 ' + stats.support + '/' + stats.supportLimit +
        ' · 飞机 ' + stats.air + '/' + (stats.planeLimit === Infinity ? '∞' : stats.planeLimit) + '</div>';
      if (phase === 'B' || phase === 'C') {
        const divs = battleReinforceCandidates(side, phase);
        html += '<div class="br-divs">';
        divs.forEach(function (d) {
          html += '<button type="button" class="br-div' + (pick.divisionId === d.id ? ' is-on' : '') +
            '" data-reinforce-div="' + battleReinforceEsc(d.id) + '">' + battleReinforceEsc(d.name) + '</button>';
        });
        html += '</div>';
      }
      html += '<div class="br-list">';
      stats.entries.forEach(function (e) {
        const n = Number(pick.units[e.name]) || 0;
        const cls = prepUnitClass(e.info);
        html += '<div class="br-row' + (n ? ' is-on' : '') + '">' +
          '<div class="br-name"><b>' + battleReinforceEsc(e.name) + '</b>' +
          '<small>' + (cls === 'air' ? '飞机' : cls === 'main' ? '主战' : cls === 'aux' ? '辅助作战' : '辅助') +
          ' · ' + battleReinforceEsc(prepUnitInfo(prepFaction(side), e.name).price) + ' 点</small></div>' +
          '<div class="br-num"><button type="button" data-reinforce-pick="' + battleReinforceEsc(e.name) + '" data-reinforce-delta="-1">−</button>' +
          '<b>' + n + '/' + e.max + '</b>' +
          '<button type="button" data-reinforce-pick="' + battleReinforceEsc(e.name) + '" data-reinforce-delta="1">+</button></div></div>';
      });
      html += '</div>';
      if (battleReinforceHasNuke(side)) {
        html += '<div class="prep-nuke"><b>核弹购买</b><span>每枚 100 经费' +
          (phase === 'C' ? '；C 阶段没有下一阶段' : '；每枚使下一阶段对方经费 +100') + '</span>' +
          '<div class="br-num">' +
          '<button type="button" data-reinforce-nuke="1" data-reinforce-nuke-delta="-1"' +
          (!r.ready[side] && stats.nukes > 0 ? '' : ' disabled') + '>−</button>' +
          '<b>' + stats.nukes + '</b>' +
          '<button type="button" data-reinforce-nuke="1" data-reinforce-nuke-delta="1"' +
          (!r.ready[side] && stats.cost + 100 <= stats.funds ? '' : ' disabled') + '>+</button></div></div>';
      }
      html += '<p class="br-hint">确认配卡后回到战场进行部署；可先点左上角「查看战场」临时隐藏面板观察局势。</p>';
      html += '<div class="br-actions"><button type="button" class="btn small primary" data-reinforce-confirm="1"' +
        (stats.total <= 0 || r.ready[side] ? ' disabled' : '') + '>' +
        (r.ready[side] ? '已确认，等待对方' : '确认配卡') + '</button></div>';
    } else {
      const remaining = stats.entries.map(function (e) {
        const n = Number(pick.units[e.name]) || 0;
        const placed = (r.placed[side] || []).filter(function (p) { return p.name === e.name; }).length;
        return { name: e.name, left: Math.max(0, n - placed), total: n, placed: placed };
      }).filter(function (x) { return x.total > 0; });
      let sel = state.reinforceSel;
      if (!remaining.some(function (x) { return x.name === sel && x.left > 0; })) {
        sel = (remaining.filter(function (x) { return x.left > 0; })[0] || {}).name || '';
        state.reinforceSel = sel;
      }
      const cells = battleReinforceEligible(side);
      const zs = Object.keys(b.zoneStatus || {}).map(function (id) { return b.zoneStatus[id]; });
      const zoneOwn = zs.filter(function (z) { return !z.contested && z.owner === side; }).length;
      const zoneContested = zs.filter(function (z) { return z.contested; }).length;
      html += '<div class="br-budget">可部署格 <b>' + cells.length + '</b> · 已放 ' +
        (r.placed[side] || []).length + ' / ' +
        remaining.reduce(function (n, x) { return n + x.total; }, 0) +
        ' · 部署区 控制 ' + zoneOwn + ' / 争夺 ' + zoneContested + '</div>';
      html += '<div class="br-list br-deploy-list">';
      remaining.forEach(function (x) {
        html += '<button type="button" class="br-pick' + (sel === x.name ? ' is-on' : '') + (x.left ? '' : ' is-done') +
          '" data-reinforce-select="' + battleReinforceEsc(x.name) + '"' + (x.left ? '' : ' disabled') + '>' +
          '<span>' + battleReinforceEsc(x.name) + '</span><b>' + x.placed + '/' + x.total + '</b></button>';
      });
      html += '</div>';
      const airDeploy = battleReinforceIsAirborne(side, r.phase);
      const placedN = (r.placed[side] || []).length;
      const groundPlaced = battleReinforceGroundPlaced(side);
      if (airDeploy) {
        if (!r.airborne) r.airborne = {};
        if (!r.airborne[side]) r.airborne[side] = { mode: 'zone', unitId: '' };
        const air = r.airborne[side];
        const center = air.mode === 'unit' ? battleUnitById(air.unitId) : null;
        html += '<div class="br-air">空降师：点击地图上的友方单位，选定它作为空降圆心；该友军半径 2 内不能有敌军。选友军后先布满半径 1 的空格，再向外圈。也可以从进攻方出兵点进场。</div>';
        html += '<div class="br-center">';
        html += '<button type="button" class="br-div' + (air.mode === 'zone' ? ' is-on' : '') +
          '" data-reinforce-air="zone"' + (groundPlaced ? ' disabled' : '') + '>按部署区 / 出兵点</button>';
        html += '<span class="br-center-now">' + (center
          ? ('当前圆心：' + battleReinforceEsc(center.name))
          : '当前：部署区 / 出兵点') + '</span>';
        html += '</div>';
      }
      html += '<p class="br-hint">' + (r.done[side] ? '本侧已部署完成，等待对方。' :
        (cells.length ? (airDeploy
          ? '选一个单位，点地图上的空降格。右键已部署单位可撤回（会连同之后部署的单位一起撤回）。空降单位本回合即可行动。'
          : '选一个单位，然后点地图上的蓝色可部署格；右键已部署单位可撤回。新部署单位本回合不能行动，下回合恢复。') :
          '当前没有可部署格（部署区被争夺或被敌方控制）；可以直接结束部署。')) + '</p>';
      const totalN = remaining.reduce(function (n, x) { return n + x.total; }, 0);
      html += '<div class="br-actions"><button type="button" class="btn small primary" data-reinforce-done="1"' +
        (((placedN < totalN) && cells.length > 0) || r.done[side] ? ' disabled' : '') + '>' +
        (r.done[side] ? '已部署完成' : '部署完成') + '</button></div>';
    }
    panel.innerHTML = html;
    panel.classList.remove('hidden');
  }

  function battleCounterUI() {
    const panel = el('battle-counter');
    if (!panel) return;
    const b = state.battle;
    if (!b || !b.counter) { panel.classList.add('hidden'); return; }
    const cu = battleUnitById(b.counter.counterUnitId);
    const targets = (b.counter.targetIds || []).map(function (id) {
      const u = battleUnitById(id);
      return u && u.alive ? u.name : '';
    }).filter(Boolean);
    panel.innerHTML = '';
    const h = document.createElement('b');
    h.textContent = '选择反击目标';
    const p = document.createElement('p');
    p.textContent = (cu ? cu.name : '被攻击单位') +
      (b.counter.lethal ? ' 已阵亡，仍可打出反击' : ' 反击') +
      (targets.length ? '：点击 ' + targets.join(' / ') + ' 中的一个' : '：没有可反击的进攻方') +
      '；悬停可看预计伤害。';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn small';
    skip.textContent = '不反击';
    skip.setAttribute('data-battle-counter-skip', '1');
    panel.appendChild(h);
    panel.appendChild(p);
    panel.appendChild(skip);
    panel.classList.toggle('hidden', !battleCanCounter(b.counter.chooserSide));
  }

  function battleShowTip(clientX, clientY, text) {
    const tip = el('battle-tip');
    const view = el('online-battle-view');
    if (!tip || !view) return;
    if (!text) { tip.classList.add('hidden'); return; }
    tip.textContent = text;
    tip.classList.remove('hidden');
    const r = view.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.width - 150, clientX - r.left + 12)) + 'px';
    tip.style.top = Math.max(8, clientY - r.top - 34) + 'px';
  }

  function enterBattle() {
    if (state.phase !== 'deploy') return;
    state.phase = 'battle';
    state.battle = initBattleState();
    if (state.net && state.role === 'host') {
      state.net.setHostState({
        phase: 'battle',
        decks: state.decks,
        deploy: state.deploy,
        battle: state.battle,
        factions: state.hostFactions || {
          attacker: sideFaction('attacker'),
          defender: sideFaction('defender'),
        },
      });
    }
    pushLog('部署完成 · A 阶段第 1 回合');
    renderRoom();
    window.dispatchEvent(new Event('resize'));
  }

  function deployConfirm() {
    const side = myDeploySide();
    if (!canDeploySide(side)) return;
    const remain = deployRemainingList(side).reduce(function (n, u) { return n + u.remaining; }, 0);
    if (remain > 0) { toast('还有 ' + remain + ' 个单位没有放置'); return; }
    if (side === 'attacker' && !(state.map && state.map.deploy && state.map.deploy.spawn)) {
      toast('地图没有进攻方出兵点'); return;
    }
    if (side === 'defender' && !(state.map && state.map.deploy && state.map.deploy.zone && state.map.deploy.zone.size)) {
      toast('地图没有防守方部署区'); return;
    }
    state.deploy.ready[side] = true;
    deployPublish();
    renderPlayers();
    renderDeployPanel();
    scheduleDraw();
    pushLog((side === 'attacker' ? '攻方' : '守方') + '部署完成');
    deployMaybeEnterBattle();
  }

  function mergeGuestDeploy(g) {
    if (!state.deploy || !state.decks) return;
    const side = normalizeSide(g.side);
    if (!side) return;
    const deck = deployDeck(side);
    if (!deck.length) return;
    const other = deployUnits().filter(function (u) { return u.side !== side; });
    const incoming = g.deploy && Array.isArray(g.deploy.units) ? g.deploy.units : [];
    const built = [];
    const used = {};
    incoming.forEach(function (raw) {
      if (!raw || normalizeSide(raw.side) !== side) return;
      const name = String(raw.name || '');
      const total = deck.filter(function (n) { return n === name; }).length;
      if (!total || (used[name] || 0) >= total) return;
      const c = Math.floor(Number(raw.c)), r = Math.floor(Number(raw.r));
      if (!isFinite(c) || !isFinite(r)) return;
      if (deployCellReason(side, c, r, other.concat(built))) return;
      used[name] = (used[name] || 0) + 1;
      let id = String(raw.id || '');
      if (!id || other.concat(built).some(function (u) { return u.id === id; })) {
        id = 'u-guest-' + side + '-' + Date.now().toString(36) + '-' + built.length;
      }
      built.push({ id: id, side: side, name: name, c: c, r: r });
    });
    const wasReady = !!state.deploy.ready[side];
    state.deploy.units = other.concat(built);
    // 空军不参与部署；客机只提交地面单位后，由房主补机场待命单位。
    autoDeployAircraft();
    const groundDeckCount = deck.filter(function (name) { return !battleIsAirUnit(name, side); }).length;
    const groundPlaced = state.deploy.units.filter(function (u) {
      return u.side === side && !u.airBase;
    }).length;
    state.deploy.ready[side] = !!(g.deploy && g.deploy.ready && groundPlaced === groundDeckCount);
    if (state.net && state.role === 'host') {
      state.net.setHostState({ deploy: state.deploy });
    }
    if (state.deploy.ready[side] && !wasReady) {
      pushLog((side === 'attacker' ? '攻方' : '守方') + '部署完成');
    }
    renderPlayers();
    renderDeployPanel();
    scheduleDraw();
    deployMaybeEnterBattle();
  }

  function renderDeployPanel() {
    const card = el('online-deploy-card');
    if (!card) return;
    const on = state.phase === 'deploy' && state.view === 'room';
    card.classList.toggle('hidden', !on);
    const hint = el('online-deploy-map-hint');
    if (!on) {
      if (hint) hint.classList.add('hidden');
      return;
    }

    const side = myDeploySide();
    const deck = deployDeck(side);
    const remaining = deployRemainingList(side);
    const selectedName = side ? deploySelectedName() : '';
    const placed = deployUnits().filter(function (u) { return u.side === side; }).length;
    const remainCount = remaining.reduce(function (n, u) { return n + u.remaining; }, 0);
    const captain = side ? selfIsCaptain(side) : false;
    const ready = !!(state.deploy && side && state.deploy.ready[side]);
    const editable = !!side && captain && !ready;

    setText('online-deploy-count', placed + ' / ' + deck.length);
    const note = el('online-deploy-note');
    if (note) {
      if (!side) {
        note.textContent = '还没有选择攻守。';
      } else if (!captain) {
        const cap = sideCaptain(side);
        note.textContent = '本侧由队长「' + (cap ? cap.name : '队长') + '」部署；你可以查看实时结果。';
      } else if (ready) {
        note.textContent = '你方已部署完成' + (state.deploy.ready[otherSide(side)] ? '，双方都已确认。' : '，等待对方。');
      } else if (remainCount === 0) {
        note.textContent = '全部单位已放置；检查无误后点「部署完成」。';
      } else if (side === 'defender') {
        note.textContent = '点击地图上的蓝色部署区，放置选中的单位。任意格子都可以，但不能和已有单位重叠。';
      } else {
        const info = deployEligibleFor(side);
        if (!state.map || !state.map.deploy || !state.map.deploy.spawn) {
          note.textContent = '地图没有设置进攻方出兵点，暂时无法部署。';
        } else if (info.cells.length) {
          note.textContent = info.ring === 0
            ? '先从出兵点本格放置，再逐圈向外。'
            : ('从出兵点向外逐圈放置：先布满第 ' + info.ring + ' 圈（当前还剩 ' + info.cells.length + ' 格），才能放下一圈。');
        } else {
          note.textContent = '当前没有可放置的格子。';
        }
      }
    }

    const seats = el('online-deploy-seats');
    if (seats) {
      seats.innerHTML = '';
      if (state.test) {
        seats.classList.remove('hidden');
        state.testSeats.forEach(function (seat) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'prep-seat' + (seat.id === state.activeSeat ? ' is-active' : '');
          b.setAttribute('data-deploy-seat', seat.id);
          b.textContent = seat.name;
          seats.appendChild(b);
        });
      } else {
        seats.classList.add('hidden');
      }
    }

    const roster = el('online-deploy-roster');
    if (roster) {
      roster.innerHTML = '';
      if (!deck.length) {
        const p = document.createElement('p');
        p.className = 'online-deploy-empty';
        p.textContent = side ? '本侧没有可部署的单位。' : '—';
        roster.appendChild(p);
      } else {
        remaining.forEach(function (u) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'online-deploy-unit' +
            (selectedName === u.name ? ' is-selected' : '') +
            (u.remaining === 0 ? ' is-done' : '');
          b.setAttribute('data-deploy-pick', u.name);
          b.disabled = !editable || u.remaining === 0;
          const name = document.createElement('b');
          name.textContent = u.name;
          const num = document.createElement('span');
          num.textContent = u.remaining + ' / ' + u.total;
          b.appendChild(name);
          b.appendChild(num);
          roster.appendChild(b);
        });
      }
    }

    const undo = el('online-deploy-undo');
    const done = el('online-deploy-done');
    const canEdit = editable && !!state.deploy;
    if (undo) {
      undo.disabled = !canEdit || placed <= 0;
      undo.title = canEdit ? '撤回最后放置的一个单位' : '当前不能修改部署';
    }
    if (done) {
      done.disabled = !canEdit || remainCount > 0;
      done.textContent = ready ? '已部署完成' : '部署完成';
      done.title = ready ? '等待对方' : (remainCount > 0 ? '还有 ' + remainCount + ' 个单位没放置' : '确认部署，双方都完成后开始 A 阶段');
    }

    if (hint) {
      if (!side) {
        hint.textContent = '';
        hint.classList.add('hidden');
      } else if (ready) {
        hint.textContent = '已部署完成 · 等待对方';
        hint.className = 'online-deploy-map-hint is-ready';
      } else if (!captain) {
        hint.textContent = '队长部署中 · 你可以查看';
        hint.className = 'online-deploy-map-hint';
      } else if (remainCount === 0) {
        hint.textContent = '全部单位已放置 · 点「部署完成」';
        hint.className = 'online-deploy-map-hint is-ready';
      } else if (side === 'defender') {
        hint.textContent = '守方 · 蓝色部署区 · 剩余 ' + remainCount + ' 个单位';
        hint.className = 'online-deploy-map-hint is-defender';
      } else {
        const info = deployEligibleFor(side);
        hint.textContent = '攻方 · 第 ' + info.ring + ' 圈 · 本圈还需 ' + info.cells.length + ' 格 · 剩余 ' + remainCount + ' 个单位';
        hint.className = 'online-deploy-map-hint is-attacker';
      }
    }
    if (B3) {
      refreshBattle3DUnits();
      syncBattle3DHUD();
    }
    scheduleDraw();
  }

  function drawDeployOverlay(ctx, w, h, parsed) {
    if (!state.deploy) return;
    const L = mapLayout(w, h, parsed);
    if (!L) return;
    const side = myDeploySide();
    const hasRemaining = side ? deployRemainingList(side).some(function (u) { return u.remaining > 0; }) : false;
    if (state.phase === 'deploy' && canDeploySide(side) && hasRemaining) {
      const info = deployEligibleFor(side);
      const color = side === 'attacker' ? 'rgba(224,87,63,0.22)' : 'rgba(74,134,224,0.20)';
      const line = side === 'attacker' ? 'rgba(224,120,87,0.95)' : 'rgba(110,168,255,0.95)';
      info.cells.forEach(function (idx) {
        const c = idx % L.cols, r = Math.floor(idx / L.cols);
        const p = L.center(c, r);
        const pts = HG.corners(p.x, p.y, L.scale * 0.91);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
          else ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = line;
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    const selected = deploySelectedName();
    deployUnits().forEach(function (u) {
      const p = L.center(u.c, u.r);
      const own = u.side === side;
      drawUnitModel(ctx, p, L.scale, u, own && u.name === selected && !state.deploy.ready[u.side]);
    });
  }

  function drawMainMap() {
    const canvas = el('online-map');
    if (!canvas || state.view !== 'room' || mount.classList.contains('hidden')) return;
    if (state.phase === 'deploy' || state.phase === 'battle') return;
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
    if ((state.phase === 'deploy' || state.phase === 'battle') && state.deploy) {
      drawDeployOverlay(ctx, w, h, state.map);
    }
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
    const deploy = state.phase === 'deploy' && state.view === 'room';
    const battle = state.phase === 'battle' && state.view === 'room';
    const battle3d = prep || deploy || battle;
    const open = state.factionView && state.phase === 'lobby' && state.view === 'room';
    if (!prep) {
      const oldUnified = document.getElementById('prep-unified');
      if (oldUnified) oldUnified.remove();
    }
    const grid = mount.querySelector('.online-room-grid');
    const foot = mount.querySelector('.online-room-foot');
    if (grid) grid.classList.toggle('hidden', open || prep || battle3d);
    if (foot) foot.classList.toggle('hidden', open || prep || battle3d);
    hideEl('online-faction-view', !open);
    hideEl('online-prep', true);
    hideEl('online-flow', prep || battle3d);
    hideEl('online-test', !state.test || prep || battle3d);
    hideEl('online-banner', prep || battle3d);
    hideEl('online-deploy-card', true);
    hideEl('online-deploy-map-hint', true);
    hideEl('online-side-pick', prep || deploy || battle);
    hideEl('online-faction', prep || deploy || battle);
    hideEl('online-battle-view', !battle3d);
    mount.classList.toggle('is-deploying', deploy);
    const shell = document.querySelector('.online-shell');
    if (shell) shell.classList.toggle('is-battle-wide', battle3d);
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
    if (state.view !== 'room' || state.phase !== 'lobby') return;
    if (!state.map || state.map.mode !== 'attack') {
      toast('先选一张攻防战地图，再选国家阵营');
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
      nukes: Math.max(0, Number(prep.nukes) || 0),
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
    btn.disabled = locked || confirmed || !state.map || state.map.mode !== 'attack' || !state.side;
    btn.title = btn.disabled
      ? (locked ? '对局已开始，阵营已锁定' : (confirmed ? '本阵营已确认，等待对方' : '先选一张攻防战地图，并选定你的攻守'))
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
      note.textContent = '对方还没选攻守；你可以先选国家阵营，双方阵营不能相同。';
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

  function prepHasNuke(data, prep) {
    if (!data || !prep) return false;
    return prepEntryList(data, prep).some(function (e) {
      return (Number(prep.units[e.key]) || 0) > 0 && /核弹/.test(String(e.info && e.info.traits || ''));
    });
  }

  function prepStats(data, prep, side) {
    const div = prepDivision(data, prep);
    const entries = prepEntryList(data, prep);
    const nukes = Math.max(0, Number(prep.nukes) || 0);
    const byKey = {};
    entries.forEach(function (e) { byKey[e.key] = e; });
    let main = 0, support = 0, air = 0, cost = nukes * 100, total = 0;
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
      nukes: nukes,
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

  function prepAdjustNuke(delta) {
    const side = normalizeSide(state.side);
    if (!side || state.phase !== 'prepare' || !selfIsCaptain(side)) return;
    const data = prepFaction(side);
    const prep = myPrep();
    if (!data || prep.ready || !prepHasNuke(data, prep)) return;
    const stats = prepStats(data, prep, side);
    const cur = Math.max(0, Number(prep.nukes) || 0);
    if (delta > 0) {
      if (stats.cost + 100 > stats.funds) return;
      prep.nukes = cur + 1;
    } else {
      prep.nukes = Math.max(0, cur - 1);
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
    prep.nukes = 0;
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
    prep.nukes = 0;
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
    prep.nukes = 0;
    prep.ready = false;
    publishPrep();
    renderPrep();
  }

  function prepClearDivision() {
    const prep = myPrep();
    if (prep.ready) return;
    prep.divisionId = '';
    prep.units = {};
    prep.nukes = 0;
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
    if (bothDecksConfirmed()) {
      toast('双方配置都已确认，进入部署阶段');
      maybeEnterDeploy();
    }
  }

  function sideDeckNames(side) {
    const prep = sidePrep(side);
    if (!prep || !prep.units) return [];
    const out = [];
    Object.keys(prep.units).forEach(function (key) {
      const n = Math.max(0, Number(prep.units[key]) || 0);
      const name = key.split('|').slice(1).join('|');
      for (let i = 0; i < n; i++) out.push(name);
    });
    return out;
  }

  function buildDeckSnapshot() {
    return {
      attacker: sideDeckNames('attacker'),
      defender: sideDeckNames('defender'),
    };
  }

  function maybeEnterDeploy() {
    if (state.phase !== 'prepare' || !bothDecksConfirmed()) return;
    if (state.test || state.role === 'host') enterDeploy();
  }

  function enterDeploy() {
    if (state.phase !== 'prepare') return;
    const decks = buildDeckSnapshot();
    if (!decks.attacker.length || !decks.defender.length) {
      toast('有一方还没有可部署的单位');
      return;
    }
    state.phase = 'deploy';
    state.decks = decks;
    state.deploy = { units: [], ready: { attacker: false, defender: false } };
    autoDeployAircraft();
    state.deploySel = '';
    state.deploySeq = 0;
    state.deployDist = null;
    state.factionView = false;
    state.prepError = '';
    ensureDeployModels();
    if (state.net && state.role === 'host') {
      state.net.setHostState({
        phase: 'deploy',
        decks: decks,
        deploy: state.deploy,
        factions: state.hostFactions || {
          attacker: sideFaction('attacker'),
          defender: sideFaction('defender'),
        },
      });
    }
    pushLog('双方配置确认 · 进入 A 阶段部署');
    renderRoom();
    window.dispatchEvent(new Event('resize'));
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
    const meta = document.createElement('div');
    meta.className = 'prep-unit-meta';
    const price = document.createElement('span');
    price.className = 'prep-unit-price';
    const priceNum = document.createElement('b');
    priceNum.textContent = info.missing ? '—' : info.price;
    const priceUnit = document.createElement('small');
    priceUnit.textContent = '动员点';
    price.appendChild(priceNum);
    price.appendChild(priceUnit);
    const sub = document.createElement('span');
    sub.className = 'prep-unit-sub';
    sub.textContent = (entry.source === 'corps' ? prepCatLabel(cls) + ' · ' : '') +
      '血 ' + (info.missing ? '—' : info.hp) + ' · 行 ' + (info.missing ? '—' : info.move) + ' · 上限 ' + entry.max;
    meta.appendChild(price);
    meta.appendChild(sub);
    card.appendChild(top);
    card.appendChild(meta);
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
    card.appendChild(controls);
    return card;
  }

  function prepDeckView(data, prep, side, canEdit) {
    const div = prepDivision(data, prep);
    const corps = prepCorps(data, prep);
    const stats = prepStats(data, prep, side);
    const wrap = document.createElement('div');
    wrap.className = 'prep-deck is-bc';

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

  function prepUnifiedView(data, prep, side, canEdit) {
    const div = prepDivision(data, prep);
    const corps = prepCorps(data, prep);
    const stats = prepStats(data, prep, side);
    const editable = !!canEdit && !prep.ready;
    const wrap = document.createElement('div');
    wrap.id = 'prep-unified';
    wrap.className = 'battle-reinforce is-pick prep-unified';
    let html = '<div class="br-head"><div><b>A 阶段配卡</b><span>' +
      (!prep.corpsId ? '选军' : (!prep.divisionId ? '选师' : '配卡')) +
      '</span></div><em>' + (corps ? battleReinforceEsc(corps.name) : '未选军') +
      ' · ' + (div ? battleReinforceEsc(div.name) : '未选师') + '</em></div>';
    if (!prep.corpsId) {
      html += '<p class="br-hint">先选择本局固定军；军直属单位计入格子、经费和全局上限。</p>';
      wrap.innerHTML = html;
      wrap.appendChild(prepCorpsCards(data, prep, canEdit));
      return wrap;
    }
    if (!prep.divisionId) {
      html += '<p class="br-hint">选择 A 阶段师；步兵 / 空降 / 山地加入 A、B，装甲师留 C。</p>';
      wrap.innerHTML = html;
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'btn small prep-back';
      back.setAttribute('data-prep-change-corps', '1'); back.textContent = '返回换军';
      back.disabled = !canEdit;
      wrap.appendChild(back);
      wrap.appendChild(prepDivisionCards(data, prep, canEdit));
      return wrap;
    }
    html += '<div class="br-actions">' +
      '<button type="button" class="btn small" data-prep-change-division="1"' + (editable ? '' : ' disabled') + '>更换师</button>' +
      '<button type="button" class="btn small" data-prep-change-corps="1"' + (editable ? '' : ' disabled') + '>更换军</button>' +
      '</div>';
    html += '<div class="br-budget">经费 <b>' + stats.cost + '</b> / ' + stats.funds +
      ' · 主战 ' + stats.main + '/' + stats.mainLimit +
      ' · 辅助 ' + stats.support + '/' + stats.supportLimit +
      ' · 飞机 ' + stats.air + '/' + (stats.planeLimit === Infinity ? '∞' : stats.planeLimit) + '</div>';
    html += '<div class="br-list">';
    const entries = stats.entries.slice().sort(function (a, b) {
      const order = { main: 0, aux: 1, support: 2, air: 3 };
      return order[prepSlotClass(a.info)] - order[prepSlotClass(b.info)];
    });
    entries.forEach(function (e) {
      const n = Number(prep.units[e.key]) || 0;
      const cls = prepUnitClass(e.info);
      html += '<div class="br-row' + (n ? ' is-on' : '') + '">' +
        '<div class="br-name"><b>' + battleReinforceEsc(e.name) + '</b><small>' +
        (cls === 'air' ? '飞机' : cls === 'main' ? '主战' : cls === 'aux' ? '辅助作战' : '辅助') +
        ' · ' + (e.info.missing ? '—' : e.info.price) + ' 点 · 血 ' + (e.info.missing ? '—' : e.info.hp) +
        '</small></div><div class="br-num">' +
        '<button type="button" data-prep-unit="' + battleReinforceEsc(e.key) + '" data-prep-delta="-1"' +
        (!editable || n <= 0 ? ' disabled' : '') + '>−</button>' +
        '<b>' + n + '/' + e.max + '</b>' +
        '<button type="button" data-prep-unit="' + battleReinforceEsc(e.key) + '" data-prep-delta="1"' +
        (!editable || !prepCanAdd(e, stats) ? ' disabled' : '') + '>+</button></div></div>';
    });
    html += '</div>';
    if (prepHasNuke(data, prep)) {
      html += '<div class="prep-nuke"><b>核弹购买</b><span>每枚 100 经费；每购买一枚，下一阶段对方经费 +100。</span>' +
        '<div class="br-num">' +
        '<button type="button" data-prep-nuke="1" data-prep-nuke-delta="-1"' +
        (!editable || stats.nukes <= 0 ? ' disabled' : '') + '>−</button>' +
        '<b>' + stats.nukes + '</b>' +
        '<button type="button" data-prep-nuke="1" data-prep-nuke-delta="1"' +
        (!editable || stats.cost + 100 > stats.funds ? ' disabled' : '') + '>+</button></div></div>';
    }
    html += '<div class="br-actions">';
    html += '<button type="button" class="btn small" data-prep-export="1"' + (canEdit ? '' : ' disabled') + '>导出配置</button>';
    html += '<button type="button" class="btn small" data-prep-import="1"' + (canEdit ? '' : ' disabled') + '>导入配置</button>';
    if (prep.ready) {
      html += '<button type="button" class="btn small" data-prep-unlock="1">取消确认</button>';
    } else {
      html += '<button type="button" class="btn small primary" data-prep-confirm="1"' + (canEdit ? '' : ' disabled') + '>确认配卡</button>';
    }
    html += '</div>';
    html += '<p class="br-hint">A 阶段卡池；B 阶段会从剩余师中选新师并用该师 A+B 池。军属计入格子和经费。</p>';
    wrap.innerHTML = html;
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
    stage.classList.add('hidden');
    me.appendChild(stage);
    const oldUnified = document.getElementById('prep-unified');
    if (oldUnified) oldUnified.remove();
    mount.appendChild(prepUnifiedView(data, prep, side, canEdit));
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
    if (state.phase === 'prepare' || state.phase === 'deploy' || state.phase === 'battle') syncBattle3DView();
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

  const TEST_MAP_28 = {"format":"bingqi-map","version":3,"app":"bingqi-map-editor","cols":28,"rows":22,"mode":"attack","terrains":["plain","road","rail","house","city","forest","hill","mountain","river","swamp"],"cells":[0,0,0,0,0,0,0,0,0,0,6,7,9,8,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,7,7,8,8,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,7,7,7,7,8,8,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0,0,3,6,7,7,7,7,8,8,0,0,6,0,0,0,0,0,4,3,0,0,0,0,0,0,0,3,4,3,4,3,3,5,6,8,8,8,8,8,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,4,4,3,3,3,0,8,8,0,0,8,8,8,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,4,4,4,4,0,8,0,0,0,0,4,8,8,3,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,8,0,0,0,0,4,8,8,4,4,0,0,0,0,3,0,0,0,0,0,0,0,0,3,4,4,4,3,8,5,5,5,0,3,4,8,8,3,0,0,0,0,4,3,0,0,0,0,0,0,0,5,3,3,3,8,5,5,6,0,3,4,8,8,4,3,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,8,0,0,5,6,0,3,8,4,8,4,3,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,8,0,0,0,0,0,0,8,4,4,8,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,6,7,0,8,4,3,3,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,7,7,0,0,8,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,7,6,0,8,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,6,7,0,8,0,0,0,8,0,0,0,0,0,0,3,3,3,0,0,0,0,0,0,3,0,0,8,0,6,7,7,8,0,0,0,0,8,0,0,0,0,0,3,4,3,0,0,0,0,0,3,4,0,8,0,0,5,7,6,0,0,0,0,8,0,0,0,0,0,0,3,4,3,0,0,0,0,0,0,3,3,8,0,0,6,7,7,6,0,5,5,5,8,8,0,0,0,0,3,4,4,0,0,0,0,0,0,0,8,0,0,0,5,7,7,6,0,5,5,0,0,8,0,0,0,0,3,3,3,0,0,0,0,0,0,0,8,0,0,0,5,6,6,7,7,7,6,5,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,5,5,6,7,7,6,5,0,0,0,8,0,0,0,0,0,0,0,0],"phases":{"a":1,"b":4,"c":8},"facing":0,"deploy":{"spawn":[0,4],"hqA":null,"hqD":[25,18],"zone":[[6,3],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[3,5],[4,5],[5,5],[6,5],[7,5],[16,5],[3,6],[4,6],[5,6],[6,6],[7,6],[14,6],[15,6],[16,6],[17,6],[2,7],[3,7],[4,7],[5,7],[6,7],[7,7],[13,7],[14,7],[15,7],[16,7],[17,7],[3,8],[4,8],[5,8],[6,8],[7,8],[13,8],[14,8],[15,8],[16,8],[17,8],[4,9],[5,9],[6,9],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[13,10],[14,10],[15,10],[16,10],[17,10],[18,10],[13,11],[14,11],[15,11],[16,11],[17,11],[14,12],[15,12],[16,12],[17,12],[23,15],[24,15],[25,15],[23,16],[24,16],[25,16],[23,17],[24,17],[25,17],[23,18],[24,18],[25,18],[23,19],[24,19],[25,19]],"airA":[[0,2]],"airD":[[27,19]]}};

  function testBattleMap() { return JSON.parse(JSON.stringify(TEST_MAP_28)); }

  function beginTestBattle() {
    loadPrepData().then(function () {
      if (!state.test || state.view !== 'room') return;
      const r = parseMap(testBattleMap());
      if (!r) { toast('测试地图生成失败'); return; }
      state.map = r.parsed;
      state.mapWrapper = { title: '28×22 测试地图', map: r.map };
      state.selectedMapId = 'test-battle';

      ensureTestSeats(2);
      const s0 = state.testSeats[0], s1 = state.testSeats[1];
      s0.side = 'attacker'; s0.faction = 'us';
      s0.factionReady = true; s0.deckReady = true; s0.ready = true;
      s1.side = 'defender'; s1.faction = 'de';
      s1.factionReady = true; s1.deckReady = true; s1.ready = true;
      state.activeSeat = s0.id;
      syncActiveSeat();
      state.factionView = false;
      state.hostFactions = { attacker: 'us', defender: 'de' };
      state.hostTeams = null;
      state.factionReady = true;
      state.deckReady = true;

      const us = ['工兵营', '潘兴重坦营', '宪兵连', '医疗连', '侦察营', 'M15自行防空炮营',
        '105炮兵营', '反炮兵小组', '反炮兵小组'];
      const de = ['鼠式超重坦营', '工兵营', '侦察营', '20防空炮营', '人民冲锋队',
        '105炮兵营', '反炮兵小组', '反炮兵小组'];
      const usAir = ['B29轰炸机', 'F6战斗侦察机'];
      const deAir = ['Bf109战斗机', 'Me262战斗机'];
      // 精简测试：核心地面单位 + 双方105炮/反炮兵 + 重轰/高空/武装侦察机。
      const atkPos = [[12, 11], [11, 10], [9, 10], [11, 9], [12, 10], [10, 10],
        [9, 11], [13, 10], [13, 12]];
      const defPos = [[14, 11], [16, 12], [15, 10], [15, 12], [14, 12],
        [15, 11], [11, 11], [11, 12]];
      const units = [];
      us.forEach(function (name, i) {
        units.push({ id: 'test-us-' + (i + 1), side: 'attacker', name: name, c: atkPos[i][0], r: atkPos[i][1] });
      });
      de.forEach(function (name, i) {
        units.push({ id: 'test-de-' + (i + 1), side: 'defender', name: name, c: defPos[i][0], r: defPos[i][1] });
      });
      const usAirCells = airPadCells('attacker', usAir.length);
      const deAirCells = airPadCells('defender', deAir.length);
      usAir.forEach(function (name, i) {
        const cell = usAirCells[i] || usAirCells[0];
        if (!cell) return;
        units.push({
          id: 'test-us-air-' + (i + 1), side: 'attacker', name: name,
          c: cell.c, r: cell.r, airBase: true,
        });
      });
      deAir.forEach(function (name, i) {
        const cell = deAirCells[i] || deAirCells[0];
        if (!cell) return;
        units.push({
          id: 'test-de-air-' + (i + 1), side: 'defender', name: name,
          c: cell.c, r: cell.r, airBase: true,
        });
      });
      state.decks = { attacker: us.concat(usAir), defender: de.concat(deAir) };
      state.deploy = { units: units, ready: { attacker: true, defender: true } };
      state.phase = 'battle';
      state.battle = initBattleState();
      state.battle.buildings = [];
      const testPersh = state.battle.units.find(function (u) { return u.name === '潘兴重坦营'; });
      if (testPersh) { testPersh.confused = true; testPersh.hp = 5; }
      state.battleSeenAction = '';
      ensureDeployModels();
      pushLog('测试战斗已精简：双方105炮+2个反炮兵，潘兴初始混乱，含B29/F6/德军战斗机');
      toast('测试战斗已开始 · 点名字切换玩家');
      renderRoom();
      window.dispatchEvent(new Event('resize'));
    }).catch(function (err) {
      toast('测试战斗初始化失败：' + (err && err.message ? err.message : '编制数据未加载'));
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
    pushLog('本地测试已启动 · 直接生成测试战场');
    toast('本地测试：正在生成测试战场…');
    renderRoom();
    beginTestBattle();
    mount.focus({ preventScroll: true });
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
      hint.textContent = '创建后会生成 4 位数字房间码。房间最多 4 人：攻方 2 人、守方 2 人（房主算一位）。';
    } else {
      hint.textContent = '输入房主发来的 4 位数字房间码。房主和你要使用同一个中继。';
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
    } else if (state.phase === 'deploy' && p.side) {
      const ready = !!(state.deploy && state.deploy.ready[p.side]);
      st.classList.add(ready ? 'is-ready' : 'is-on');
      st.textContent = ready ? '已部署' : '部署中';
    } else if (state.phase === 'battle' && p.side) {
      st.classList.add('is-ready');
      st.textContent = '参战';
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
    if (state.phase === 'deploy') return 'A 阶段部署中';
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
    const lobby = state.phase === 'lobby';
    const live = state.phase === 'battle';
    const start = el('online-start');
    const ready = el('online-ready');
    const backLobby = el('online-back-lobby');
    const pick = el('online-pick-map');

    hideEl('online-start', !(isHost && lobby));
    hideEl('online-pick-map', !(isHost && lobby));
    hideEl('online-ready', state.test || !(!isHost && lobby));
    hideEl('online-back-lobby', !(isHost && live));

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
    if (state.phase === 'deploy') {
      note.textContent = 'A 阶段部署中 · 守方在蓝色部署区布防，攻方从出兵点逐圈展开 · ' + compositionText();
      return;
    }
    if (state.phase === 'battle') {
      note.textContent = 'A 阶段第 1 回合 · 部署完成 · ' + compositionText();
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
    if (state.phase === 'deploy') {
      phaseNote.textContent = 'A 阶段部署中 · ' + compositionText();
    } else if (state.phase === 'battle') {
      phaseNote.textContent = 'A 阶段第 1 回合 · ' + compositionText();
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
      text = state.phase === 'deploy'
        ? '本地测试 · A 阶段部署 · ' + compositionText()
        : (state.phase === 'battle'
          ? '本地测试 · A 阶段第 1 回合 · ' + compositionText()
          : '本地测试模式 · 不连接任何中继 · 你同时操控 ' + state.testSeats.length + ' 名本机玩家');
      cls = (state.phase === 'deploy' || state.phase === 'battle') ? 'is-live' : 'is-test';
    } else if (state.role === 'guest' && state.host && state.host.online === false) {
      text = '房主已离开，房间已关闭';
      cls = 'is-danger';
    } else if (state.netStatus === 'reconnecting' || state.netStatus === 'offline' ||
               state.netStatus === 'closed' || state.netStatus === 'error') {
      text = state.netStatus === 'error' ? '连接异常，正在尝试恢复…' : '连接中断，正在重连…';
      cls = 'is-warn';
    } else if (state.phase === 'deploy') {
      text = 'A 阶段 · 部署阶段 · ' + compositionText();
      cls = 'is-live';
    } else if (state.phase === 'battle') {
      text = 'A 阶段 · 第 1 回合 · 部署完成 · ' + compositionText();
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
    if (state.phase === 'prepare' || state.phase === 'deploy' || state.phase === 'battle') syncBattle3DView();

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

    if (!el('online-battle-view')) {
      const view = document.createElement('section');
      view.id = 'online-battle-view';
      view.className = 'online-battle-view hidden';
      view.setAttribute('aria-label', 'A 阶段作战地图');
      view.innerHTML =
        '<canvas id="online-battle3d" class="online-battle3d"></canvas>' +
        '<div class="online-battle-top">' +
          '<div class="online-battle-units-wrap">' +
            '<div class="online-battle-kicker">可用单位 · 点击后放到地图</div>' +
            '<div id="online-battle-units" class="online-battle-units"></div>' +
          '</div>' +
          '<aside class="online-battle-status">' +
            '<div id="online-battle-clock" class="online-battle-clock">' +
              '<div class="online-battle-clock-main">' +
                '<b id="online-battle-round">第 1 回合</b>' +
                '<span id="online-battle-daynight" class="online-battle-daynight">白天</span>' +
              '</div>' +
              '<div id="online-battle-day" class="online-battle-day">第 1 天</div>' +
              '<div id="online-battle-next" class="online-battle-next">下一阶段 —</div>' +
            '</div>' +
            '<div id="online-battle-title" class="online-battle-title">A 阶段 · 部署</div>' +
            '<div id="online-battle-turn" class="online-battle-turn">—</div>' +
            '<div id="online-battle-side" class="online-battle-line">—</div>' +
            '<div id="online-battle-opp" class="online-battle-line">—</div>' +
            '<div id="online-battle-seats" class="online-battle-seats hidden"></div>' +
            '<div class="online-battle-actions">' +
              '<button id="online-battle-undo" type="button" class="btn small">撤销</button>' +
              '<button id="online-battle-done" type="button" class="btn small primary">部署完成</button>' +
              '<button id="online-battle-end-turn" type="button" class="btn small primary hidden">结束回合</button>' +
              '<button id="online-save-game" type="button" class="btn small">保存对局</button>' +
              '<button id="online-load-game" type="button" class="btn small">载入对局</button>' +
              '<button id="online-battle-back" type="button" class="btn small hidden">返回大厅</button>' +
            '</div>' +
            '<input id="online-save-file" type="file" accept=".json,application/json" class="hidden" />' +
          '</aside>' +
        '</div>' +
        '<div id="battle-choice" class="battle-choice hidden"></div>' +
        '<div id="battle-air-intercept" class="battle-air-intercept hidden"></div>' +
        '<div id="battle-facing-choice" class="battle-facing-choice hidden"></div>' +
        '<div id="battle-build-panel" class="battle-build-panel hidden"></div>' +
        '<div id="battle-transport-panel" class="battle-transport-panel hidden"></div>' +
        '<div id="battle-counter" class="battle-counter hidden"></div>' +
        '<div id="battle-reinforce" class="battle-reinforce hidden"></div>' +
        '<button id="battle-reinforce-peek" type="button" class="btn small battle-reinforce-peek hidden">查看战场</button>' +
        '<div id="battle-tip" class="battle-tip hidden"></div>' +
        '<div class="online-battle-hint">右键拖动旋转 · 右键点击移动/攻击 · 中键 / 空格拖动平移 · WASD 移动镜头 · 滚轮缩放 · 左键选中 / 取消虚影</div>' +
        '<div id="online-battle-loading" class="online-battle-loading hidden">模型加载中…</div>';
      const grid = room.querySelector('.online-room-grid');
      if (grid && grid.parentNode === room) room.insertBefore(view, grid);
      else room.appendChild(view);
    }

    if (!el('online-deploy-card')) {
      const card = document.createElement('section');
      card.id = 'online-deploy-card';
      card.className = 'online-card online-deploy-card hidden';
      card.innerHTML =
        '<div class="online-panel-head"><h2>A 阶段 · 部署</h2><span id="online-deploy-count" class="online-dims">0 / 0</span></div>' +
        '<p id="online-deploy-note" class="online-deploy-note">—</p>' +
        '<div id="online-deploy-seats" class="online-deploy-seats hidden"></div>' +
        '<div id="online-deploy-roster" class="online-deploy-roster"></div>' +
        '<div class="online-deploy-actions">' +
          '<button id="online-deploy-undo" type="button" class="btn small">撤销</button>' +
          '<button id="online-deploy-done" type="button" class="btn small primary">部署完成</button>' +
        '</div>';
      const players = el('online-players');
      const playersCard = players && players.closest ? players.closest('.online-card') : null;
      if (playersCard && playersCard.parentNode) playersCard.parentNode.insertBefore(card, playersCard.nextSibling);
      else {
        const side = room.querySelector('.online-room-side');
        if (side) side.appendChild(card);
      }
    }

    const mapWrap = el('online-map') && el('online-map').parentElement;
    if (mapWrap && !el('online-deploy-map-hint')) {
      const hint = document.createElement('div');
      hint.id = 'online-deploy-map-hint';
      hint.className = 'online-deploy-map-hint hidden';
      mapWrap.appendChild(hint);
    }

    const card = mount.querySelector('.online-entry-card');
    if (card && !el('online-test-start')) {
      const entry = document.createElement('div');
      entry.className = 'online-test-entry';
      entry.innerHTML =
        '<span class="online-test-entry-label"><b>本地测试</b><em>TEST</em></span>' +
        '<span class="online-test-entry-note">不连接中继，直接生成双方各 5 个单位的测试战场。</span>' +
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
    state.decks = null;
    state.deploy = null;
    state.deploySel = '';
    state.deploySeq = 0;
    state.deployDist = null;
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
      state.codeRetry = 0;
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
      showAlert('房间码不对', '房间码是 4 位数字，例如 4821。请向房主确认。');
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
    if (state.role === 'host') {
      // 4 位数字只有 1 万种，公共中继上会撞码：撞了就自动换一个
      if (h.id && h.id !== state.selfId && state.joined) {
        const tries = state.codeRetry || 0;
        if (tries < 3) {
          state.codeRetry = tries + 1;
          pushLog('房间码 ' + NET.formatCode(state.roomCode) + ' 已被占用，正在换一个');
          toast('房间码撞车了，自动换一个');
          setTimeout(function () { startHost(); }, 350);
        } else {
          toast('连续撞到同一个房间码，请再点一次建房');
        }
      }
      return;
    }

    if (h.online === false) {
      if (state.joined && !state.hostGoneAlerted) {
        state.hostGoneAlerted = true;
        showAlert('房主已离开', '房间已经关闭。', function () { leaveRoom(); });
      }
      renderBanner();
      return;
    }

    if (state.joined) {
      const nextPhase = h.phase === 'battle' ? 'battle'
        : (h.phase === 'deploy' ? 'deploy' : (h.phase === 'prepare' ? 'prepare' : 'lobby'));
      const wasPhase = state.phase;
      const wasBattle = state.phase === 'battle';
      state.phase = nextPhase;
      state.hostTeams = nextPhase === 'battle' && Array.isArray(h.teams) ? h.teams : null;
      state.hostFactions = nextPhase !== 'lobby' && h.factions ? h.factions : null;
      state.decks = nextPhase === 'deploy' || nextPhase === 'battle' ? (h.decks || null) : null;
      if (state.decks) ensureDeployModels();
      state.deploy = nextPhase === 'deploy' || nextPhase === 'battle' ? (h.deploy || null) : null;
      const prevBattleSel = state.battle && state.battle.selectedId;
      state.battle = nextPhase === 'battle' ? (h.battle || null) : null;
      if (state.battle && state.role === 'guest') {
        // 客方的选中是本地 UI 状态，不应被房主的心跳覆盖。
        if (prevBattleSel) {
          const own = state.battle.units.filter(function (u) { return u.id === prevBattleSel && u.alive; })[0];
          if (own && own.side === state.side) state.battle.selectedId = prevBattleSel;
        }
      }
      if (nextPhase === 'deploy' && !state.deploy) {
        state.deploy = { units: [], ready: { attacker: false, defender: false } };
      }
      if (nextPhase === 'deploy' && wasPhase !== 'deploy') {
        state.deploySel = '';
        state.deployDist = null;
        ensureDeployModels();
      }
      // 房主状态说“还没有地图”时，清掉可能从旧会话 retained 下来的地图
      if (!h.map && state.map) {
        state.map = null;
        state.mapWrapper = null;
        state.selectedMapId = '';
      }
      if (nextPhase === 'battle' && !wasBattle) {
        state.battleSeenAction = '';
        pushLog('房主开始了对局');
      }
      if (nextPhase === 'prepare' && wasPhase === 'lobby') pushLog('双方阵营已确认，进入战前准备');
      if (nextPhase === 'deploy' && wasPhase !== 'deploy') pushLog('双方配置确认，进入部署阶段');
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
    if (state.role === 'host') {
      // 新玩家加入时补发当前地图和房主快照；否则晚加入的客机没有地图，攻守按钮会一直是禁用态。
      if ((!prev || !prev.presence || !prev.presence.online) && state.mapWrapper && state.net) {
        state.net.publishMap(state.mapWrapper);
        state.net.setHostState({
          phase: state.phase,
          mode: state.map ? state.map.mode : null,
          map: state.map ? mapMeta(state.map, state.mapWrapper.title) : null,
          decks: state.decks,
          deploy: state.deploy,
          battle: state.battle,
          factions: state.hostFactions,
          teams: state.hostTeams,
        });
      }
      if (state.phase === 'lobby') maybePrepare();
      else if (state.phase === 'prepare') maybeEnterDeploy();
      else if (state.phase === 'deploy' && g.deploy) mergeGuestDeploy(g);
      else if (state.phase === 'battle' && g.battleAction && g.battleAction.id &&
               g.battleAction.id !== state.battleSeenAction &&
               normalizeSide(g.battleAction.side) === normalizeSide(g.side)) {
        state.battleSeenAction = g.battleAction.id;
        battleApply(g.battleAction);
        battlePublish();
      }
    }
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

  /* 房间码输入框改成 4 位数字（index.html 归 UI，这里运行时设置） */
  function setupCodeInput() {
    const input = el('online-code');
    if (input && !input.dataset.codeFixed) {
      input.dataset.codeFixed = '1';
      input.setAttribute('maxlength', '4');
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('placeholder', '4 位数字');
      input.addEventListener('input', function () {
        const v = String(input.value || '').replace(/[^0-9]/g, '').slice(0, 4);
        if (input.value !== v) input.value = v;
      });
    }
    const display = el('online-code-display');
    if (display && !display.dataset.codeFixed) {
      display.dataset.codeFixed = '1';
      display.textContent = '----';
    }
    const box = el('online-code-box');
    if (box && !box.dataset.codeFixed) {
      box.dataset.codeFixed = '1';
      box.textContent = '----';
    }
  }

  function open(opts) {
    if (state.open) return;
    state.open = true;
    setupCodeInput();
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
    if (e.target.closest && e.target.closest('#online-battle-end-turn')) { battleEndTurn(); return; }
    if (e.target.closest && e.target.closest('#online-save-game')) { saveGameFile(); return; }
    if (e.target.closest && e.target.closest('#online-load-game')) { loadGameFile(); return; }
    if (e.target.closest && e.target.closest('#battle-reinforce-peek')) {
      state.reinforcePeek = !state.reinforcePeek;
      renderBattleReinforce();
      return;
    }
    const rDiv = e.target.closest ? e.target.closest('[data-reinforce-div]') : null;
    if (rDiv) {
      const side = battleMySide();
      if (side && battleCanReinforce(side)) {
        battleRequest({ type: 'reinforcePick', side: side, divisionId: rDiv.getAttribute('data-reinforce-div') });
      }
      return;
    }
    const rAir = e.target.closest ? e.target.closest('[data-reinforce-air]') : null;
    if (rAir) {
      const side = battleMySide();
      const val = rAir.getAttribute('data-reinforce-air');
      if (side && battleCanReinforce(side)) {
        battleRequest(val === 'zone'
          ? { type: 'reinforceAirborne', side: side, mode: 'zone' }
          : { type: 'reinforceAirborne', side: side, mode: 'unit', unitId: val });
      }
      return;
    }
    const rNuke = e.target.closest ? e.target.closest('[data-reinforce-nuke]') : null;
    if (rNuke) {
      const side = battleMySide();
      if (side && battleCanReinforce(side)) {
        battleRequest({
          type: 'reinforceNuke', side: side,
          delta: Number(rNuke.getAttribute('data-reinforce-nuke-delta')) || 0,
        });
      }
      return;
    }
    const rPick = e.target.closest ? e.target.closest('[data-reinforce-pick]') : null;
    if (rPick) {
      const side = battleMySide();
      if (side && battleCanReinforce(side)) {
        battleRequest({
          type: 'reinforcePick', side: side,
          name: rPick.getAttribute('data-reinforce-pick'),
          delta: Number(rPick.getAttribute('data-reinforce-delta')) || 0,
        });
      }
      return;
    }
    const rSel = e.target.closest ? e.target.closest('[data-reinforce-select]') : null;
    if (rSel) {
      state.reinforceSel = rSel.getAttribute('data-reinforce-select');
      renderBattleReinforce();
      return;
    }
    if (e.target.closest && e.target.closest('[data-reinforce-confirm]')) {
      const side = battleMySide();
      if (side && battleCanReinforce(side)) battleRequest({ type: 'reinforceConfirm', side: side });
      return;
    }
    if (e.target.closest && e.target.closest('[data-reinforce-done]')) {
      const side = battleMySide();
      if (side && battleCanReinforce(side)) battleRequest({ type: 'reinforceDone', side: side });
      return;
    }
    const facingBtn = e.target.closest ? e.target.closest('[data-battle-facing]') : null;
    if (facingBtn) {
      const box = el('battle-choice');
      if (box) {
        box.setAttribute('data-facing', facingBtn.getAttribute('data-battle-facing'));
        box.querySelectorAll('[data-battle-facing]').forEach(function (b) {
          b.classList.toggle('is-on', b === facingBtn);
        });
        box.querySelectorAll('[data-battle-action="attack"],[data-battle-action="focus"]').forEach(function (b) {
          if (b.getAttribute('data-battle-action') === 'focus' || box.getAttribute('data-locked') !== '1') {
            b.disabled = false;
          }
        });
      }
      return;
    }
    const transportUnloadBtn = e.target.closest ? e.target.closest('[data-transport-unload]') : null;
    if (transportUnloadBtn) {
      state.transportMode = 'unload';
      renderBattleTransportPanel();
      return;
    }
    const transportCancelBtn = e.target.closest ? e.target.closest('[data-transport-cancel]') : null;
    if (transportCancelBtn) {
      state.transportMode = null;
      renderBattleTransportPanel();
      return;
    }
    const buildTypeBtn = e.target.closest ? e.target.closest('[data-build-type]') : null;
    if (buildTypeBtn) {
      const b = state.battle;
      const unit = b && b.selectedId ? battleUnitById(b.selectedId) : null;
      if (unit && battleTrait(unit, 'engineer') && unit.mp >= 2) {
        state.buildMode = buildTypeBtn.getAttribute('data-build-type');
        renderBattleBuildPanel();
        if (B3 && B3.lastPointer) b3UpdateBuildingGhost(B3.lastPointer.x, B3.lastPointer.y);
      }
      return;
    }
    if (e.target.closest && e.target.closest('[data-build-cancel]')) {
      state.buildMode = null;
      b3ClearBuildingGhost();
      renderBattleBuildPanel();
      return;
    }
    if (e.target.closest && e.target.closest('[data-build-abandon]')) {
      const b = state.battle;
      const unit = b && b.selectedId ? battleUnitById(b.selectedId) : null;
      if (unit && battleCanControl(unit.side)) {
        battleRequest({ type: 'abandonBuild', side: unit.side, unitId: unit.id });
      }
      state.buildMode = null;
      b3ClearBuildingGhost();
      renderBattleBuildPanel();
      return;
    }
    const facingChoiceBtn = e.target.closest ? e.target.closest('[data-facing-choice]') : null;
    if (facingChoiceBtn) {
      const fc = state.battle && state.battle.facingChoice;
      const facing = Number(facingChoiceBtn.getAttribute('data-facing-choice'));
      if (fc && isFinite(facing) && battleMySide() === fc.defenderSide) {
        battleRequest({ type: 'faceChoose', side: fc.defenderSide, facing: facing });
      }
      return;
    }
    const airInterceptBtn = e.target.closest ? e.target.closest('[data-air-intercept-id]') : null;
    if (airInterceptBtn) {
      const id = airInterceptBtn.getAttribute('data-air-intercept-id');
      const sel = state.airInterceptSel || [];
      const at = sel.indexOf(id);
      if (at === -1) {
        if (sel.length >= 2) return;
        sel.push(id);
      } else {
        sel.splice(at, 1);
      }
      state.airInterceptSel = sel;
      renderBattleAirIntercept();
      return;
    }
    if (e.target.closest && e.target.closest('[data-air-intercept-confirm]')) {
      if (state.battle && state.battle.airIntercept) {
        battleRequest({
          type: 'airIntercept', side: state.battle.airIntercept.defenderSide,
          ids: (state.airInterceptSel || []).slice(0, 2),
        });
      }
      return;
    }
    if (e.target.closest && e.target.closest('[data-air-intercept-none]')) {
      if (state.battle && state.battle.airIntercept) {
        battleRequest({ type: 'airIntercept', side: state.battle.airIntercept.defenderSide, ids: [] });
      }
      return;
    }
    const airRoleBtn = e.target.closest ? e.target.closest('button[data-air-role]') : null;
    if (airRoleBtn) {
      const box = el('battle-choice');
      if (box) {
        const air = battleUnitById(box.getAttribute('data-attacker'));
        const target = battleUnitById(box.getAttribute('data-defender'));
        if (air && target) battleOpenAirChoice(air, target, airRoleBtn.getAttribute('data-air-role'));
      }
      return;
    }
    const airDirBtn = e.target.closest ? e.target.closest('button[data-air-dir]') : null;
    if (airDirBtn) {
      const box = el('battle-choice');
      if (box) {
        box.setAttribute('data-air-dir', airDirBtn.getAttribute('data-air-dir'));
        box.querySelectorAll('[data-air-dir]').forEach(function (b) {
          b.classList.toggle('is-on', b === airDirBtn);
        });
        if (state.b3BombHint) {
          state.b3BombHint.dir = Number(airDirBtn.getAttribute('data-air-dir')) || 0;
          refreshBattle3DBombHint();
        }
      }
      return;
    }
    const choiceBtn = e.target.closest ? e.target.closest('[data-battle-action]') : null;
    if (choiceBtn) {
      const box = el('battle-choice');
      const type = choiceBtn.getAttribute('data-battle-action');
      const attackerId = box ? box.getAttribute('data-attacker') : '';
      const defenderId = box ? box.getAttribute('data-defender') : '';
      const facingRaw = box ? box.getAttribute('data-facing') : '';
      const facing = facingRaw === '' ? null : Number(facingRaw);
      const role = box ? box.getAttribute('data-air-selected-role') : '';
      const dirRaw = box ? box.getAttribute('data-air-dir') : '';
      const airDir = dirRaw === '' || dirRaw == null ? undefined : Number(dirRaw);
      const reconC = box ? box.getAttribute('data-recon-c') : '';
      const reconR = box ? box.getAttribute('data-recon-r') : '';
      const focus = !!(choiceBtn.getAttribute('data-air-focus') === '1');
      box.classList.add('hidden');
      if (state.battle) state.battle.choice = null;
      state.b3BombHint = null;
      refreshBattle3DBombHint();
      if (type === 'airRecon' && attackerId && reconC !== '' && reconR !== '') {
        battleRequest({
          type: 'airRecon', side: state.battle ? state.battle.activeSide : null,
          unitId: attackerId, c: Number(reconC), r: Number(reconR),
        });
      } else if (type !== 'cancel' && attackerId && defenderId) {
        battleRequest({
          type: type, side: state.battle ? state.battle.activeSide : null,
          unitId: attackerId, targetId: defenderId,
          facing: facing == null ? undefined : facing,
          role: role || undefined, focus: focus, dir: airDir,
        });
      }
      return;
    }
    if (e.target.closest && e.target.closest('[data-battle-counter-skip]')) {
      if (state.battle && state.battle.counter && battleCanCounter(state.battle.counter.chooserSide)) {
        battleRequest({ type: 'counterSkip', side: state.battle.counter.chooserSide });
      }
      return;
    }
    const b3Seat = e.target.closest ? e.target.closest('[data-battle-seat]') : null;
    if (b3Seat) {
      setActiveTestSeat(b3Seat.getAttribute('data-battle-seat'));
      syncBattle3DView();
      return;
    }
    const b3Pick = e.target.closest ? e.target.closest('[data-battle-pick]') : null;
    if (b3Pick) {
      state.deploySel = b3Pick.getAttribute('data-battle-pick');
      syncBattle3DView();
      return;
    }
    if (e.target.closest && e.target.closest('#online-battle-done')) { deployConfirm(); return; }
    if (e.target.closest && e.target.closest('#online-battle-undo')) { deployUndo(); return; }
    if (e.target.closest && e.target.closest('#online-battle-back')) {
      const back = el('online-back-lobby');
      if (back) back.click();
      return;
    }
    const depSeat = e.target.closest ? e.target.closest('[data-deploy-seat]') : null;
    if (depSeat) {
      setActiveTestSeat(depSeat.getAttribute('data-deploy-seat'));
      renderDeployPanel();
      scheduleDraw();
      return;
    }
    const depPick = e.target.closest ? e.target.closest('[data-deploy-pick]') : null;
    if (depPick) {
      state.deploySel = depPick.getAttribute('data-deploy-pick');
      renderDeployPanel();
      scheduleDraw();
      return;
    }
    if (e.target.closest && e.target.closest('#online-deploy-undo')) { deployUndo(); return; }
    if (e.target.closest && e.target.closest('#online-deploy-done')) { deployConfirm(); return; }
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
    const prepNukeBtn = e.target.closest ? e.target.closest('[data-prep-nuke]') : null;
    if (prepNukeBtn) {
      prepAdjustNuke(Number(prepNukeBtn.getAttribute('data-prep-nuke-delta')) || 0);
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
  el('online-map').addEventListener('click', function (e) {
    if (state.phase !== 'deploy' || !state.map) return;
    const canvas = el('online-map');
    const L = mapLayout(canvas.clientWidth, canvas.clientHeight, state.map);
    if (!L) return;
    const rect = canvas.getBoundingClientRect();
    const cell = L.toCell(e.clientX - rect.left, e.clientY - rect.top);
    if (cell) deployPlaceAt(cell.c, cell.r);
  });
  const deployUndoBtn = el('online-deploy-undo');
  if (deployUndoBtn) deployUndoBtn.addEventListener('click', deployUndo);
  const deployDoneBtn = el('online-deploy-done');
  if (deployDoneBtn) deployDoneBtn.addEventListener('click', deployConfirm);

  el('online-map-file').addEventListener('change', function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (file) importMapFile(file);
  });

  // 存档输入框是运行时注入的，必须在 document 上委托 change，不能启动时直接绑定。
  document.addEventListener('change', function (e) {
    const input = e.target;
    if (!input || input.id !== 'online-save-file') return;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        loadGameSave(JSON.parse(String(reader.result || '')));
      } catch (err) {
        showAlert('载入失败', '存档不是有效的 JSON：' + String((err && err.message) || err));
      }
    };
    reader.onerror = function () { showAlert('载入失败', '读取文件失败'); };
    reader.readAsText(file, 'utf-8');
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

  // 样式表没有构建哈希；升级后强制换一次 URL，避免旧 CSS 让新面板被裁切/样式错位。
  try {
    const cssLink = document.querySelector('link[href="online.css"]');
    if (cssLink && !/[?&]v=/.test(cssLink.href)) cssLink.href = 'online.css?v=20261122a';
  } catch (e) { /* ignore */ }

  window.Online = {
    traits: {
      modules: function () { return Object.keys(TRAIT_MODULES); },
      parse: function (unitOrText) {
        return parseTraitText(typeof unitOrText === 'string' ? unitOrText : (battleInfoFor(unitOrText) || {}).traits);
      },
    },
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
    saveGame: saveGameFile,
    loadGameSave: loadGameSave,
    deployAt: function (c, r) { deployPlaceAt(Number(c), Number(r)); },
    deployInfo: function (side) {
      const info = deployEligibleFor(side || state.side);
      const cols = state.map ? state.map.cols : 0;
      return {
        ring: info.ring,
        cells: info.cells.map(function (idx) { return { c: idx % cols, r: Math.floor(idx / cols) }; }),
      };
    },
    deployCellPoint: function (c, r) {
      if (B3 && (state.phase === 'deploy' || state.phase === 'battle')) {
        return b3CellScreenPoint(Number(c), Number(r));
      }
      const canvas = el('online-map');
      if (!canvas || !state.map) return null;
      const L = mapLayout(canvas.clientWidth, canvas.clientHeight, state.map);
      if (!L) return null;
      const p = L.center(Number(c), Number(r));
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    },
    unitSpriteData: function (name, faction) {
      const s = unitModelSprite(name, faction);
      return s ? s.toDataURL('image/png') : '';
    },
  };
})();

/* ==== 建筑模型（由 building-models.js 嵌入，发布包只带 online.js） ==== */
/* 寤虹瓚妯″瀷锛堝彲鐮村潖閮ㄥ垎锛夆€斺€?鐢?tools/build_buildings.py 鐢熸垚锛屽埆鎵嬫敼銆?
 * 婧愭枃浠讹細绾夸笂鐗?寤虹瓚/*.blend锛堝叚杈瑰舰鎻掑叆浠讹紝鍜屽湴鍥炬牸 1:1锛夈€?
 * 鏁版嵁锛歿 b64, dims }锛沚64 = uint16 椤剁偣鏁?+ 閲忓寲椤剁偣(unit cube) + uint16 绱㈠紩锛?
 *       dims = 鐪熷疄灏哄锛堟绫筹級锛岀敤鏉ユ妸妯″瀷缂╂斁鍒版牸瀛愬ぇ灏忋€?
 */
window.BUILDING_MODELS = window.BUILDING_MODELS || {};
window.BUILDING_MODELS["hq"] = { b64: "ZAAAgPfgiGgHX7qom30HXzaZm32eg4uum30HX7+Sm33zdnRRm31hfIuum33OkBJzm30xbxJzm30MiXRRm30XXRJzm33oohJzm32qqnRRm32qqhJzm30FLHuwiGhVVRJzm30FLIRPiGj/fwgfiGhVVXRRm33604RPiGj603uwiGgAgPfg7XsFLHuw7XsFLIRP7Xv/fwgf7Xv604RP7Xv603uw7XsAgP//7XsmEf+/7XsmEQBA7Xv/fwAA7XvZ7gBA7XvZ7v+/7XsAgP//d5cmEf+/d5cmEQBAd5f/fwAAd5fZ7gBAd5fZ7v+/d5cAgG7nd5dsJrezd5dsJkhMd5f/f5EYd5eT2UhMd5eT2bezd5cAgG7nEoRsJrezEoRsJkhMEoT/f5EYEoST2UhMEoST2bezEoRVVXRREoSqqnRREoSqqhJzEoRVVRJzEoToojZZEoToolBrEoToojZZm33oolBrm30XXVBrEoQXXTZZEoQXXTZZm30XXVBrm33OkDZZEoQMiTZZEoTOkFBrEoQMiVBrEoTXijZZm33OkDZZm30MiTZZm33OkFBrm30MiVBrm33zdlBrEoQxb1BrEoTzdjZZEoQxbzZZEoTzdjZZm30xbzZZm33zdlBrm30xb1Brm32egxJzEoRhfBJzEoRhfIuuEoSeg4uuEoSegxJzm31hfBJzm31hfDaZEoRhfL+SEoQHX7+SEoRhfL+Sm31hfDaZm31+ZTaZEoQHX7qoEoR+ZTaZm31+ZUOiEoRhfEOiEoRhfLqoEoRhfEOim31hfLqom31+ZUOim30TABEAEAAQAA4AAAAAABQAEwAQAAAAEwAAAA4AFgAAABYAFQAbABwAIgAbACIAIQAnACgALgAnAC4ALQAOABAAFwAOABcAFgAcAB0AIwAcACMAIgAkACUAKwAkACsAKgAsACYAIQAnACwAIQAjACQAKgAjACoAKQAnACEAIgAjACkAKAAoACcAIgAoACIAIwAoACkALwAoAC8ALgAQABEAGAAQABgAFwAdAB4AJAAdACQAIwApACoAMAApADAALwARABMAGQARABkAGAAeAB8AJQAeACUAJAAqACsAMQAqADEAMAATABQAGgATABoAGQAfACAAJgAfACYAJQAlACYALAAlACwAKwArACwAMgArADIAMQAUAAAAFQAUABUAGgAgABsAIQAgACEAJgAsACcALQAsAC0AMgA0ADMALwAvADAAMQAvADEANABeAFsAVgBeAFYAXwBcAGAAUgBTAFAANQA1ADQAMQAxADIALQAtAC4ALwAvADMANgA2AFEAVwA2AFcAWAA1ADEALQBTADUALQAvADYAWAAvAFgAXABSAFMALQAtAC8AXABSAC0AXAA/ADcAOAA/ADgAQQBJADsAPABJADwASwBKAEAAQgBKAEIASAA+AAoADwASAAUATAA+AA8AEgA9AD4AEgBHAEUAQwBDAAkADAAMAA0ACwAMAAsAOgBNAD0AEgBVAAgATwBNABIATAACAF0AYwADAAYAYgBGAAcAVABUAAMAYgABAAIAYwABAGMAYQAMADoAOQBNAEwATgBiAAEAYQBUAGIAYQBUAGEAWgAMADkARABPAE0ATgBVAE8ATgBVAE4ARwBUAFoAWQBDAAwARABUAFkAVQBHAEMARABUAFUARwBHAEQARgBHAEYAVAA0ADUADQA0AA0ADAA2ADMAEgA2ABIADwA1AFAAVAA1AFQABwALAA0ANQAHAAsANQBgAFwAAQBgAAEAYgBFAEAASgBFAEoATAA8AD0ATQA8AE0ASwA5ADcAPwA5AD8ARAAzADQADAAzAAwACQAFABIAMwAJAAUAMwBGADoACwBGAAsABwA+AE8ACAA+AAgACgAJAEMARQBFAEwABQBFAAUACQAgABoAFQAVABYAHAAbACAAFQAVABwAGwACAAEAXABcAFgABABcAAQAAgBBADgAOgBBADoARgBPAD4AOwBPADsASQBCAEcATgBCAE4ASAA3ADkAOgA3ADoAOAA8ADsAPgA8AD4APQBBAEYARABBAEQAPwBAAEUARwBAAEcAQgBIAE4ATABIAEwASgBJAEsATQBJAE0ATwBdAAIABAAEAFkAWgAEAFoAXQAZABoAIAAdABwAFgAdABYAFwAZACAAHwAdABcAGAAYABkAHwAeAB0AGAAfAB4AGABQAFMAAwBQAAMAVAAGAAMAUwAGAFMAUgBRAFUAWQBRAFkAVwBWAFoAYQBWAGEAXwAGAFIAYAAGAGAAYgBaAFYAWwBaAFsAXQBZAAQAWABZAFgAVwBdAFsAXgBdAF4AYwBVAFEANgA2AA8ACgAIAFUANgA2AAoACABeAF8AYQBeAGEAYwA=", dims: [17.147, 19.8, 3.63] };
window.BUILDING_MODELS["bunker"] = { b64: "XwD604RPiGjzsipcm327UGFZm31pTHVdm30It3xgm33StSKLm33603uwiGgzSxyIm30AgPfgiGhYtKuQm30FLHuwiGj0sSCVm30FLIRPiGi4rlKZm33/fwgfiGixqi6dm33604RP7XvzpaSgm33603uw7XuRoKSjm30AgPfg7XujmiCmm30FLHuw7XtDlA+om32NjWipm30FLIRP7XuehiSqm33/fwgf7XvZ7gBA7XuVf0Gqm33Z7v+/7XuReL6pm30AgP//7XuwcZ2om30Qa+Smm30mEf+/7XvPZJmkm30mEQBA7XsIX8ehm33/fwAA7XvZ7gBAd5fUWXuem33Z7v+/d5dJVcKam30AgP//d5d9Ua2Wm30mEf+/d5d/Tk6Sm30mEQBAd5dcTLiNm33/fwAAd5eT2UhMd5eT2bezd5cAgG7nd5dsJrezd5dsJkhMd5f/f5EYd5eT2UhMEoST2bezEoQAgG7nEoRsJrezEoRsJkhMEoT/f5EYEoRcTLiNEoR/Tk6SEoR9Ua2WEoRJVcKaEoTUWXueEoTPZJmkEoQIX8ehEoSwcZ2oEoSReL6pEoQQa+SmEoSehiSqEoSNjWipEoSjmiCmEoSRoKSjEoRDlA+oEoRYtKuQEoT0sSCVEoS4rlKZEoSxqi6dEoTzpaSgEoSVf0GqEoRVS2uDEoRpTHVdEoQzSxyIEoQIt3xgEoTStSKLEoS7UGFZEoScUJRdEoScUJRdm33Vsl5gEoTzsipcEoTVsl5gm30MAAoACAAIAAYAAAAAAA4ADAAIAAAADAAAAAYAEgAAABIAEAAcAB4AKgAcACoAKAAzADQAOgAzADoAOQAGAAgAFAAGABQAEgAeACAALAAeACwAKgAqACwANQAqADUANAA0ADUAOwA0ADsAOgAIAAoAFgAIABYAFAAUABYAIwAUACMAIAAgACMALgAgAC4ALAA1ADYAPAA1ADwAOwAKAAwAGQAKABkAFgAjACUAMAAjADAALgA2ADcAPQA2AD0APAAMAA4AGwAMABsAGQAlACcAMgAlADIAMAAoACoANAAoADQAMwA1ACwALgA2ADUALgAyACgAMwAyADMAOAA2AC4AMAAyADgANwA3ADYAMAAyADcAMAA3ADgAPgA3AD4APQAOAAAAEAAOABAAGwAnABwAKAAnACgAMgA4ADMAOQA4ADkAPgA/AFYABwA/AAcAMQALAAkATgALAE4ATwANAAsATwANAE8AUAAPAA0AUAAPAFAAUQARAA8AUQARAFEAUgBMABMAEQBMABEAUgBLABUAEwBLABMATABNABcAFQBNABUASwBKABgAFwBKABcATQBJABoAGABJABgASgBTAB0AGgBTABoASQBHAB8AHQBHAB0AUwBGACEAHwBGAB8ARwBIACIAIQBIACEARgBEACQAIgBEACIASABFACYAJABFACQARABDACkAJgBDACYARQBCACsAKQBCACkAQwBBAC0AKwBBACsAQgBAAC8ALQBAAC0AQQA/ADEALwA/AC8AQAAxAAcAAwBbAAIAAQAxAAMAWwAtAC8AMQApACsALQAkACYAKQAhACIAJAAdAB8AIQAYABoAHQAVABcAGAARABMAFQANAA8AEQAJAAsADQAEAAUACQBbAAEAXgBeAAQACQAJAA0AEQARABUAGAAYAB0AIQAhACQAKQApAC0AMQAxAFsAXgBeAAkAEQARABgAIQAhACkAMQAxAF4AEQARACEAMQBbAAMAVQBbAFUAWgBUAFUAAwADAAcAVgBUAAMAVgASABQAIAAlACMAFgAlABYAGQASACAAHgAQABIAHgAnACUAGQAnABkAGwAQAB4AHAAnABsAEAAQABwAJwBXAAQAXgBXAF4AXABYAAUABABYAAQAVwBaAFkAAgBaAAIAWwABAF0AXAABAFwAXgBdAAEAAgBdAAIAWQA9AFkAWgBVAFQAPAA9AFoAVQA9AFUAPABZAD0APgA+ADkAVwBXAFwAXQBdAFkAPgA+AFcAXQBXADkAWAA6ADsAPAA8AFQAVgA8AFYAPwBNAEsAOgBKAE0AOgA8AD8AQAA8AEAAQQBJAEoAOgBTAEkAOgA8AEEAQgA8AEIAQwBTADoAPABHAFMAPAA8AEMARQA8AEUARABGAEcAPAA8AEQASAA8AEgARgBYAE4ACQBYAAkABQA6AEsATAA6AEwAUgBYADkAOgBOAFgAOgA6AFIAUQA6AFEAUABPAE4AOgA6AFAATwA=", dims: [17.147, 19.8, 3.63] };
window.BUILDING_MODELS["trench"] = { b64: "ZQDUetapUHyudzapUHwAgPfgiGgDdW6nUHyNkzxbUHw7c8OkUHxWlZFYUHwBmMlWUHwmmylWUHxMnslWUHz3oJFYUHwQwZ96UHzhtWCFUHywVJFYUHxsgsOkUHykgG6nUHz5fTapUHxbV8lWUHyBWilWUHynXclWUHyXNJ96UHxRYJFYUHwaYjxbUHwFLHuwiGgFLIRPiGj/fwgfiGjGP2CFUHz604RPiGj603uwiGgAgPfg7XsFLHuw7XsFLIRP7Xv/fwgf7Xv604RP7Xv603uw7XsAgP//7XsmEf+/7XsmEQBA7Xv/fwAA7XvZ7gBA7XvZ7v+/7XsAgP//d5cmEf+/d5cmEQBAd5f/fwAAd5fZ7gBAd5fZ7v+/d5cAgG7nd5dsJrezd5dsJkhMd5f/f5EYd5eT2UhMd5eT2bezd5cAgG7nEoRsJrezEoRsJkhMEoT/f5EYEoST2UhMEoST2bezEoTARNBpEoTGP2CFEoSXNJ96EoRaWNBrEoRaWNBrUHzUeraPEoTUeraPUHwQwZ96EoRNndBrEoThtWCFEoRNndBrUHx1YgVdEoQaYjxbEoQ5U8NaEoSBWilWEoSnXclWEoSwVJFYEoRbV8lWEoRRYJFYEoQ5U8NaUHx1YgVdUHw7c8OkEoTgcvqiEoQDdW6nEoTUetapEoT5fTapEoSudzapEoSkgG6nEoTHgvqiEoRsgsOkEoTgcvqiUHzHgvqiUHyNkzxbEoQzkwVdEoRWlZFYEoRMnslWEoQmmylWEoQBmMlWEoT3oJFYEoRuosNaEoQzkwVdUHxuosNaUHwcABsAGQAZABgAFwAXAAIAHAAZABcAHAACABcAHgACAB4AHQAjACQAKgAjACoAKQAvADAANgAvADYANQAXABgAHwAXAB8AHgAkACUAKwAkACsAKgAqACsAMQAqADEAMAAwADEANwAwADcANgAYABkAIAAYACAAHwAlACYALAAlACwAKwAfACAAJgAoACcAIQAoACEAIgAfACYAJQAeAB8AJQAjACgAIgAjACIAHQAeACUAJAAjAB0AHgAeACQAIwAxADIAOAAxADgANwAZABsAIQAZACEAIAAgACEAJwAgACcAJgAmACcALQAmAC0ALAAyADMAOQAyADkAOAAbABwAIgAbACIAIQAnACgALgAnAC4ALQApACoAMAApADAALwAxACsALAAyADEALAAuACkALwAuAC8ANAAyACwALQAuADQAMwAzADIALQAuADMALQAzADQAOgAzADoAOQAcAAIAHQAcAB0AIgAoACMAKQAoACkALgA0AC8ANQA0ADUAOgBLAEgAOwA7ADcAOAA6ADUANgA2ADwAPgA+AFEAUAA2AD4AUABLADsAOABMAEsAOAA2AFAAUgA2AFIAVQBJAEwAOABKAEkAOAA2AFUAUwA6ADYAUwBKADgAOQBNAEoAOQA6AFMAVAA6AFQAVgBHAE0AOQBAAEYARwBbAFwAQABbAEAARwA6AFYAWABYAFcAQwBYAEMARABdAFsARwBgAF0ARwA6AFgARABCAGIAYQA6AEQAQgBfAGAARwBfAEcAOQA5ADoAQgA5AEIAYQBeAF8AOQA5AGEAXgA9ADwANgA3ADsAPQA9ADYANwA/ABoAFABOAA0AEQA/ABQATgADAAUAWQBZAD8ATgBOABEAEgASABMAFQAVABYATwASABUATwBZAE4AEgABAAMAWQAQAAAAAQAOAA8AEABaAA4AEAAQAAEAWQBZABIATwBZAE8AQQBaABAAWQALAAwARQBFAFoAWQBZAEEAYwBjAAQABgAGAAcACAAIAAkACgBkAAsARQAIAAoAZABjAAYACABFAFkAYwAIAGQARQBjAAgARQA7AEgATgBOABQAPQBOAD0AOwA8ABoAPwA8AD8APgAUABoAPAAUADwAPQBAAEEATwBAAE8ARgA+AD8AWQA+AFkAUQBBAEAAXABBAFwAYwBFAEMAVwBFAFcAWgBCAAsAZABCAGQAYgAMAAsAQgAMAEIARAAMAEQAQwAMAEMARQBLAA0ATgBLAE4ASABMABEADQBMAA0ASwBJABIAEQBJABEATABKABMAEgBKABIASQBNABUAEwBNABMASgAWABUATQAWAE0ARwAWAEcARgAWAEYATwABAAAAUwABAFMAVQADAAEAVQADAFUAUgBQAAUAAwBQAAMAUgAFAFAAUQAFAFEAWQBXAFgADgBXAA4AWgAPAA4AWAAPAFgAVgAQAA8AVgAQAFYAVAAAABAAVAAAAFQAUwBcAFsABABcAAQAYwBdAAYABABdAAQAWwBgAAcABgBgAAYAXQBfAAgABwBfAAcAYABeAAkACABeAAgAXwBhAAoACQBhAAkAXgAKAGEAYgAKAGIAZAA=", dims: [17.147, 19.8, 3.63] };
window.BUILDING_MODELS["bridge"] = { b64: "UQD504RPkGgUQ+Vs5Hf504RP9XsAgAkfkGi9SO975HcAgAkf9XsGLIRPkGi8UAyH5HcGLIRP9XsGLHuwkGimWk6Q5HcGLHuw9XsAgPfgkGgbZlmX5HcAgPfg9Xv503uwkGiqcumb5Hf503uw9XuS2UlMCoTXf9Gd5HcAgJIYCoRtJklMCoQgjf6c5HdtJrezCoQAgG7nCoQDmniZ5HeS2bezCoQCpmKT5HcAgJIYb5eS2bezb5dtJrezb5elsPiK5HcAgG7nb5dtJklMb5eFuYyA5HeS2UlMb5dkwARy5HcnEQBAu3sAgP//u3sAgAEAu3usUIZt5HfZ7gFAb5f/fwAAb5cmEf8/b5cnEQDAb5cAgP//b5fZ7v+/b5fZ7gFAu3snEQDAu3vZ7v+/u3vKsolx5HcbZlmX9XtkwARy9XvXf9Gdu3uqcumbu3sgjf6cu3umWk6Qu3sDmniZu3u8UAyHu3uFuYyAu3ulsPiKu3usUIZtu3sUQ+Vsu3vKsolxu3u9SO97u3sCpmKTu3uFuYyACoRkwARyCoTXf9GdCoSqcumbCoQgjf6cCoQbZlmXCoQDmniZCoQCpmKTCoS8UAyHCoSlsPiKCoQUQ+VsCoSsUIZtCoTKsolxCoS9SO97CoSmWk6QCoQAAAIABQAAAAUAAwADAAUACAADAAgABgAGAAgACwAGAAsACQAJAAsADgAJAA4ADAA7ADQAAgARAA4ACwALAD4AQAALAEAAOgA7AAIAEQA8ADsAEQALADoAOAALADgAMwBBADwAEQA5AEEAEQALADMANgALADYANQA3ADkAEQALADUANwARAAsANwAIAAUAAgACADQAPwA/AD0APgA+AAsACAAIAAIAPwAIAD8APgAMAA4AEQAMABEADwAPABEAAgAPAAIAAAAMAA8AAAAAAAMABgAGAAkADAAAAAYADAAnAC8AKQAnACkAKgAjABIAFAAjABQAHAAUABUAIQAUACEAHAAVABcAHgAVAB4AIQAXABgAIAAXACAAHgAgABgAGgAgABoAHQAdABoAEgAdABIAIwAuADEAJgAuACYALQAwACUAKwAwACsALAArACUAJwArACcAKgAuACkALwAuAC8AMQAmADAALAAmACwALQA2ADMAJgAmADEALwAvADQAOwAmAC8AOwA1ADYAJgA3ADUAJgAmADsAPAAmADwAQQA5ADcAJgAmAEEAOQA0AC8AJwAnACUAMAAwACYAMwAwADMAOAA/ADQAJwA+AD0APwA+AD8AJwAwADgAOgAwADoAQAA+ACcAMAAwAEAAPgAgAB0ALgAgAC4ALQAdACMAKQAdACkALgAcACoAKQAcACkAIwAhACsAKgAhACoAHAAeACwAKwAeACsAIQAgAC0ALAAgACwAHgBCAEMAEgASABoAGAAXAEwATwAXAE8ASgBCABIAGABLAEIAGAAYABcASgAYAEoAUABJAEsAGABIAEkAGAAYAFAARwAYAEcARQBGAEgAGAAYAEUARAAYAEQARgBMABcAFQAVABQAEgASAEMATgBOAE0ATABMABUAEgASAE4ATAABAAQAQAABAEAAPgA+AEAATwA+AE8ATAAEAAcAOgAEADoAQABAADoASgBAAEoATwA6AAcACgA6AAoAOABKADoAOABKADgAUAA4AAoADQA4AA0AMwBQADgAMwBQADMARwAzAA0AEAAzABAANgBHADMANgBHADYARQA2ABAAEwA2ABMANQBFADYANQBFADUARAA1ABMAFgA1ABYANwBEADUANwBEADcARgA3ABYAGQA3ABkAOQBGADcAOQBGADkASAA5ABkAGwA5ABsAQQBIADkAQQBIAEEASQBBABsAHwBBAB8APABJAEEAPABJADwASwA8AB8AIgA8ACIAOwBLADwAOwBLADsAQgA7ACIAJAA7ACQANABCADsANABCADQAQwAoAAEAPgAoAD4APQA9AD4ATAA9AEwATQAkADIAPwAkAD8ANAA0AD8ATgA0AE4AQwAyACgAPQAyAD0APwA/AD0ATQA/AE0ATgAHAAQAAQAHAAEAKAANAAoABwATABAADQAZABYAEwAfABsAGQAkACIAHwAHACgAMgAyACQAHwAfABkAEwATAA0ABwAHADIAHwAfABMABwA=", dims: [17.148, 19.8, 3.625] };
window.BUILDING_MODELS["road"] = { b64: "OgAGLINPkGgGLINP9XsGLHuwkGgGLHuw9XsAgPfgkGgAgPfg9Xv503uwkGj503uw9Xv504NPkGj504NP9XsAgAgfkGgAgAgf9XttJkhMCoRtJrazCoQAgG3nCoST2bazCoST2UhMCoQAgJEYCoRtJrazb5cAgJEYb5eT2bazb5eT2UhMb5cAgG3nb5dtJkhMb5cAgP7/u3vZ7v8/u3snEf+/u3snEf8/b5cmEQDAb5f/f///b5fZ7v6/b5fZ7v8/b5cAgAAAb5cnEf8/u3vZ7v6/u3sAgAAAu3uJvI2aDHeJvHFlDHd3Q42aDHd3Q3FlDHcAgJEYCoRtJkhMCoRtJrazCoQAgG3nCoST2bazCoST2UhMCoR3Q42aCoSJvI2aCoSJvHFlCoR3Q3FlCoQioJKIDXUioJKIGIQioGx3DXUioGx3GITeX5KIDXXeX5KIGITeX2x3DXXeX2x3GIQAAAEAAwAAAAMAAgACAAMABQACAAUABAAEAAUABwAEAAcABgAGAAcACQAGAAkACAAFAAMAAQABAAsACQAJAAcABQABAAkABQAIAAkACwAIAAsACgAKAAsAAQAKAAEAAAAKAAAAAgACAAQABgAGAAgACgACAAYACgAaACEAGwAaABsAHAAXAAwADQAXAA0AEgANAA4AFgANABYAEgAOAA8AFAAOABQAFgAPABAAFQAPABUAFAAVABAAEQAVABEAEwATABEADAATAAwAFwAgACMAGQAgABkAHwAiABgAHQAiAB0AHgAdABgAGgAdABoAHAAgABsAIQAgACEAIwAZACIAHgAZAB4AHwAhABoAGAAYACIAGQAZACMAIQAYABkAIQAVABMAIAAVACAAHwATABcAGwATABsAIAASABwAGwASABsAFwAWAB0AHAAWABwAEgAUAB4AHQAUAB0AFgAVAB8AHgAVAB4AFAAtACwALwAtAC8AMAAuAC8ALAAsACsAKgApACgALQAtADAAMQAuACwAKgApAC0AMQAxAC4AKgAqACkAMQAvACQAJQAvACUAMAAwACUAJwAwACcAMQAnACYALgAnAC4AMQAmACQALwAmAC8ALgAlACQAJgAlACYAJwAyADMANQAyADUANAA0ADUAOQA0ADkAOAA4ADkANwA4ADcANgA2ADcAMwA2ADMAMgA0ADgANgA0ADYAMgA5ADUAMwA5ADMANwA=", dims: [17.148, 19.8, 3.625] };
window.BUILDING_MODELS["base"] = { b64: "KgAGLINPkGgGLINP9XsGLHuwkGgGLHuw9XsAgPfgkGgAgPfg9Xv503uwkGj503uw9Xv504NPkGj504NP9XsAgAgfkGgAgAgf9XttJkhMCoRtJrazCoQAgG3nCoST2bazCoST2UhMCoQAgJEYCoRtJrazb5cAgJEYb5eT2bazb5eT2UhMb5cAgG3nb5dtJkhMb5cAgP7/u3vZ7v8/u3snEf+/u3snEf8/b5cmEQDAb5f/f///b5fZ7v6/b5fZ7v8/b5cAgAAAb5cnEf8/u3vZ7v6/u3sAgAAAu3ttJkhMCoRtJrazCoQAgG3nCoST2bazCoST2UhMCoQAgJEYCoQAAAEAAwAAAAMAAgACAAMABQACAAUABAAEAAUABwAEAAcABgAGAAcACQAGAAkACAAFAAMAAQABAAsACQAJAAcABQABAAkABQAIAAkACwAIAAsACgAKAAsAAQAKAAEAAAAKAAAAAgACAAQABgAGAAgACgACAAYACgAaACEAGwAaABsAHAAXAAwADQAXAA0AEgANAA4AFgANABYAEgAOAA8AFAAOABQAFgAPABAAFQAPABUAFAAVABAAEQAVABEAEwATABEADAATAAwAFwAgACMAGQAgABkAHwAiABgAHQAiAB0AHgAdABgAGgAdABoAHAAgABsAIQAgACEAIwAZACIAHgAZAB4AHwAhABoAGAAYACIAGQAZACMAIQAYABkAIQAVABMAIAAVACAAHwATABcAGwATABsAIAASABwAGwASABsAFwAWAB0AHAAWABwAEgAUAB4AHQAUAB0AFgAVAB8AHgAVAB4AFAAnACYAJQAlACQAKQApACgAJwAlACkAJwA=", dims: [17.148, 19.8, 3.625] };

