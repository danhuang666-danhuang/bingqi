/* =============================================================
 * armory.js —— 军械库
 *
 * 主菜单「军械库」→ 五个国家 → 国家的单位工作台：
 *   左列：该兵种下所有单位
 *   中间：3D 模型（右键拖动旋转、滚轮缩放）
 *   右侧：数据 / 词条 / 简介（简介可直接编辑，存在本机）
 *   底部：兵种切换（大按钮）
 *
 * 单位数据来源（只读，没有改动原文件）：
 *   图鉴更新记录/图鉴.xlsx   数据卡（软/硬攻、反伤、血量）+ 二战价格（穿甲、装甲、价格、行动力、词条）
 *   线上版/单位/<年代>/<国家>/<兵种>/*.blend   模型（Blender 4.2 导出，见文末生成数据）
 *
 * 和别的区块的接口：
 *   - home.js 的 activate() 里 data-module="armory" 调 window.Armory.open()；
 *   - 军械库是盖在主菜单上的一层，关掉就露出原来的菜单；
 *   - 打开时把 #menu 设成 inert，键盘在 window 捕获阶段接管。
 * ============================================================= */
(function () {
  'use strict';

  let mount = document.getElementById('armory');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'armory';
    mount.className = 'armory hidden';
    mount.setAttribute('role', 'dialog');
    mount.setAttribute('aria-modal', 'true');
    mount.setAttribute('aria-label', '军械库');
    mount.setAttribute('tabindex', '-1');
    document.body.appendChild(mount);
  }

  const TITLE = '军械库 · 兵棋';

  /* ---------------- 国家 ---------------- */
  const COUNTRIES = [
    { id: 'us',   name: '美国', en: 'UNITED STATES',  code: 'US',   char: '美',
      color: '#5b8ad6', soft: 'rgba(91, 138, 214, 0.42)', eras: ['40s', '80s', '2020s'] },
    { id: 'ussr', name: '苏联', en: 'SOVIET UNION',   code: 'USSR', char: '苏',
      color: '#d2453c', soft: 'rgba(210, 69, 60, 0.42)',  eras: ['40s', '80s', '2020s'] },
    { id: 'de',   name: '德国', en: 'GERMANY',        code: 'DE',   char: '德',
      color: '#909cab', soft: 'rgba(144, 156, 171, 0.42)', eras: ['40s', '80s', '2020s'] },
    { id: 'uk',   name: '英国', en: 'UNITED KINGDOM', code: 'UK',   char: '英',
      color: '#8a9a58', soft: 'rgba(138, 154, 88, 0.42)', eras: ['40s', '80s', '2020s'] },
    { id: 'cn',   name: '中国', en: 'CHINA',          code: 'CN',   char: '中',
      color: '#c2603f', soft: 'rgba(194, 96, 63, 0.42)',  eras: ['40s', '80s', '2020s'] },
  ];

  const BY_ID = {};
  COUNTRIES.forEach(function (c) { BY_ID[c.id] = c; });

  const ERAS = [
    { id: '40s', label: '二战' },
    { id: '80s', label: '冷战' },
    { id: '2020s', label: '现代' },
  ];

  /* ---------------- 兵种 ---------------- */
  const CATS = [
    { id: 'inf', name: '步兵' },
    { id: 'armor', name: '装甲' },
    { id: 'arty', name: '炮兵' },
    { id: 'at', name: '反坦克' },
    { id: 'aa', name: '防空' },
    { id: 'recon', name: '侦察' },
    { id: 'support', name: '支援' },
    { id: 'fort', name: '防御工事' },
    { id: 'air', name: '飞机' },
    { id: 'heli', name: '直升机', eras: ['80s', '2020s'] },
  ];

  function catsFor(era) {
    return CATS.filter(function (c) { return !c.eras || c.eras.indexOf(era) !== -1; });
  }

  function catName(id) {
    for (let i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i].name;
    return id;
  }

  /* ---------------- 单位数据 ----------------
   * 键：`国家|年代|兵种`。数值全部来自 图鉴.xlsx：
   *   atk  = 数据卡「巷战 / 射程1 / 射程2」的 [软攻, 硬攻]
   *   ref  = 反伤系数（反击伤害 = 攻 × 反伤系数）
   *   ap   = 属性卡「巷战 / 1 / 2 穿甲」
   *   armor= 属性卡「正甲 / 侧甲 / 背甲」
   *   move = 行动力，price = 价格（动员点）
   * 目前只录了 美国 40s 步兵；其它空着，界面会提示「还没录」。
   */
  /* 单位索引：只记「哪个国家 / 年代 / 兵种有哪些单位」。
   * 数值和词条统一从 online-prep-data.js（window.PREP_DATA）读，
   * 和线上对战用同一份数据，不再各存一套。 */
  const UNIT_INDEX = {
    us: {
      inf: ["步兵营", "游骑兵营", "山地步兵营", "海军陆战队营", "伞兵营", "机械化步兵营", "突击工兵营"],
      armor: ["斯图亚特轻坦营", "75谢尔曼中坦营", "76谢尔曼中坦营", "潘兴重坦营", "巨无霸重坦营", "超级潘兴重坦营"],
      at: ["反坦克小组", "反坦克营", "M10中型坦歼营", "T95超重坦营"],
      arty: ["105炮兵营", "155炮兵营", "M7自行火炮营", "M12自行火炮营", "反炮兵小组", "管风琴火箭炮营"],
      aa: ["40防空炮营", "90防空炮营", "M16自行防空炮营", "M15自行防空炮营"],
      recon: ["侦察营", "灰狗装甲侦察营", "地狱猫装甲侦察营"],
      support: ["工兵营", "宪兵连", "医疗连", "摩托化运输队"],
      air: ["F5侦察机", "F6战斗侦察机", "P38战斗机", "P51战斗机", "P47战斗轰炸机", "B25轰炸机", "B29轰炸机"],
      fort: ["桥", "防御基座"]
    },
    de: {
      inf: ["步兵营", "突击步兵营", "猎兵营", "山地猎兵营", "人民冲锋队", "装甲掷弹兵营", "突击工兵营"],
      armor: ["四号中坦营", "豹式中坦营", "虎式重坦营", "虎王重坦营", "鼠式超重坦营"],
      at: ["反坦克小组", "反坦克敢死队", "反坦克营", "黄鼠狼轻型坦歼营", "追猎者轻型坦歼营", "四号突击炮营", "四号中型坦歼营", "猎豹重型坦歼营", "猎虎重型坦歼营"],
      arty: ["105炮兵营", "150炮兵营", "黄蜂自行火炮营", "野蜂自行火炮营", "反炮兵小组"],
      aa: ["20防空炮营", "88防空炮营", "卡车自行防空炮营", "东风自行防空炮营"],
      recon: ["侦察营", "222装甲侦察营", "美洲狮装甲侦察营"],
      support: ["工兵营", "宪兵连", "医疗连", "摩托化运输队"],
      air: ["Fw189侦察机", "Bf109战斗机", "Me262战斗机", "Fw190战斗轰炸机", "Ju88轰炸机"]
    },
    ussr: {
      inf: ["步兵营", "近卫步兵营", "惩戒营", "伞兵营", "机械化步兵营", "突击工兵营"]
    }
  };

  /* 图鉴和属性卡里名字对不上的几个 */
  const PREP_ALIAS = {
    '山地步兵营': '山地营',
    '海军陆战队营': '海军陆战队步兵营',
    '突击工兵营': '战斗工兵营',
    'M16自行防空炮营': 'M13自行防空炮营',
  };

  const EMPTY_STATS = {
    atk: [[null, null], [null, null], [null, null]], ref: null, hp: null,
    ap: [null, null, null], armor: [0, 0, 0], move: null, price: null, traits: [],
  };

  /* PREP_DATA 里还没有的阵营（苏军目前只有 40s 步兵）先放这张补充表，
   * 字段和 PREP_DATA 映射后的结构一致；等线上对战把苏军导进去就可以删。 */
  const EXTRA_UNITS = {
    ussr: {
      '步兵营': { atk: [[2.75, 1.25], [2.5, 1.5], [0.75, 0.25]], ref: 1.25, hp: 6, ap: [20, 5, 4], armor: [0, 0, 0], move: 4, price: 28, traits: [] },
      '近卫步兵营': { atk: [[4, 1.5], [2, 1.75], [0.75, 0.5]], ref: 1.25, hp: 6, ap: [20, 13, 10], armor: [0, 0, 0], move: 5, price: 50, traits: ['山地作战', '政治军队'] },
      '惩戒营': { atk: [[2, 0.5], [1, 0.5], [0.25, 0.25]], ref: 1.25, hp: 6, ap: [0, 0, 0], armor: [0, 0, 0], move: 4, price: 15, traits: [] },
      '伞兵营': { atk: [[2.75, 1], [2.25, 1], [0.5, 0.25]], ref: 1.25, hp: 5, ap: [20, 3, 0], armor: [0, 0, 0], move: 5, price: 28, traits: [] },
      '机械化步兵营': { atk: [[3.75, 2.25], [3.5, 3], [1.5, 1]], ref: 1.2, hp: 6, ap: [20, 13, 10], armor: [3, 2, 2], move: 8, price: 32, traits: [] },
      '突击工兵营': { atk: [[2.25, 0.75], [1.5, 0.75], [0.25, 0]], ref: 1.25, hp: 4, ap: [20, 5, 0], armor: [0, 0, 0], move: 4, price: 35, traits: ['爆破'] },
    },
  };

  /* 从 PREP_DATA 取一个单位的数值（和战斗系统同一份数据）；没有的查补充表 */
  function unitStats(country, name) {
    const d = window.PREP_DATA;
    const f = d && d.factions ? d.factions[country] : null;
    const bag = f && f.units;
    const u = bag ? (bag[name] || bag[PREP_ALIAS[name]]) : null;
    if (!u) return (EXTRA_UNITS[country] || {})[name] || null;
    const atk = u.attack || {};
    const ap = u.ap || {};
    const av = u.av || {};
    return {
      atk: [atk.urban || [null, null], atk.r1 || [null, null], atk.r2 || [null, null]],
      ref: (u.counter === undefined ? null : u.counter),
      hp: (u.hp === undefined ? null : u.hp),
      ap: [ap.urban === undefined ? null : ap.urban, ap.r1 === undefined ? null : ap.r1, ap.r2 === undefined ? null : ap.r2],
      armor: [av.front || 0, av.side || 0, av.rear || 0],
      move: (u.move === undefined ? null : u.move),
      price: (u.price === undefined ? null : u.price),
      traits: String(u.traits || '').split(/[，,]/).map(function (s) { return s.trim(); }).filter(Boolean),
    };
  }

  function unitsOf(country, era, cat) {
    const byEra = UNIT_INDEX[country];
    const names = (era === '40s' && byEra && byEra[cat]) ? byEra[cat] : [];
    return names.map(function (n) {
      const s = unitStats(country, n) || EMPTY_STATS;
      return {
        name: n, atk: s.atk, ref: s.ref, hp: s.hp, ap: s.ap,
        armor: s.armor, move: s.move, price: s.price, traits: s.traits,
      };
    });
  }

  /* 词条说明：规则文档第 7 节有的照抄，没有的只显示名字，不编。 */
  const TRAIT_INFO = {
    '山地作战': '丘陵消耗 1 行动力，山地消耗 2（替代常规消耗）。',
    '隐蔽': '不会受到反击伤害（任何距离）。',
    '工程': '消耗 2 行动力，在半径 1 格内架桥或修路。',
    '宪兵': '半径 1 格内友军免疫并解除混乱；半径 2 格内友军无法被敌军推进。',
    '医疗': '与目标单位合并（消耗本回合行动），恢复目标 1 点血量。',
    '侦察': '半径内目标视为有视野，并与友军共享；友军进攻该目标时行动力 −1。',
    '防空': '半径内敌方飞机无法穿越，可按射程拦截。',
    '曲射': '射程 ≥ 3 时不受反击。',
    '火箭炮': '每回合 1 次曲射，下一大回合装填，半径 1 内敌友不分。',
    '拦截': '遭受敌方飞机进攻时可立即起飞参战。',
    '重轰': '轰炸消耗 2 行动力；防空无法拦截，但要承受路径上每个防空的伤害。',
    '高空': '被防空攻击时防空射程 −1；不能被没有高空词条的战斗机攻击。',
    '核弹': '中心目标必死；半径 1 内 3 点、半径 2 内 2 点，敌友不分。',
    '碎心': '受到的反击伤害 ×2。',
    '游击队': '进攻不消耗行动力，攻击后可继续移动，每回合限一次。',
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    open: false,
    view: 'list',       // list 国家列表 / country 工作台
    country: null,
    era: '40s',
    cat: 'inf',
    unit: 0,            // 当前单位下标
  };

  let savedTitle = '';
  let unitListEl = null;
  let dataEl = null;
  let catsEl = null;
  let viewer = null;

  /* ---------------- 小工具 ---------------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function num(v) {
    if (v === null || v === undefined) return '—';
    return String(Math.round(Number(v) * 1000) / 1000);
  }

  function pair(a, b) {
    if ((a === null || a === undefined) && (b === null || b === undefined)) return '—';
    return num(a) + ' <i>/</i> ' + num(b);
  }

  /* =============================================================
   * 一、简介（存在同目录的 armory-desc.js 里，谁打开都能看到）
   *
   * 不再用浏览器 localStorage：数据是 线上版/armory-desc.js 里的
   * window.UNIT_DESC 对象，页面启动时用 <script> 动态读进来。
   * 界面上改完点「保存」，直接写回这个文件（Chrome/Edge 支持
   * File System Access API 时弹窗选文件，否则退回下载一份同名文件）。
   * ============================================================= */
  const DESC_FILE = 'armory-desc.js';
  let descDirty = false;

  function unitKey(country, era, cat, name) {
    return country + '|' + era + '|' + cat + '|' + name;
  }

  function descMap() {
    if (!window.UNIT_DESC || typeof window.UNIT_DESC !== 'object') window.UNIT_DESC = {};
    return window.UNIT_DESC;
  }

  function loadDescs() {
    return descMap();
  }

  function setDesc(key, text) {
    const all = descMap();
    const before = all[key] || '';
    if (text && text.trim()) all[key] = text;
    else delete all[key];
    if (before !== (all[key] || '')) descDirty = true;
  }

  function serializeDescs() {
    const all = descMap();
    const keys = Object.keys(all).sort();
    const lines = keys.map(function (k) {
      return '  ' + JSON.stringify(k) + ': ' + JSON.stringify(all[k]) + ',';
    });
    return '/* 军械库单位简介 —— 由军械库界面「保存」生成，也可以直接手改。\n' +
      ' * 键：国家|年代|兵种|单位名；值是简介正文。\n' +
      ' * 改完存回 线上版/armory-desc.js，刷新页面就能看到。\n' +
      ' */\n' +
      'window.UNIT_DESC = {\n' + lines.join('\n') + (lines.length ? '\n' : '') + '};\n';
  }

  function setDescStatus(msg) {
    const hint = mount.querySelector('#ar-desc-hint');
    if (hint) hint.textContent = msg;
  }

  function downloadDescs() {
    const blob = new Blob([serializeDescs()], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = DESC_FILE;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function saveDescs() {
    descDirty = false;
    const text = serializeDescs();

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: DESC_FILE,
          types: [{ description: 'JavaScript', accept: { 'text/javascript': ['.js'] } }],
        });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        setDescStatus('已写回 ' + DESC_FILE);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') {
          descDirty = true;
          setDescStatus('已取消保存');
          return;
        }
        // 没有权限 / file:// 不支持时退回下载
      }
    }

    downloadDescs();
    setDescStatus('已下载 ' + DESC_FILE + '，请覆盖 线上版/ 里的同名文件');
  }

  /* 页面启动时把 armory-desc.js 读进来；读不到就当空表 */
  (function loadDescFile() {
    const s = document.createElement('script');
    s.src = DESC_FILE;
    s.async = false;
    s.onload = function () {
      if (window.Armory && window.Armory.refreshDesc) window.Armory.refreshDesc();
    };
    s.onerror = function () { /* 还没建这个文件，忽略 */ };
    document.head.appendChild(s);
  })();


  /* =============================================================
   * 二、3D 查看器
   * ============================================================= */
  /* 只绕竖轴转（yaw 不限），俯仰压在这个范围里：
   * 相机本身在基座上方约 20°，压到 -0.14rad（约 -8°）仍然在基座平面之上，
   * 抬到 +0.34rad（约 +19°）是稍微俯视，这样任何角度都看不到底座下面。 */
  const PITCH_MIN = -0.14;
  const PITCH_MAX = 0.34;
  const PITCH_HOME = 0.14;

  /* 阵营模型颜色：用户指定美军纯蓝、德军灰，其它国家先留中性灰 */
  const MODEL_COLOR = { us: 0x1f3d73, de: 0x50565e, ussr: 0x6f2d29 };

  /* 模型正面朝向的修正角：用户把美军 / 德军模型都统一成「正面朝 +X」，
   * 转到正对相机要多转 -90°。 */
  const MODEL_FACING = { us: -Math.PI / 2, de: -Math.PI / 2, ussr: -Math.PI / 2 };

  /* 个别模型正面反了，单独再转 180° */
  const MODEL_YAW = { 'us|40s|air|F6战斗侦察机': Math.PI };

  function decodeGeometry(b64) {
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
    for (let i = 0; i < nidx; i++) {
      idx[i] = dv.getUint16(o + i * 2, true);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  function ensureViewer() {
    const THREE = window.THREE;
    const canvas = mount.querySelector('#ar-canvas');
    if (!THREE || !canvas) return null;
    if (viewer) return viewer;

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    camera.position.set(0, 1.35, 3.4);
    camera.lookAt(0, 0.02, 0);

    // 打光思路：环境光托底 + 跟相机的一盏补光，保证转到哪一面都不会黑成一片；
    // 再用一盏主光和一点轮廓光把体积感提出来。不开阴影贴图，不会有投影。
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x2b313a, 0.3));

    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(2.2, 3.2, 2.6);
    scene.add(key);

    // 跟着相机方向的补光：模型转到背面也能看清
    const head = new THREE.DirectionalLight(0xffffff, 0.35);
    head.position.set(0, 1.25, 3.4);
    head.target.position.set(0, 0, 0);
    scene.add(head);
    scene.add(head.target);

    // 左侧补光：主光的背光面不至于黑成洞
    const fill = new THREE.DirectionalLight(0xdfe8f5, 0.3);
    fill.position.set(-2.8, 1.6, 1.4);
    scene.add(fill);

    const side = new THREE.DirectionalLight(0x9dc0e4, 0.32);
    side.position.set(-2.6, 1.2, -1.8);
    scene.add(side);

    const rim = new THREE.DirectionalLight(0xe0a458, 0.18);
    rim.position.set(-0.5, 0.6, -3.0);
    scene.add(rim);

    const group = new THREE.Group();
    // 先绕竖轴转（yaw），再绕世界 X 轴俯仰（pitch）。
    // 'XYZ' = Rx * Ry：俯仰方向不跟着水平转，上下拖动永远是「往前/往后点一下」。
    group.rotation.order = 'XYZ';
    group.rotation.y = -0.62;
    group.rotation.x = PITCH_HOME;
    group.scale.setScalar(0.7);
    scene.add(group);

    viewer = {
      renderer: renderer, scene: scene, camera: camera, group: group,
      mesh: null, canvas: canvas, dist: 3.4, yaw: -0.62, pitch: PITCH_HOME, ro: null,
    };

    bindOrbit(viewer);

    // 面板尺寸变化（窗口缩放、数据栏换行等）时跟着重排
    if (typeof ResizeObserver !== 'undefined') {
      viewer.ro = new ResizeObserver(function () { sizeViewer(viewer); });
      viewer.ro.observe(viewer.canvas.parentElement);
    }

    sizeViewer(viewer);
    return viewer;
  }

  function sizeViewer(v) {
    const box = v.canvas.parentElement;
    if (!box) return;
    const w = box.clientWidth || 1;
    const h = box.clientHeight || 1;
    v.renderer.setSize(w, h, false);
    v.camera.aspect = w / h;
    v.camera.updateProjectionMatrix();
    drawViewer(v);
  }

  function drawViewer(v) {
    if (!v) return;
    v.renderer.render(v.scene, v.camera);
  }

  function bindOrbit(v) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    v.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    v.canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 2 && e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      try { v.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      v.canvas.classList.add('is-dragging');
    });

    v.canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      v.yaw += dx * 0.012;
      // 俯仰只给一点点：往下压不超过 -0.18rad，免得看到底座下面
      v.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, v.pitch + dy * 0.006));
      v.group.rotation.y = v.yaw;
      v.group.rotation.x = v.pitch;
      drawViewer(v);
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      v.canvas.classList.remove('is-dragging');
      try { v.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    v.canvas.addEventListener('pointerup', end);
    v.canvas.addEventListener('pointercancel', end);

    v.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      v.dist = Math.max(1.9, Math.min(5.6, v.dist + (e.deltaY > 0 ? 0.24 : -0.24)));
      v.camera.position.set(0, 1.25 * (v.dist / 3.4), v.dist);
      v.camera.lookAt(0, 0.02, 0);
      drawViewer(v);
    }, { passive: false });
  }

  function unitKeyOf(u) {
    return unitKey(state.country, state.era, state.cat, u.name);
  }

  /* ---------------- 模型文件按兵种分包 ----------------
   * armory.js 只放单位数据；模型放在 armory-models/<国家>-<年代>-<兵种>.js，
   * 点开哪个兵种才加载哪个，单文件大概 1~2MB。
   */
  const MODEL_DIR = 'armory-models/';
  const modelState = {};      // bag key -> 'loading' | 'ready' | 'error'
  const modelWaiters = {};    // bag key -> [cb]

  function modelBagKey() {
    return state.country + '|' + state.era + '|' + state.cat;
  }

  function modelFile(key) {
    return MODEL_DIR + key.split('|').join('-') + '.js';
  }

  function modelBag(key) {
    const all = window.ARMORY_MODELS;
    return (all && all[key]) || null;
  }

  function loadModels(key, cb) {
    if (modelBag(key)) { cb(); return; }
    const st = modelState[key];
    if (st === 'loading') { (modelWaiters[key] = modelWaiters[key] || []).push(cb); return; }
    if (st === 'error') { cb(); return; }

    modelState[key] = 'loading';
    modelWaiters[key] = [cb];
    const s = document.createElement('script');
    s.src = modelFile(key);
    s.async = false;
    s.onload = function () {
      modelState[key] = 'ready';
      const q = modelWaiters[key] || [];
      modelWaiters[key] = null;
      q.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    };
    s.onerror = function () {
      modelState[key] = 'error';
      const q = modelWaiters[key] || [];
      modelWaiters[key] = null;
      q.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    };
    document.head.appendChild(s);
  }

  function setViewHint(text) {
    const el = mount.querySelector('#ar-view-hint');
    if (el) el.textContent = text;
  }

  /* 先保证模型文件在，再画 */
  function showModelFor(unit) {
    if (!unit) { showModel(null); setViewHint('按住右键拖动旋转 · 滚轮缩放'); return; }
    if (modelBag(modelBagKey())) { applyModel(unit); return; }
    var bag = modelBagKey();
    setViewHint('模型加载中…');
    loadModels(bag, function () {
      if (!state.open || state.view !== 'country') return;
      if (!modelBag(modelBagKey())) {
        showModel(null);
        setViewHint('模型文件没找到（' + modelFile(bag) + '）');
        return;
      }
      applyModel(currentUnit() || unit);
    });
  }

  function applyModel(unit) {
    const ok = showModel(unit);
    setViewHint(ok ? '按住右键拖动旋转 · 滚轮缩放' : '这个单位的模型还没导出');
  }

  function showModel(unit) {
    const v = ensureViewer();
    if (!v) return false;

    if (v.mesh) {
      v.group.remove(v.mesh);
      v.mesh.geometry.dispose();
      v.mesh.material.dispose();
      v.mesh = null;
    }

    if (!unit) { drawViewer(v); return false; }

    const models = modelBag(modelBagKey()) || {};
    const rec = models[unitKeyOf(unit)];
    if (!rec || !window.THREE) { drawViewer(v); return false; }

    const geo = decodeGeometry(rec.b64);
    const mat = new THREE.MeshStandardMaterial({
      color: (MODEL_COLOR[state.country] !== undefined ? MODEL_COLOR[state.country] : 0x98a3af),
      roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // 打印件的正面朝 +X：先 Z-up→Y-up，再绕竖轴转到正对相机（+Z）
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = (MODEL_FACING[state.country] || 0) + (MODEL_YAW[unitKeyOf(unit)] || 0);
    mesh.rotation.x = -Math.PI / 2;
    v.group.add(mesh);
    v.mesh = mesh;

    sizeViewer(v);
    return true;
  }

  function disposeViewer() {
    if (!viewer) return;
    if (viewer.ro) { viewer.ro.disconnect(); viewer.ro = null; }
    if (viewer.mesh) {
      viewer.mesh.geometry.dispose();
      viewer.mesh.material.dispose();
      viewer.mesh = null;
    }
    viewer.renderer.dispose();
    viewer = null;
  }

  /* =============================================================
   * 三、渲染
   * ============================================================= */
  function topbar(backLabel, right) {
    return '' +
      '<header class="ar-top">' +
        '<button type="button" class="ar-back" data-act="back">' +
          '<span class="ar-back-i" aria-hidden="true">←</span>' +
          '<span>' + backLabel + '</span>' +
        '</button>' +
        '<span class="menu-brand"><span class="logo">⬢</span><b>军械库</b><em>ARMORY</em></span>' +
        (right || '<span class="ar-top-meta">5 个国家<span class="sep">/</span>单位 · 武器 · 编制</span>') +
      '</header>';
  }

  function foot() {
    return '' +
      '<footer class="ar-foot">' +
        '<span>单位模型由 单位/ 下的 .blend 只读导出，未改动原文件。</span>' +
        '<span class="mono">数值来源 · 图鉴.xlsx</span>' +
      '</footer>';
  }

  /* ---------------- 国家列表 ---------------- */
  function listHTML() {
    const cardsHTML = COUNTRIES.map(function (c, i) {
      return '' +
        '<button type="button" class="ar-nation" data-country="' + c.id + '"' +
            ' style="--c:' + c.color + ';--c-soft:' + c.soft + '">' +
          '<span class="ar-nation-top">' +
            '<span class="ar-no">' + pad2(i + 1) + '</span>' +
            '<span class="ar-code">' + c.code + '</span>' +
          '</span>' +
          '<span class="ar-wm" aria-hidden="true">' + c.char + '</span>' +
          '<span class="ar-nation-name">' + c.name + '</span>' +
          '<span class="ar-nation-en">' + c.en + '</span>' +
          '<span class="ar-nation-eras">' +
            c.eras.map(function (e) { return '<i>' + e + '</i>'; }).join('') +
          '</span>' +
        '</button>';
    }).join('');

    return '' +
      topbar('主菜单') +
      '<div class="ar-body">' +
        '<div class="ar-stage">' +
          '<section class="ar-head">' +
            '<p class="menu-kicker">ORDER OF BATTLE <span>/</span> SELECT NATION</p>' +
            '<h1 class="ar-title">选择国家</h1>' +
            '<p class="ar-lead">军械库按国家归档：先选国家，再按年代、兵种查单位的数值与模型。<br>' +
              '目前录好了 美国 40s 的步兵，其它兵种会陆续补上。</p>' +
            '<div class="ar-deck-entry">' +
              '<button type="button" class="ar-deck-btn" data-dk-open>' +
                '<span>创建卡组</span><em>按师预览卡池 · 导出 / 导入配置</em>' +
              '</button>' +
            '</div>' +
          '</section>' +
          '<nav class="ar-nations" aria-label="国家">' + cardsHTML + '</nav>' +
          '<p class="menu-note">' +
            '<kbd>←</kbd><kbd>→</kbd> 选国家 <span>·</span>' +
            '<kbd>1</kbd>–<kbd>5</kbd> 直达 <span>·</span>' +
            '<kbd>Enter</kbd> 进入 <span>·</span>' +
            '<kbd>Esc</kbd> 回主菜单' +
          '</p>' +
        '</div>' +
        foot() +
      '</div>';
  }

  /* =============================================================
   * 创建卡组（读线上对战的 online-prep-data.js，规则与那边一致）
   *
   * 数据只读：window.PREP_DATA 由 online.js / 本模块按需动态加载。
   * 规则（对齐 online.js）：
   *   占格：飞机单独占飞机格；HP>=4 主战、HP=3 辅助作战（都占主战格）；HP<3 纯辅助。
   *   预算：A 阶段 attack.A / defense.A；B 阶段 attack.B / defense.B；C 阶段 fundsC。
   *   卡池：A 用 pool.A；B 用 pool.A + pool.B（同名合并上限）；C 用 pool.C。
   *   军直属单位计入格子和经费。
   * ============================================================= */
  const DECK_FACTIONS = [
    { id: 'us', name: '美国', code: 'US' },
    { id: 'de', name: '德国', code: 'DE' },
  ];

  const deck = {
    faction: 'us',
    side: 'attacker',
    phase: 'A',
    corpsId: '',
    divisionId: '',
    units: {},          // key -> count
  };

  let prepLoading = null;
  let prepError = '';

  function prepData() {
    return (window.PREP_DATA && window.PREP_DATA.factions) ? window.PREP_DATA : null;
  }

  function loadPrep() {
    if (prepData()) return Promise.resolve(prepData());
    if (prepLoading) return prepLoading;
    prepError = '';
    prepLoading = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'online-prep-data.js';
      s.onload = function () {
        if (prepData()) resolve(prepData());
        else { prepError = 'online-prep-data.js 没有定义 window.PREP_DATA'; reject(new Error(prepError)); }
      };
      s.onerror = function () {
        prepError = '没有找到 online-prep-data.js';
        reject(new Error(prepError));
      };
      document.head.appendChild(s);
    });
    return prepLoading;
  }

  function deckFactionData() {
    const d = prepData();
    return (d && d.factions[deck.faction]) || null;
  }

  function deckCorps() {
    const f = deckFactionData();
    if (!f) return null;
    const list = f.corps || [];
    return list.filter(function (c) { return c.id === deck.corpsId; })[0] || list[0] || null;
  }

  function deckDivision() {
    const f = deckFactionData();
    if (!f) return null;
    const list = f.divisions || [];
    return list.filter(function (d) { return d.id === deck.divisionId; })[0] || list[0] || null;
  }

  function deckUnitInfo(name) {
    const f = deckFactionData();
    const u = f && f.units ? f.units[name] : null;
    return u || { price: 0, hp: 0, cat: 'support', missing: true };
  }

  function deckUnitClass(info) {
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

  function deckSlotClass(info) {
    const cls = deckUnitClass(info);
    if (cls === 'air') return 'air';
    if (cls === 'support') return 'support';
    return 'main';
  }

  function deckEntries() {
    const div = deckDivision();
    const corps = deckCorps();
    const out = [];
    const push = function (key, name, max, source) {
      const old = out.filter(function (x) { return x.key === key; })[0];
      if (old) { old.max += Number(max) || 0; return; }
      out.push({ key: key, name: name, max: Number(max) || 0, source: source, info: deckUnitInfo(name) });
    };
    if (div) {
      const pool = div.pool || {};
      const lists = deck.phase === 'C' ? [pool.C]
        : deck.phase === 'B' ? [pool.A, pool.B] : [pool.A];
      lists.forEach(function (arr) {
        (arr || []).forEach(function (u) { push('div|' + u.name, u.name, u.max, 'division'); });
      });
    }
    if (corps) {
      (corps.units || []).forEach(function (u) { push('corps|' + u.name, u.name, u.max, 'corps'); });
    }
    return out;
  }

  function deckFunds(div) {
    if (!div) return 0;
    if (deck.phase === 'C') return Number(div.fundsC) || 0;
    const bag = deck.side === 'defender' ? div.defense : div.attack;
    return Number(bag && bag[deck.phase]) || 0;
  }

  function deckStats() {
    const div = deckDivision();
    const entries = deckEntries();
    const byKey = {};
    entries.forEach(function (e) { byKey[e.key] = e; });
    let main = 0, support = 0, air = 0, cost = 0, total = 0;
    Object.keys(deck.units).forEach(function (k) {
      const e = byKey[k];
      const n = Number(deck.units[k]) || 0;
      if (!e || n <= 0) return;
      total += n;
      cost += n * (e.info.price || 0);
      const slot = deckSlotClass(e.info);
      if (slot === 'air') air += n;
      else if (slot === 'main') main += n;
      else support += n;
    });
    return {
      main: main, support: support, air: air, cost: cost, total: total,
      mainLimit: div ? div.slots.main : 0,
      supportLimit: div ? div.slots.support : 0,
      planeLimit: div ? (div.planes == null ? Infinity : div.planes) : 0,
      funds: deckFunds(div), entries: entries, byKey: byKey, division: div,
    };
  }

  /* 加一个单位为什么不行的原因（能加就返回空串） */
  function deckBlockReason(entry, stats) {
    if (!entry) return '没有这个单位';
    const n = Number(deck.units[entry.key]) || 0;
    if (n >= entry.max) return '已到上限 ' + entry.max;
    if (stats.cost + (entry.info.price || 0) > stats.funds) return '经费不够';
    const slot = deckSlotClass(entry.info);
    if (slot === 'air' && stats.air + 1 > stats.planeLimit) return '飞机格已满';
    if (slot === 'main' && stats.main + 1 > stats.mainLimit) return '主战格已满';
    if (slot === 'support' && stats.support + 1 > stats.supportLimit) return '辅助格已满';
    return '';
  }

  function deckAdjust(key, delta) {
    const stats = deckStats();
    const entry = stats.byKey[key];
    if (!entry) return;
    const cur = Number(deck.units[key]) || 0;
    if (delta > 0) {
      if (deckBlockReason(entry, stats)) return;
      deck.units[key] = Math.min(entry.max, cur + 1);
    } else {
      const next = cur - 1;
      if (next <= 0) delete deck.units[key];
      else deck.units[key] = next;
    }
    renderDeck();
  }

  function deckPrune() {
    const stats = deckStats();
    Object.keys(deck.units).forEach(function (k) {
      if (!stats.byKey[k]) delete deck.units[k];
    });
  }

  function deckPickDivision(id) {
    const f = deckFactionData();
    const div = (f ? f.divisions : []).filter(function (d) { return d.id === id; })[0];
    if (!div) return;
    if (deck.divisionId !== id) deck.units = {};   // 换师 = 新卡组，避免上一套的单位残留
    deck.divisionId = id;
    if (div.phase === 'C') deck.phase = 'C';
    else if (deck.phase === 'C') deck.phase = 'A';
    deckPrune();
    renderDeck();
  }

  function deckPickCorps(id) {
    deck.corpsId = id;
    deckPrune();
    renderDeck();
  }

  function deckPickPhase(p) {
    const div = deckDivision();
    if (!div) return;
    const allowed = div.phase === 'C' ? ['C'] : ['A', 'B'];
    if (allowed.indexOf(p) < 0) return;
    deck.phase = p;
    deckPrune();
    renderDeck();
  }

  function deckPickFaction(id) {
    if (deck.faction === id) return;
    deck.faction = id;
    deck.corpsId = '';
    deck.divisionId = '';
    deck.units = {};
    deck.phase = 'A';
    renderDeck();
  }

  function deckClear() {
    deck.units = {};
    renderDeck();
  }

  function deckExport() {
    const div = deckDivision();
    const corps = deckCorps();
    if (!div || !corps) return;
    const units = Object.keys(deck.units).filter(function (k) { return deck.units[k] > 0; }).map(function (k) {
      const parts = k.split('|');
      return { name: parts.slice(1).join('|'), source: parts[0] === 'corps' ? 'corps' : 'division', count: deck.units[k] };
    });
    const payload = {
      format: 'bingqi-division-deck',
      version: 1,
      faction: deck.faction,
      corps: corps.id,
      division: div.id,
      phase: deck.phase,
      side: deck.side,
      units: units,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = deck.faction + '-' + div.id + '-' + deck.phase + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (e) {
      try { navigator.clipboard.writeText(text); } catch (err) { /* ignore */ }
    }
  }

  function deckImportText(text) {
    let payload;
    try { payload = JSON.parse(text); } catch (e) { return '不是有效的 JSON 文件'; }
    if (!payload || payload.format !== 'bingqi-division-deck' || payload.version !== 1) {
      return '不是「bingqi-division-deck」配置';
    }
    const fac = payload.faction;
    if (!fac || !prepData() || !prepData().factions[fac]) return '配置里的阵营不存在';
    const f = prepData().factions[fac];
    const div = (f.divisions || []).filter(function (d) { return d.id === payload.division; })[0];
    const corps = (f.corps || []).filter(function (c) { return c.id === payload.corps; })[0];
    if (!div) return '配置里的师不存在';
    if (!corps) return '配置里的军不存在';
    const phase = payload.phase === 'B' || payload.phase === 'C' ? payload.phase : 'A';
    if (div.phase === 'C' && phase !== 'C') return '装甲师只能在 C 阶段配卡';
    if (div.phase !== 'C' && phase === 'C') return '这个师不参加 C 阶段';

    deck.faction = fac;
    deck.corpsId = corps.id;
    deck.divisionId = div.id;
    deck.phase = phase;
    deck.side = payload.side === 'defender' ? 'defender' : 'attacker';
    deck.units = {};

    const entries = deckEntries();
    const errors = [];
    (payload.units || []).forEach(function (u) {
      if (!u || !u.name) return;
      const source = u.source === 'corps' ? 'corps' : 'division';
      const key = (source === 'corps' ? 'corps' : 'div') + '|' + u.name;
      const entry = entries.filter(function (e) { return e.key === key; })[0];
      if (!entry) { errors.push('卡池里没有：' + u.name); return; }
      const n = Math.max(0, Math.min(entry.max, Number(u.count) || 0));
      if (n > 0) deck.units[key] = n;
    });

    const stats = deckStats();
    if (stats.cost > stats.funds) errors.push('经费超出 ' + stats.cost + ' / ' + stats.funds);
    if (stats.main > stats.mainLimit) errors.push('主战格超出 ' + stats.main + ' / ' + stats.mainLimit);
    if (stats.support > stats.supportLimit) errors.push('辅助格超出 ' + stats.support + ' / ' + stats.supportLimit);
    if (stats.air > stats.planeLimit) errors.push('飞机格超出 ' + stats.air + ' / ' + stats.planeLimit);

    renderDeck();
    return errors.length ? errors.slice(0, 3).join('；') : '';
  }

  function deckImportFile(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) { deckToast('配置文件太大'); return; }
    const reader = new FileReader();
    reader.onload = function () {
      const err = deckImportText(String(reader.result || ''));
      deckToast(err ? '导入失败：' + err : '配置已导入');
    };
    reader.readAsText(file);
  }

  let deckToastTimer = 0;
  function deckToast(msg) {
    const el = mount.querySelector('#dk-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(deckToastTimer);
    deckToastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }

  /* ---------------- 卡组界面 ---------------- */
  function deckTopbar() {
    const f = deckFactionData();
    const right = '<div class="dk-tabs">' + DECK_FACTIONS.map(function (x) {
      const on = x.id === deck.faction;
      return '<button type="button" class="dk-tab' + (on ? ' is-on' : '') + '" data-dk="faction" data-v="' + x.id + '">' +
        x.name + '<em>' + x.code + '</em></button>';
    }).join('') + '</div>';
    return topbar('全部国家', right);
  }

  function deckHintText() {
    if (prepError) return prepError;
    if (!prepData()) return '正在读取 online-prep-data.js …';
    return '';
  }

  function deckHTML() {
    const err = deckHintText();
    if (err) {
      return deckTopbar() +
        '<div class="ar-body"><div class="dk-body dk-error">' +
          '<p>' + esc(err) + '</p>' +
          '<p class="muted">卡组数据来自线上对战的 <code>online-prep-data.js</code>，确认这个文件在 线上版/ 目录下。</p>' +
        '</div></div>';
    }

    const f = deckFactionData();
    const corps = deckCorps();
    const div = deckDivision();
    const stats = deckStats();
    if (!f) return deckTopbar() + '<div class="ar-body"></div>';
    if (!corps) deck.corpsId = (f.corps && f.corps[0] && f.corps[0].id) || '';
    if (!div) deck.divisionId = (f.divisions && f.divisions[0] && f.divisions[0].id) || '';

    const corpsHTML = (f.corps || []).map(function (c) {
      const on = c.id === deck.corpsId;
      const total = (c.units || []).reduce(function (s, u) { return s + (Number(u.max) || 0); }, 0);
      return '<button type="button" class="dk-corps' + (on ? ' is-on' : '') + '" data-dk="corps" data-v="' + c.id + '">' +
        '<b>' + esc(c.name) + '</b><em>' + (c.units || []).length + ' 种 · 共 ' + total + '</em>' +
      '</button>';
    }).join('');

    const divsHTML = (f.divisions || []).map(function (d) {
      const on = d.id === deck.divisionId;
      const ph = d.phase === 'C' ? 'C' : 'A/B';
      return '<button type="button" class="dk-div' + (on ? ' is-on' : '') + '" data-dk="division" data-v="' + d.id + '">' +
        '<b>' + esc(d.name) + '</b>' +
        '<em>' + esc(typeLabel(d.type)) + ' · ' + ph + ' 阶段</em>' +
      '</button>';
    }).join('');

    const phaseChips = div ? (div.phase === 'C'
      ? '<button type="button" class="dk-chip is-on" data-dk="phase" data-v="C">C 阶段 · 增援</button>'
      : ['A', 'B'].map(function (p) {
          return '<button type="button" class="dk-chip' + (deck.phase === p ? ' is-on' : '') + '" data-dk="phase" data-v="' + p + '">' +
            p + ' 阶段' + (p === 'B' ? ' · 增援' : '') + '</button>';
        }).join('')) : '';

    const sideChips = div && div.phase !== 'C'
      ? ['attacker', 'defender'].map(function (s) {
          return '<button type="button" class="dk-chip' + (deck.side === s ? ' is-on' : '') + '" data-dk="side" data-v="' + s + '">' +
            (s === 'attacker' ? '进攻' : '防守') + '</button>';
        }).join('')
      : '';

    const bar = function (label, cur, lim) {
      const limTxt = lim === Infinity ? '不限' : String(lim);
      const pct = lim === Infinity || !lim ? 0 : Math.min(100, Math.round(cur / lim * 100));
      const full = lim !== Infinity && cur >= lim;
      return '<div class="dk-bar' + (full ? ' is-full' : '') + '">' +
        '<span class="dk-bar-l">' + label + '</span>' +
        '<span class="dk-bar-n">' + cur + ' / ' + limTxt + '</span>' +
        '<i style="width:' + pct + '%"></i>' +
      '</div>';
    };

    const groups = [
      { id: 'main', name: '主战', hint: 'HP ≥ 4，占主战格' },
      { id: 'aux', name: '辅助作战', hint: 'HP = 3，也占主战格' },
      { id: 'support', name: '纯辅助', hint: 'HP < 3，占辅助格' },
      { id: 'air', name: '飞机', hint: '占飞机格' },
    ];

    const unitCard = function (e) {
      const n = Number(deck.units[e.key]) || 0;
      const cls = deckSlotClass(e.info);
      const reason = deckBlockReason(e, stats);
      const info = e.info;
      const meta = [];
      if (info.price) meta.push(info.price + ' 经费');
      if (info.hp) meta.push('血 ' + info.hp);
      if (e.source === 'corps') meta.push('军直属');
      const maxTxt = '×' + n + ' / ' + e.max;
      return '<div class="dk-unit' + (n ? ' is-picked' : '') + (cls ? ' is-' + cls : '') + '">' +
        '<div class="dk-unit-main">' +
          '<b>' + esc(e.name) + '</b>' +
          '<em>' + esc(meta.join(' · ')) + '</em>' +
        '</div>' +
        '<div class="dk-unit-ops">' +
          '<button type="button" class="dk-ghost" data-dk="minus" data-k="' + esc(e.key) + '"' + (n ? '' : ' disabled') + '>−</button>' +
          '<span class="dk-count">' + esc(maxTxt) + '</span>' +
          '<button type="button" class="dk-ghost" data-dk="plus" data-k="' + esc(e.key) + '"' +
            (reason ? ' disabled title="' + esc(reason) + '"' : '') + '>＋</button>' +
        '</div>' +
      '</div>';
    };

    let unitsHTML = '';
    groups.forEach(function (g) {
      const list = stats.entries.filter(function (e) { return deckUnitClass(e.info) === g.id; });
      if (!list.length) return;
      unitsHTML += '<section class="dk-group">' +
        '<h3>' + g.name + '<em>' + g.hint + '</em></h3>' +
        '<div class="dk-grid">' + list.map(unitCard).join('') + '</div>' +
      '</section>';
    });
    if (!unitsHTML) unitsHTML = '<p class="dk-empty">这个师在这个阶段没有可用单位。</p>';

    const picked = stats.entries.filter(function (e) { return (Number(deck.units[e.key]) || 0) > 0; });
    const pickedHTML = picked.length ? picked.map(function (e) {
      const n = Number(deck.units[e.key]) || 0;
      return '<li><span>' + esc(e.name) + '</span><em>×' + n + ' · ' + ((e.info.price || 0) * n) + '</em></li>';
    }).join('') : '<li class="is-none">还没有选单位</li>';

    return deckTopbar() +
      '<div class="ar-body dk-body">' +
        '<aside class="dk-left">' +
          '<div class="dk-sec"><span>军</span><em>军直属单位计入格子和经费</em></div>' +
          '<div class="dk-corps-list">' + corpsHTML + '</div>' +
          '<div class="dk-sec"><span>师</span><em>步兵 / 空降 / 山地走 A、B 阶段；装甲师走 C 阶段</em></div>' +
          '<div class="dk-div-list">' + divsHTML + '</div>' +
        '</aside>' +
        '<section class="dk-mid">' +
          '<header class="dk-head">' +
            '<div class="dk-head-main">' +
              '<h2>' + esc(div ? div.name : '未选师') + '</h2>' +
              '<p>' + esc(f.name) + ' · ' + esc(div ? typeLabel(div.type) : '') +
                ' · 主战 ' + (div ? div.slots.main : 0) + ' 格 / 辅助 ' + (div ? div.slots.support : 0) +
                ' 格 / 飞机 ' + (div && div.planes != null ? div.planes : '不限') + ' 格</p>' +
            '</div>' +
            '<div class="dk-head-ctl">' +
              (phaseChips ? '<div class="dk-chips">' + phaseChips + '</div>' : '') +
              (sideChips ? '<div class="dk-chips">' + sideChips + '</div>' : '') +
            '</div>' +
          '</header>' +
          '<div class="dk-bars">' +
            bar('经费', stats.cost, stats.funds) +
            bar('主战', stats.main, stats.mainLimit) +
            bar('辅助', stats.support, stats.supportLimit) +
            bar('飞机', stats.air, stats.planeLimit) +
          '</div>' +
          '<div class="dk-scroll">' + unitsHTML + '</div>' +
        '</section>' +
        '<aside class="dk-right">' +
          '<div class="dk-right-head"><h3>卡组</h3><span>' + stats.total + ' 个单位</span></div>' +
          '<ul class="dk-picked">' + pickedHTML + '</ul>' +
          '<div class="dk-actions">' +
            '<button type="button" class="dk-btn is-primary" data-dk="export">导出 JSON</button>' +
            '<button type="button" class="dk-btn" data-dk="import">导入</button>' +
            '<button type="button" class="dk-btn is-ghost" data-dk="clear">清空</button>' +
          '</div>' +
          '<input type="file" id="dk-file" accept=".json,application/json" hidden>' +
          '<p class="dk-note">导出格式和线上对战一致（<code>bingqi-division-deck</code> v1），' +
            '可以互相导入。A/B 阶段按你选的模式导出。</p>' +
          '<div class="dk-toast" id="dk-toast"></div>' +
        '</aside>' +
      '</div>';
  }

  function typeLabel(type) {
    if (type === 'infantry') return '步兵师';
    if (type === 'airborne') return '空降师';
    if (type === 'mountain') return '山地师';
    if (type === 'armored') return '装甲师';
    return type || '';
  }

  function bindDeckFile() {
    const input = mount.querySelector('#dk-file');
    if (!input) return;
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      deckImportFile(file);
      input.value = '';
    });
  }

  function renderDeck() {
    mount.classList.remove('is-bench');
    mount.innerHTML = deckHTML();
    mount.scrollTop = 0;
    bindDeckFile();
  }

  function openDeck() {
    state.view = 'deck';
    state.country = null;
    disposeViewer();
    renderDeck();
    loadPrep().then(function () {
      if (state.open && state.view === 'deck') renderDeck();
    }).catch(function () {
      if (state.open && state.view === 'deck') renderDeck();
    });
  }

  /* ---------------- 国家工作台 ---------------- */
  function eraTabsHTML(c) {
    return '<div class="ar-era" role="tablist" aria-label="年代">' +
      ERAS.map(function (e) {
        const on = e.id === state.era;
        return '<button type="button" class="ar-era-btn' + (on ? ' is-on' : '') + '"' +
          ' data-era="' + e.id + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' +
          e.id + '<em>' + e.label + '</em></button>';
      }).join('') +
    '</div>';
  }

  function countryTopbar(c) {
    return topbar('全部国家',
      '<span class="ar-crumb"><i style="--c:' + c.color + '">' + c.char + '</i>' + c.name + '</span>' +
      eraTabsHTML(c));
  }

  function unitsListHTML() {
    const units = unitsOf(state.country, state.era, state.cat);
    if (!units.length) {
      return '<p class="ar-units-empty">这个兵种还没录单位。</p>';
    }
    return units.map(function (u, i) {
      return '<button type="button" class="ar-unit' + (i === state.unit ? ' is-on' : '') + '"' +
        ' data-unit="' + i + '">' +
        '<span class="ar-unit-no">' + pad2(i + 1) + '</span>' +
        '<span class="ar-unit-nm">' + esc(u.name) + '</span>' +
      '</button>';
    }).join('');
  }

  function catBarHTML() {
    const cats = catsFor(state.era);
    return cats.map(function (c) {
      const n = unitsOf(state.country, state.era, c.id).length;
      return '<button type="button" class="ar-catbtn' + (c.id === state.cat ? ' is-on' : '') +
        (n ? '' : ' is-empty') + '" data-cat="' + c.id + '">' +
        '<span>' + c.name + '</span><em>' + (n || 0) + '</em>' +
      '</button>';
    }).join('');
  }

  function currentUnit() {
    const units = unitsOf(state.country, state.era, state.cat);
    return units[state.unit] || null;
  }

  function dataHTML() {
    const u = currentUnit();
    const c = BY_ID[state.country];
    if (!u) {
      return '<div class="ar-data-empty">' +
        '<p>这个兵种还没有单位数据。</p>' +
        '<p class="muted">先把 ' + esc(c.name) + ' ' + state.era + ' 的 ' + catName(state.cat) +
        ' 的单位录进图鉴，再补模型。</p>' +
      '</div>';
    }

    const armor = (u.armor && u.armor.some(function (v) { return v > 0; }))
      ? u.armor.map(num).join(' / ')
      : '—';

    const traits = (u.traits && u.traits.length) ? u.traits.map(function (t) {
      const info = TRAIT_INFO[t];
      return '<li><b>' + esc(t) + '</b>' + (info ? '<span>' + esc(info) + '</span>' : '') + '</li>';
    }).join('') : '<li class="is-none">没有词条</li>';

    return '' +
      '<div class="ar-data-head">' +
        '<h2>' + esc(u.name) + '</h2>' +
        '<span class="ar-data-tag">' + esc(c.name) + ' · ' + catName(state.cat) + ' · ' + state.era + '</span>' +
      '</div>' +
      '<div class="ar-data-scroll">' +
        '<section class="ar-dsec">' +
          '<h3>进攻 <em>软 / 硬</em></h3>' +
          '<dl class="ar-stats">' +
            '<div><dt>巷战</dt><dd>' + pair(u.atk[0][0], u.atk[0][1]) + '</dd></div>' +
            '<div><dt>射程 1</dt><dd>' + pair(u.atk[1][0], u.atk[1][1]) + '</dd></div>' +
            '<div><dt>射程 2</dt><dd>' + pair(u.atk[2][0], u.atk[2][1]) + '</dd></div>' +
            '<div><dt>反击系数</dt><dd>' + num(u.ref) + '</dd></div>' +
          '</dl>' +
        '</section>' +
        '<section class="ar-dsec">' +
          '<h3>防御</h3>' +
          '<dl class="ar-stats">' +
            '<div><dt>血量</dt><dd>' + num(u.hp) + '</dd></div>' +
            '<div><dt>装甲 正 / 侧 / 背</dt><dd>' + armor + '</dd></div>' +
            '<div><dt>穿甲 巷 / 1 / 2</dt><dd>' + u.ap.map(num).join(' / ') + '</dd></div>' +
          '</dl>' +
        '</section>' +
        '<section class="ar-dsec">' +
          '<h3>机动与成本</h3>' +
          '<dl class="ar-stats">' +
            '<div><dt>行动力</dt><dd>' + num(u.move) + '</dd></div>' +
            '<div><dt>价格</dt><dd>' + num(u.price) + '</dd></div>' +
          '</dl>' +
        '</section>' +
        '<section class="ar-dsec">' +
          '<h3>词条</h3>' +
          '<ul class="ar-traits">' + traits + '</ul>' +
        '</section>' +
      '</div>' +
      '<section class="ar-desc-block">' +
        '<h3>简介 <button type="button" class="ar-desc-export" title="把简介写回 线上版/armory-desc.js">保存</button></h3>' +
        '<textarea id="ar-desc" class="ar-desc" rows="4" spellcheck="false"' +
          ' placeholder="还没写简介。点这里写，改完点「保存」写进 armory-desc.js，别人也能看到。"></textarea>' +
        '<p class="ar-desc-hint" id="ar-desc-hint">还没有简介</p>' +
      '</section>';
  }

  function workbenchHTML(c) {
    return '' +
      countryTopbar(c) +
      '<div class="ar-work">' +
        '<aside class="ar-units" aria-label="单位">' +
          '<h2><span id="ar-cat-name">' + catName(state.cat) + '</span><em id="ar-unit-count">' + unitsOf(state.country, state.era, state.cat).length + '</em></h2>' +
          '<div class="ar-units-list" id="ar-units-list">' + unitsListHTML() + '</div>' +
        '</aside>' +
        '<section class="ar-view">' +
          '<div class="ar-view-box">' +
            '<canvas id="ar-canvas"></canvas>' +
          '</div>' +
          '<p class="ar-view-hint" id="ar-view-hint">按住右键拖动旋转 · 滚轮缩放</p>' +
        '</section>' +
        '<aside class="ar-data" id="ar-data">' + dataHTML() + '</aside>' +
      '</div>' +
      '<nav class="ar-cats" aria-label="兵种" id="ar-cats">' + catBarHTML() + '</nav>';
  }

  /* =============================================================
   * 四、切页与局部刷新
   * ============================================================= */
  function render() {
    const c = state.country ? BY_ID[state.country] : null;
    mount.classList.toggle('is-bench', !!(state.view === 'country' && c));
    mount.setAttribute('aria-label', c ? c.name + ' · 军械库' : '军械库');
    if (state.view === 'deck') {
      mount.classList.remove('is-bench');
      mount.innerHTML = deckHTML();
      bindDeckFile();
      return;
    }
    mount.innerHTML = (state.view === 'country' && c) ? workbenchHTML(c) : listHTML();
    mount.scrollTop = 0;

    if (state.view === 'country' && c) {
      unitListEl = mount.querySelector('#ar-units-list');
      dataEl = mount.querySelector('#ar-data');
      catsEl = mount.querySelector('#ar-cats');
      bindDesc();

      // 数值在 online-prep-data.js 里，和线上对战同一份；没读完先显示「—」，读完刷一次右栏
      if (!window.PREP_DATA) {
        const want = state.country;
        loadPrep().then(function () {
          if (state.open && state.view === 'country' && state.country === want) dataRefresh();
        }).catch(function () { /* 没有这个文件就一直显示「—」 */ });
      }

      // 先同步建一次：读 clientWidth 会强制 layout，尺寸是准的；
      // 再补一帧，防止刚显示时 flex 还没算完。
      const v = ensureViewer();
      if (v) {
        sizeViewer(v);
        showModelFor(currentUnit());
      }
      requestAnimationFrame(function () {
        if (!viewer) return;
        sizeViewer(viewer);
      });
    }
  }

  function unitListRefresh() {
    if (!unitListEl) return;
    unitListEl.innerHTML = unitsListHTML();
    const count = mount.querySelector('#ar-unit-count');
    if (count) count.textContent = unitsOf(state.country, state.era, state.cat).length;
    const nameEl = mount.querySelector('#ar-cat-name');
    if (nameEl) nameEl.textContent = catName(state.cat);
  }

  function dataRefresh() {
    if (!dataEl) return;
    dataEl.innerHTML = dataHTML();
    bindDesc();
  }

  function catsRefresh() {
    if (!catsEl) return;
    catsEl.innerHTML = catBarHTML();
  }

  function selectUnit(i) {
    state.unit = i;
    unitListRefresh();
    dataRefresh();
    showModelFor(currentUnit());
    focusEl(unitListEl && unitListEl.querySelector('[data-unit="' + i + '"]'));
  }

  function selectCat(id) {
    const units = unitsOf(state.country, state.era, id);
    state.cat = id;
    state.unit = 0;
    catsRefresh();
    unitListRefresh();
    dataRefresh();
    showModelFor(units[0] || null);
    focusEl(catsEl && catsEl.querySelector('[data-cat="' + id + '"]'));
  }

  function selectEra(id) {
    state.era = id;
    const cats = catsFor(id);
    if (!cats.some(function (c) { return c.id === state.cat; })) {
      state.cat = cats[0].id;
    }
    state.unit = 0;
    // 画布会被重建，旧的 WebGL 上下文先丢掉
    disposeViewer();
    render();
    focusEl(mount.querySelector('[data-era="' + id + '"]'));
  }

  /* ---------------- 简介编辑 ---------------- */
  function bindDesc() {
    const ta = mount.querySelector('#ar-desc');
    const u = currentUnit();
    if (!ta || !u) return;

    const key = unitKeyOf(u);
    ta.value = loadDescs()[key] || '';
    setDescStatus(ta.value ? ta.value.length + ' 字 · 改完记得保存' : '还没有简介');

    ta.addEventListener('input', function () {
      setDesc(key, ta.value);
      setDescStatus(ta.value ? '未保存 · ' + ta.value.length + ' 字' : '已清空 · 点保存写入文件');
    });
  }

  /* =============================================================
   * 五、打开 / 关闭 / 交互
   * ============================================================= */
  function openCountry(id) {
    const c = BY_ID[id];
    if (!c) return;
    state.view = 'country';
    state.country = id;
    state.era = '40s';
    state.cat = 'inf';
    state.unit = 0;
    render();
    focusEl(mount);
    // 数值在 online-prep-data.js 里，和线上对战同一份；没读完先显示「—」，读完再刷一次
    if (!window.PREP_DATA) {
      loadPrep().then(function () {
        if (state.open && state.view === 'country' && state.country === id) {
          dataRefresh();
        }
      }).catch(function () { /* 没有这个文件就一直是「—」 */ });
    }
  }

  function goBack() {
    if (state.view === 'deck') {
      state.view = 'list';
      render();
      return;
    }
    if (state.view === 'country') {
      const prev = state.country;
      state.view = 'list';
      state.country = null;
      disposeViewer();
      render();
      if (prev) focusEl(mount.querySelector('[data-country="' + prev + '"]'));
      return;
    }
    close();
  }

  function open(countryId) {
    if (state.open) {
      if (countryId) openCountry(countryId);
      return;
    }

    savedTitle = document.title;
    state.open = true;
    state.era = '40s';
    state.cat = 'inf';
    state.unit = 0;
    if (countryId && BY_ID[countryId]) {
      state.view = 'country';
      state.country = countryId;
    } else {
      state.view = 'list';
      state.country = null;
    }

    mount.classList.remove('hidden');
    mount.setAttribute('aria-hidden', 'false');
    if (!mount.hasAttribute('tabindex')) mount.setAttribute('tabindex', '-1');
    document.body.classList.add('armory-open');

    const menu = document.getElementById('menu');
    if (menu) menu.setAttribute('inert', '');

    document.title = TITLE;
    render();
    focusEl(mount);

    window.addEventListener('resize', onResize);
  }

  function close() {
    if (!state.open) return;
    state.open = false;

    disposeViewer();
    window.removeEventListener('resize', onResize);

    mount.classList.add('hidden');
    mount.setAttribute('aria-hidden', 'true');
    mount.classList.remove('is-bench');
    mount.innerHTML = '';
    document.body.classList.remove('armory-open');

    const menu = document.getElementById('menu');
    if (menu) menu.removeAttribute('inert');

    document.title = savedTitle || '兵棋 · 线上战术桌';
    focusEl(document.querySelector('.menu-item[data-module="armory"]'));
  }

  function onResize() {
    if (!state.open || state.view !== 'country') return;
    if (viewer) sizeViewer(viewer);
  }

  /* ---------------- 鼠标 ---------------- */
  mount.addEventListener('click', function (e) {
    const t = e.target && e.target.closest
      ? e.target.closest('[data-act], [data-country], [data-era], [data-cat], [data-unit], [data-dk], [data-dk-open], .ar-desc-export')
      : null;
    if (!t || !mount.contains(t)) return;

    // 卡组界面：所有按钮都走 data-dk
    const dk = e.target.closest ? e.target.closest('[data-dk]') : null;
    if (dk && mount.contains(dk)) {
      const act = dk.getAttribute('data-dk');
      const v = dk.getAttribute('data-v');
      if (act === 'faction') deckPickFaction(v);
      else if (act === 'corps') deckPickCorps(v);
      else if (act === 'division') deckPickDivision(v);
      else if (act === 'phase') deckPickPhase(v);
      else if (act === 'side') { deck.side = v; renderDeck(); }
      else if (act === 'plus') deckAdjust(dk.getAttribute('data-k'), 1);
      else if (act === 'minus') deckAdjust(dk.getAttribute('data-k'), -1);
      else if (act === 'clear') deckClear();
      else if (act === 'export') deckExport();
      else if (act === 'import') { const inp = mount.querySelector('#dk-file'); if (inp) inp.click(); }
      return;
    }

    if (e.target.closest && e.target.closest('[data-dk-open]')) { openDeck(); return; }

    if (t.getAttribute('data-act') === 'back') { goBack(); return; }

    if (t.classList.contains('ar-desc-export')) { saveDescs(); return; }

    const country = t.getAttribute('data-country');
    if (country) { openCountry(country); return; }

    const era = t.getAttribute('data-era');
    if (era) { selectEra(era); return; }

    const cat = t.getAttribute('data-cat');
    if (cat) { selectCat(cat); return; }

    const unit = t.getAttribute('data-unit');
    if (unit !== null) { selectUnit(Number(unit)); }
  });

  /* ---------------- 键盘 ----------------
   * 捕获阶段接管：军械库开着时按键不漏给 home.js / app3d.js。
   * 简介输入框有焦点时不抢 1–5 和方向键。 */
  window.addEventListener('keydown', function (e) {
    if (!state.open) return;
    e.stopImmediatePropagation();

    const active = document.activeElement;
    const typing = !!active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');

    if (e.key === 'Escape') {
      e.preventDefault();
      goBack();
      return;
    }

    if (typing) return;

    if (state.view === 'list') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); return; }
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        const c = COUNTRIES[Number(e.key) - 1];
        if (c) openCountry(c.id);
      }
      return;
    }

    // 工作台里：↑↓ 换单位，←→ 换兵种
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const units = unitsOf(state.country, state.era, state.cat);
      if (!units.length) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      selectUnit((state.unit + dir + units.length) % units.length);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const cats = catsFor(state.era);
      const i = cats.map(function (x) { return x.id; }).indexOf(state.cat);
      if (i < 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      selectCat(cats[(i + dir + cats.length) % cats.length].id);
    }
  }, true);

  window.addEventListener('keyup', function (e) {
    if (state.open) e.stopImmediatePropagation();
  }, true);

  /* ---------------- 菜单焦点 ---------------- */
  function cards() {
    return Array.prototype.slice.call(mount.querySelectorAll('.ar-nation'));
  }

  function focusCard(i) {
    const list = cards();
    if (!list.length) return;
    const n = ((i % list.length) + list.length) % list.length;
    focusEl(list[n]);
  }

  function moveFocus(dir) {
    const list = cards();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    focusCard(i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir);
  }

  /* ---------------- 对外接口 ---------------- */
  window.Armory = {
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    countries: COUNTRIES,
    country: function (id) { return BY_ID[id] || null; },
    eras: ERAS,
    categories: catsFor,
    units: function (country, era, cat) { return unitsOf(country, era, cat); },
    descriptions: loadDescs,
    /* armory-desc.js 加载完 / 换过文件之后调一下，把当前单位的简介刷出来 */
    refreshDesc: function () {
      if (!state.open || state.view !== 'country') return;
      const ta = mount.querySelector('#ar-desc');
      const u = currentUnit();
      if (!ta || !u) return;
      if (document.activeElement === ta) return;   // 别覆盖正在写的
      ta.value = loadDescs()[unitKeyOf(u)] || '';
      setDescStatus(ta.value ? ta.value.length + ' 字 · 改完记得保存' : '还没有简介');
    },
  };
})();
