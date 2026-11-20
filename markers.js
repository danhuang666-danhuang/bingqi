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

  /* 部署工具。kind：cell = 单格标记，zone = 区域涂刷 */
  const TOOLS = [
    { id: 'spawn', name: '进攻方出生点', short: '出生点', kind: 'cell', color: '#e0573f', shape: 'pennant' },
    { id: 'hqA', name: '进攻方指挥部', short: '攻指', kind: 'cell', color: '#e0a458', shape: 'hq' },
    { id: 'hqD', name: '防守方指挥部', short: '守指', kind: 'cell', color: '#4a86e0', shape: 'hq' },
    { id: 'zone', name: '防守方部署区', short: '部署区', kind: 'zone', color: '#4a86e0', shape: 'zone' },
    { id: 'zoneErase', name: '擦除部署区', short: '擦除', kind: 'zoneErase', color: '#8d97a5', shape: 'erase' },
  ];

  const TOOL_BY_ID = {};
  TOOLS.forEach(function (t) { TOOL_BY_ID[t.id] = t; });

  const ZONE_COLOR = '#4a86e0';

  function createDeploy() {
    return { spawn: null, hqA: null, hqD: null, zone: new Set() };
  }

  function cloneDeploy(d) {
    if (!d) return createDeploy();
    return {
      spawn: d.spawn ? { c: d.spawn.c, r: d.spawn.r } : null,
      hqA: d.hqA ? { c: d.hqA.c, r: d.hqA.r } : null,
      hqD: d.hqD ? { c: d.hqD.c, r: d.hqD.r } : null,
      zone: new Set(d.zone),
    };
  }

  function isEmpty(d) {
    return !!d && !d.spawn && !d.hqA && !d.hqD && d.zone.size === 0;
  }

  function sameCell(p, c, r) { return !!p && p.c === c && p.r === r; }

  function cellTool(d, c, r, cols) {
    if (!d) return null;
    if (sameCell(d.spawn, c, r)) return 'spawn';
    if (sameCell(d.hqA, c, r)) return 'hqA';
    if (sameCell(d.hqD, c, r)) return 'hqD';
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
    return false;
  }

  /* 右键擦除：把该格上的任何部署标记去掉 */
  function removeAt(d, c, r, cols) {
    let changed = false;
    if (sameCell(d.spawn, c, r)) { d.spawn = null; changed = true; }
    if (sameCell(d.hqA, c, r)) { d.hqA = null; changed = true; }
    if (sameCell(d.hqD, c, r)) { d.hqD = null; changed = true; }
    if (d.zone.delete(r * cols + c)) changed = true;
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
    const t = TOOL_BY_ID[toolId];
    g.clearRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);

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
