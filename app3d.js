/* =============================================================
 * 兵棋地图编辑器 · 3D 视图
 * 每格用的是 地图/ 里那套 .3mf 的实体图块（models3d.js 由脚本导出，模型未改动）。
 * ============================================================= */
(function () {
  'use strict';

  const THREE = window.THREE;
  const HG = window.HexGrid;
  const TERRAINS = window.TERRAINS;
  const T_INDEX = window.T_INDEX;
  const PLAIN = T_INDEX.plain;
  const MODEL = window.BQ3D;
  const MK = window.Markers;

  const HEXR = MODEL.hexR;                 // 外接圆半径（mm）
  const ROWH = MODEL.rowHeight;            // 行距 = 1.5R
  const PITCH = MODEL.pitch;               // 列距 = √3R
  const TOP = MODEL.top;                   // 图块厚度（mm）

  /* ---------------- 状态 ---------------- */
  const state = {
    cols: 12,
    rows: 9,
    cells: null,
    current: PLAIN,
    hover: -1,
    cam: { yaw: 0, pitch: 0.86, dist: 340, tx: 0, ty: 0, tz: 0 },
    mode: 'attack',
    deploy: MK.createDeploy(),
    showMarkers: true,
    toolTab: 'terrain',
    deployTool: 'spawn',
    viewMode: 'terrain',      // terrain 地形色 / move 行动力消耗 / protect 伤害抗性
    undo: [],
    redo: [],
    pending: null,
    topView: false,
  };

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById('board');
  const paletteGrid = document.getElementById('paletteGrid');
  const statCoord = document.getElementById('stat-coord');
  const statTerrain = document.getElementById('stat-terrain');
  const statZoom = document.getElementById('stat-zoom');
  const inspBody = document.getElementById('insp-body');
  const countsBox = document.getElementById('counts');
  const fileInput = document.getElementById('file');

  /* =============================================================
   * 模型解码
   * ============================================================= */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function parseModels(b64) {
    const bytes = b64ToBytes(b64);
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
      const idxBytes = bytes.slice(o, o + tcount * 3 * ib);
      o += tcount * 3 * ib;
      const idx = wide ? new Uint32Array(idxBytes.buffer) : new Uint16Array(idxBytes.buffer);

      tiles[name] = { positions: pos, normals: nrm, indices: idx, version: version };
    }
    return tiles;
  }

  const tileData = parseModels(MODEL.data);

  function buildGeometry(td) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(td.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(td.normals, 3));
    g.setIndex(new THREE.BufferAttribute(td.indices, 1));
    // 模型的 XY 平面 → 世界的 XZ 平面（模型 z 轴朝上 → 世界 y 轴朝上）
    g.rotateX(-Math.PI / 2);
    g.computeBoundingSphere();
    return g;
  }

  const geometries = {};
  TERRAINS.forEach(function (t) {
    if (tileData[t.id]) geometries[t.id] = buildGeometry(tileData[t.id]);
  });

  /* =============================================================
   * 场景
   * ============================================================= */
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // 颜色按 sRGB 输入、线性空间做光照，再编码回 sRGB
  if (THREE.ColorManagement) {
    if ('enabled' in THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171b21);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);

  const hemi = new THREE.HemisphereLight(0xd6e4f5, 0x2a2620, 0.16);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff3e2, 0.98);
  key.position.set(120, 150, 90);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.5;
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0x9cbcff, 0.14);
  rim.position.set(-160, 70, -150);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x30363e, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.6;
  ground.receiveShadow = true;
  scene.add(ground);

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  /* 部署标记（旗子 + 部署区高亮） */
  const deployGroup = new THREE.Group();
  scene.add(deployGroup);
  const flagObjects = [];

  let hexPlateGeo = null;
  function plateGeometry() {
    if (hexPlateGeo) return hexPlateGeo;
    const pts = HG.corners(0, 0, HEXR * 0.93);
    const shape = new THREE.Shape();
    pts.forEach(function (p, i) {
      if (i === 0) shape.moveTo(p[0], p[1]); else shape.lineTo(p[0], p[1]);
    });
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    hexPlateGeo = geo;
    return geo;
  }

  let starTex = null;
  function starTexture() {
    if (starTex) return starTex;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    // 底色压暗一点、星用纯白：和材质颜色相乘后，星会明显更亮
    g.fillStyle = '#a8a8a8';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? 22 : 46;
      const x = 64 + Math.cos(a) * rr, y = 64 + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    starTex = new THREE.CanvasTexture(cv);
    starTex.encoding = THREE.sRGBEncoding;
    return starTex;
  }

  let poleMat = null;
  function getPoleMat() {
    if (!poleMat) poleMat = new THREE.MeshStandardMaterial({ color: 0x3b424b, roughness: 0.55, metalness: 0.25 });
    return poleMat;
  }

  /* kind: 'pennant' 三角旗（出生点） / 'hq' 方旗（指挥部） */
  function makeFlag(kind, color) {
    const g = new THREE.Group();
    const poleH = kind === 'hq' ? 21 : 18;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, poleH, 6), getPoleMat());
    pole.position.y = poleH / 2;
    pole.castShadow = true;
    g.add(pole);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.9, 8), getPoleMat());
    base.position.y = 0.45;
    base.castShadow = true;
    g.add(base);

    let mesh;
    if (kind === 'hq') {
      // 旗面用不受光材质，保证在各种角度都看得清
      const mat = new THREE.MeshBasicMaterial({
        map: starTexture(), color: color,
        side: THREE.DoubleSide, transparent: true,
      });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 8.2), mat);
      mesh.position.set(6.1, poleH - 5.2, 0);
    } else {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.lineTo(11.5, -4.0);
      sh.lineTo(0, -8.0);
      sh.closePath();
      const mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
      mesh.position.set(0.5, poleH - 1.0, 0);
    }
    g.add(mesh);
    return g;
  }

  function rebuildDeploy() {
    while (deployGroup.children.length) {
      const o = deployGroup.children.pop();
      if (o.material && o.material.dispose) o.material.dispose();
    }
    flagObjects.length = 0;

    const d = state.deploy;
    if (!state.showMarkers || state.mode !== 'attack') {
      needRender = true;
      return;
    }

    if (d.zone && d.zone.size) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4a86e0, transparent: true, opacity: 0.42,
        roughness: 0.55, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.InstancedMesh(plateGeometry(), mat, d.zone.size);
      let n = 0;
      d.zone.forEach(function (idx) {
        const c = idx % state.cols, r = Math.floor(idx / state.cols);
        const p = cellWorld(c, r);
        tmpMat.makeTranslation(p[0], TOP + 0.4, p[1]);
        m.setMatrixAt(n++, tmpMat);
      });
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      deployGroup.add(m);
    }

    const addFlag = function (p, kind, color) {
      if (!p) return;
      const f = makeFlag(kind, color);
      const w = cellWorld(p.c, p.r);
      f.position.set(w[0], TOP, w[1]);
      deployGroup.add(f);
      flagObjects.push(f);
    };
    addFlag(d.spawn, 'pennant', 0xe0573f);
    addFlag(d.hqA, 'hq', 0xe0a458);
    addFlag(d.hqD, 'hq', 0x4a86e0);

    needRender = true;
  }

  /* 悬停高亮（六边形描边 + 半透明填充） */
  const hexCorners = HG.corners(0, 0, HEXR);
  const hoverPts = hexCorners.map(function (p) {
    return new THREE.Vector3(p[0], TOP + 0.5, -p[1]);
  });
  const hoverLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(hoverPts),
    new THREE.LineBasicMaterial({ color: 0xffc36b, transparent: true, opacity: 0.95 })
  );
  hoverLine.visible = false;
  scene.add(hoverLine);

  const hoverShape = new THREE.Shape();
  hexCorners.forEach(function (p, i) {
    if (i === 0) hoverShape.moveTo(p[0] * 0.98, p[1] * 0.98);
    else hoverShape.lineTo(p[0] * 0.98, p[1] * 0.98);
  });
  hoverShape.closePath();
  const hoverFillGeo = new THREE.ShapeGeometry(hoverShape);
  hoverFillGeo.rotateX(-Math.PI / 2);
  const hoverFill = new THREE.Mesh(
    hoverFillGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffc36b, transparent: true, opacity: 0.22, depthWrite: false,
    })
  );
  hoverFill.position.y = TOP + 0.15;
  hoverFill.visible = false;
  scene.add(hoverFill);

  function showHover(c, r, on) {
    hoverLine.visible = on;
    hoverFill.visible = on;
    if (on) {
      const p = cellWorld(c, r);
      hoverLine.position.set(p[0], 0, p[1]);
      hoverFill.position.set(p[0], TOP + 0.15, p[1]);
    }
  }

  /* =============================================================
   * 棋盘几何
   * ============================================================= */
  let OX = 0;   // 棋盘中心平移
  let OZ = 0;

  function layout() {
    OX = -PITCH * (state.cols - 0.5) / 2;
    OZ = ROWH * (state.rows - 1) / 2;
  }

  function cellWorld(c, r) {
    const p = HG.center(c, r, HEXR);
    return [p[0] + OX, -p[1] + OZ];
  }

  let terrainMeshes = [];

  function buildBoard() {
    terrainMeshes.forEach(function (m) {
      boardGroup.remove(m);
      m.material.dispose();
    });
    terrainMeshes = [];
    layout();

    const maxCount = Math.max(1, state.cols * state.rows);
    TERRAINS.forEach(function (t) {
      const geo = geometries[t.id];
      if (!geo) return;
      const mat = new THREE.MeshStandardMaterial({
        color: state.viewMode === 'terrain' ? t.color3d : 0xffffff,
        roughness: 0.78,
        metalness: 0.02,
      });
      const m = new THREE.InstancedMesh(geo, mat, maxCount);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      boardGroup.add(m);
      terrainMeshes.push(m);
    });

    // 地面与灯光适配棋盘大小
    const bw = PITCH * (state.cols + 0.5);
    const bh = ROWH * state.rows + HEXR * 2;
    const span = Math.max(bw, bh) * 1.6;
    ground.geometry.dispose();
    ground.geometry = new THREE.PlaneGeometry(span * 2.4, span * 2.4);

    const s = Math.max(bw, bh) * 0.85;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 1600;
    key.shadow.camera.updateProjectionMatrix();
    key.position.set(s * 1.1, s * 1.9, s * 0.9);
    key.target.position.set(0, 0, 0);

    updateBoard();
    rebuildDeploy();
  }

  const tmpMat = new THREE.Matrix4();
  const tmpColor = new THREE.Color();

  /* 属性视图的配色（'move' 行动力消耗 / 'protect' 伤害抗性） */
  const HEAT_MOVE = [
    [0.5, 0x3f8f5a], [1, 0x8cc46b], [2, 0xe0b84a], [3, 0xd9603f],
  ];
  const HEAT_PROTECT = [
    [0, 0xc9d2cf], [0.2, 0x9fc4de], [0.3, 0x6d9fd0], [0.4, 0x4a76bb], [0.5, 0x2b4f92],
  ];

  function heatHex(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const t = (v - a[0]) / (b[0] - a[0] || 1);
        tmpColor.setHex(a[1]);
        const ca = tmpColor.clone();
        tmpColor.setHex(b[1]);
        ca.lerp(tmpColor, t);
        return ca.getHex();
      }
    }
    return stops[stops.length - 1][1];
  }

  function cellMove(c, r) {
    return TERRAINS[state.cells[r * state.cols + c]].rule.move;
  }
  function cellProtect(c, r) {
    return TERRAINS[state.cells[r * state.cols + c]].rule.protect;
  }

  function updateBoard() {
    const counts = new Array(TERRAINS.length).fill(0);
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const tid = state.cells[r * state.cols + c];
        const m = terrainMeshes[tid];
        if (!m) continue;
        const n = counts[tid]++;
        const p = cellWorld(c, r);
        tmpMat.makeTranslation(p[0], 0, p[1]);
        m.setMatrixAt(n, tmpMat);

        if (state.viewMode === 'terrain') {
          tmpColor.setHex(0xffffff);
        } else if (state.viewMode === 'move') {
          tmpColor.setHex(heatHex(HEAT_MOVE, cellMove(c, r)));
        } else {
          tmpColor.setHex(heatHex(HEAT_PROTECT, cellProtect(c, r)));
        }
        m.setColorAt(n, tmpColor);
      }
    }
    terrainMeshes.forEach(function (m, i) {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  /* 切换 地形 / 行动力消耗 / 伤害抗性 三种着色 */
  function setViewMode(mode) {
    if (mode !== 'terrain' && mode !== 'move' && mode !== 'protect') return;
    state.viewMode = mode;
    const sel = document.getElementById('viewSelect');
    if (sel && sel.value !== mode) sel.value = mode;
    terrainMeshes.forEach(function (m, i) {
      if (m.material) {
        m.material.color.setHex(mode === 'terrain' ? TERRAINS[i].color3d : 0xffffff);
        m.material.needsUpdate = true;
      }
    });
    updateBoard();
    renderLegend();
    needRender = true;
  }

  function hex6(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }

  function renderLegend() {
    const el = document.getElementById('legend');
    if (!el) return;
    if (state.viewMode === 'terrain') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');

    const isMove = state.viewMode === 'move';
    const stops = isMove ? HEAT_MOVE : HEAT_PROTECT;
    const lo = stops[0][0], hi = stops[stops.length - 1][0];
    const grad = stops.map(function (s) {
      const pct = Math.round((s[0] - lo) / (hi - lo) * 100);
      return hex6(s[1]) + ' ' + pct + '%';
    }).join(', ');
    const fmt = isMove
      ? function (v) { return String(v); }
      : function (v) { return Math.round(v * 100) + '%'; };

    el.innerHTML =
      '<div class="lg-title">' + (isMove ? '行动力消耗' : '伤害抗性') + '</div>' +
      '<div class="lg-bar" style="background:linear-gradient(90deg,' + grad + ')"></div>' +
      '<div class="lg-ticks">' + stops.map(function (s) {
        return '<span>' + fmt(s[0]) + '</span>';
      }).join('') + '</div>';
  }

  /* =============================================================
   * 相机
   * ============================================================= */
  function updateCamera() {
    const c = state.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    camera.position.set(
      c.tx + c.dist * cp * Math.sin(c.yaw),
      c.ty + c.dist * sp,
      c.tz + c.dist * cp * Math.cos(c.yaw)
    );
    camera.lookAt(c.tx, c.ty, c.tz);
  }

  function fitView() {
    const c = state.cam;
    c.tx = 0; c.ty = 0; c.tz = 0;
    const bw = PITCH * (state.cols + 0.5);
    const bh = ROWH * state.rows + HEXR * 2;

    // 先给一个估计值，再按实际投影收敛，保证任何行列数、任何倾角都装得下
    let dist = Math.max(bw, bh) * 1.4;
    const corners = [
      [-bw / 2, 0, -bh / 2], [bw / 2, 0, -bh / 2], [-bw / 2, 0, bh / 2], [bw / 2, 0, bh / 2],
      [-bw / 2, TOP, -bh / 2], [bw / 2, TOP, bh / 2], [-bw / 2, TOP, bh / 2], [bw / 2, TOP, -bh / 2],
    ];
    const v = new THREE.Vector3();
    for (let it = 0; it < 6; it++) {
      c.dist = dist;
      updateCamera();
      camera.updateMatrixWorld(true);
      let k = 0;
      for (let i = 0; i < corners.length; i++) {
        v.set(corners[i][0], corners[i][1], corners[i][2]).project(camera);
        k = Math.max(k, Math.abs(v.x), Math.abs(v.y));
      }
      if (!isFinite(k) || k <= 0.001) break;
      const next = dist * (k / 0.9);
      if (Math.abs(next - dist) < 0.5) { dist = next; break; }
      dist = next;
    }
    c.dist = dist;
    updateCamera();
  }

  const _right = new THREE.Vector3();
  const _viewH = new THREE.Vector3();

  function panBy(dx, dy) {
    const c = state.cam;
    _right.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    _viewH.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const s = c.dist * 0.0016;
    c.tx += (-_right.x * dx + _viewH.x * dy) * s;
    c.tz += (-_right.z * dx + _viewH.z * dy) * s;
  }

  function zoomBy(factor) {
    const c = state.cam;
    c.dist = Math.max(45, Math.min(1400, c.dist * factor));
  }

  /* =============================================================
   * 拾取
   * ============================================================= */
  const ray = new THREE.Raycaster();
  const pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  function pickCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(pickPlane, hitPoint)) return [-1, -1];
    const X = hitPoint.x - OX;
    const Y = OZ - hitPoint.z;
    return HG.pixelToCell(X, Y, HEXR);
  }

  /* =============================================================
   * 渲染循环
   * ============================================================= */
  let needRender = true;

  let everSized = false;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;              // 面板还没显示出来（比如停在主菜单），别把宽高比算成 NaN
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 第一次拿到真实尺寸时补做一次取景：编辑器可能是在被隐藏的状态下启动的
    if (!everSized) {
      everSized = true;
      fitView();
    }
    needRender = true;
  }

  /* 旗子朝向相机（只绕竖直轴转） */
  function faceFlagsToCamera() {
    for (let i = 0; i < flagObjects.length; i++) {
      const f = flagObjects[i];
      f.rotation.y = Math.atan2(camera.position.x - f.position.x, camera.position.z - f.position.z);
    }
  }

  function render() {
    if (needRender) {
      updateCamera();
      faceFlagsToCamera();
      renderer.render(scene, camera);
      needRender = false;
    }
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }

  /* =============================================================
   * 地图模型
   * ============================================================= */
  function makeCells(cols, rows, fill) {
    const a = new Uint8Array(cols * rows);
    if (fill) a.fill(fill);
    return a;
  }

  function inBounds(c, r) { return c >= 0 && r >= 0 && c < state.cols && r < state.rows; }
  function cellTerrain(c, r) { return inBounds(c, r) ? state.cells[r * state.cols + c] : -1; }

  function snapshot() {
    return {
      cols: state.cols,
      rows: state.rows,
      cells: state.cells.slice(),
      mode: state.mode,
      deploy: MK.cloneDeploy(state.deploy),
    };
  }

  function beginAction() { state.pending = snapshot(); }

  function commitAction() {
    if (!state.pending) return;
    state.undo.push(state.pending);
    if (state.undo.length > 200) state.undo.shift();
    state.redo.length = 0;
    state.pending = null;
    updateCounts();
    scheduleSave();
    updateButtons();
  }

  function restore(snap) {
    state.cols = snap.cols;
    state.rows = snap.rows;
    state.cells = snap.cells.slice();
    state.hover = -1;
    if (snap.mode) state.mode = snap.mode;
    if (snap.deploy) state.deploy = MK.cloneDeploy(snap.deploy);
    showHover(0, 0, false);
    syncSizeInputs();
    syncModeUI();
    buildBoard();
    fitView();
    updateCounts();
    updateButtons();
    updateInspector();
    needRender = true;
    scheduleSave();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
  }

  /* =============================================================
   * 涂色 / 部署标记
   * ============================================================= */
  let painted = false;

  function markChanged() {
    if (!painted) {
      if (state.pending) {
        state.undo.push(state.pending);
        if (state.undo.length > 200) state.undo.shift();
        state.redo.length = 0;
        state.pending = null;
      }
      painted = true;
    }
  }

  function paintCell(c, r) {
    if (!inBounds(c, r)) return;
    if (state.toolTab === 'deploy') {
      applyDeployAt(c, r);
      return;
    }
    const i = r * state.cols + c;
    if (state.cells[i] === state.current) return;
    markChanged();
    state.cells[i] = state.current;
    updateBoard();
    needRender = true;
    updateCounts();
  }

  function applyDeployAt(c, r) {
    if (state.mode !== 'attack' || !inBounds(c, r)) return;
    if (!MK.applyTool(state.deploy, state.deployTool, c, r, state.cols)) return;
    markChanged();
    rebuildDeploy();
    updateCounts();
  }

  function removeDeployAt(c, r) {
    if (!inBounds(c, r)) return;
    beginAction();
    if (MK.removeAt(state.deploy, c, r, state.cols)) {
      markChanged();
      commitAction();
      rebuildDeploy();
    } else {
      state.pending = null;
    }
  }

  let lastPaint = null;

  function paintAt(clientX, clientY) {
    const [c, r] = pickCell(clientX, clientY);
    if (!inBounds(c, r)) return;
    if (lastPaint && lastPaint[0] === c && lastPaint[1] === r) return;
    lastPaint = [c, r];
    paintCell(c, r);
  }

  /* 鼠标移动很快时，沿屏幕线段采样，避免漏格 */
  function paintFrom(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / 5));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      paintAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }

  /* =============================================================
   * 交互
   * ============================================================= */
  let drag = null;
  let spaceDown = false;

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvas.addEventListener('pointerdown', function (e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    lastPaint = null;

    if (e.altKey) {
      drag = { mode: 'orbit', last: [e.clientX, e.clientY] };
      return;
    }
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      drag = { mode: 'pan', last: [e.clientX, e.clientY] };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) {
      drag = { mode: 'right', start: [e.clientX, e.clientY], last: [e.clientX, e.clientY], moved: false };
      return;
    }
    if (e.button === 0) {
      drag = { mode: 'paint', last: [e.clientX, e.clientY] };
      painted = false;
      beginAction();
      paintAt(e.clientX, e.clientY);
      updateHover(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!drag) { updateHover(e.clientX, e.clientY); return; }

    const dx = e.clientX - drag.last[0];
    const dy = e.clientY - drag.last[1];

    if (drag.mode === 'orbit') {
      state.cam.yaw -= dx * 0.007;
      state.cam.pitch = Math.max(0.12, Math.min(1.52, state.cam.pitch + dy * 0.006));
      needRender = true;
    } else if (drag.mode === 'pan') {
      panBy(dx, dy);
      needRender = true;
    } else if (drag.mode === 'right') {
      if (Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) > 4) drag.moved = true;
      if (drag.moved) {
        state.cam.yaw -= dx * 0.007;
        state.cam.pitch = Math.max(0.12, Math.min(1.52, state.cam.pitch + dy * 0.006));
        canvas.style.cursor = 'grabbing';
        needRender = true;
      }
    } else if (drag.mode === 'paint') {
      // 单格工具（出生点 / 指挥部）只在按下时落点，不跟着拖动走
      const cellTool = state.toolTab === 'deploy' &&
        MK.TOOL_BY_ID[state.deployTool] && MK.TOOL_BY_ID[state.deployTool].kind === 'cell';
      if (!cellTool) paintFrom(drag.last[0], drag.last[1], e.clientX, e.clientY);
      updateHover(e.clientX, e.clientY);
    }
    drag.last = [e.clientX, e.clientY];
  });

  function endDrag(e) {
    if (!drag) return;
    if (drag.mode === 'paint') {
      if (painted) commitAction(); else { state.pending = null; }
      painted = false;
    } else if (drag.mode === 'right' && !drag.moved) {
      const [c, r] = pickCell(e.clientX, e.clientY);
      if (state.toolTab === 'deploy' && state.mode === 'attack') {
        removeDeployAt(c, r);
      } else {
        const tid = cellTerrain(c, r);
        if (tid >= 0) selectTerrain(tid);
      }
    }
    drag = null;
    canvas.style.cursor = state.toolTab === 'deploy' ? 'pointer' : 'default';
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', function () { drag = null; painted = false; state.pending = null; });
  canvas.addEventListener('pointerleave', function () {
    if (!drag) { state.hover = -1; showHover(0, 0, false); updateHoverText(); needRender = true; }
  });

  function updateHover(cx, cy) {
    const [c, r] = pickCell(cx, cy);
    const i = inBounds(c, r) ? r * state.cols + c : -1;
    if (i !== state.hover) {
      state.hover = i;
      showHover(c, r, i >= 0);
      updateHoverText();
      needRender = true;
    }
  }

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.0012));
    needRender = true;
  }, { passive: false });

  /* ---------------- 键盘 ---------------- */
  const PAN_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  const held = Object.create(null);
  let panTimer = 0;
  let panPrev = 0;

  function panStep() {
    const now = (window.performance && performance.now) ? performance.now() : Date.now();
    const dt = panPrev ? Math.min(40, now - panPrev) : 16;
    panPrev = now;
    const speed = 0.55 * dt;
    let dx = 0, dy = 0;
    if (held.w || held.arrowup) dy += speed;
    if (held.s || held.arrowdown) dy -= speed;
    if (held.a || held.arrowleft) dx += speed;
    if (held.d || held.arrowright) dx -= speed;
    if (dx || dy) {
      panBy(dx, dy);
      needRender = true;
    } else {
      stopPan();
    }
  }

  function startPan() {
    if (panTimer) return;
    panPrev = 0;
    panTimer = setInterval(panStep, 16);
  }

  function stopPan() {
    if (panTimer) clearInterval(panTimer);
    panTimer = 0;
    panPrev = 0;
  }

  window.addEventListener('keydown', function (e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }

    if (e.code === 'Space') {
      spaceDown = true;
      canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    if (e.key === '?') { toggleHelp(); return; }
    if (e.key === 'f' || e.key === 'F') { toggleTopView(); return; }
    if (e.key === 'r' || e.key === 'R') { resetView(); return; }
    if (e.key === 'b' || e.key === 'B') {
      setToolTab(state.toolTab === 'deploy' ? 'terrain' : 'deploy');
      return;
    }

    const k = (e.key || '').toLowerCase();
    if (!ctrl && PAN_KEYS.indexOf(k) >= 0) {
      held[k] = true;
      startPan();
      e.preventDefault();
      return;
    }

    const idx = TERRAINS.findIndex(function (t) { return t.key === e.key; });
    if (idx >= 0) {
      e.preventDefault();
      selectTerrain(idx);
    }
  });

  window.addEventListener('keyup', function (e) {
    const k = (e.key || '').toLowerCase();
    if (held[k]) delete held[k];
    if (e.code === 'Space') {
      spaceDown = false;
      if (!drag) canvas.style.cursor = 'default';
    }
  });

  window.addEventListener('blur', function () {
    for (const k in held) delete held[k];
    spaceDown = false;
  });

  /* =============================================================
   * 面板
   * ============================================================= */
  function selectTerrain(idx) {
    state.current = idx;
    Array.prototype.forEach.call(paletteGrid.children, function (el, i) {
      el.classList.toggle('active', i === idx);
    });
    updateInspector();
  }

  function updateHoverText() {
    if (state.hover < 0) {
      statCoord.textContent = '—';
      statTerrain.textContent = '移到地图上查看格子';
    } else {
      const r = Math.floor(state.hover / state.cols);
      const c = state.hover % state.cols;
      const t = TERRAINS[state.cells[state.hover]];
      const rule = t.rule;
      statCoord.textContent = coordLabel(c, r);
      statTerrain.textContent = t.name + ' · 消耗 ' + rule.move +
        (rule.moveMech !== rule.move ? '（机械 ' + rule.moveMech + '）' : '') +
        ' · 防护 ' + t.resist;
    }
    updateInspector();
  }

  function coordLabel(c, r) {
    let s = '';
    let n = c;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s + (r + 1);
  }

  /* 一格的完整属性（目前完全由地形决定；game 侧读 mapio 的 grid 即可） */
  function cellAttrs(c, r) {
    const t = TERRAINS[state.cells[r * state.cols + c]];
    const g = t.rule;
    return {
      terrain: t.id,
      name: t.name,
      move: g.move,
      moveMech: g.moveMech,
      protect: g.protect,
      blocksSight: g.blocksSight,
      urban: g.urban,
      riverReset: g.riverReset,
      chaos: g.chaos,
    };
  }

  function updateInspector() {
    const t = TERRAINS[state.current];
    let html = '';
    html += '<div class="card-title"><span class="dot" style="background:' + t.fill + ';border-color:' + t.line + '"></span>' +
      t.name + '<kbd>' + t.key + '</kbd></div>';
    html += '<dl class="stats">';
    html += '<div><dt>行动力消耗</dt><dd>' + t.rule.move +
      (t.rule.moveMech !== t.rule.move ? '（机械化 ' + t.rule.moveMech + '）' : '') + '</dd></div>';
    html += '<div><dt>伤害抗性</dt><dd>' + t.resist + '</dd></div>';
    html += '<div><dt>特殊限制</dt><dd>' + t.limit + '</dd></div>';
    html += '</dl>';
    html += '<p class="desc">' + t.desc + '</p>';
    if (state.hover >= 0) {
      const r = Math.floor(state.hover / state.cols);
      const c = state.hover % state.cols;
      const a = cellAttrs(c, r);
      const flags = [];
      if (a.blocksSight) flags.push('阻挡视野');
      if (a.urban) flags.push('巷战');
      if (a.riverReset) flags.push('过河清零');
      if (a.chaos) flags.push('混乱 +' + a.chaos);
      html += '<div class="hover-box"><div class="hb-title"><span class="muted">当前格子</span> ' +
        coordLabel(c, r) + ' · ' + a.name + '</div>';
      html += '<dl class="stats tight">';
      html += '<div><dt>行动力消耗</dt><dd>' + a.move +
        (a.moveMech !== a.move ? ' <span class="muted">/ 机械 ' + a.moveMech + '</span>' : '') + '</dd></div>';
      html += '<div><dt>防护（伤害抗性）</dt><dd>' + (a.protect ? Math.round(a.protect * 100) + '%' : '无') + '</dd></div>';
      if (flags.length) html += '<div><dt>附加</dt><dd>' + flags.join(' · ') + '</dd></div>';
      html += '</dl></div>';
    }
    inspBody.innerHTML = html;
  }

  function updateCounts() {
    const counts = new Array(TERRAINS.length).fill(0);
    for (let i = 0; i < state.cells.length; i++) counts[state.cells[i]]++;
    let html = '';
    TERRAINS.forEach(function (t, i) {
      if (!counts[i]) return;
      html += '<div class="count-row"><span class="sw" style="background:' + t.fill + ';border-color:' + t.line + '"></span>' +
        '<span class="nm">' + t.name + '</span><span class="num">' + counts[i] + '</span></div>';
    });
    html += '<div class="count-total">共 ' + state.cols + ' × ' + state.rows + ' = ' + state.cells.length + ' 格</div>';

    // 攻防战的部署标记
    if (state.mode === 'attack') {
      const d = state.deploy;
      const row = function (name, ok, extra) {
        return '<div class="count-row"><span class="mark ' + (ok ? 'on' : '') + '"></span>' +
          '<span class="nm">' + name + '</span><span class="num">' + (ok ? (extra || '✓') : '—') + '</span></div>';
      };
      html += '<div class="deploy-summary"><div class="sub">部署标记</div>';
      html += row('进攻方出生点', !!d.spawn, d.spawn ? coordLabel(d.spawn.c, d.spawn.r) : '未设置');
      html += row('进攻方指挥部', !!d.hqA, d.hqA ? coordLabel(d.hqA.c, d.hqA.r) : '未设置');
      html += row('防守方指挥部', !!d.hqD, d.hqD ? coordLabel(d.hqD.c, d.hqD.r) : '未设置');
      html += row('防守方部署区', d.zone.size > 0, d.zone.size ? d.zone.size + ' 格' : '未设置');
      html += '</div>';
    }
    countsBox.innerHTML = html;

    Array.prototype.forEach.call(paletteGrid.children, function (el, i) {
      const b = el.querySelector('.badge');
      if (b) b.textContent = counts[i] || '';
    });
  }

  function updateButtons() {
    document.getElementById('btn-undo').disabled = !state.undo.length;
    document.getElementById('btn-redo').disabled = !state.redo.length;
  }

  function syncSizeInputs() {
    document.getElementById('cols').value = state.cols;
    document.getElementById('rows').value = state.rows;
  }

  /* ---------------- 调色板（用 3D 图块渲染缩略图） ---------------- */
  let thumbs = null;

  function renderThumbs() {
    const size = 112;
    let r2;
    try {
      r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      return null;
    }
    r2.setPixelRatio(1);
    r2.setSize(size, size);
    r2.outputEncoding = THREE.sRGBEncoding;
    const s2 = new THREE.Scene();
    const cam2 = new THREE.PerspectiveCamera(34, 1, 1, 600);
    cam2.position.set(0, 40, 30);
    cam2.lookAt(0, 1.5, 0);
    s2.add(new THREE.HemisphereLight(0xffffff, 0x40485a, 1.0));
    const d2 = new THREE.DirectionalLight(0xffffff, 1.5);
    d2.position.set(26, 46, 30);
    s2.add(d2);
    const out = {};
    TERRAINS.forEach(function (t) {
      const geo = geometries[t.id];
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: t.color3d, roughness: 0.8 }));
      s2.add(mesh);
      r2.render(s2, cam2);
      try { out[t.id] = r2.domElement.toDataURL('image/png'); } catch (e) { /* ignore */ }
      s2.remove(mesh);
      mesh.material.dispose();
    });
    r2.dispose();
    return out;
  }

  function buildPalette() {
    thumbs = renderThumbs();
    TERRAINS.forEach(function (t, i) {
      const btn = document.createElement('button');
      btn.className = 'terra';
      btn.type = 'button';
      btn.title = t.name + '（' + t.key + '）';
      if (i === state.current) btn.classList.add('active');

      let icon;
      if (thumbs && thumbs[t.id]) {
        icon = document.createElement('img');
        icon.className = 'icon';
        icon.src = thumbs[t.id];
        icon.alt = t.name;
      } else {
        icon = document.createElement('span');
        icon.className = 'icon swatch';
        icon.style.background = t.fill;
      }

      const label = document.createElement('span');
      label.className = 'nm';
      label.textContent = t.name;

      const kbd = document.createElement('kbd');
      kbd.textContent = t.key;

      const badge = document.createElement('span');
      badge.className = 'badge';

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.appendChild(kbd);
      btn.appendChild(badge);
      btn.addEventListener('click', function () { selectTerrain(i); });
      paletteGrid.appendChild(btn);
    });
  }

  /* ---------------- 部署工具面板 / 模式 ---------------- */
  function buildDeployPalette() {
    const grid = document.getElementById('deployGrid');
    if (!grid) return;
    grid.innerHTML = '';
    MK.TOOLS.forEach(function (tool) {
      const btn = document.createElement('button');
      btn.className = 'terra';
      btn.type = 'button';
      btn.dataset.tool = tool.id;
      btn.title = tool.name;
      if (tool.id === state.deployTool) btn.classList.add('active');

      const icon = document.createElement('canvas');
      icon.width = 88; icon.height = 88;
      icon.className = 'icon';
      MK.drawIcon(icon, tool.id);

      const label = document.createElement('span');
      label.className = 'nm';
      label.textContent = tool.name;

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        state.deployTool = tool.id;
        Array.prototype.forEach.call(grid.children, function (el) {
          el.classList.toggle('active', el.dataset.tool === tool.id);
        });
        setToolTab('deploy');
        canvas.style.cursor = 'pointer';
      });
      grid.appendChild(btn);
    });
  }

  /* 部署标记只在「部署」标签页里显示：看地形时不会被高亮挡住颜色 */
  function updateMarkerVisibility() {
    state.showMarkers = state.toolTab === 'deploy' && state.mode === 'attack';
    rebuildDeploy();
  }

  function setToolTab(tab) {
    state.toolTab = tab;
    const t1 = document.getElementById('tab-terrain');
    const t2 = document.getElementById('tab-deploy');
    const p1 = document.getElementById('terrain-pane');
    const p2 = document.getElementById('deploy-pane');
    if (t1) t1.classList.toggle('active', tab === 'terrain');
    if (t2) t2.classList.toggle('active', tab === 'deploy');
    if (p1) p1.classList.toggle('hidden', tab !== 'terrain');
    if (p2) p2.classList.toggle('hidden', tab !== 'deploy');
    canvas.style.cursor = tab === 'deploy' ? 'pointer' : 'default';
    updateMarkerVisibility();
  }

  function syncModeUI() {
    const sel = document.getElementById('modeSelect');
    if (sel) sel.value = state.mode;
    const note = document.getElementById('deploy-note');
    const grid = document.getElementById('deployGrid');
    const clear = document.getElementById('btn-clear-deploy');
    const isAttack = state.mode === 'attack';
    if (note) note.classList.toggle('hidden', isAttack);
    if (grid) grid.classList.toggle('hidden', !isAttack);
    if (clear) clear.classList.toggle('hidden', !isAttack);
    const tabDeploy = document.getElementById('tab-deploy');
    if (tabDeploy) tabDeploy.classList.toggle('disabled', !isAttack);
    if (!isAttack && state.toolTab === 'deploy') setToolTab('terrain');
    updateMarkerVisibility();
    updateCounts();
  }

  function setMode(mode) {
    if (mode !== 'attack' && mode !== 'contest') return;
    if (mode === state.mode) return;
    const hasMarks = !MK.isEmpty(state.deploy);
    state.mode = mode;
    if (mode === 'contest' && hasMarks) {
      flash('已切到争夺战，攻防战的部署标记暂时隐藏（切回去还在）');
    }
    syncModeUI();
    scheduleSave();
  }

  function clearDeploy() {
    beginAction();
    state.deploy = MK.createDeploy();
    markChanged();
    commitAction();
    rebuildDeploy();
    flash('已清空部署标记');
  }

  /* =============================================================
   * 存档
   * ============================================================= */
  const MAPIO = window.MapIO;

  function toJSON() {
    return MAPIO.serialize({
      cols: state.cols,
      rows: state.rows,
      cells: state.cells,
      mode: state.mode,
      deploy: state.deploy,
    }, TERRAINS);
  }

  function applyJSON(obj) {
    // 解析、地形下标翻译、版本兼容都在 mapio.js 里
    const r = MAPIO.parse(obj, TERRAINS, T_INDEX);
    state.cols = r.cols;
    state.rows = r.rows;
    state.cells = r.cells;
    state.mode = r.mode || 'attack';
    state.deploy = r.deploy || MK.createDeploy();
    state.undo.length = 0;
    state.redo.length = 0;
    syncSizeInputs();
    buildBoard();
    fitView();
    syncModeUI();
    updateCounts();
    updateButtons();
    needRender = true;
    scheduleSave();
    if (r.warnings.length) {
      flash(r.warnings[0]);
      if (window.console) console.warn('[地图载入]', r.warnings.join('\n'));
    }
    return r;
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function saveFile() {
    download('兵棋地图_' + state.cols + 'x' + state.rows + '.json',
      new Blob([JSON.stringify(toJSON())], { type: 'application/json' }));
    flash('已保存 JSON 文件');
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        applyJSON(JSON.parse(String(reader.result)));
        flash('已载入：' + file.name);
      } catch (err) {
        alert('载入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      MAPIO.saveLocal({
        cols: state.cols,
        rows: state.rows,
        cells: state.cells,
        mode: state.mode,
        deploy: state.deploy,
      }, TERRAINS);
    }, 400);
  }

  function restoreLocal() {
    const raw = MAPIO.readLocal();
    if (!raw) return false;
    try {
      applyJSON(raw);
      return true;
    } catch (e) { return false; }
  }

  function exportPNG() {
    render();
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = '兵棋地图3D_' + state.cols + 'x' + state.rows + '.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 500);
    flash('已导出 PNG');
  }

  /* =============================================================
   * 按钮
   * ============================================================= */
  function resetView() {
    // 默认朝向：列 0 在左、行 0 在下（左下角为原点，和地图存档的坐标习惯一致）
    state.cam.yaw = 0;
    state.cam.pitch = 0.86;
    state.topView = false;
    syncViewButton();
    fitView();
    needRender = true;
  }

  function syncViewButton() {
    const b = document.getElementById('btn-view');
    if (!b) return;
    b.classList.toggle('on', state.topView);
    b.textContent = state.topView ? '斜视' : '俯视';
  }

  function toggleTopView() {
    state.topView = !state.topView;
    state.cam.pitch = state.topView ? 1.5 : 0.86;
    syncViewButton();
    needRender = true;
  }

  function newMap() {
    const cols = Math.max(2, Math.min(80, parseInt(document.getElementById('cols').value, 10) || 12));
    const rows = Math.max(2, Math.min(60, parseInt(document.getElementById('rows').value, 10) || 9));
    let dirty = false;
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] !== PLAIN) { dirty = true; break; }
    }
    if (dirty && !confirm('新建地图会清空当前内容，确定吗？')) return;
    state.cols = cols;
    state.rows = rows;
    state.cells = makeCells(cols, rows, PLAIN);
    state.deploy = MK.createDeploy();
    state.undo.length = 0;
    state.redo.length = 0;
    state.hover = -1;
    showHover(0, 0, false);
    syncSizeInputs();
    buildBoard();
    fitView();
    syncModeUI();
    updateCounts();
    updateButtons();
    needRender = true;
    scheduleSave();
    flash('已新建 ' + cols + ' × ' + rows + ' 空白地图（全部平原）');
  }

  function fillPlain() {
    beginAction();
    state.cells.fill(PLAIN);
    commitAction();
    updateBoard();
    needRender = true;
    flash('已全部改回平原');
  }

  function toggleHelp() {
    document.getElementById('help').classList.toggle('hidden');
  }

  let flashTimer = null;
  function flash(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  function on(id, ev, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  }

  on('btn-new', 'click', newMap);
  on('btn-plain', 'click', fillPlain);
  on('btn-undo', 'click', undo);
  on('btn-redo', 'click', redo);
  on('btn-view', 'click', toggleTopView);
  on('btn-reset', 'click', resetView);
  on('btn-save', 'click', saveFile);
  on('btn-load', 'click', function () { fileInput.click(); });
  on('btn-png', 'click', exportPNG);
  on('btn-help', 'click', toggleHelp);
  on('btn-clear-deploy', 'click', clearDeploy);
  on('tab-terrain', 'click', function () { setToolTab('terrain'); });
  on('tab-deploy', 'click', function () {
    if (state.mode !== 'attack') {
      flash('争夺战暂时没有特殊标记，切到攻防战再放');
      return;
    }
    setToolTab('deploy');
  });
  on('modeSelect', 'change', function (e) { setMode(e.target.value); });
  on('viewSelect', 'change', function (e) { setViewMode(e.target.value); });
  on('help', 'click', function (e) {
    if (e.target.id === 'help' || e.target.classList.contains('close')) toggleHelp();
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  /* =============================================================
   * 启动
   * ============================================================= */
  function boot() {
    buildPalette();
    buildDeployPalette();

    if (!restoreLocal()) {
      state.cells = makeCells(state.cols, state.rows, PLAIN);
      state.deploy = MK.createDeploy();
      buildBoard();
    }
    selectTerrain(PLAIN);
    syncModeUI();
    setToolTab('terrain');
    renderLegend();
    updateCounts();
    updateButtons();

    resize();
    fitView();
    needRender = true;
    statZoom.textContent = '';

    if (window.ResizeObserver) {
      new ResizeObserver(function () { resize(); }).observe(canvas);
    }
    window.addEventListener('resize', function () { resize(); });

    canvas.style.cursor = 'default';
    loop();

    window.BQ = {
      state: state,
      applyJSON: applyJSON,
      toJSON: toJSON,
      selectTerrain: selectTerrain,
      paintCell: paintCell,
      paintAt: paintAt,
      applyDeployAt: applyDeployAt,
      removeDeployAt: removeDeployAt,
      pickCell: pickCell,
      updateBoard: updateBoard,
      rebuildDeploy: rebuildDeploy,
      showHover: showHover,
      fitView: fitView,
      resetView: resetView,
      setMode: setMode,
      setToolTab: setToolTab,
      setViewMode: setViewMode,
      cellAttrs: cellAttrs,
      renderLegend: renderLegend,
      render: render,
      renderer: renderer,
      camera: camera,
      scene: scene,
      deployGroup: deployGroup,
      TERRAINS: TERRAINS,
      MK: MK,
    };
  }

  boot();
})();
