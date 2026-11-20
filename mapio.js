/* =============================================================
 * mapio.js —— 地图存档的读写与版本兼容
 *
 * 存档格式（当前 v3）：
 *   {
 *     "format": "bingqi-map",
 *     "version": 3,
 *     "mode": "attack" | "contest",
 *     "cols": 12, "rows": 9,
 *     "terrains": ["plain", "road", ...],   // 写文件时地形表的顺序
 *     "cells": [0, 0, 3, ...],              // 行优先，数字是 terrains 里的下标
 *     "rules": { "city": { move, moveMech, protect, blocksSight, urban, riverReset, chaos } },
 *     "grid":  { "move": [...], "moveMech": [...], "protect": [...] },  // 逐格属性，与 cells 同序
 *     "deploy": { "spawn": [c,r], "hqA": [c,r], "hqD": [c,r], "zone": [[c,r], ...] },
 *     "phases": { "a": 1, "b": 4, "c": 9 }   // 阶段开始的大回合；b/c 为 null 表示没有该阶段
 *   }
 *
 * 阶段规则：第 1 大回合固定是 A 阶段；B、C 的开始回合由每张地图单独设置。
 *   b 必须 ≥ 2，c 必须 > b；不合法会被纠正（见 normalizePhases）。
 *   这是可选字段，老地图没有 phases 时按「只有 A 阶段」处理。
 *
 * 坐标约定（地图编辑器、小程序、线上对战都必须一致）：
 *   [列, 行] 都从 0 开始；列 0 在最左，行 0 在最下 —— 也就是**左下角为原点**，
 *   列号向右增大、行号向上增大。默认视角就是按这个方向摆的，
 *   所以 [0, 4] 会出现在左下角，[cols-1, rows-1] 出现在右上角。
 *
 * 兼容原则（以后改版请遵守）：
 *   1. 只新增字段，不改名/不删除 cols、rows、cells、terrains。旧程序读到多余字段会忽略。
 *   2. cells 里的数字一律先经「文件自带的 terrains 列表」翻译成 id，再映射到当前版本。
 *      —— 这样即使以后往地形表中间插一条、或调整顺序，旧地图也不会错位。
 *   3. 地形被删掉时，在 ALIASES 里写一条「旧 id → 新 id」，老地图照旧打开；
 *      没有别名且当前版本也没有该 id 时，退回平原并给出提示，不会报错。
 *   4. 新增地形请追加到 terrain.js 末尾，不要插在中间（有第 2 条兜底，但追加最省事）。
 * ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapIO = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'bingqi-map';
  const VERSION = 3;              // v3 起有 rules / grid 格子属性（v1、v2 文件照常读）
  const MAX_DIM = 400;            // 单边格数上限（宽松，避免以后放大尺寸读不进来）

  /* 旧地形 id → 新 id。目前没有删改过地形，留空即可。
   * 例：以后把「铁路」并入「道路」时写 { rail: 'road' }。 */
  const ALIASES = {};

  function resolveId(id, tIndex) {
    let cur = String(id);
    for (let i = 0; i < 8 && ALIASES[cur]; i++) cur = ALIASES[cur];
    if (tIndex[cur] != null) return { index: tIndex[cur], missing: false };
    return { index: null, missing: true };
  }

  function clampDim(v) {
    const n = Math.floor(Number(v));
    if (!isFinite(n) || n < 1) return 0;
    return Math.min(MAX_DIM, n);
  }

  /* ---------- 部署标记 ---------- */

  const MODE_IDS = { attack: 1, contest: 1 };

  function point(v, cols, rows) {
    if (!Array.isArray(v) || v.length < 2) return null;
    const c = Math.floor(Number(v[0])), r = Math.floor(Number(v[1]));
    if (!isFinite(c) || !isFinite(r) || c < 0 || r < 0 || c >= cols || r >= rows) return null;
    return { c: c, r: r };
  }

  function serializeDeploy(d, cols) {
    if (!d) return null;
    const out = {
      spawn: d.spawn ? [d.spawn.c, d.spawn.r] : null,
      hqA: d.hqA ? [d.hqA.c, d.hqA.r] : null,
      hqD: d.hqD ? [d.hqD.c, d.hqD.r] : null,
      zone: [],
    };
    if (d.zone && d.zone.size) {
      const pts = [];
      d.zone.forEach(function (idx) { pts.push([idx % cols, Math.floor(idx / cols)]); });
      pts.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
      out.zone = pts;
    }
    return out;
  }

  function parseDeploy(raw, cols, rows, warnings) {
    const d = { spawn: null, hqA: null, hqD: null, zone: new Set() };
    if (!raw || typeof raw !== 'object') return d;

    d.spawn = point(raw.spawn, cols, rows);
    d.hqA = point(raw.hqA, cols, rows);
    d.hqD = point(raw.hqD, cols, rows);

    let dropped = 0;
    if (Array.isArray(raw.zone)) {
      raw.zone.forEach(function (v) {
        const p = point(v, cols, rows);
        if (p) d.zone.add(p.r * cols + p.c); else dropped++;
      });
    }
    if (dropped) warnings.push('部署区有 ' + dropped + ' 格超出地图范围，已忽略');
    return d;
  }

  /* ---------- 格子属性 ---------- */

  function ruleOf(t) {
    const r = t.rule || {};
    return {
      move: typeof r.move === 'number' ? r.move : 1,
      moveMech: typeof r.moveMech === 'number' ? r.moveMech : (typeof r.move === 'number' ? r.move : 1),
      protect: typeof r.protect === 'number' ? r.protect : 0,
      blocksSight: !!r.blocksSight,
      urban: !!r.urban,
      riverReset: !!r.riverReset,
      chaos: typeof r.chaos === 'number' ? r.chaos : 0,
    };
  }

  /* 地形 → 属性表（写进文件，方便别的程序读懂，也方便人肉查看） */
  function ruleTable(terrains) {
    const out = {};
    terrains.forEach(function (t) { out[t.id] = ruleOf(t); });
    return out;
  }

  /* 逐格解析属性：和 cells 同序、行优先 */
  function cellGrid(cells, terrains) {
    const n = cells.length;
    const move = new Array(n);
    const moveMech = new Array(n);
    const protect = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = ruleOf(terrains[cells[i]] || terrains[0]);
      move[i] = r.move;
      moveMech[i] = r.moveMech;
      protect[i] = r.protect;
    }
    return { move: move, moveMech: moveMech, protect: protect };
  }

  function sameGrid(a, b) {
    if (!b || !Array.isArray(b.move) || !Array.isArray(b.protect)) return false;
    const n = a.move.length;
    if (b.move.length !== n || b.protect.length !== n) return false;
    for (let i = 0; i < n; i++) {
      if (a.move[i] !== b.move[i]) return false;
      if (a.protect[i] !== b.protect[i]) return false;
      if (Array.isArray(b.moveMech) && b.moveMech.length === n && a.moveMech[i] !== b.moveMech[i]) return false;
    }
    return true;
  }

  /* ---------- 写出 ---------- */
  /* ---------- 阶段（A / B / C） ----------
   * 规则：第 1 大回合固定是 A 阶段开始；B、C 的开始回合由地图单独设置。
   * 数据结构：{ a: 1, b: 4|null, c: 9|null }，null = 这张图没有该阶段。
   * 这是可选字段：老地图没有 phases 时按 {a:1,b:null,c:null} 处理。 */

  const DEFAULT_PHASES = { a: 1, b: null, c: null };
  const MAX_ROUND = 99;

  function toRound(v, min) {
    const n = Math.floor(Number(v));
    if (!isFinite(n)) return null;
    if (n < min || n > MAX_ROUND) return null;
    return n;
  }

  /* 规整成合法配置：A 恒为 1；B ≥ 2；C ≥ B+1；C 存在时 B 必须存在 */
  function normalizePhases(p) {
    const out = { a: 1, b: null, c: null };
    if (!p || typeof p !== 'object') return out;
    const b = toRound(p.b, 2);
    if (b != null) {
      out.b = b;
      const c = toRound(p.c, b + 1);
      if (c != null) out.c = c;
    } else if (p.c != null) {
      // 只给了 C 没给 B：B 退到 2；但 C 自己也必须是合法值，否则整组丢掉
      const c = toRound(p.c, 3);
      if (c != null) {
        out.b = 2;
        out.c = c;
      }
    }
    return out;
  }

  /* 第 round 大回合属于哪个阶段；返回 'a' | 'b' | 'c' */
  function phaseOfRound(p, round) {
    const ph = normalizePhases(p);
    const n = Math.max(1, Math.floor(Number(round) || 1));
    if (ph.c != null && n >= ph.c) return 'c';
    if (ph.b != null && n >= ph.b) return 'b';
    return 'a';
  }

  function serializePhases(p) {
    const ph = normalizePhases(p);
    return { a: 1, b: ph.b, c: ph.c };
  }

  /* ---------- 写出 ---------- */
  function serialize(map, terrains) {
    const mode = MODE_IDS[map.mode] ? map.mode : 'attack';
    const out = {
      format: FORMAT,
      version: VERSION,
      app: 'bingqi-map-editor',
      savedAt: new Date().toISOString(),
      cols: map.cols,
      rows: map.rows,
      mode: mode,
      terrains: terrains.map(function (t) { return t.id; }),
      cells: Array.from(map.cells),
      rules: ruleTable(terrains),
      grid: cellGrid(map.cells, terrains),
      phases: serializePhases(map.phases),
    };
    if (mode === 'attack') {
      const dep = serializeDeploy(map.deploy, map.cols);
      if (dep) out.deploy = dep;
    }
    return out;
  }

  /* ---------- 读入 ----------
   * 返回 { cols, rows, cells: Uint8Array, warnings: string[] }
   * 只有真正无法处理的情况才抛错（结构损坏、格子数量对不上）。
   */
  function parse(raw, terrains, tIndex) {
    const warnings = [];
    if (!raw || typeof raw !== 'object') throw new Error('文件内容不是有效的 JSON 对象');

    if (raw.format == null) {
      warnings.push('文件缺少 format 标记，按地图文件处理');
    } else if (raw.format !== FORMAT) {
      throw new Error('这不是兵棋地图文件（format = ' + raw.format + '）');
    }

    const ver = Number(raw.version) || 1;
    if (ver > VERSION) {
      warnings.push('文件是 v' + ver + '（本程序 v' + VERSION + '），新增的内容可能读不到');
    }

    const cols = clampDim(raw.cols);
    const rows = clampDim(raw.rows);
    if (!cols || !rows) throw new Error('缺少或非法的地图尺寸（cols / rows）');
    if (!Array.isArray(raw.cells)) throw new Error('缺少 cells 格子数据');
    if (raw.cells.length !== cols * rows) {
      throw new Error('格子数量与尺寸不匹配：' + raw.cells.length + ' 个格子，但 ' +
        cols + ' × ' + rows + ' = ' + (cols * rows));
    }

    // 文件自带的地形顺序；没有就退回「按当前顺序解释」
    const fileTerrains = Array.isArray(raw.terrains)
      ? raw.terrains.map(function (x) { return String(x); })
      : null;
    if (!fileTerrains) warnings.push('文件未记录地形表，按当前顺序解释数字');

    const plainIndex = tIndex.plain != null ? tIndex.plain : 0;
    const cells = new Uint8Array(cols * rows);
    const missing = Object.create(null);
    let missingCount = 0;

    for (let i = 0; i < cells.length; i++) {
      const v = raw.cells[i];
      let id = null;

      if (typeof v === 'number') {
        if (!isFinite(v) || v < 0 || Math.floor(v) !== v) { id = null; }
        else if (fileTerrains) { id = fileTerrains[v] != null ? fileTerrains[v] : null; }
        else { id = terrains[v] ? terrains[v].id : null; }
      } else if (typeof v === 'string') {
        id = v;
      }

      if (id == null) {
        cells[i] = plainIndex;
        missingCount++;
        missing['(空)'] = (missing['(空)'] || 0) + 1;
        continue;
      }

      const r = resolveId(id, tIndex);
      if (r.missing) {
        cells[i] = plainIndex;
        missingCount++;
        missing[id] = (missing[id] || 0) + 1;
      } else {
        cells[i] = r.index;
      }
    }

    if (missingCount) {
      const detail = Object.keys(missing).map(function (id) {
        const t = terrains.filter(function (x) { return x.id === id; })[0];
        return (t ? t.name : '「' + id + '」') + ' × ' + missing[id];
      }).join('、');
      warnings.push('有 ' + missingCount + ' 格的地形在当前版本不存在，已按平原打开：' + detail);
    }

    const mode = raw.mode === 'contest' ? 'contest' : 'attack';
    if (raw.mode != null && mode !== raw.mode) {
      warnings.push('文件里的模式「' + raw.mode + '」不认识，按攻防战打开');
    }
    const deploy = parseDeploy(raw.deploy, cols, rows, warnings);

    /* 阶段：缺省 = A 从第 1 回合开始，没有 B/C */
    const phases = normalizePhases(raw.phases);
    if (raw.phases && typeof raw.phases === 'object') {
      const wantB = raw.phases.b, wantC = raw.phases.c;
      if ((wantB != null && phases.b !== wantB) || (wantC != null && phases.c !== wantC)) {
        warnings.push('阶段起始回合不合法，已按 A=1 / B≥2 / C>B 修正');
      }
    }

    /* 格子属性：始终以 cells 里的地形为准重算。
     * 文件自带的 grid 只做校验——手改过 cells 却没重算属性时，这里会提示。 */
    const grid = cellGrid(cells, terrains);
    if (raw.grid && !sameGrid(grid, raw.grid)) {
      warnings.push('文件里的格子属性与地形对不上，已按地形重新计算');
    }

    return {
      cols: cols, rows: rows, cells: cells, mode: mode, deploy: deploy,
      phases: phases,
      grid: grid, rules: ruleTable(terrains), warnings: warnings,
    };
  }

  /* ---------- 浏览器本地存档 ---------- */
  const SAVE_KEY = 'bingqi-map-editor:v1';

  function saveLocal(map, terrains) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(map, terrains)));
      return true;
    } catch (e) {
      return false;   // 隐私模式 / 配额满
    }
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearLocal() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  return {
    FORMAT: FORMAT,
    VERSION: VERSION,
    MAX_DIM: MAX_DIM,
    SAVE_KEY: SAVE_KEY,
    serialize: serialize,
    parse: parse,
    DEFAULT_PHASES: DEFAULT_PHASES,
    normalizePhases: normalizePhases,
    phaseOfRound: phaseOfRound,
    ruleTable: ruleTable,
    cellGrid: cellGrid,
    ruleOf: ruleOf,
    saveLocal: saveLocal,
    readLocal: readLocal,
    clearLocal: clearLocal,
  };
});
