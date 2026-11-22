/* =============================================================
 * markers.js —— 地图模式与「部署标记」的公共定义
 *
 * 攻防战：
 *   - 进攻方出生点：一个格子。对战时单位必须从它开始，一圈一圈往外放，不能跳格。
 *   - 进攻方 / 防守方指挥部：各一个格子。
 *   - 防守方部署区：一片格子（刷出来），防守方在这片范围内放单位。
 *   这些标记只在编辑和「单位部署阶段」出现，正式交战时不显示。
 *
 * 争夺战：规则未定，暂时没有特殊标记，只把模式记进地图。
 * ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Markers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODES = [
    { id: 'attack', name: '攻防战', desc: '攻守双方非对称：进攻方从出生点逐环展开，防守方在部署区内布防。' },
    { id: 'contest', name: '争夺战', desc: '双方争夺关键点位，相对公平；特殊标记规则未定，先只记地形与模式。' },
  ];

  /* 部署工具。kind：cell = 单格标记，zone = 区域涂刷，air = 只能放在地图边缘的单格标记 */
  const TOOLS = [
    { id: 'spawn', name: '进攻方出生点', short: '出生点', kind: 'cell', color: '#e0573f', shape: 'pennant' },
    { id: 'airA', name: '进攻方飞机进场点', short: '进攻飞机', kind: 'air', color: '#e0573f', shape: 'air' },
    { id: 'airD', name: '防守方飞机进场点', short: '防守飞机', kind: 'air', color: '#4a86e0', shape: 'air' },
    { id: 'zone', name: '防守方部署区', short: '部署区', kind: 'zone', color: '#4a86e0', shape: 'zone' },
    { id: 'zoneErase', name: '擦除部署区', short: '擦除', kind: 'zoneErase', color: '#8d97a5', shape: 'erase' },
  ];

  /* 建筑：场景里可破坏的东西。现在只有指挥所（从部署页挪过来）和通用建筑，
   * 等模型做好之后把 shape 换成模型即可。一格最多一个建筑。 */
  const BUILDINGS = [
    { id: 'hqA', name: '进攻方指挥所', short: '攻指', color: '#e0a458', model: 'hq', shape: 'plate', glyph: 'hq', unique: true },
    { id: 'hqD', name: '防守方指挥所', short: '守指', color: '#4a86e0', model: 'hq', shape: 'plate', glyph: 'hq', unique: true },
    { id: 'bunker', name: '碉堡', short: '碉堡', color: '#8d97a5', model: 'bunker', shape: 'plate', glyph: 'bunker' },
    { id: 'trench', name: '战壕', short: '战壕', color: '#a08565', model: 'trench', shape: 'plate', glyph: 'trench' },
    { id: 'bridge', name: '桥', short: '桥', color: '#c8a469', model: 'bridge', shape: 'plate', glyph: 'bridge' },
    { id: 'road', name: '道路', short: '道路', color: '#9c9891', model: 'road', shape: 'plate', glyph: 'road' },
    { id: 'base', name: '基座', short: '基座', color: '#b9b2a5', model: 'base', shape: 'plate', glyph: 'base' },
  ];
  const BUILDING_BY_ID = {};
  BUILDINGS.forEach(function (b) { BUILDING_BY_ID[b.id] = b; });
  const BUILDING_IDS = BUILDINGS.map(function (b) { return b.id; });

  const TOOL_BY_ID = {};
  TOOLS.forEach(function (t) { TOOL_BY_ID[t.id] = t; });

  const ZONE_COLOR = '#4a86e0';

  function createDeploy() {
    return { spawn: null, hqA: null, hqD: null, zone: new Set(), airA: [], airD: [], buildings: [] };
  }

  function cloneDeploy(d) {
    if (!d) return createDeploy();
    return {
      spawn: d.spawn ? { c: d.spawn.c, r: d.spawn.r } : null,
      hqA: d.hqA ? { c: d.hqA.c, r: d.hqA.r } : null,
      hqD: d.hqD ? { c: d.hqD.c, r: d.hqD.r } : null,
      zone: new Set(d.zone),
      airA: (d.airA || []).map(function (p) { return { c: p.c, r: p.r }; }),
      airD: (d.airD || []).map(function (p) { return { c: p.c, r: p.r }; }),
      buildings: cloneBuildings(d.buildings),
    };
  }

  function isEmpty(d) {
    return !!d && !d.spawn && !d.hqA && !d.hqD && d.zone.size === 0 &&
      (!d.airA || !d.airA.length) && (!d.airD || !d.airD.length);
  }

  function sameCell(p, c, r) { return !!p && p.c === c && p.r === r; }

  function airList(d, toolId) {
    if (toolId === 'airA') return d.airA || (d.airA = []);
    if (toolId === 'airD') return d.airD || (d.airD = []);
    return null;
  }

  function hasAir(d, toolId, c, r) {
    const list = airList(d, toolId);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) if (list[i].c === c && list[i].r === r) return true;
    return false;
  }

  function cellTool(d, c, r, cols) {
    if (!d) return null;
    if (sameCell(d.spawn, c, r)) return 'spawn';
    if (sameCell(d.hqA, c, r)) return 'hqA';
    if (sameCell(d.hqD, c, r)) return 'hqD';
    if (hasAir(d, 'airA', c, r)) return 'airA';
    if (hasAir(d, 'airD', c, r)) return 'airD';
    if (d.zone.has(r * cols + c)) return 'zone';
    return null;
  }

  /* 应用某个工具到格子；返回是否有变化 */
  function applyTool(d, toolId, c, r, cols) {
    const idx = r * cols + c;
    if (toolId === 'spawn') {
      if (sameCell(d.spawn, c, r)) return false;
      d.spawn = { c: c, r: r };
      return true;
    }
    if (toolId === 'hqA') {
      if (sameCell(d.hqA, c, r)) return false;
      d.hqA = { c: c, r: r };
      return true;
    }
    if (toolId === 'hqD') {
      if (sameCell(d.hqD, c, r)) return false;
      d.hqD = { c: c, r: r };
      return true;
    }
    if (toolId === 'zone') {
      if (d.zone.has(idx)) return false;
      d.zone.add(idx);
      return true;
    }
    if (toolId === 'zoneErase') {
      if (!d.zone.has(idx)) return false;
      d.zone.delete(idx);
      return true;
    }
    if (toolId === 'airA' || toolId === 'airD') {
      const list = airList(d, toolId);
      if (hasAir(d, toolId, c, r)) return false;
      list.push({ c: c, r: r });
      return true;
    }
    return false;
  }

  /* ---------- 建筑 ---------- */
  function buildingAt(list, c, r) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].c === c && list[i].r === r) return list[i];
    }
    return null;
  }

  /* 放/换一个建筑；同一格只能一个。unique 类型（指挥所）全图只能一个。
   * 返回 'added' | 'replaced' | 'same' | 'unique-taken' */
  function applyBuilding(list, typeId, c, r) {
    if (!BUILDING_BY_ID[typeId]) return 'same';
    const cur = buildingAt(list, c, r);
    if (cur && cur.t === typeId) return 'same';
    const def = BUILDING_BY_ID[typeId];
    if (def.unique) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].t === typeId && !(list[i].c === c && list[i].r === r)) return 'unique-taken';
      }
    }
    if (cur) { cur.t = typeId; return 'replaced'; }
    list.push({ c: c, r: r, t: typeId });
    return 'added';
  }

  function removeBuildingAt(list, c, r) {
    if (!list) return false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].c === c && list[i].r === r) { list.splice(i, 1); return true; }
    }
    return false;
  }

  function cloneBuildings(list) {
    if (!list) return [];
    return list.map(function (b) { return { c: b.c, r: b.r, t: b.t }; });
  }

  /* 右键擦除：把该格上的任何部署标记去掉 */
  function removeAt(d, c, r, cols) {
    let changed = false;
    if (sameCell(d.spawn, c, r)) { d.spawn = null; changed = true; }
    if (sameCell(d.hqA, c, r)) { d.hqA = null; changed = true; }
    if (sameCell(d.hqD, c, r)) { d.hqD = null; changed = true; }
    if (d.zone.delete(r * cols + c)) changed = true;
    if (removeBuildingAt(d.buildings, c, r)) changed = true;
    ['airA', 'airD'].forEach(function (key) {
      const list = d[key];
      if (!list || !list.length) return;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].c === c && list[i].r === r) { list.splice(i, 1); changed = true; }
      }
    });
    return changed;
  }

  /* ---------------- 调色板图标（2D 画布） ---------------- */
  function star(g, cx, cy, r, color) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? r * 0.45 : r;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }

  function drawIcon(canvas, toolId, cols) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const t = TOOL_BY_ID[toolId] || BUILDING_BY_ID[toolId];
    g.clearRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);

    if (t && t.shape === 'plate') {
      // 六边形薄片（和地图格同形），按类型画不同花纹
      const R = W * 0.34;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (30 + 60 * i) * Math.PI / 180;
        pts.push([Math.cos(a) * R * 0.88, Math.sin(a) * R * 1.0]);
      }
      g.beginPath();
      pts.forEach(function (q, k) {
        if (k === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
      });
      g.closePath();
      g.fillStyle = t.color;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.2;
      g.stroke();

      g.strokeStyle = 'rgba(24,28,34,0.75)';
      g.fillStyle = 'rgba(24,28,34,0.75)';
      g.lineWidth = Math.max(1.4, W * 0.035);
      g.lineCap = 'round';
      const r2 = W * 0.2;
      if (t.glyph === 'hq') {
        // 小旗
        g.beginPath();
        g.moveTo(-r2 * 0.2, r2 * 0.7);
        g.lineTo(-r2 * 0.2, -r2 * 0.8);
        g.stroke();
        g.beginPath();
        g.moveTo(-r2 * 0.2, -r2 * 0.8);
        g.lineTo(r2 * 0.9, -r2 * 0.35);
        g.lineTo(-r2 * 0.2, r2 * 0.1);
        g.closePath();
        g.fill();
      } else if (t.glyph === 'bunker') {
        g.beginPath();
        g.moveTo(-r2, r2 * 0.5);
        g.lineTo(-r2 * 0.5, -r2 * 0.6);
        g.lineTo(r2 * 0.5, -r2 * 0.6);
        g.lineTo(r2, r2 * 0.5);
        g.stroke();
        g.fillRect(-r2 * 0.55, 0, r2 * 1.1, r2 * 0.22);
      } else if (t.glyph === 'trench') {
        g.beginPath();
        g.moveTo(-r2, r2 * 0.4);
        g.lineTo(-r2 * 0.2, -r2 * 0.5);
        g.lineTo(r2 * 0.2, r2 * 0.4);
        g.lineTo(r2, -r2 * 0.5);
        g.stroke();
      } else if (t.glyph === 'bridge') {
        g.beginPath();
        g.moveTo(-r2, -r2 * 0.2);
        g.lineTo(r2, -r2 * 0.2);
        g.moveTo(-r2, r2 * 0.35);
        g.lineTo(r2, r2 * 0.35);
        g.stroke();
        g.beginPath();
        g.moveTo(-r2 * 0.6, -r2 * 0.2);
        g.lineTo(-r2 * 0.6, r2 * 0.35);
        g.moveTo(0, -r2 * 0.2);
        g.lineTo(0, r2 * 0.35);
        g.moveTo(r2 * 0.6, -r2 * 0.2);
        g.lineTo(r2 * 0.6, r2 * 0.35);
        g.stroke();
      } else if (t.glyph === 'road') {
        g.setLineDash([W * 0.06, W * 0.05]);
        g.beginPath();
        g.moveTo(-r2, 0);
        g.lineTo(r2, 0);
        g.stroke();
        g.setLineDash([]);
      } else {
        // 基座：中间一个浅色六边形
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (30 + 60 * i) * Math.PI / 180;
          const x = Math.cos(a) * r2 * 0.55, y = Math.sin(a) * r2 * 0.55;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
      g.restore();
      return;
    }

    if (t && t.shape === 'block') {
      // 一栋带屋顶的小楼，表示可破坏建筑
      const w = W * 0.46, h = H * 0.40;
      g.fillStyle = t.color;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.rect(-w / 2, -h * 0.1, w, h);
      g.fill();
      g.stroke();
      // 屋顶
      g.beginPath();
      g.moveTo(-w / 2 - 3, -h * 0.1);
      g.lineTo(0, -h * 0.62);
      g.lineTo(w / 2 + 3, -h * 0.1);
      g.closePath();
      g.fillStyle = '#6b737d';
      g.fill();
      g.stroke();
      // 窗
      g.fillStyle = 'rgba(20,24,30,0.55)';
      const bw = w * 0.18, bh = h * 0.18;
      [[-w * 0.26, h * 0.12], [w * 0.08, h * 0.12]].forEach(function (p2) {
        g.fillRect(p2[0], p2[1], bw, bh);
      });
      g.restore();
      return;
    }

    if (t && t.kind === 'air') {
      // 飞机图标 + 一个指向地图内的箭头
      const color = t.color;
      const s = W * 0.30;
      g.fillStyle = color;
      g.beginPath();
      // 机身
      g.moveTo(0, -s * 0.95);
      g.lineTo(s * 0.26, -s * 0.1);
      g.lineTo(s * 0.95, s * 0.28);
      g.lineTo(s * 0.95, s * 0.5);
      g.lineTo(s * 0.22, s * 0.34);
      g.lineTo(s * 0.3, s * 0.86);
      g.lineTo(s * 0.5, s * 1.02);
      g.lineTo(s * 0.5, s * 1.2);
      g.lineTo(0, s * 1.08);
      g.lineTo(-s * 0.5, s * 1.2);
      g.lineTo(-s * 0.5, s * 1.02);
      g.lineTo(-s * 0.3, s * 0.86);
      g.lineTo(-s * 0.22, s * 0.34);
      g.lineTo(-s * 0.95, s * 0.5);
      g.lineTo(-s * 0.95, s * 0.28);
      g.lineTo(-s * 0.26, -s * 0.1);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1;
      g.stroke();
      // 右下角的进场箭头
      g.strokeStyle = color;
      g.lineWidth = Math.max(1.6, W * 0.05);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-W * 0.34, H * 0.36);
      g.lineTo(W * 0.30, H * 0.36);
      g.moveTo(W * 0.14, H * 0.26);
      g.lineTo(W * 0.30, H * 0.36);
      g.lineTo(W * 0.14, H * 0.46);
      g.stroke();
      g.restore();
      return;
    }

    if (toolId === 'zone' || toolId === 'zoneErase') {
      // 三个小六边形表示区域
      const R = W * 0.20;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (30 + 60 * i) * Math.PI / 180;
        pts.push([Math.cos(a) * R, Math.sin(a) * R]);
      }
      const cells = [[-R * 1.55, -R * 0.45], [0, -R * 0.45], [-R * 0.78, R * 0.9]];
      cells.forEach(function (p, i) {
        g.beginPath();
        pts.forEach(function (q, k) {
          const x = p[0] + q[0], y = p[1] + q[1];
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.closePath();
        if (toolId === 'zone') {
          g.fillStyle = i === 2 ? 'rgba(74,134,224,0.55)' : 'rgba(74,134,224,0.35)';
          g.fill();
          g.strokeStyle = 'rgba(74,134,224,0.95)';
          g.lineWidth = 1.4;
          g.stroke();
        } else {
          g.fillStyle = 'rgba(141,151,165,0.12)';
          g.fill();
          g.strokeStyle = 'rgba(141,151,165,0.9)';
          g.lineWidth = 1.2;
          g.setLineDash([3, 3]);
          g.stroke();
          g.setLineDash([]);
        }
      });
      if (toolId === 'zoneErase') {
        g.strokeStyle = '#e0573f';
        g.lineWidth = 2.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-W * 0.20, -W * 0.20);
        g.lineTo(W * 0.20, W * 0.20);
        g.moveTo(W * 0.20, -W * 0.20);
        g.lineTo(-W * 0.20, W * 0.20);
        g.stroke();
      }
      g.restore();
      return;
    }

    // 旗杆
    const poleX = -W * 0.12;
    const poleTop = -H * 0.34;
    const poleBottom = H * 0.34;
    g.strokeStyle = '#4a515c';
    g.lineWidth = Math.max(1.2, W * 0.035);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(poleX, poleBottom);
    g.lineTo(poleX, poleTop);
    g.stroke();

    const color = t ? t.color : '#888';
    if (t && t.shape === 'hq') {
      const fw = W * 0.44, fh = H * 0.30;
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.rect(poleX, poleTop, fw, fh);
      g.fill();
      g.stroke();
      star(g, poleX + fw / 2, poleTop + fh / 2, fh * 0.34, 'rgba(255,255,255,0.92)');
    } else {
      const fw = W * 0.46, fh = H * 0.34;
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(poleX, poleTop);
      g.lineTo(poleX + fw, poleTop + fh * 0.5);
      g.lineTo(poleX, poleTop + fh);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // 底座
    g.fillStyle = '#4a515c';
    g.beginPath();
    g.ellipse(poleX, poleBottom, W * 0.10, H * 0.045, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  return {
    MODES: MODES,
    TOOLS: TOOLS,
    BUILDINGS: BUILDINGS,
    BUILDING_BY_ID: BUILDING_BY_ID,
    BUILDING_IDS: BUILDING_IDS,
    buildingAt: buildingAt,
    applyBuilding: applyBuilding,
    removeBuildingAt: removeBuildingAt,
    cloneBuildings: cloneBuildings,
    TOOL_BY_ID: TOOL_BY_ID,
    ZONE_COLOR: ZONE_COLOR,
    createDeploy: createDeploy,
    cloneDeploy: cloneDeploy,
    isEmpty: isEmpty,
    cellTool: cellTool,
    applyTool: applyTool,
    removeAt: removeAt,
    drawIcon: drawIcon,
  };
});
