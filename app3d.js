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
    buildingTool: 'hqA',
    viewMode: 'terrain',      // terrain 地形色 / move 行动力消耗 / protect 伤害抗性
    phases: { a: 1, b: null, c: null },   // A 阶段固定第 1 回合起；B/C 由地图设置
    facing: 0,                            // 默认朝向 0–5（东/东北/西北/西/西南/东南）
    absent: null,                         // Uint8Array：1 = 这格不存在（非矩形地图）
    shapeMode: false,                     // 形状编辑：点格子 = 删掉 / 补回
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

  /* =============================================================
   * 建筑模型（线上版/建筑/*.blend 导出成 building-models.js）
   * 数据是量化的 unit cube，dims 是真实毫米尺寸；模型是六边形插入件，
   * 和地图格 1:1，直接按 dims 放到格子上即可。
   * ============================================================= */
  let buildingModelsReady = false;
  let buildingModelError = false;
  const buildingGeoCache = {};
  const SOCKET_DEPTH = 0.75;   // 模型底部卡榫伸进格子的深度（毫米）
  const CREASE_DEG = 35;       // 折痕角：超过这个夹角就断开法线（和地图格一致）   // 模型底部卡榫伸进格子的深度（毫米）
  const buildingMatCache = {};

  function loadBuildingModels() {
    if (window.BUILDING_MODELS) { buildingModelsReady = true; return; }
    if (buildingModelError) return;
    const s = document.createElement('script');
    // 打包时 index.html 注入 window.__BUILD__，带上它避免缓存导致模型不更新
    const v = window.__BUILD__;
    s.src = 'building-models.js' + (v ? ('?v=' + encodeURIComponent(v)) : '');
    s.onload = function () {
      buildingModelsReady = !!window.BUILDING_MODELS;
      rebuildDeploy();
      needRender = true;
    };
    s.onerror = function () {
      buildingModelError = true;
      if (window.console) console.warn('[建筑] 没加载到 building-models.js，先用占位方块');
      rebuildDeploy();
    };
    document.head.appendChild(s);
  }

  function decodeBuildingGeometry(b64) {
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
    // 按折痕劈开法线：相邻面夹角大于 CREASE_DEG 就断开，否则平滑。
    // 直接用 computeVertexNormals() 会把 90° 的棱也平均掉，看起来像被抹圆了。
    creaseSplitNormals(geo, CREASE_DEG);
    return geo;
  }

  /* 把索引几何按夹角重新拆成"硬边 + 平滑面"两组法线（和导出地图格时的 35° 折痕一致） */
  function creaseSplitNormals(geo, creaseDeg) {
    const THREE = window.THREE;
    const pos = geo.attributes.position;
    const idx = geo.index;
    if (!pos || !idx) return;
    const cosLimit = Math.cos(creaseDeg * Math.PI / 180);

    // 先算每个三角形的法线
    const triCount = idx.count / 3;
    const triN = new Float32Array(triCount * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      a.fromBufferAttribute(pos, idx.getX(t * 3));
      b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
      c.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      triN[t * 3] = n.x; triN[t * 3 + 1] = n.y; triN[t * 3 + 2] = n.z;
    }

    // 每个顶点都重新出一份，法线取"同位置且夹角在阈值内"的三角形平均
    const outPos = [];
    const outN = [];
    const vKey = {};
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        // 累加同位置、夹角够小的邻面
        let nx = 0, ny = 0, nz = 0;
        for (let t2 = 0; t2 < triCount; t2++) {
          let shares = false;
          for (let m = 0; m < 3; m++) {
            if (idx.getX(t2 * 3 + m) === vi) { shares = true; break; }
          }
          if (!shares) continue;
          const d = triN[t * 3] * triN[t2 * 3] + triN[t * 3 + 1] * triN[t2 * 3 + 1] + triN[t * 3 + 2] * triN[t2 * 3 + 2];
          if (d < cosLimit) continue;
          nx += triN[t2 * 3]; ny += triN[t2 * 3 + 1]; nz += triN[t2 * 3 + 2];
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        outPos.push(x, y, z);
        outN.push(nx / len, ny / len, nz / len);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
    geo.setIndex(null);
  }

  function buildingGeometry(def) {
    if (!buildingModelsReady || !def || !def.model) return null;
    const all = window.BUILDING_MODELS;
    const entry = all && all[def.model];
    if (!entry) return null;
    if (buildingGeoCache[def.model]) return buildingGeoCache[def.model];
    const geo = decodeBuildingGeometry(entry.b64);
    // 量化时按最大边归一化到 2，所以真实毫米尺寸 = dims 的最大值
    const span = Math.max(entry.dims[0], entry.dims[1], entry.dims[2]) || 1;
    geo.userData.scale = span / 2;      // 归一化 -> 毫米
    geo.userData.dims = entry.dims;
    buildingGeoCache[def.model] = geo;
    return geo;
  }

  function buildingMaterial(colorHex) {
    if (buildingMatCache[colorHex]) return buildingMatCache[colorHex];
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex, roughness: 0.86, metalness: 0.04,
    });
    buildingMatCache[colorHex] = mat;
    return mat;
  }

  /* 把模型摆到格子中心：Z-up 转 Y-up，按真实尺寸缩放到格子上，底面贴住格面 */
  function makeBuildingMesh(def, c, r) {
    const geo = buildingGeometry(def);
    if (!geo) return null;
    const w = cellWorld(c, r);
    const mesh = new THREE.Mesh(geo, buildingMaterial(parseInt(def.color.slice(1), 16)));
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(geo.userData.scale);
    mesh.position.set(w[0], 0, w[1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 模型下面有一段卡榫（约 0.75mm）：只让卡榫进格子，正面露在格面之上
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.y += (TOP - SOCKET_DEPTH) - box.min.y;
    return mesh;
  }

  function rebuildDeploy() {
    while (deployGroup.children.length) {
      const o = deployGroup.children.pop();
      if (o.material && o.material.dispose) o.material.dispose();
    }
    flagObjects.length = 0;

    const d = state.deploy;
    // 建筑是地图的一部分（可破坏），任何时候都要画，不跟部署标记一起隐藏
    renderBuildings(d);
    if (!state.showMarkers) {
      needRender = true;
      return;
    }
    const attackMode = state.mode === 'attack';

    if (attackMode && d.zone && d.zone.size) {
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

    // 飞机进场点：半透明底盘 + 指向地图内部的箭头
    [['airA', 0xe0573f], ['airD', 0x4a86e0]].forEach(function (pair) {
      const list = d[pair[0]] || [];
      list.forEach(function (p) {
        const w = cellWorld(p.c, p.r);
        const plate = new THREE.Mesh(
          plateGeometry(),
          new THREE.MeshBasicMaterial({
            color: pair[1], transparent: true, opacity: 0.30,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        plate.position.set(w[0], TOP + 0.35, w[1]);
        plate.rotation.x = -Math.PI / 2;
        deployGroup.add(plate);

        // 箭头方向：指向相邻的、存在的格子（也就是地图内部）
        let dx = 0, dz = 0;
        HG.neighbors(p.c, p.r).forEach(function (n) {
          const nc = n[0], nr = n[1];
          if (!inBounds(nc, nr) || isAbsent(nc, nr)) return;
          const q = cellWorld(nc, nr);
          dx += q[0] - w[0];
          dz += q[1] - w[1];
        });
        if (!dx && !dz) dx = 1;              // 孤格就朝东
        const ang = Math.atan2(dz, dx);

        const sh = new THREE.Shape();
        sh.moveTo(0.0, 4.4);
        sh.lineTo(-6.2, -1.4);
        sh.lineTo(-2.9, -1.4);
        sh.lineTo(-2.9, -4.6);
        sh.lineTo(2.9, -4.6);
        sh.lineTo(2.9, -1.4);
        sh.lineTo(6.2, -1.4);
        sh.closePath();
        const arrow = new THREE.Mesh(
          new THREE.ShapeGeometry(sh),
          new THREE.MeshBasicMaterial({ color: pair[1], side: THREE.DoubleSide })
        );
        arrow.rotation.x = -Math.PI / 2;
        arrow.rotation.z = ang + Math.PI / 2;   // 形状默认朝 +y，转到目标方向
        arrow.position.set(w[0], TOP + 0.8, w[1]);
        deployGroup.add(arrow);
      });
    });

    needRender = true;
  }

  /* 建筑：用真实模型（模型没加载成功时退回占位方块）。
   * 每一块都记下格子下标和颜色，悬停时靠它做半透明。 */
  function renderBuildings(d) {
    (d.buildings || []).forEach(function (b) {
      const def = MK.BUILDING_BY_ID[b.t];
      const color = def ? parseInt(def.color.slice(1), 16) : 0x9aa2ab;
      let mesh = def ? makeBuildingMesh(def, b.c, b.r) : null;
      if (!mesh) {
        const w = cellWorld(b.c, b.r);
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(HEXR * 1.05, 6.5, HEXR * 1.05),
          buildingMaterial(color)
        );
        mesh.position.set(w[0], TOP + 3.2, w[1]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      mesh.userData.buildingCell = b.r * state.cols + b.c;
      mesh.userData.buildingColor = color;
      deployGroup.add(mesh);
    });
  }

  /* ---------- 悬停：建筑半透明，露出下面的地形 ---------- */
  let hoverBuildingCell = -1;
  const buildingGhostMatCache = {};

  function buildingGhostMaterial(colorHex) {
    if (buildingGhostMatCache[colorHex]) return buildingGhostMatCache[colorHex];
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex, roughness: 0.7, metalness: 0.04,
      transparent: true, opacity: 0.32, depthWrite: false,
    });
    buildingGhostMatCache[colorHex] = mat;
    return mat;
  }

  function applyBuildingHover(cellIdx) {
    if (cellIdx === hoverBuildingCell) return;
    hoverBuildingCell = cellIdx;
    let changed = false;
    for (let i = 0; i < deployGroup.children.length; i++) {
      const o = deployGroup.children[i];
      const ud = o.userData;
      if (!ud || ud.buildingColor == null) continue;
      const on = ud.buildingCell === cellIdx;
      const next = on ? buildingGhostMaterial(ud.buildingColor) : buildingMaterial(ud.buildingColor);
      if (o.material !== next) {
        o.material = next;
        o.renderOrder = on ? 2 : 0;
        changed = true;
      }
    }
    if (changed) needRender = true;
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
  let ghostMesh = null;

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

    // 被挖掉的格子：画一层很暗的薄片，让人看得见地图轮廓、也点得到（补格用）
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x2a3138, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    });
    ghostMesh = new THREE.InstancedMesh(plateGeometry(), ghostMat, maxCount);
    ghostMesh.frustumCulled = false;
    ghostMesh.count = 0;
    ghostMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    boardGroup.add(ghostMesh);

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
    let ghosts = 0;
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const idx = r * state.cols + c;
        if (state.absent && state.absent[idx]) {
          if (ghostMesh) {
            const gp = cellWorld(c, r);
            tmpMat.makeTranslation(gp[0], 0.6, gp[1]);
            ghostMesh.setMatrixAt(ghosts++, tmpMat);
          }
          continue;
        }
        const tid = state.cells[idx];
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
    if (ghostMesh) {
      ghostMesh.count = ghosts;
      ghostMesh.instanceMatrix.needsUpdate = true;
    }
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

  /* 这格是不是被挖掉了（不存在） */
  function isAbsent(c, r) {
    if (!inBounds(c, r)) return true;
    return !!(state.absent && state.absent[r * state.cols + c]);
  }

  /* 边界格：至少有一个相邻格不存在或出界（飞机进场点只能放这里） */
  function isEdgeCell(c, r) {
    return MAPIO.isEdgeCell(state.absent, state.cols, state.rows, c, r, HG.neighbors);
  }

  function snapshot() {
    return {
      cols: state.cols,
      rows: state.rows,
      cells: state.cells.slice(),
      mode: state.mode,
      deploy: MK.cloneDeploy(state.deploy),
      phases: { a: 1, b: state.phases.b, c: state.phases.c },
      facing: state.facing,
      absent: state.absent ? state.absent.slice() : null,
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
    if (snap.phases) state.phases = MAPIO.normalizePhases(snap.phases);
    if (snap.facing != null) state.facing = MAPIO.normalizeFacing(snap.facing);
    if (snap.absent) state.absent = snap.absent.slice();
    showHover(0, 0, false);
    syncSizeInputs();
    syncModeUI();
    buildBoard();
    fitView();
    updateCounts();
    updateButtons();
    updateInspector();
    renderFacingUI();
    renderPhaseUI();
    renderShapeUI();
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
    if (state.shapeMode) { toggleCell(c, r); return; }
    if (state.toolTab === 'deploy') {
      applyDeployAt(c, r);
      return;
    }
    if (state.toolTab === 'building') {
      applyBuildingAt(c, r);
      return;
    }
    if (isAbsent(c, r)) return;          // 不存在的格子不能铺地形
    const i = r * state.cols + c;
    if (state.cells[i] === state.current) return;
    markChanged();
    state.cells[i] = state.current;
    updateBoard();
    needRender = true;
    updateCounts();
  }

  function applyDeployAt(c, r) {
    if (!inBounds(c, r)) return;
    const tool = MK.TOOL_BY_ID[state.deployTool];
    if (!tool) return;
    const isAir = tool.kind === 'air';
    if (!isAir && state.mode !== 'attack') return;
    if (isAbsent(c, r)) { flash('这一格不存在'); return; }
    if (isAir && !isEdgeCell(c, r)) { flash('飞机进场点只能放在地图边缘'); return; }
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
      const cellTool = (state.toolTab === 'deploy' &&
        MK.TOOL_BY_ID[state.deployTool] && MK.TOOL_BY_ID[state.deployTool].kind === 'cell') ||
        state.toolTab === 'building';
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
      if (state.toolTab === 'deploy' || state.toolTab === 'building') {
        removeDeployAt(c, r);
        syncBuildingFlags();
        updateCounts();
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
    applyBuildingHover(i);
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

  /* =============================================================
   * 阶段设置（A / B / C）
   * 规则：第 1 大回合固定是 A 阶段；B、C 的开始回合由地图单独设置。
   * 说明：index.html / style.css 归 UI agent，这里用运行时注入自己的一块面板，
   *       不动他们的文件。
   * ============================================================= */
  /* =============================================================
   * 默认朝向（六边形转盘）
   * 单位放上地图后的初始朝向，0–5 对应六条边：
   *   0 东 · 1 东北 · 2 西北 · 3 西 · 4 西南 · 5 东南
   * 同样用运行时注入，不动 index.html / style.css。
   * ============================================================= */
  function ensureFacingStyles() {
    if (document.getElementById('facing-style')) return;
    const st = document.createElement('style');
    st.id = 'facing-style';
    st.textContent = [
      '.facing-box{margin-top:14px;padding-top:10px;border-top:1px solid #323a46}',
      '.facing-box h2{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1px;color:#8d97a5}',
      '.facing-box h2 em{font-style:normal;font-size:11px;letter-spacing:0;color:#66707d}',
      '.facing-wrap{display:flex;align-items:center;gap:12px}',
      '.facing-dial{width:92px;height:92px;display:block;cursor:pointer;flex:0 0 auto}',
      '.facing-dial .wedge{fill:#232931;stroke:#323a46;stroke-width:1;transition:fill .12s}',
      '.facing-dial .wedge:hover{fill:#2f3742}',
      '.facing-dial .wedge.on{fill:rgba(224,164,88,0.30);stroke:#e0a458}',
      '.facing-dial .rim{fill:none;stroke:#4a5361;stroke-width:1.4}',
      '.facing-dial .hub{fill:#1b2027;stroke:#323a46;stroke-width:1}',
      '.facing-dial .shaft{stroke:#e0a458;stroke-width:2.6;stroke-linecap:round;fill:none}',
      '.facing-dial .head{fill:#e0a458}',
      '.facing-info{font-size:12px;line-height:1.65;color:#b9c2ce}',
      '.facing-info b{color:#e0a458;font-weight:600}',
      '.facing-info .hint{display:block;margin-top:3px;font-size:11px;color:#8d97a5}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function facingDialSvg(current) {
    const cx = 48, cy = 48, R = 42;
    // 六边形顶点：屏幕角度 30+60k（SVG y 向下，所以 sin 取负）
    const V = [];
    for (let k = 0; k < 6; k++) {
      const a = (30 + 60 * k) * Math.PI / 180;
      V.push([cx + Math.cos(a) * R, cy - Math.sin(a) * R]);
    }
    const f2 = function (n) { return n.toFixed(2); };
    let svg = '<svg class="facing-dial" viewBox="0 0 96 96" role="img" aria-label="默认朝向">';

    // 六个扇形：每个扇形正好是六边形的一条边 = 一个朝向
    for (let i = 0; i < 6; i++) {
      const p1 = V[(i + 5) % 6];
      const p2 = V[i];
      svg += '<path class="wedge' + (i === current ? ' on' : '') + '" data-i="' + i +
        '" d="M' + cx + ',' + cy +
        ' L' + f2(p1[0]) + ',' + f2(p1[1]) +
        ' L' + f2(p2[0]) + ',' + f2(p2[1]) + ' Z"></path>';
    }

    // 外框（六边形）
    svg += '<polygon class="rim" points="' +
      V.map(function (p) { return f2(p[0]) + ',' + f2(p[1]); }).join(' ') + '"></polygon>';

    // 指针：沿当前朝向
    const th = (60 * current) * Math.PI / 180;
    const dx = Math.cos(th), dy = -Math.sin(th);
    const px = -dy * 4.6, py = dx * 4.6;
    const at = function (t) { return [cx + dx * R * t, cy + dy * R * t]; };
    const s0 = at(0.10), s1 = at(0.56), tip = at(0.84);
    svg += '<line class="shaft" x1="' + f2(s0[0]) + '" y1="' + f2(s0[1]) +
      '" x2="' + f2(s1[0]) + '" y2="' + f2(s1[1]) + '"></line>';
    svg += '<polygon class="head" points="' +
      f2(tip[0]) + ',' + f2(tip[1]) + ' ' +
      f2(s1[0] + px) + ',' + f2(s1[1] + py) + ' ' +
      f2(s1[0] - px) + ',' + f2(s1[1] - py) + '"></polygon>';
    svg += '<circle class="hub" cx="' + cx + '" cy="' + cy + '" r="4.2"></circle>';
    svg += '</svg>';
    return svg;
  }

  function buildFacingUI() {
    ensureFacingStyles();
    if (document.getElementById('facing-box')) return;
    const anchor = document.getElementById('phase-box') || document.getElementById('counts');
    const host = anchor ? anchor.parentNode : null;
    if (!host) return;

    const box = document.createElement('div');
    box.id = 'facing-box';
    box.className = 'facing-box';
    box.innerHTML =
      '<h2>默认朝向 <em>放置后的初始方向</em></h2>' +
      '<div class="facing-wrap">' +
      '<span id="facing-dial-host"></span>' +
      '<span class="facing-info" id="facing-info"></span>' +
      '</div>';
    if (document.getElementById('phase-box')) host.insertBefore(box, document.getElementById('phase-box'));
    else host.appendChild(box);

    renderFacingUI();
  }

  function renderFacingUI() {
    const dialHost = document.getElementById('facing-dial-host');
    const info = document.getElementById('facing-info');
    if (!dialHost || !info) return;
    dialHost.innerHTML = facingDialSvg(state.facing);
    const name = MAPIO.facingName(state.facing);
    info.innerHTML = '单位放上地图时朝 <b>' + name + '</b>' +
      '<span class="hint">点转盘的扇形改方向</span>';
    const svg = dialHost.querySelector('svg');
    if (svg && !svg.dataset.bound) {
      svg.dataset.bound = '1';
      svg.addEventListener('click', function (e) {
        const t = e.target;
        const i = t && t.getAttribute ? t.getAttribute('data-i') : null;
        if (i == null) return;
        setFacing(Number(i));
      });
    }
  }

  function setFacing(i) {
    const next = MAPIO.normalizeFacing(i);
    if (next === state.facing) return;
    beginAction();
    state.facing = next;
    commitAction();
    renderFacingUI();
  }

  /* =============================================================
   * 地图形状（挖空 / 补格）—— 支持非矩形地图
   * ============================================================= */
  function ensureShapeStyles() {
    if (document.getElementById('shape-style')) return;
    const st = document.createElement('style');
    st.id = 'shape-style';
    st.textContent = [
      '.shape-box{margin-top:14px;padding-top:10px;border-top:1px solid #323a46}',
      '.shape-box h2{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1px;color:#8d97a5}',
      '.shape-box h2 em{font-style:normal;font-size:11px;letter-spacing:0;color:#66707d}',
      '.shape-actions{display:flex;gap:6px;margin-bottom:7px}',
      '.shape-btn{flex:1;height:28px;border-radius:6px;border:1px solid #323a46;background:#262c35;color:#c3cbd6;font:inherit;font-size:12px;cursor:pointer;transition:background .12s,border-color .12s,color .12s}',
      '.shape-btn:hover{background:#2f3742}',
      '.shape-btn.on{background:rgba(224,164,88,0.22);border-color:#e0a458;color:#e8c089}',
      '.shape-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.shape-info{font-size:11.5px;line-height:1.6;color:#8d97a5}',
      '.shape-info b{color:#c3cbd6;font-weight:600}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function buildShapeUI() {
    ensureShapeStyles();
    if (document.getElementById('shape-box')) return;
    const anchor2 = document.getElementById('facing-box') || document.getElementById('phase-box') || document.getElementById('counts');
    const host = anchor2 ? anchor2.parentNode : null;
    if (!host) return;

    const box = document.createElement('div');
    box.id = 'shape-box';
    box.className = 'shape-box';
    box.innerHTML =
      '<h2>地图形状 <em>挖空 / 补格</em></h2>' +
      '<div class="shape-actions">' +
      '<button class="shape-btn" id="shape-toggle" type="button">开始挖空</button>' +
      '<button class="shape-btn" id="shape-reset" type="button">恢复矩形</button>' +
      '</div>' +
      '<div class="shape-info" id="shape-info"></div>';
    if (document.getElementById('facing-box')) host.insertBefore(box, document.getElementById('facing-box'));
    else host.appendChild(box);

    document.getElementById('shape-toggle').addEventListener('click', function () {
      state.shapeMode = !state.shapeMode;
      if (state.shapeMode && state.toolTab !== 'terrain') setToolTab('terrain');
      renderShapeUI();
      canvas.style.cursor = state.shapeMode ? 'crosshair' : '';
    });
    document.getElementById('shape-reset').addEventListener('click', function () {
      if (!state.absent || holeCount() === 0) return;
      beginAction();
      state.absent.fill(0);
      markChangedShape();
      renderShapeUI();
      needRender = true;
    });
    renderShapeUI();
  }

  function holeCount() {
    if (!state.absent) return 0;
    let n = 0;
    for (let i = 0; i < state.absent.length; i++) if (state.absent[i]) n++;
    return n;
  }

  function markChangedShape() {
    updateBoard();
    rebuildDeploy();
    updateCounts();
    scheduleSave();
    updateButtons();
  }

  function renderShapeUI() {
    const btn = document.getElementById('shape-toggle');
    const info = document.getElementById('shape-info');
    if (!btn || !info) return;
    const holes = holeCount();
    const total = state.cols * state.rows;
    btn.classList.toggle('on', !!state.shapeMode);
    btn.textContent = state.shapeMode ? '结束形状编辑' : '开始挖空';
    const resetBtn = document.getElementById('shape-reset');
    if (resetBtn) resetBtn.disabled = holes === 0;

    if (state.shapeMode) {
      info.innerHTML = '左键点格子：<b>删除</b>；再点一次 <b>恢复</b>。<br>右键拖动仍是转视角。';
    } else {
      info.innerHTML = holes
        ? '现有 <b>' + (total - holes) + '</b> 格，挖空 <b>' + holes + '</b> 格。'
        : '现有 <b>' + total + '</b> 格（完整矩形）。';
    }
  }

  /* 点一格：有 → 删，没有 → 补 */
  function toggleCell(c, r) {
    if (!inBounds(c, r)) return;
    const idx = r * state.cols + c;
    if (!state.absent) state.absent = new Uint8Array(state.cols * state.rows);
    const wasAbsent = !!state.absent[idx];
    // 拖动时外面已经开了事务（markChanged 会提交它）；单独调用时自己开一个，保证能撤销
    const ownTx = !state.pending;
    if (ownTx) beginAction();
    state.absent[idx] = wasAbsent ? 0 : 1;
    if (!wasAbsent) {
      // 删掉的格子不能留着标记
      MK.removeAt(state.deploy, c, r, state.cols);
    }
    if (ownTx) commitAction(); else markChanged();
    markChangedShape();
    renderShapeUI();
    flash(wasAbsent ? '已补回这一格' : '已删除这一格');
  }

  function ensurePhaseStyles() {
    if (document.getElementById('phase-style')) return;
    const st = document.createElement('style');
    st.id = 'phase-style';
    st.textContent = [
      '.phase-box{margin-top:14px;padding-top:10px;border-top:1px solid #323a46}',
      '.phase-box h2{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1px;color:#8d97a5}',
      '.phase-box h2 em{font-style:normal;font-size:11px;letter-spacing:0;color:#66707d}',
      '.phase-row{display:flex;align-items:center;gap:7px;margin-bottom:7px;font-size:12px;color:#b9c2ce}',
      '.phase-row .ph-name{width:15px;font-weight:600;color:#e0a458}',
      '.phase-row input{width:58px;height:26px;padding:0 6px;border-radius:6px;border:1px solid #323a46;background:#262c35;color:#e3e7ec;font:inherit;font-size:12px;text-align:center;outline:none}',
      '.phase-row input:focus{border-color:#e0a458}',
      '.phase-row input:disabled{opacity:.45;cursor:not-allowed}',
      '.phase-row .ph-desc{color:#8d97a5;font-size:11.5px}',
      '.phase-summary{margin-top:8px;font-size:11.5px;line-height:1.65;color:#a9b3c0}',
      '.phase-summary b{color:#e0a458;font-weight:600}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function buildPhaseUI() {
    ensurePhaseStyles();
    if (document.getElementById('phase-box')) return;
    const anchor = document.getElementById('counts');
    const host = anchor ? anchor.parentNode : null;
    if (!host) return;

    const box = document.createElement('div');
    box.id = 'phase-box';
    box.className = 'phase-box';
    box.innerHTML =
      '<h2>阶段 <em>回合节奏</em></h2>' +
      '<div class="phase-row"><span class="ph-name">A</span>' +
      '<span class="ph-desc">第 1 回合起（固定）</span></div>' +
      '<div class="phase-row"><span class="ph-name">B</span>' +
      '<input id="phase-b" type="number" min="2" max="99" step="1" placeholder="—"><span class="ph-desc">回合起</span></div>' +
      '<div class="phase-row"><span class="ph-name">C</span>' +
      '<input id="phase-c" type="number" min="2" max="99" step="1" placeholder="—"><span class="ph-desc">回合起</span></div>' +
      '<div class="phase-summary" id="phase-summary"></div>';
    host.appendChild(box);

    const bEl = document.getElementById('phase-b');
    const cEl = document.getElementById('phase-c');
    const onEdit = function () { applyPhasesFromInputs(); };
    if (bEl) bEl.addEventListener('change', onEdit);
    if (cEl) cEl.addEventListener('change', onEdit);
    renderPhaseUI();
  }

  function renderPhaseUI() {
    const bEl = document.getElementById('phase-b');
    const cEl = document.getElementById('phase-c');
    const sum = document.getElementById('phase-summary');
    if (!bEl || !cEl || !sum) return;

    const b = state.phases.b, c = state.phases.c;
    bEl.value = b == null ? '' : b;
    cEl.value = c == null ? '' : c;
    cEl.disabled = (b == null);

    let text;
    if (b == null) {
      text = '整局只有 <b>A</b> 阶段（第 1 回合起）。填 B 的开场回合即可开启第二阶段。';
    } else if (c == null) {
      text = '<b>A</b> 第 1–' + (b - 1) + ' 回合 · <b>B</b> 第 ' + b + ' 回合起。';
    } else {
      text = '<b>A</b> 第 1–' + (b - 1) + ' 回合 · <b>B</b> 第 ' + b + '–' + (c - 1) +
        ' 回合 · <b>C</b> 第 ' + c + ' 回合起。';
    }
    sum.innerHTML = text;
  }

  function applyPhasesFromInputs() {
    const bEl = document.getElementById('phase-b');
    const cEl = document.getElementById('phase-c');
    if (!bEl || !cEl) return;

    const rawB = bEl.value === '' ? null : Number(bEl.value);
    const rawC = cEl.value === '' ? null : Number(cEl.value);
    // 没有 B 就不存在 C：清空 B 时 C 一并清掉
    const next = (rawB == null)
      ? { a: 1, b: null, c: null }
      : MAPIO.normalizePhases({ b: rawB, c: rawC });

    const changed = next.b !== state.phases.b || next.c !== state.phases.c;
    if (changed) {
      beginAction();
      state.phases = next;
      commitAction();
    }
    renderPhaseUI();

    if (rawB != null && next.b == null) flash('B 阶段起始回合要在 2–99 之间');
    else if (rawB != null && rawC != null && next.c == null) flash('C 阶段要晚于 B（且 ≤ 99）');
  }

  /* 第 n 回合属于哪个阶段 —— 供后续对战逻辑使用 */
  function phaseAt(round) {
    return MAPIO.phaseOfRound(state.phases, round);
  }

  function updateCounts() {
    const counts = new Array(TERRAINS.length).fill(0);
    let present = 0;
    for (let i = 0; i < state.cells.length; i++) {
      if (state.absent && state.absent[i]) continue;
      counts[state.cells[i]]++;
      present++;
    }
    let html = '';
    TERRAINS.forEach(function (t, i) {
      if (!counts[i]) return;
      html += '<div class="count-row"><span class="sw" style="background:' + t.fill + ';border-color:' + t.line + '"></span>' +
        '<span class="nm">' + t.name + '</span><span class="num">' + counts[i] + '</span></div>';
    });
    const holes = state.cols * state.rows - present;
    html += '<div class="count-total">共 ' + present + ' 格' +
      (holes ? '（矩形 ' + state.cols + '×' + state.rows + '，挖空 ' + holes + '）'
             : '（' + state.cols + ' × ' + state.rows + '）') + '</div>';

    // 部署标记（攻防战才有出生点/指挥部/部署区；飞机进场点两种模式都用）
    {
      const d = state.deploy;
      const row = function (name, ok, extra) {
        return '<div class="count-row"><span class="mark ' + (ok ? 'on' : '') + '"></span>' +
          '<span class="nm">' + name + '</span><span class="num">' + (ok ? (extra || '✓') : '—') + '</span></div>';
      };
      html += '<div class="deploy-summary"><div class="sub">' + (state.mode === 'attack' ? '部署标记' : '飞机进场点') + '</div>';
      if (state.mode === 'attack') {
        html += row('进攻方出生点', !!d.spawn, d.spawn ? coordLabel(d.spawn.c, d.spawn.r) : '未设置');
        html += row('防守方部署区', d.zone.size > 0, d.zone.size ? d.zone.size + ' 格' : '未设置');
      }
      html += row('进攻方飞机进场', d.airA.length > 0, d.airA.length ? d.airA.length + ' 个' : '未设置');
      html += row('防守方飞机进场', d.airD.length > 0, d.airD.length ? d.airD.length + ' 个' : '未设置');
      html += '</div>';

      // 建筑（可破坏）
      const bl = d.buildings || [];
      html += '<div class="deploy-summary"><div class="sub">建筑</div>';
      MK.BUILDINGS.forEach(function (def) {
        const got = bl.filter(function (x) { return x.t === def.id; });
        const label = got.length && got[0].c != null ? coordLabel(got[0].c, got[0].r) : '未设置';
        html += row(def.name, got.length > 0, got.length > 1 ? got.length + ' 个' : label);
      });
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
  /* =============================================================
   * 建筑栏：地形 / 部署 之外的第三个标签页
   * 建筑是场景里可破坏的东西（指挥所、房子……），一格一个。
   * index.html 归 UI agent，这里运行时注入按钮和面板。
   * ============================================================= */
  let buildingUIReady = false;

  function buildBuildingPane() {
    if (buildingUIReady) return;
    const tabs = document.querySelector('#palette-panel .tabs');
    const deployPane = document.getElementById('deploy-pane');
    const deployTab = document.getElementById('tab-deploy');
    if (!tabs || !deployPane || !deployTab) return;

    const tab = document.createElement('button');
    tab.id = 'tab-building';
    tab.className = 'tab';
    tab.textContent = '建筑';
    deployTab.parentNode.insertBefore(tab, deployTab.nextSibling);

    const pane = document.createElement('div');
    pane.id = 'building-pane';
    pane.className = 'hidden';
    pane.innerHTML =
      '<h2>建筑 <span class="tip">可破坏</span></h2>' +
      '<div class="palette-grid" id="buildingGrid"></div>' +
      '<button id="btn-clear-building" class="btn wide">清空建筑</button>' +
      '<p class="note">建筑是场景里可破坏的部分，一格只能放一个。<br>' +
      '右键单击删除。模型还没做好，先用标记代替。</p>';
    deployPane.parentNode.insertBefore(pane, deployPane.nextSibling);

    tab.addEventListener('click', function () { setToolTab('building'); });
    document.getElementById('btn-clear-building').addEventListener('click', function () {
      if (!state.deploy.buildings || !state.deploy.buildings.length) { flash('还没有建筑'); return; }
      beginAction();
      state.deploy.buildings.length = 0;
      syncBuildingFlags();
      commitAction();
      rebuildDeploy();
      updateCounts();
      flash('已清空建筑');
    });

    buildBuildingPalette();
    buildingUIReady = true;
  }

  function buildBuildingPalette() {
    const grid = document.getElementById('buildingGrid');
    if (!grid) return;
    grid.innerHTML = '';
    MK.BUILDINGS.forEach(function (b) {
      const btn = document.createElement('button');
      btn.className = 'terra';
      btn.type = 'button';
      btn.dataset.building = b.id;
      btn.title = b.name;
      if (b.id === state.buildingTool) btn.classList.add('active');

      const icon = document.createElement('canvas');
      icon.width = 88; icon.height = 88;
      icon.className = 'icon';
      MK.drawIcon(icon, b.id);

      const label = document.createElement('span');
      label.className = 'nm';
      label.textContent = b.name;

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        state.buildingTool = b.id;
        Array.prototype.forEach.call(grid.children, function (el) {
          el.classList.toggle('active', el.dataset.building === b.id);
        });
      });
      grid.appendChild(btn);
    });
  }

  /* 建筑里的指挥所同步到 deploy.hqA / hqD（老字段，线上对战还在读） */
  function syncBuildingFlags() {
    const list = state.deploy.buildings || [];
    ['hqA', 'hqD'].forEach(function (t) {
      const b = list.filter(function (x) { return x.t === t; })[0];
      state.deploy[t] = b ? { c: b.c, r: b.r } : null;
    });
  }

  function applyBuildingAt(c, r) {
    if (!inBounds(c, r)) return;
    if (isAbsent(c, r)) { flash('这一格不存在'); return; }
    if (!state.deploy.buildings) state.deploy.buildings = [];
    const res = MK.applyBuilding(state.deploy.buildings, state.buildingTool, c, r);
    if (res === 'same') return;
    if (res === 'unique-taken') {
      flash(MK.BUILDING_BY_ID[state.buildingTool].name + ' 只能有一个');
      return;
    }
    markChanged();
    syncBuildingFlags();
    rebuildDeploy();
    updateCounts();
  }

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
    // 飞机进场点与模式无关，所以「部署」页在两种模式下都显示标记；
    // 出生点 / 指挥部 / 部署区 只在攻防战里画。
    state.showMarkers = state.toolTab === 'deploy' || state.toolTab === 'building';
    rebuildDeploy();
  }

  function setToolTab(tab) {
    if (tab !== 'terrain' && tab !== 'deploy' && tab !== 'building') tab = 'terrain';
    state.toolTab = tab;
    const t1 = document.getElementById('tab-terrain');
    const t2 = document.getElementById('tab-deploy');
    const t3 = document.getElementById('tab-building');
    const p1 = document.getElementById('terrain-pane');
    const p2 = document.getElementById('deploy-pane');
    const p3 = document.getElementById('building-pane');
    if (t1) t1.classList.toggle('active', tab === 'terrain');
    if (t2) t2.classList.toggle('active', tab === 'deploy');
    if (t3) t3.classList.toggle('active', tab === 'building');
    if (p1) p1.classList.toggle('hidden', tab !== 'terrain');
    if (p2) p2.classList.toggle('hidden', tab !== 'deploy');
    if (p3) p3.classList.toggle('hidden', tab !== 'building');
    canvas.style.cursor = (tab === 'deploy' || tab === 'building') ? 'pointer' : 'default';
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

  /* 当前地图对象：导出和自动保存都走这里，字段不会再漏 */
  function currentMap() {
    return {
      cols: state.cols,
      rows: state.rows,
      cells: state.cells,
      mode: state.mode,
      deploy: state.deploy,
      phases: state.phases,
      facing: state.facing,
      absent: state.absent,
    };
  }

  function toJSON() {
    return MAPIO.serialize(currentMap(), TERRAINS);
  }

  function applyJSON(obj) {
    // 解析、地形下标翻译、版本兼容都在 mapio.js 里
    const r = MAPIO.parse(obj, TERRAINS, T_INDEX);
    state.cols = r.cols;
    state.rows = r.rows;
    state.cells = r.cells;
    state.mode = r.mode || 'attack';
    state.deploy = r.deploy || MK.createDeploy();
    state.phases = MAPIO.normalizePhases(r.phases);
    state.facing = MAPIO.normalizeFacing(r.facing);
    state.absent = r.absent || new Uint8Array(state.cols * state.rows);
    state.undo.length = 0;
    state.redo.length = 0;
    syncSizeInputs();
    buildBoard();
    fitView();
    syncModeUI();
    updateCounts();
    updateButtons();
    renderFacingUI();
    renderPhaseUI();
    renderShapeUI();
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
      MAPIO.saveLocal(currentMap(), TERRAINS);
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
    state.absent = new Uint8Array(cols * rows);
    state.deploy = MK.createDeploy();
    state.phases = { a: 1, b: null, c: null };
    state.facing = 0;
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
    renderFacingUI();
    renderPhaseUI();
    renderShapeUI();
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
    buildBuildingPane();
    loadBuildingModels();

    if (!restoreLocal()) {
      state.cells = makeCells(state.cols, state.rows, PLAIN);
      state.absent = new Uint8Array(state.cols * state.rows);
      state.deploy = MK.createDeploy();
      buildBoard();
    }
    selectTerrain(PLAIN);
    syncModeUI();
    setToolTab('terrain');
    renderLegend();
    buildPhaseUI();
    buildFacingUI();
    buildShapeUI();
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
      phaseAt: phaseAt,
      setFacing: setFacing,
      toggleCell: toggleCell,
      applyBuildingAt: applyBuildingAt,
      loadBuildingModels: loadBuildingModels,
      syncBuildingFlags: syncBuildingFlags,
      isEdgeCell: isEdgeCell,
      holeCount: holeCount,
      renderFacingUI: renderFacingUI,
      renderPhaseUI: renderPhaseUI,
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
