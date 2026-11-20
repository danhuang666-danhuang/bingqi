/*
 * hexgrid.js —— 六边形网格坐标工具
 *
 * 与实体模型一致的设定：
 *   尖顶六边形（顶点朝上/下），外接圆半径 R = 1cm，平边左右两侧。
 *   使用「偏移坐标」存储地图：列 col、行 row，奇数行整体右移半格（odd-r）。
 *
 * 该文件只做纯数学，不依赖 DOM，可在浏览器与 Node 下复用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HexGrid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SQRT3 = Math.sqrt(3);

  /* 六个方向（轴坐标增量），下标与 EDGE_DEG 一一对应，用于「道路/铁路/河流」连接相邻格 */
  const DIRS = [
    [1, 0],   // 0: E  右
    [0, 1],   // 1: SE 右下
    [-1, 1],  // 2: SW 左下
    [-1, 0],  // 3: W  左
    [0, -1],  // 4: NW 左上
    [1, -1],  // 5: NE 右上
  ];

  /* 各方向「边中点」相对格心的角度（度，画布坐标 y 轴向下） */
  const EDGE_DEG = [0, 60, 120, 180, 240, 300];

  /* 偏移坐标 → 轴坐标 */
  function toAxial(col, row) {
    return [col - ((row - (row & 1)) >> 1), row];
  }

  /* 轴坐标 → 偏移坐标 */
  function toOffset(q, r) {
    return [q + ((r - (r & 1)) >> 1), r];
  }

  /* 格子中心的世界坐标（世界单位 = cm，R 为外接圆半径） */
  function center(col, row, R) {
    return [R * SQRT3 * (col + (row & 1) / 2), R * 1.5 * row];
  }

  /* 世界坐标 → 格子（返回 [col, row]，可能超出地图范围，由调用方判断） */
  function pixelToCell(x, y, R) {
    const fq = (SQRT3 / 3 * x - y / 3) / R;
    const fr = (2 / 3 * y) / R;
    // 立方坐标取整
    let cx = fq, cz = fr, cy = -fq - fr;
    let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return toOffset(rx, rz);
  }

  /* 相邻格坐标列表（顺序与 EDGE_DEG 一致） */
  function neighbors(col, row) {
    const a = toAxial(col, row);
    return DIRS.map(function (d) { return toOffset(a[0] + d[0], a[1] + d[1]); });
  }

  /* 六边形顶点（尖顶朝上：顶点位于 30° + 60°k） */
  function corners(cx, cy, R) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (30 + 60 * i) * Math.PI / 180;
      out.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    return out;
  }

  /* 整张地图的外接像素尺寸 */
  function mapPixelSize(cols, rows, R) {
    return [R * SQRT3 * (cols + 0.5), R * (1.5 * rows + 0.5)];
  }

  /* 整张地图在世界坐标中的包围盒（格 (0,0) 的中心为原点） */
  function mapBounds(cols, rows, R) {
    return {
      minX: -R * SQRT3 / 2,
      minY: -R,
      w: R * SQRT3 * (cols + 0.5),
      h: R * (1.5 * rows + 0.5),
    };
  }

  return {
    SQRT3: SQRT3,
    DIRS: DIRS,
    EDGE_DEG: EDGE_DEG,
    toAxial: toAxial,
    toOffset: toOffset,
    center: center,
    pixelToCell: pixelToCell,
    neighbors: neighbors,
    corners: corners,
    mapPixelSize: mapPixelSize,
    mapBounds: mapBounds,
  };
});
