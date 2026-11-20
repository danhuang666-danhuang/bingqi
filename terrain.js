/* 地形表 —— 地图格的属性来源
 *
 * 数值全部取自《规则.docx》第 6 节「地形效果」，另外两条散在别处但同样属于格子属性：
 *   - 视野阻挡：2.2 节「山地、丘陵、森林、城区、房区等地形可阻挡视野」
 *   - 巷战：1.2 节「当单位处于城区或房区地形格内时，其相邻格的攻击/反击均视为巷战距离」
 *
 * rule 字段说明（每个地图格都按所在地形带一份）：
 *   move      常规行动力消耗（进入该格）
 *   moveMech  机械化 / 摩托化单位的消耗（道路减半、森林加 1）
 *   protect   伤害抗性，0~1（对应规则里的 30% / 50% …）
 *   blocksSight 阻挡视野
 *   urban     巷战地形（相邻格按巷战距离结算）
 *   riverReset 上河后行动力清零
 *   chaos     混乱判定加成（沼泽 +1）
 *
 * 「山地作战」「侦察」这类词条是对单位侧的修正，不在格子属性里，由战斗逻辑叠加。
 */
window.TERRAINS = [
  {
    id: 'plain', name: '平原', key: '1',
    fill: '#cde0a3', line: '#b0c489', ink: '#89a367',
    color3d: 0xa6cb70,
    rule: { move: 1, moveMech: 1, protect: 0, blocksSight: false, urban: false, riverReset: false, chaos: 0 },
    limit: '—',
    desc: '开阔地，无遮挡。',
  },
  {
    id: 'road', name: '道路', key: '2',
    fill: '#e7dcc2', line: '#c9bd9c', ink: '#9c8757',
    color3d: 0xd6c096,
    linear: true,
    rule: { move: 1, moveMech: 0.5, protect: 0, blocksSight: false, urban: false, riverReset: false, chaos: 0 },
    limit: '机械化 / 摩托化仅需 0.5',
    desc: '沿路机动，机械化部队更省行动力。',
  },
  {
    id: 'rail', name: '铁路', key: '3',
    fill: '#e5e1d5', line: '#c5c1b1', ink: '#6d6659',
    color3d: 0xc0b9a4,
    linear: true,
    rule: { move: 1, moveMech: 0.5, protect: 0, blocksSight: false, urban: false, riverReset: false, chaos: 0 },
    limit: '视同道路',
    desc: '模型包中的铁路段，规则上按道路处理。',
  },
  {
    id: 'house', name: '房区', key: '4',
    fill: '#e8cfa8', line: '#ccb087', ink: '#a97a4b',
    color3d: 0xd6a674,
    rule: { move: 1, moveMech: 1, protect: 0.30, blocksSight: true, urban: true, riverReset: false, chaos: 0 },
    limit: '阻挡视野 · 巷战',
    desc: '居民区，可提供掩护。',
  },
  {
    id: 'city', name: '城区', key: '5',
    fill: '#cfc8bd', line: '#b0a89b', ink: '#7c7367',
    color3d: 0xaea497,
    rule: { move: 1, moveMech: 1, protect: 0.50, blocksSight: true, urban: true, riverReset: false, chaos: 0 },
    limit: '阻挡视野 · 巷战',
    desc: '城市废墟，抗性最高的地形。',
  },
  {
    id: 'forest', name: '森林', key: '6',
    fill: '#a9c986', line: '#8cae6b', ink: '#5a7c3d',
    color3d: 0x74a854,
    rule: { move: 1, moveMech: 2, protect: 0.20, blocksSight: true, urban: false, riverReset: false, chaos: 0 },
    limit: '阻挡视野 · 机械化 / 摩托化额外 +1',
    desc: '遮蔽良好的林地，车辆难行。',
  },
  {
    id: 'hill', name: '丘陵', key: '7',
    fill: '#d9d0a1', line: '#bbb083', ink: '#93864f',
    color3d: 0xc9b878,
    rule: { move: 2, moveMech: 2, protect: 0.25, blocksSight: true, urban: false, riverReset: false, chaos: 0 },
    limit: '阻挡视野',
    desc: '起伏地形，需绕行。',
  },
  {
    id: 'mountain', name: '山地', key: '8',
    fill: '#cbc1ab', line: '#a99f89', ink: '#7b6f58',
    color3d: 0xa89b82,
    rule: { move: 3, moveMech: 3, protect: 0.40, blocksSight: true, urban: false, riverReset: false, chaos: 0 },
    limit: '阻挡视野',
    desc: '难以通行的高地。',
  },
  {
    id: 'river', name: '河流', key: '9',
    fill: '#aacfe0', line: '#89b4c9', ink: '#4f8fab',
    color3d: 0x74b2d4,
    rule: { move: 1, moveMech: 1, protect: 0, blocksSight: false, urban: false, riverReset: true, chaos: 0 },
    limit: '上河后行动力清零',
    desc: '水面，过河后无法继续行动。',
  },
  {
    id: 'swamp', name: '沼泽', key: '0',
    fill: '#b5bfa4', line: '#96a187', ink: '#6c7a5a',
    color3d: 0x93a67f,
    rule: { move: 2, moveMech: 2, protect: 0, blocksSight: false, urban: false, riverReset: false, chaos: 1 },
    limit: '混乱判定 +1',
    desc: '泥泞地带，容易陷入混乱。',
  },
];

/* 展示用的文字由 rule 推出来，避免两处写两遍对不上 */
window.TERRAINS.forEach(function (t) {
  t.cost = String(t.rule.move);
  t.moveMechText = String(t.rule.moveMech);
  t.resist = t.rule.protect ? Math.round(t.rule.protect * 100) + '%' : '无';
});

window.T_INDEX = {};
window.TERRAINS.forEach(function (t, i) { window.T_INDEX[t.id] = i; });
