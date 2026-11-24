/* =============================================================
 * codex.js —— 百科区块
 *
 * 主菜单点「百科」→ 规则 / 词条 / 单位数据表。
 *
 * 内容来源（全部只读引用，没有改动原文件）：
 *   规则.docx            0 术语与总则 / 1 基础行动 / 2 战斗结算 / 3 警戒 /
 *                        4 编制 / 5 辅助兵种 / 6 地形 / 7 词条 / 8 胜利条件
 *   图鉴更新记录/图鉴.xlsx  数据卡：7 张表（美军/德军/苏军/中国/英国 + 美军80s/苏军80s）
 *   terrain.js           地形数值（运行时读 window.TERRAINS，和编辑器同一份）
 *
 * 和别的区块的接口：
 *   - 归属：军械库 agent（协作规则.md 第 1 节）。
 *   - 挂载点 #codex 由 UI 放在 index.html 里；万一没有，这里自己建一个，
 *     免得脚本先加载时整个区块打不开。
 *   - home.js 的 activate() 里 data-module="codex" 调 window.Codex.open()。
 *   - 键盘在 window 捕获阶段接管，不漏给编辑器（app3d.js）的全局快捷键；
 *     搜索框获得焦点时不抢 1–3 和 /。
 * ============================================================= */
(function () {
  'use strict';

  const TITLE = '百科 · 兵棋';

  let mount = document.getElementById('codex');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'codex';
    mount.className = 'codex hidden';
    mount.setAttribute('role', 'dialog');
    mount.setAttribute('aria-modal', 'true');
    mount.setAttribute('aria-label', '百科');
    mount.setAttribute('tabindex', '-1');
    document.body.appendChild(mount);
  }

  /* =============================================================
   * 一、数据
   * ============================================================= */

  const SECTIONS = [
    { id: 'rules', no: '01', name: '规则', en: 'RULES',
      desc: '规则.docx 里的正文：术语、行动、战斗结算、辅助兵种、地形、胜利条件。' },
    { id: 'traits', no: '02', name: '词条', en: 'TRAITS',
      desc: '单位卡上的特殊能力，一条一张卡。' },
    { id: 'units', no: '03', name: '单位数据表', en: 'UNITS',
      desc: '图鉴里的数据卡：按年代、阵营查单位的软/硬攻、反伤系数和血量。' },
  ];

  /* ---------------- 术语（规则第 0 节） ---------------- */
  const TERMS = [
    { t: '行动力', d: '单位执行行动的基础资源，每个玩家回合固定，不可累积。移动、进攻、推进都从这里扣。' },
    { t: '视野', d: '山地、丘陵、森林、城区、房区会阻挡视野。没有视野就不能直接进攻该目标，除非有友军共享。' },
    { t: '玩家回合 / 大回合', d: '玩家回合是当前玩家操控己方所有单位行动；大回合是所有人各自完成一次玩家回合的完整周期。' },
    { t: '昼夜循环', d: '每 3 个大回合为 1 个昼夜循环：第 1、2 大回合是昼间，第 3 大回合是夜间。' },
    { t: '射程', d: '单位不在城区/房区时，相邻格为射程 1，再远一格为射程 2，以此类推；每个距离对应一组伤害值。' },
    { t: '巷战', d: '单位处在城区或房区时，它相邻格的攻击和反击都按「巷战距离」结算。' },
    { t: '半径 / 射程 X 格', d: '以原点为中心、最短路径步数 ≤ X 的所有格子，也就是一块实心六边形区域。' },
    { t: '反击', d: '遭到进攻时立刻还手：反击伤害 = 该距离的进攻伤害 × 单位的反击系数。' },
    { t: '穿甲 AP / 装甲 AV', d: '两者之差 D = AP − AV 决定穿透等级与伤害修正，见「规则 · 战斗结算」。' },
    { t: '主战单位', d: '初始血量 ≥ 4。血量 = 3 是辅助作战单位，< 3 是辅助单位。' },
    { t: '韧性', d: '每个师部有韧性，一方总韧性 = 各师韧性代数和；死亡一个作战单位 −1，减到 0 判负。' },
    { t: '动员点', d: '起始部署时用来放单位的资源，属性卡里的「价格」就是所需动员点。' },
    { t: '混乱', d: '侧后方位主战单位合作进攻时可能触发；混乱中再受任意伤害（哪怕 0 点）直接死亡。' },
    { t: '曲射', d: '炮兵、火箭炮在射程 ≥ 3 进攻时不受反击；在射程 1、2 直射则按普通单位处理。' },
    { t: '禁飞区', d: '防空单位半径之内，敌方飞机不能直接穿越。' },
  ];

  /* ---------------- 规则（规则.docx 正文） ---------------- */
  const RULES = [
    {
      id: 'basics', no: '0', t: '术语与总则',
      blocks: [
        { dl: TERMS.map(function (x) { return [x.t, x.d]; }) },
        { p: '**昼夜规则**：每 3 个大回合为 1 个昼夜循环，伤害按下面的时段修正。' },
        { table: {
            head: ['时段', '大回合序号', '进攻方伤害', '防守方反击伤害'],
            rows: [
              ['昼间', '第 1、2 大回合', '100%', '100%'],
              ['夜间', '第 3 大回合', '50%', '75%'],
            ],
        } },
        { note: '各条目另有说明的从其说明（例如炮兵曲射不受昼夜修正）。' },
      ],
    },
    {
      id: 'act', no: '1.1 – 1.3', t: '移动 · 进攻 · 推进',
      blocks: [
        { p: '**移动**：消耗行动力进入相邻格，消耗值见「6 地形效果」；**空军移动不消耗行动力，也不受地形限制。**' },
        { p: '**进攻消耗**：地面单位进攻 2 点；空军对地攻击 1 点；空战 2 点；重轰词条轰炸 2 点。' },
        { p: '**进攻后限制**：地面单位进攻后，本玩家回合内不能再做任何行动（即使还有行动力）；空军没有这个限制。' },
        { p: '**射程**：不在城区/房区时，相邻格是射程 1，再远一格是射程 2，以此类推。处在城区/房区时，相邻格的攻防都按**巷战**结算。' },
        { p: '**反击**：遭进攻时立刻还手，反击伤害 = 该距离的进攻伤害 × 反击系数（单位固有属性）。炮兵与火箭炮在曲射（射程 ≥ 3）时不受反击。' },
        { p: '**推进**：' },
        { ul: [
          '条件：与敌方单位相邻（紧贴）。消耗 3 点行动力。',
          '效果：把敌方单位朝远离自己的方向强制移动 1 格；推进完成后不能再做任何行动。',
          '限制：目标格被地形或单位挡住时无法推进。',
          '伤害：己方用「射程 0 / 巷战进攻伤害」，敌方用「巷战反击伤害」，且无视词条限制必定反击。',
          '减伤与射程判定按**推进前**两个单位所处的地形算，伤害受昼夜修正影响。',
        ] },
        { note: '半径 / 射程 X 格 = 以原点为中心、最短路径步数 ≤ X 的所有格子（实心六边形区域）。' },
      ],
    },
    {
      id: 'combat', no: '2.1 – 2.5', t: '战斗结算',
      blocks: [
        { p: '**穿透判定**：设穿甲值 AP、装甲值 AV，差值 D = AP − AV。' },
        { table: {
            head: ['条件', '穿透等级', '伤害修正'],
            rows: [
              ['D > 3', '完全穿透', '×1.0（正常）'],
              ['0 < D ≤ 3', '半穿透', '×0.5（减半）'],
              ['−3 ≤ D ≤ 0', '难穿透', '×0.33（三分之一）'],
              ['D < −3', '无法穿透', '×0.2（五分之一）'],
            ],
        } },
        { ul: [
          '**小数伤害**：保留概率。伤害 0.125 就掷骰判 12.5% 造成 1 点，否则 0 点。',
          '**侧后方**：从侧方或后方进攻时，取被攻击单位的侧甲或背甲。',
          '**软攻 / 硬攻**：对装甲单位（AV > 0）用硬攻，对非装甲用软攻，反击同理。正面护甲非 0 而侧甲为 0 时，从侧面进攻仍取硬攻。',
          '**朝向**：由防守方声称正面朝向（不改单位物理朝向）。夹角 ≤ 60° 为正面，60°–120° 为侧方，≥ 120° 为后方。',
          '**防御方反应**：只能选一个进攻单位反击；即使防守方在本次战斗中死亡，也照常反击。',
          '**合作进攻穿透**：全队取最优穿透等级（有人完全穿透就全队算完全穿透）；判为无法穿透时不计算混乱。',
          '**血量显示**：单位朝向表示血量 —— 指向防守方为 6 血，扣 1 血逆时针转 60°。血量 ≤ 0 死亡并移出地图，溢出伤害不转移。',
        ] },
        { p: '**混乱判定**：若本次合作进攻中，有**相邻侧后方、初始血量 ≥ 4 的主战单位**参与，则' },
        { p: '混乱概率 = 相邻侧后方参与进攻的主战单位数 ÷ 6（上限 100%）。' },
        { ul: [
          '判定成功 → 目标陷入混乱，持续到被特殊词条解除。',
          '混乱中单位仍可正常移动，但**再受到任意伤害（即使为 0）直接死亡**。',
        ] },
        { note: '沼泽等地形会给混乱判定 +1（见「6 地形效果」）。' },
      ],
    },
    {
      id: 'vision', no: '2.2', t: '视野与协同作战',
      blocks: [
        { ul: [
          '只能攻击自己有视野的目标，或参与合作进攻的友军有视野的目标。',
          '自己没视野、也没有友军共享视野时，不能发起攻击。',
          '**侦察单位**半径内的所有目标都视为有视野，并实时与友军共享；目标离开半径立刻丢失视野。',
        ] },
        { p: '**合作进攻**：发起单位可以等友军调动就位，再联合进攻同一目标。只要进攻方里任意一个单位有目标视野，所有在攻击范围内的友方单位都能参战。' },
        { note: '山地、丘陵、森林、城区、房区阻挡视野。' },
      ],
    },
    {
      id: 'guard', no: '3', t: '警戒与反应',
      blocks: [
        { p: '两个主战单位之间相隔**恰好 1 格**空隙时形成警戒。' },
        { ul: [
          '敌方单位移动到该空隙格时必须停止移动。',
          '若它还有行动力，可以选择进攻警戒单位，但本回合不能再移动。',
        ] },
      ],
    },
    {
      id: 'roster', no: '4.1 – 4.3', t: '单位分类、编制与部署',
      blocks: [
        { p: '**按血量分类**：血量 ≥ 4 是主战单位；= 3 是辅助作战单位；< 3 是辅助单位。' },
        { ul: [
          '**配卡**：按所选师部卡池配置单位，不同师有各自的卡池和卡槽。',
          '**起始部署**：玩家回合开始前获得动员点，在己方增援区或防守区放置单位；数量由师部数据卡决定，属性卡的「价格」就是所需动员点。',
          '**增援部署**：特定大回合后双方获得对应支援师，在增援区放增援单位；具体时间由地图决定。',
          '**韧性**：每个师部有韧性，一方总韧性 = 各师韧性代数和；死亡一个作战单位 −1，减到 0 判负。',
        ] },
        { p: '**数据卡 / 属性卡模板**' },
        { ul: [
          '数据卡：序号 / 单位名 / 巷战软攻 / 巷战硬攻 / 射程1软攻 / 射程1硬攻 / 射程2软攻 / 射程2硬攻 / 反伤系数 / 血量。',
          '属性卡：序号 / 单位名 / 巷战穿甲 / 射程1穿甲 / 射程2穿甲 / 价格 / 血量 / 正甲 / 侧甲 / 背甲 / 行动力 / 词条。',
        ] },
      ],
    },
    {
      id: 'air', no: '5.1', t: '空军',
      blocks: [
        { ul: [
          '所有飞机统一 2 点行动力，移动不消耗；对地攻击 1 点，空战 2 点。',
          '**空中优势**：一方有空军、而敌方既没有防空词条单位参战也没有空军参战 → 敌方地面攻击伤害减半，敌方受到的地面伤害 ×1.5。',
          '**攻击限制**：只能攻击被侦察到的、或正被己方地面单位进攻的目标；每场战斗每方至多投入 2 个空军单位。',
          '**速度决胜**：战斗机（带拦截词条）速度高于敌方最快的飞机 → 用标准伤害额外打击一架敌机；敌方只参战 1 架时改为 1.5 倍伤害。',
          '**夜间**：飞机无法起飞（除非特殊词条允许夜战）。',
        ] },
        { p: '**部署与航向**' },
        { ul: [
          '出场方向在每次任务前指定并告知对方，指定后不可更改。',
          '入场后必须沿严格直线飞行：从入场边缘的起始格出发，沿指定方向一直飞到目标单位（对地）或己方参战单位（防空）上方。',
          '直线路径经过敌方防空单位的防空半径时自动拦截，按射程造成一次防空伤害；经过多个防空就依次各结算一次。',
          '被击落或受创无法继续时任务终止；飞行途中不能转向规避防空。',
        ] },
      ],
    },
    {
      id: 'aa', no: '5.2', t: '防空',
      blocks: [
        { ul: [
          '**禁飞区**：防空单位半径内，敌方飞机无法直接穿越。',
          '**参战支援**：半径 +1 范围内有己方单位与敌空军交火时，防空可以加入该次空战结算。',
          '**射程**：对每个射程内的敌方飞行单位造成对应射程的防空伤害。',
        ] },
      ],
    },
    {
      id: 'arty', no: '5.3', t: '炮兵与火箭炮',
      blocks: [
        { ul: [
          '**曲射**：仅在射程 ≥ 3 时与非曲射单位有区别（不受反击）；射程 1、2 的直射按普通单位处理。',
          '曲射伤害不随距离变化；攻击装甲单位时穿甲修正固定 ×0.5。',
          '曲射伤害不受昼夜修正，但受地形修正。',
          '**攻击限制**：必须攻击处于己方侦察单位视野内、或正与己方其他单位交战的目标。',
          '**消耗**：曲射只花 1 点行动力，每回合至多 2 次，曲射后仍然能移动。',
        ] },
        { p: '**火箭炮**' },
        { ul: [
          '每回合只能进行一次曲射攻击。',
          '攻击后的下一大回合不能攻击（装填期）。',
          '对目标格及半径 1 格内所有地面单位造成伤害，**敌友不分，无视地形修正**。',
          '其余特性与炮兵曲射相同。',
        ] },
      ],
    },
    {
      id: 'terrain', no: '6', t: '地形效果（地图格）', terrain: true,
      blocks: [
        { note: '「常规 / 机械化」是进入该格消耗的行动力；「抗性」是受到的伤害减免；' +
                '「附加」里的河流清零、沼泽混乱会在对应规则里用到。每个地图格都带一份解析后的属性，' +
                '编辑器右侧「地形信息」看到的就是这些数，数据只维护在 terrain.js 里。' },
      ],
    },
    {
      id: 'win', no: '8', t: '胜利条件',
      blocks: [
        { p: '由具体地图决定，也可以由玩家自己约定，例如：保护指定单位或地图格、击杀单位计分、夺取关键点位。' },
        { p: '通用一条：**一方总韧性降到 0 即失败。**' },
      ],
    },
  ];

  /* ---------------- 词条（规则第 7 节） ---------------- */
  const TRAITS = [
    { t: '山地作战', d: '丘陵消耗 1 行动力，山地消耗 2（替代常规消耗）。' },
    { t: '隐蔽', d: '不会受到反击伤害（任何距离）。' },
    { t: '工程', d: '消耗 2 行动力，在半径 1 格内架桥或修路。' },
    { t: '宪兵', d: '半径 1 格内友军免疫并解除混乱；半径 2 格内友军无法被敌军推进。' },
    { t: '医疗', d: '与目标单位合并（消耗本回合行动），恢复目标 1 点血量。' },
    { t: '侦察', d: '目标进入侦察半径后，友军进攻它时行动力 −1（空军不受影响；侦察单位自己受自己的增益）；同时为所有友军提供该目标视野。' },
    { t: '防空', d: '见「5.2 防空」：半径内禁飞、可加入空战、按射程造成防空伤害。' },
    { t: '曲射', d: '见「1.2 进攻」与「5.3 炮兵」：射程 ≥ 3 时不受反击。' },
    { t: '火箭炮', d: '见「5.3 炮兵」：每回合 1 次、装填期、半径 1 内敌友不分。' },
    { t: '拦截', d: '遭受敌方飞机进攻时可以立即起飞参战。' },
    { t: '重轰', d: '轰炸消耗 2 行动力；防空无法拦截（无视禁飞区），但要承受路径上每个防空的伤害。' },
    { t: '高空', d: '被防空攻击时，防空射程 −1；无法被不具有高空词条的战斗机攻击。' },
    { t: '核弹', d: '中心目标必死；半径 1 格内受 3 点伤害，半径 2 格内受 2 点；敌友不分，无视地形修正与穿甲修正。' },
    { t: '碎心', d: '受到的反击伤害 ×2。' },
    { t: '游击队', d: '进攻不消耗行动力，攻击后可继续移动，每回合限攻击一次；与非游击主战单位合作进攻时敌方混乱 +1（多个也只 +1），但攻击后不能移动；若本回合未移动，可在敌方回合任意单位行动后立即行动。' },
  ];

  /* ---------------- 单位数据表（图鉴.xlsx 数据卡） ----------------
   * 由 图鉴更新记录/图鉴.xlsx 导出，只读引用，没有改动原表。
   * 每条：[名称, 巷战软攻, 巷战硬攻, 1软, 1硬, 2软, 2硬, 3软, 3硬, 4软, 4硬, 反伤系数, 血量]
   * 2020s 还没有数据，所以只收了 40s / 80s。
   */
  const UNIT_DATA = {
  '40s': {
    label: '二战', maxRange: 2,
    factions: {
      us: { name: "美国", units: [
        ["步兵营", 2, 0.75, 1.75, 0.5, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["游骑兵营", 3.5, 1.25, 1.5, 0.5, 0.5, 0.25, null, null, null, null, 1.25, 5],
        ["山地步兵营", 2, 0.5, 2, 0.75, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["海军陆战队营", 3.25, 1, 1.25, 0.5, 0.25, 0.25, null, null, null, null, 1.25, 4],
        ["伞兵营", 2, 0.75, 1.5, 0.25, 0, 0, null, null, null, null, 1.375, 6],
        ["机械化步兵营", 3.25, 1.25, 3.25, 1.25, 1, 0.5, null, null, null, null, 1.25, 6],
        ["斯图亚特轻坦营", 3.5, 1.75, 3.5, 1.5, 1.5, 0.75, null, null, null, null, 1.2, 6],
        ["75谢尔曼中坦营", 4.25, 2.25, 4.5, 2.25, 1.75, 1, null, null, null, null, 1.2, 6],
        ["76谢尔曼中坦营", 4, 2.25, 4.25, 2.5, 1.75, 1.25, null, null, null, null, 1.2, 6],
        ["潘兴重坦营", 4.25, 2.5, 5, 3.25, 2.25, 1.75, null, null, null, null, 1.2, 6],
        ["巨无霸重坦营", 4.25, 2.25, 4.5, 2.25, 1.75, 1, null, null, null, null, 1.2, 6],
        ["超级潘兴重坦营", 4, 2.25, 4.75, 3, 2, 1.5, null, null, null, null, 1.2, 6],
        ["反坦克小组", 0.5, 0.25, 0.25, 0, 0, 0, null, null, null, null, 1.375, 1],
        ["反坦克营", 1.5, 0.75, 1.5, 1, 0.25, 0.25, null, null, null, null, 1.75, 6],
        ["M10中型坦歼营", 4, 2.25, 4.25, 2.5, 1.75, 1.25, null, null, null, null, 1.2, 6],
        ["T95超重坦营", 2, 1.25, 3, 2, 1.5, 1, null, null, null, null, 1.5, 6],
        ["工兵营", 1, 0.25, 0.75, 0.25, 0, 0, null, null, null, null, 1.375, 3],
        ["突击工兵营", 2.5, 0.75, 1, 0.25, 0, 0, null, null, null, null, 1.375, 4],
        ["宪兵连", 0.75, 0.25, 0.5, 0, 0, 0, null, null, null, null, 1.375, 2],
        ["医疗连", 0.75, 0.25, 0.5, 0, 0, 0, null, null, null, null, 1.375, 2],
        ["摩托化运输队", 0, 0, 0, 0, 0, 0, null, null, null, null, 1, 3],
        ["侦察营", 1, 0.5, 0.75, 0.25, 0, 0, null, null, null, null, 1.375, 3],
        ["灰狗装甲侦察营", 2.25, 1.25, 2.25, 1, 1, 0.5, null, null, null, null, 1.2, 4],
        ["地狱猫装甲侦察营", 2.5, 1.5, 2.75, 1.75, 1.25, 0.75, null, null, null, null, 1.2, 4],
        ["40防空炮营", 2.25, 1.5, 2, 1.25, 0.25, 0.25, null, null, null, null, 1.75, 3],
        ["90防空炮营", 1.25, 1.5, 2.5, 3.5, 1.5, 2, null, null, null, null, 1.75, 3],
        ["M16自行防空炮营", 3.25, 1.5, 3.25, 1.5, 1, 0.5, null, null, null, null, 1.2, 3],
        ["M15自行防空炮营", 2.5, 0.75, 2.75, 1, 1.25, 0.5, null, null, null, null, 1.2, 3],
        ["反炮兵小组", 0, 0, 0, 0, 0, 0, null, null, null, null, 1, 1],
        ["105炮兵营", 0.75, 0.25, 1.75, 0.75, 1, 0.5, null, null, null, null, 1, 3],
        ["155炮兵营", 0.75, 0.5, 2.5, 1.5, 1.5, 1, null, null, null, null, 1, 3],
        ["M7自行火炮营", 1.5, 0.5, 2.5, 1, 1.5, 0.75, null, null, null, null, 1, 3],
        ["M12自行火炮营", 0.75, 0.5, 2.5, 1.5, 1.5, 1, null, null, null, null, 1, 3],
        ["管风琴火箭炮营", 2.25, 1, 6.25, 3.5, 3.5, 1.75, null, null, null, null, 1, 3],
        ["F5侦察机", null, null, null, null, null, null, null, null, null, null, null, 3],
        ["F6战斗侦察机", null, null, null, null, null, null, null, null, null, null, null, 3],
        ["P38战斗机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["P51战斗机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["P47战斗轰炸机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["B25轰炸机", null, null, null, null, null, null, null, null, null, null, null, 6],
        ["B29轰炸机", null, null, null, null, null, null, null, null, null, null, null, 6],
      ] },
      de: { name: "德国", units: [
        ["步兵营", 1.75, 0.75, 1.5, 0.5, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["突击步兵营", 3.5, 1.25, 3, 1.25, 0.75, 0.5, null, null, null, null, 1.25, 5],
        ["猎兵营", 2.25, 1, 1.75, 0.75, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["山地猎兵营", 2.25, 0.5, 1.75, 0.75, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["人民冲锋队", 1.5, 0.75, 0.5, 0, 0, 0, null, null, null, null, 1.375, 6],
        ["装甲掷弹兵营", 2.75, 1.25, 3, 1.25, 1.5, 0.5, null, null, null, null, 1.25, 6],
        ["四号中坦营", 2.5, 1.75, 2.5, 1.75, 1, 1, null, null, null, null, 1.2, 6],
        ["豹式中坦营", 3, 1.75, 3.75, 2.75, 1.75, 1.25, null, null, null, null, 1.2, 6],
        ["虎式重坦营", 3.25, 2, 3.75, 2.75, 1.75, 1.5, null, null, null, null, 1.2, 6],
        ["虎王重坦营", 3.5, 2.25, 4.25, 3.25, 2, 1.75, null, null, null, null, 1.2, 6],
        ["鼠式超重坦营", 2.75, 2, 3.5, 2.75, 1.75, 1.5, null, null, null, null, 1.2, 6],
        ["反坦克敢死队", 0.5, 0.25, 0.25, 0, 0, 0, null, null, null, null, 1.375, 1],
        ["反坦克小组", 0.5, 0.25, 0.5, 0, 0, 0, null, null, null, null, 1.375, 1],
        ["反坦克营", 1.75, 1.25, 2.5, 2.5, 1.25, 1.25, null, null, null, null, 1.75, 6],
        ["黄鼠狼轻型坦歼营", 1, 1, 1.5, 1.5, 0.5, 0.75, null, null, null, null, 1.5, 6],
        ["追猎者轻型坦歼营", 1.75, 1, 2, 1.5, 1, 0.75, null, null, null, null, 1.5, 6],
        ["四号突击炮营", 2, 1.25, 2.5, 1.5, 1, 0.75, null, null, null, null, 1.5, 6],
        ["四号中型坦歼营", 2.25, 1.25, 2.75, 2, 1.25, 1.25, null, null, null, null, 1.5, 6],
        ["猎豹重型坦歼营", 2, 1.25, 3, 2.5, 1.25, 1.25, null, null, null, null, 1.5, 6],
        ["猎虎重型坦歼营", 2, 1.25, 2.75, 1.75, 1.25, 1, null, null, null, null, 1.5, 6],
        ["工兵营", 1, 0.25, 0.5, 0.25, 0, 0, null, null, null, null, 1.375, 3],
        ["突击工兵营", 1.5, 0.5, 1, 0.25, 0.25, 0, null, null, null, null, 1.375, 4],
        ["宪兵连", 0.5, 0.25, 0.5, 0, 0, 0, null, null, null, null, 1.375, 2],
        ["医疗连", 0.5, 0.25, 0.5, 0, 0, 0, null, null, null, null, 1.375, 2],
        ["摩托化运输队", 0, 0, 0, 0, 0, 0, null, null, null, null, 1, 3],
        ["侦察营", 1, 0.5, 0.5, 0.25, 0, 0, null, null, null, null, 1.375, 3],
        ["222装甲侦察营", 1.5, 0.75, 1.25, 0.5, 0.5, 0.25, null, null, null, null, 1.2, 4],
        ["美洲狮装甲侦察营", 1.5, 1, 1.5, 0.75, 0.5, 0.25, null, null, null, null, 1.2, 4],
        ["20防空炮营", 1.25, 1.5, 0.75, 1, 0.25, 0.25, null, null, null, null, 1.75, 3],
        ["88防空炮营", 1, 1.5, 2.25, 3, 1.5, 2, null, null, null, null, 1.75, 3],
        ["卡车自行防空炮营", 2, 1.75, 1.25, 1, 0.25, 0.25, null, null, null, null, 1.2, 3],
        ["东风自行防空炮营", 3.75, 3.5, 2.25, 2, 0.75, 0.75, null, null, null, null, 1.2, 3],
        ["反炮兵小组", 0, 0, 0, 0, 0, 0, null, null, null, null, 1, 1],
        ["105炮兵营", 0.5, 0.25, 1.5, 0.75, 1, 0.5, null, null, null, null, 1, 3],
        ["150炮兵营", 0.5, 0.25, 2.25, 1.5, 1.5, 1, null, null, null, null, 1, 3],
        ["黄蜂自行火炮营", 1, 0.5, 2.25, 1, 1.25, 0.5, null, null, null, null, 1, 3],
        ["野蜂自行火炮营", 0.75, 0.5, 2.25, 1.5, 1.5, 1, null, null, null, null, 1, 3],
        ["Fw189侦察机", null, null, null, null, null, null, null, null, null, null, null, 3],
        ["Bf109战斗机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["Me262战斗机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["Fw190战斗轰炸机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["Ju88轰炸机", null, null, null, null, null, null, null, null, null, null, null, 6],
      ] },
      ussr: { name: "苏联", units: [
        ["步兵营", 2.75, 1.25, 2.5, 1.5, 0.75, 0.25, null, null, null, null, 1.25, 6],
        ["近卫步兵营", 3.5, 2, 3.5, 2.75, 1.5, 1, null, null, null, null, 1.25, 6],
        ["惩戒营", 4, 1.5, 2, 1.75, 0.75, 0.5, null, null, null, null, 1.25, 6],
        ["伞兵营", 1.5, 0.5, 0.75, 0.5, 0.25, 0.25, null, null, null, null, 1.25, 5],
        ["机械化步兵营", 3.5, 1.25, 2.75, 1.25, 0.75, 0.25, null, null, null, null, 1.2, 6],
        ["T60轻坦营", 3.25, 2.25, 2.75, 2, 0.75, 0.5, null, null, null, null, 1.2, 6],
        ["T3476中坦营", 3.25, 2.25, 3.25, 2.75, 1, 0.75, null, null, null, null, 1.2, 6],
        ["T3485中坦营", 3, 2.25, 3.25, 3, 1.25, 1.25, null, null, null, null, 1.2, 6],
        ["T44中坦营", 3, 2.25, 3.25, 3, 1.25, 1.25, null, null, null, null, 1.2, 6],
        ["T44-100中坦营", 4, 2.25, 4.5, 3.5, 2, 1.25, null, null, null, null, 1.2, 6],
        ["IS2重坦营", 3.75, 2, 4.25, 2.75, 1.75, 1, null, null, null, null, 1.2, 6],
        ["IS3重坦营", 2.75, 1.75, 3, 2.5, 1, 0.75, null, null, null, null, 1.2, 6],
        ["反坦克营", 1.75, 1, 1.75, 1.75, 0.5, 0.5, null, null, null, null, 1.75, 6],
        ["SU85中型坦歼营", 2.25, 1.25, 2.5, 2.25, 1, 1, null, null, null, null, 1.5, 6],
        ["SU100中型坦歼营", 2.75, 1.5, 3.25, 3, 1.25, 1.25, null, null, null, null, 1.2, 6],
        ["ISU152重型坦歼营", 3, 1.5, 3.25, 2.5, 1.25, 0.75, null, null, null, null, 1.5, 6],
        ["工兵营", 1.25, 0.25, 0.75, 0.25, 0, 0, null, null, null, null, 1.25, 3],
        ["突击工兵营", 2.25, 0.75, 1.5, 0.75, 0.25, 0, null, null, null, null, 1.25, 4],
        ["教导营", 1.25, 0.25, 0.75, 0.25, 0, 0, null, null, null, null, 1.25, 3],
        ["医疗连", 0.75, 0.25, 0.5, 0, 0, 0, null, null, null, null, 1.25, 2],
        ["摩托化运输队", 0, 0, 0, 0, 0, 0, null, null, null, null, 1, 3],
        ["侦查营", 1.25, 0.5, 0.75, 0.5, 0, 0, null, null, null, null, 1.25, 3],
        ["37防空炮营", 4.5, 3.5, 3.75, 3, 1, 0.75, null, null, null, null, 1.75, 3],
        ["85防空炮营", 1, 1.5, 2.25, 3.25, 1.25, 2, null, null, null, null, 1.75, 3],
        ["ZSU37自行防空炮营", 3.25, 2.5, 3.25, 2.5, 0.75, 0.5, null, null, null, null, 1.2, 3],
        ["反炮兵小组", 0, 0, 0, 0, 0, 0, null, null, null, null, 1, 1],
        ["76炮兵营", 0.5, 0.25, 1.5, 1, 1, 0.75, null, null, null, null, 1, 3],
        ["122炮兵营", 0.5, 0.5, 2.25, 2, 1.5, 1.25, null, null, null, null, 1, 3],
        ["152炮兵营", 0.75, 0.5, 3, 2, 2, 1.5, null, null, null, null, 1, 3],
        ["SU76自行火炮", 0.5, 0.25, 1.5, 1.5, 1, 1, null, null, null, null, 1, 3],
        ["喀秋莎火箭炮营", 0, 0, 2.25, 1.25, 1.5, 0.75, null, null, null, null, 1, 3],
        ["Il2侦察机", null, null, null, null, null, null, null, null, null, null, null, 5],
        ["Yak9战斗机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["Il2攻击机", null, null, null, null, null, null, null, null, null, null, null, 5],
        ["Tu2轰炸机", null, null, null, null, null, null, null, null, null, null, null, 5],
      ] },
      cn: { name: "中国", units: [
        ["步兵营", 2.75, 1.25, 2.25, 0.5, 0.75, 0.25, null, null, null, null, 1.25, 6],
        ["警卫营", 3.75, 1.5, 3.75, 1, 1.5, 0.5, null, null, null, null, 1.25, 6],
        ["民兵营", 1.25, 0.25, 0.75, 0.25, 0, 0, null, null, null, null, 1.25, 5],
        ["游击队", 1.5, 0.75, 1, 0.25, 0, 0, null, null, null, null, 1.25, 4],
        ["独立团", 8, 3.5, 7, 1.75, 2, 0.5, null, null, null, null, 1.25, 6],
        ["斯图亚特轻坦营", 4, 2.25, 3.5, 1.75, 1.5, 0.75, null, null, null, null, 1.2, 6],
        ["97式中战营", 4.25, 2.75, 4, 2.25, 1.5, 1, null, null, null, null, 1.2, 6],
        ["75谢尔曼中坦营", 4.75, 2.75, 4.5, 2.5, 2, 1, null, null, null, null, 1.2, 6],
        ["工兵营", 2.75, 1.25, 2.25, 0.5, 0.75, 0.25, null, null, null, null, 1.25, 6],
        ["宪兵连", 1, 0.5, 0.75, 0.25, 0, 0, null, null, null, null, 1.25, 2],
        ["医疗连", 0.75, 0.25, 0.25, 0, 0, 0, null, null, null, null, 1.25, 2],
        ["侦查营", 2.5, 2, 1.75, 0.5, 0.25, 0, null, null, null, null, 1.25, 5],
        ["防空连", 1, 0.25, 1, 0.25, 0.25, 0, null, null, null, null, 1.75, 3],
        ["75炮兵营", 0.75, 0.5, 1.75, 1, 0.75, 0.5, null, null, null, null, 1, 3],
        ["105炮兵营", 0.5, 0.25, 1.75, 0.75, 1, 0.5, null, null, null, null, 1, 3],
        ["P51战斗机", null, null, null, null, null, null, null, null, null, null, null, 3],
      ] },
      uk: { name: "英国", units: [
        ["步兵营", 2, 1, 2, 1, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["SAS特勤营", 3, 1, 2.5, 0.75, 0.75, 0.25, null, null, null, null, 1.375, 5],
        ["摩托化营", 2, 1, 2, 1, 0.5, 0.25, null, null, null, null, 1.375, 6],
        ["小领主轻坦营", 1.5, 1, 1.5, 0.75, 0.5, 0.25, null, null, null, null, 1.2, 4],
        ["斯图亚特轻坦营", 2.5, 2, 2.25, 1.75, 0.75, 0.5, null, null, null, null, 1.2, 6],
        ["克伦威尔中坦营", 3.25, 2, 3.25, 2, 1.25, 0.75, null, null, null, null, 1.2, 6],
        ["萤火虫中坦营", 3, 1.75, 3.25, 2, 1.5, 1, null, null, null, null, 1.2, 6],
        ["挑战者中坦营", 3, 2, 3.25, 2.25, 1.5, 1.25, null, null, null, null, 1.2, 6],
        ["丘吉尔重坦营", 3.25, 2, 3.25, 2, 1.25, 0.75, null, null, null, null, 1.2, 6],
        ["鳄鱼喷火坦克营", 4.25, 2.25, 5, 2.25, 1.25, 0.75, null, null, null, null, 1.2, 6],
        ["黑亲王重坦营", 3, 1.75, 3.25, 2, 1.5, 1, null, null, null, null, 1.2, 6],
        ["百夫长重坦营", 3, 2, 3.25, 2.25, 1.5, 1.25, null, null, null, null, 1.2, 6],
        ["反坦克小组", 0.75, 0.25, 0.5, 0.25, 0, 0, null, null, null, null, 1.375, 1],
        ["反坦克营", 1.5, 1, 1.5, 1.75, 0.5, 1, null, null, null, null, 1.75, 6],
        ["A39重坦营", 2, 1.25, 2.5, 1.75, 1.25, 1, null, null, null, null, 1.5, 6],
        ["工兵营", 1.25, 0.25, 1, 0.25, 0.25, 0, null, null, null, null, 1.375, 4],
        ["宪兵", 0.75, 0.25, 0.5, 0.25, 0, 0, null, null, null, null, 1.375, 2],
        ["医疗营", 0.75, 0.25, 0.5, 0.25, 0, 0, null, null, null, null, 1.375, 2],
        ["侦察营", 1, 0.5, 0.75, 0.25, 0, 0, null, null, null, null, 1.375, 3],
        ["野狗装甲侦察营", 1.5, 0.75, 1.5, 0.5, 0.5, 0.25, null, null, null, null, 1.2, 4],
        ["40防空炮营", 1, 0.75, 1, 0.75, 0.25, 0, null, null, null, null, 1.75, 3],
        ["十字军防空营", 1.5, 1.75, 1.25, 1.5, 0.25, 0.25, null, null, null, null, 1.2, 3],
        ["25磅炮兵营", 0.5, 0.5, 1.75, 1.75, 0.75, 0.75, null, null, null, null, 1, 3],
        ["155炮兵营", 0.75, 0.25, 2.5, 1.5, 1.5, 1, null, null, null, null, 1, 3],
        ["司事自行火炮营", 1.25, 0.5, 2.5, 2, 1.25, 1, null, null, null, null, 1, 3],
        ["蚊式侦察机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["喷火战斗机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["台风战斗轰炸机", null, null, null, null, null, null, null, null, null, null, null, 4],
        ["惠灵顿轰炸机", null, null, null, null, null, null, null, null, null, null, null, 6],
      ] }
    },
  },
  '80s': {
    label: '冷战', maxRange: 2,
    factions: {
      us: { name: "美国", units: [
        ["M113机械化步兵营", 4.25, 1.75, 4.25, 1.5, 1.5, 0.25, 0.5, 0, 0, 0, 1.25, 6],
        ["M2A1机械化步兵营", 5.5, 2.75, 5.5, 2.75, 2.5, 1, 0.75, 0.25, 0, 0, 1.1, 6],
        ["UH1空突营", 3, 1.5, 2.5, 1.75, 0.75, 0.5, 0.5, 0.5, 0, 0, 1.375, 5],
        ["UH60空突营", 5.5, 2, 5.75, 2.25, 2.25, 1, 0.5, 0.5, 0, 0, 1.375, 5],
        ["M60装甲营", 4.75, 2.75, 6.5, 4.25, 4, 3.25, 1.75, 1.75, 0, 0, 1.1, 6],
        ["M1装甲营", 5.25, 3.5, 7.5, 5.25, 4.75, 4.25, 2.25, 2.25, 0, 0, 1.05, 6],
        ["M1A1装甲营", 5.75, 4, 8, 6, 5.5, 5, 3, 3.25, 0, 0, 1.05, 6],
        ["M1A1HA装甲营", 5.75, 4, 8, 6, 5.5, 5, 3, 3.25, 0, 0, 1.05, 6],
        ["AH1武直中队", 6.25, 4.5, 4.25, 4, 1.75, 2, 0.75, 1.5, 0, 0, 1.15, 4],
        ["AH64武直中队", 21, 16, 15.5, 14.75, 4, 5.5, 2, 4, 0, 2.75, 1, 4],
        ["机械化工兵", 0.25, 0, 0.5, 0, 0.25, 0, 0.25, 0, 0, 0, 1.375, 4],
        ["工兵", 2, 0.5, 1.75, 0.25, 0.5, 0, 0.25, 0, 0, 0, 1.375, 4],
        ["摩托化宪兵", 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["宪兵", 0.75, 0.25, 0.25, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["摩托化医疗", 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["医疗营", 0.75, 0.25, 0.25, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["侦察营", 1.75, 0.75, 1.5, 0.75, 0.5, 0.25, 0.25, 0.25, 0, 0, 1.375, 3],
        ["M3A2装甲侦察营", 4.25, 2, 4.25, 2.25, 1.75, 1.25, 0.5, 0.5, 0, 0, 1.1, 4],
        ["OH58侦查直升机中队", 0, 0, 0, 0.75, 0, 0.75, 0, 0.75, 0, 0.75, 1, 3],
        ["M163防空炮营", 1.25, 1.5, 1, 1.25, 0.5, 0.75, 0, 0, 0, 0, 1.2, 3],
        ["MIM23防空导弹营", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3],
        ["MIM104防空导弹营", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3],
        ["105炮兵营", 1.5, 0.25, 3, 0.5, 2, 0.5, 2, 0.5, 2, 0.5, 1, 3],
        ["155炮兵营", 2, 0.5, 3.75, 0.75, 2.5, 0.5, 2.5, 0.5, 2.5, 0.5, 1, 3],
        ["M109自行火炮营", 1.5, 0.25, 4, 0.75, 2.5, 0.5, 2, 0.5, 2, 0.5, 1, 3],
        ["M110自行火炮营", 1.75, 0.25, 4.75, 1, 3, 0.5, 2.5, 0.5, 2.5, 0.5, 1, 3],
        ["M270火箭炮营", 0, 0, 5.5, 2.5, 4.5, 2, 4.5, 2, 4.5, 2, 1, 3],
      ] },
      ussr: { name: "苏联", units: [
        ["BMP1机械化步兵营", 6, 4, 5.5, 4, 2.25, 2.25, 0.75, 0.25, 0, 0, 1.1, 6],
        ["BMP2机械化步兵营", 7.25, 3.5, 7.25, 4, 3, 2, 0.75, 0.25, 0, 0, 1.1, 6],
        ["BMP3机械化步兵营", 10.5, 4.25, 11.25, 4.75, 7.25, 2.75, 0.75, 0.75, 0, 0, 1.1, 6],
        ["Mi8空突营", 2.75, 1.5, 2.5, 1.5, 0.75, 0.75, 0.5, 0.5, 0, 0, 1.375, 5],
        ["T72B1装甲营", 6.5, 2.75, 9.5, 4.25, 6.25, 3.25, 3.5, 2, 0, 0, 1.05, 6],
        ["T64BV装甲营", 7, 3.5, 10.75, 5.5, 7.25, 4.25, 4.25, 2.75, 0, 1.5, 1.05, 6],
        ["T80BV装甲营", 7.25, 3.75, 10.75, 5.5, 7.25, 4.25, 4.5, 3, 0, 1.5, 1.05, 6],
        ["T80UD装甲营", 7.25, 3.75, 10.75, 5.5, 7.25, 4.25, 4.75, 3.25, 0, 2.25, 1.05, 6],
        ["Mi24武直中队", 2, 1.25, 1.25, 2.75, 0, 1.5, 0, 2, 0, 1.5, 1.15, 4],
        ["Ka50武直中队", 8, 9.25, 8.25, 11.25, 4.75, 8, 1.25, 4.5, 0, 3.5, 1, 4],
        ["机械化工兵", 4, 1.75, 3, 1.25, 1.75, 0.75, 1, 0.5, 0, 0, 1.375, 4],
        ["工兵", 0.5, 0, 0.75, 0.25, 0.5, 0, 0.25, 0, 0, 0, 1.375, 4],
        ["摩托化宪兵", 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["宪兵", 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["摩托化医疗", 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["医疗营", 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.375, 2],
        ["侦察营", 2, 0.75, 1.75, 0.75, 0.5, 0.5, 0.25, 0.25, 0, 0, 1.375, 3],
        ["BMP1P装甲侦察营", 4.75, 2.75, 4.25, 2.75, 1.5, 1.75, 0.5, 0.5, 0, 0, 1.1, 4],
        ["Mi2侦察直升机中队", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3],
        ["石勒喀河防空炮营", 1.25, 1.5, 1.25, 1.5, 0.5, 0.75, 0, 0, 0, 0, 1.2, 3],
        ["通古斯卡防空导弹营", 2, 2.5, 2.75, 3.5, 2.25, 2.75, 0, 0, 0, 0, 1.2, 3],
        ["黄蜂防空导弹营", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 3],
        ["道尔防空导弹营", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 3],
        ["山毛榉防空导弹营", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 3],
        ["S300防空导弹营", 0.5, 0, 0.75, 0.25, 0.25, 0, 0, 0, 0, 0, 1.2, 3],
        ["2S1自行火炮营", 1.5, 0.25, 3.25, 0.75, 2, 0.5, 1.5, 0.25, 1.5, 0.25, 1, 3],
        ["2S3自行火炮营", 1, 0.25, 3, 0.5, 2, 0.5, 2, 0.5, 2, 0.5, 1, 3],
        ["2S7自行火炮营", 1.25, 0.25, 3.75, 0.75, 2.5, 0.5, 2.5, 0.5, 2.5, 0.5, 1, 3],
        ["冰雹火箭炮营", 0, 0, 5.5, 1, 4.5, 1, 4.5, 1, 4.5, 1, 1, 3],
      ] }
    }
  }
  };

  /* =============================================================
   * 二、状态与工具
   * ============================================================= */

  const state = {
    open: false,
    section: 'rules',
    q: '',
    era: '',
    faction: '',
  };

  let savedTitle = '';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* 只认 **粗体** 和 `代码` 两种行内标记，先转义再替换 */
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function tableHTML(t) {
    return '<div class="cx-tablewrap"><table class="cx-table">' +
      '<thead><tr>' + t.head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + t.rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>' +
      '</table></div>';
  }

  function blocksHTML(blocks) {
    return (blocks || []).map(function (b) {
      if (b.p) return '<p class="cx-p">' + inline(b.p) + '</p>';
      if (b.ul) return '<ul class="cx-ul">' + b.ul.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>';
      if (b.note) return '<p class="cx-note">' + inline(b.note) + '</p>';
      if (b.table) return tableHTML(b.table);
      if (b.dl) {
        return '<dl class="cx-dl">' + b.dl.map(function (x) {
          return '<div><dt>' + esc(x[0]) + '</dt><dd>' + inline(x[1]) + '</dd></div>';
        }).join('') + '</dl>';
      }
      return '';
    }).join('');
  }

  /* ---------------- 地形（读 terrain.js） ---------------- */
  function terrainList() {
    return Array.isArray(window.TERRAINS) ? window.TERRAINS : [];
  }

  function terrainExtra(t) {
    const r = t.rule || {};
    const out = [];
    if (r.urban) out.push('巷战');
    if (r.riverReset) out.push('过河清零');
    if (r.chaos) out.push('混乱 +' + r.chaos);
    return out.length ? out.join(' · ') : '—';
  }

  function pct(v) { return v ? Math.round(v * 100) + '%' : '无'; }

  function terrainTableHTML() {
    const list = terrainList();
    if (!list.length) {
      return '<p class="cx-empty">读不到地形表（terrain.js 没先加载）。地形数值只在那边维护一份。</p>';
    }

    const rows = list.map(function (t) {
      const r = t.rule || {};
      return '' +
        '<tr id="cx-terrain-' + t.id + '">' +
          '<td class="cx-td-key"><kbd>' + esc(t.key) + '</kbd></td>' +
          '<td class="cx-td-name">' + esc(t.name) + '</td>' +
          '<td>' + esc(String(r.move)) + '</td>' +
          '<td>' + esc(String(r.moveMech)) + '</td>' +
          '<td>' + esc(pct(r.protect)) + '</td>' +
          '<td>' + (r.blocksSight ? '阻挡' : '通视') + '</td>' +
          '<td>' + esc(terrainExtra(t)) + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="cx-tablewrap"><table class="cx-table cx-table-terrain">' +
        '<thead><tr>' +
          '<th>键</th><th>地形</th><th>常规</th><th>机械化</th><th>抗性</th><th>视野</th><th>附加</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';
  }

  /* =============================================================
   * 三、渲染
   * ============================================================= */

  function sectionMeta(id) {
    for (let i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i];
    return SECTIONS[0];
  }

  function unitTotal() {
    let n = 0;
    Object.keys(UNIT_DATA).forEach(function (e) {
      const facs = UNIT_DATA[e].factions;
      Object.keys(facs).forEach(function (k) { n += facs[k].units.length; });
    });
    return n;
  }

  function countOf(id) {
    if (id === 'rules') return RULES.length;
    if (id === 'traits') return TRAITS.length;
    if (id === 'units') return unitTotal();
    return 0;
  }

  function navHTML() {
    return SECTIONS.map(function (s) {
      const on = s.id === state.section;
      return '' +
        '<button type="button" class="cx-nav-btn' + (on ? ' is-on' : '') + '"' +
            ' data-section="' + s.id + '"' +
            ' aria-current="' + (on ? 'true' : 'false') + '">' +
          '<span class="cx-nav-no">' + s.no + '</span>' +
          '<span class="cx-nav-tx"><b>' + s.name + '</b><em>' + s.en + '</em></span>' +
          '<span class="cx-nav-n">' + countOf(s.id) + '</span>' +
        '</button>';
    }).join('');
  }

  function headHTML(meta) {
    return '' +
      '<div class="cx-head">' +
        '<p class="menu-kicker">' + meta.en + '</p>' +
        '<h1 class="cx-title">' + esc(meta.name) + '</h1>' +
        '<p class="cx-lead">' + esc(meta.desc) + '</p>' +
      '</div>';
  }

  /* ---------------- 规则 ---------------- */
  function rulesHTML() {
    return RULES.map(function (r) {
      return '' +
        '<section class="cx-card" id="cx-rule-' + r.id + '">' +
          '<header class="cx-card-head">' +
            '<span class="cx-card-no">' + esc(r.no) + '</span>' +
            '<h2>' + esc(r.t) + '</h2>' +
          '</header>' +
          (r.terrain ? terrainTableHTML() : '') +
          blocksHTML(r.blocks) +
        '</section>';
    }).join('');
  }

  /* ---------------- 词条 ---------------- */
  function traitsHTML() {
    return '<div class="cx-traits">' + TRAITS.map(function (x, i) {
      return '' +
        '<div class="cx-trait" id="cx-trait-' + i + '">' +
          '<h3>' + esc(x.t) + '</h3>' +
          '<p>' + inline(x.d) + '</p>' +
        '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- 单位数据表 ---------------- */
  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Math.round(Number(v) * 1000) / 1000;
    return String(n);
  }

  function pairHTML(a, b) {
    if ((a === null || a === undefined) && (b === null || b === undefined)) {
      return '<span class="cx-dash">—</span>';
    }
    return '<span class="cx-soft">' + fmtNum(a) + '</span>' +
           '<i class="cx-sep">/</i>' +
           '<span class="cx-hard">' + fmtNum(b) + '</span>';
  }

  function ensureUnitSelection() {
    const eras = Object.keys(UNIT_DATA);
    if (!eras.length) { state.era = ''; state.faction = ''; return; }
    if (!UNIT_DATA[state.era]) state.era = eras[0];
    const facs = UNIT_DATA[state.era].factions;
    if (!facs[state.faction]) state.faction = Object.keys(facs)[0];
  }

  function eraTabsHTML() {
    return '<div class="cx-tabs" role="tablist" aria-label="年代">' +
      Object.keys(UNIT_DATA).map(function (e) {
        const d = UNIT_DATA[e];
        const on = e === state.era;
        const n = Object.keys(d.factions).reduce(function (a, k) { return a + d.factions[k].units.length; }, 0);
        return '' +
          '<button type="button" class="cx-tab' + (on ? ' is-on' : '') + '"' +
              ' data-era="' + e + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' +
            '<span>' + esc(e) + '</span><em>' + esc(d.label) + '</em><i>' + n + '</i>' +
          '</button>';
      }).join('') +
    '</div>';
  }

  function factionChipsHTML() {
    const facs = UNIT_DATA[state.era] ? UNIT_DATA[state.era].factions : {};
    return '<div class="cx-chips" role="group" aria-label="阵营">' +
      Object.keys(facs).map(function (k) {
        const f = facs[k];
        const on = k === state.faction;
        return '' +
          '<button type="button" class="cx-chip' + (on ? ' is-on' : '') + '"' +
              ' data-faction="' + k + '">' +
            '<span>' + esc(f.name) + '</span><i>' + f.units.length + '</i>' +
          '</button>';
      }).join('') +
    '</div>';
  }

  function unitsTableHTML() {
    const d = UNIT_DATA[state.era];
    if (!d) return '';
    const f = d.factions[state.faction];
    if (!f) return '';

    const maxRange = d.maxRange || 2;
    let head = '<th class="cx-th-no">#</th><th class="cx-th-name">单位</th>' +
      '<th class="cx-th-r"><span>巷战</span><em>软 / 硬</em></th>';
    for (let r = 1; r <= maxRange; r++) {
      head += '<th class="cx-th-r"><span>射程 ' + r + '</span><em>软 / 硬</em></th>';
    }
    head += '<th class="cx-th-r"><span>反伤</span><em>系数</em></th>' +
            '<th class="cx-th-r"><span>血量</span><em>格</em></th>';

    const body = f.units.map(function (u, i) {
      let tds = '<td class="cx-td-no">' + (i + 1) + '</td>' +
                '<td class="cx-td-name">' + esc(u[0]) + '</td>' +
                '<td>' + pairHTML(u[1], u[2]) + '</td>';
      for (let r = 1; r <= maxRange; r++) {
        const a = u[3 + (r - 1) * 2];
        const b = u[4 + (r - 1) * 2];
        tds += '<td>' + pairHTML(a, b) + '</td>';
      }
      tds += '<td class="cx-td-num">' + fmtNum(u[11]) + '</td>' +
             '<td class="cx-td-num">' + fmtNum(u[12]) + '</td>';
      return '<tr id="cx-unit-' + state.era + '-' + state.faction + '-' + i + '">' + tds + '</tr>';
    }).join('');

    return '' +
      '<div class="cx-tablewrap"><table class="cx-table cx-table-units">' +
        '<thead><tr>' + head + '</tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  function unitsHTML() {
    ensureUnitSelection();
    if (!state.era) {
      return '<p class="cx-empty">还没有单位数据。</p>';
    }

    return eraTabsHTML() + factionChipsHTML() + unitsTableHTML() +
      '<p class="cx-note">' + inline(
        '每个格子是 **软攻 / 硬攻**；反击伤害 = 该距离的攻 × 反伤系数。' +
        '数字取自 图鉴.xlsx；80s 的美/苏飞机只有名字、没有伤害数据，显示 —；2020s 的数据还没录。'
      ) + '</p>';
  }

  function sectionHTML(id) {
    const meta = sectionMeta(id);
    let body = '';
    if (id === 'rules') body = rulesHTML();
    else if (id === 'traits') body = traitsHTML();
    else body = unitsHTML();

    return headHTML(meta) + body +
      '<footer class="cx-foot">' +
        '<span>规则 / 词条摘自 规则.docx，单位数据取自 图鉴.xlsx（只读引用，原文未改）；地形数值与 terrain.js 同一份。</span>' +
        '<span class="mono">CODEX · ' + meta.en + '</span>' +
      '</footer>';
  }

  /* =============================================================
   * 四、搜索
   * ============================================================= */

  function itemText(it) {
    const parts = [it.title];
    if (it.d) parts.push(it.d);
    (it.blocks || []).forEach(function (b) {
      if (b.p) parts.push(b.p);
      if (b.note) parts.push(b.note);
      if (b.ul) parts.push(b.ul.join(' '));
      if (b.dl) b.dl.forEach(function (x) { parts.push(x[0] + ' ' + x[1]); });
      if (b.table) {
        parts.push(b.table.head.join(' '));
        b.table.rows.forEach(function (r) { parts.push(r.join(' ')); });
      }
    });
    return parts.join(' ');
  }

  function unitSearchItems() {
    const out = [];
    Object.keys(UNIT_DATA).forEach(function (era) {
      const d = UNIT_DATA[era];
      Object.keys(d.factions).forEach(function (fid) {
        const f = d.factions[fid];
        f.units.forEach(function (u, i) {
          out.push({
            id: 'unit-' + era + '-' + fid + '-' + i,
            title: u[0],
            tag: f.name + ' ' + era,
            text: [f.name, era, d.label, '软攻', '硬攻', '反伤', '血量',
                   fmtNum(u[1]), fmtNum(u[2]), fmtNum(u[11]), fmtNum(u[12])].join(' '),
          });
        });
      });
    });
    return out;
  }

  function searchItems(id) {
    if (id === 'rules') {
      return RULES.map(function (r) {
        return { id: 'rule-' + r.id, title: r.t, tag: '规则', text: itemText(r) + ' ' + (r.no || '') };
      });
    }
    if (id === 'traits') {
      return TRAITS.map(function (x, i) {
        return { id: 'trait-' + i, title: x.t, tag: '词条', text: x.d };
      });
    }
    return unitSearchItems();
  }

  function searchAll() {
    const q = state.q.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const out = [];
    SECTIONS.forEach(function (s) {
      searchItems(s.id).forEach(function (it) {
        const hay = (it.title + ' ' + it.text).toLowerCase();
        if (tokens.every(function (tk) { return hay.indexOf(tk) !== -1; })) {
          out.push({ section: s, item: it });
        }
      });
    });
    return out;
  }

  function highlight(s) {
    const tokens = state.q.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return esc(s);
    const pattern = tokens.map(function (tk) {
      return esc(tk).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|');
    return esc(s).replace(new RegExp('(' + pattern + ')', 'gi'), '<mark>$1</mark>');
  }

  function snippet(it, q) {
    const text = it.text.replace(/\*\*/g, '').replace(/`/g, '');
    const lower = text.toLowerCase();
    let i = lower.indexOf(q.toLowerCase());
    if (i < 0) i = 0;
    const start = Math.max(0, i - 18);
    const piece = text.slice(start, start + 76);
    const raw = (start > 0 ? '…' : '') + piece + (start + 76 < text.length ? '…' : '');
    return highlight(raw);
  }

  function resultsHTML() {
    const hits = searchAll();
    const q = state.q.trim();

    if (!hits.length) {
      return '' +
        '<div class="cx-head">' +
          '<p class="menu-kicker">SEARCH</p>' +
          '<h1 class="cx-title">没有找到</h1>' +
          '<p class="cx-lead">换个词试试，比如「穿透」「巷战」「防空」「混乱」「谢尔曼」。</p>' +
        '</div>' +
        '<p class="cx-empty">「' + esc(q) + '」在规则、词条、单位里都没有匹配。</p>';
    }

    return '' +
      '<div class="cx-head">' +
        '<p class="menu-kicker">SEARCH <span>/</span> ' + hits.length + ' 条</p>' +
        '<h1 class="cx-title">搜索结果</h1>' +
        '<p class="cx-lead">匹配「' + esc(q) + '」。点一条直接跳过去。</p>' +
      '</div>' +
      '<ul class="cx-results">' + hits.map(function (h) {
        return '' +
          '<li>' +
            '<button type="button" class="cx-result" data-goto-section="' + h.section.id + '"' +
                ' data-goto-item="' + esc(h.item.id) + '">' +
              '<span class="cx-result-tag">' + esc(h.item.tag || h.section.name) + '</span>' +
              '<span class="cx-result-main">' +
                '<b>' + esc(h.item.title) + '</b>' +
                '<em>' + snippet(h.item, q) + '</em>' +
              '</span>' +
            '</button>' +
          '</li>';
      }).join('') + '</ul>';
  }

  function renderMain() {
    const box = mount.querySelector('#cx-main');
    if (!box) return;
    box.innerHTML = state.q.trim() ? resultsHTML() : sectionHTML(state.section);
    const nav = mount.querySelector('.cx-nav');
    if (nav) nav.innerHTML = navHTML();
  }

  /* =============================================================
   * 五、交互
   * ============================================================= */

  function scrollToEl(el) {
    if (!el) return;
    const top = el.getBoundingClientRect().top + mount.scrollTop - 96;
    mount.scrollTop = Math.max(0, top);
  }

  function flash(el) {
    if (!el) return;
    el.classList.add('is-target');
    setTimeout(function () { el.classList.remove('is-target'); }, 1600);
  }

  function clearSearch() {
    state.q = '';
    const input = mount.querySelector('#cx-q');
    if (input) input.value = '';
  }

  function goSection(id, focus) {
    state.section = sectionMeta(id).id;
    clearSearch();
    if (state.section === 'units') ensureUnitSelection();
    renderMain();
    mount.scrollTop = 0;
    if (focus) focusEl(mount.querySelector('.cx-nav-btn[data-section="' + state.section + '"]'));
  }

  function goTo(sectionId, itemId) {
    state.section = sectionMeta(sectionId).id;
    if (state.section === 'units' && itemId && itemId.indexOf('unit-') === 0) {
      const parts = itemId.split('-');
      state.era = parts[1];
      state.faction = parts[2];
    }
    if (state.section === 'units') ensureUnitSelection();
    clearSearch();
    renderMain();

    const el = itemId ? mount.querySelector('[id="cx-' + itemId + '"]') : null;
    if (el) {
      scrollToEl(el);
      flash(el);
    } else {
      mount.scrollTop = 0;
    }
  }

  function pickEra(id) {
    if (!UNIT_DATA[id]) return;
    state.era = id;
    state.faction = Object.keys(UNIT_DATA[id].factions)[0];
    renderMain();
    focusEl(mount.querySelector('[data-era="' + id + '"]'));
  }

  function pickFaction(id) {
    if (!UNIT_DATA[state.era] || !UNIT_DATA[state.era].factions[id]) return;
    state.faction = id;
    renderMain();
    focusEl(mount.querySelector('[data-faction="' + id + '"]'));
  }

  function focusSearch() {
    const input = mount.querySelector('#cx-q');
    if (input) input.focus();
  }

  /* ---------------- 打开 / 关闭 ---------------- */
  function shellHTML() {
    return '' +
      '<header class="cx-top">' +
        '<button type="button" class="cx-back" data-act="back">' +
          '<span class="cx-back-i" aria-hidden="true">←</span><span>主菜单</span>' +
        '</button>' +
        '<span class="menu-brand"><span class="logo">⬢</span><b>百科</b><em>CODEX</em></span>' +
        '<label class="cx-search">' +
          '<span class="cx-search-i" aria-hidden="true">⌕</span>' +
          '<input id="cx-q" type="search" placeholder="搜规则 / 词条 / 单位" autocomplete="off" spellcheck="false" aria-label="搜索百科">' +
          '<kbd>/</kbd>' +
        '</label>' +
      '</header>' +
      '<div class="cx-body">' +
        '<nav class="cx-nav" aria-label="百科分区">' + navHTML() + '</nav>' +
        '<div class="cx-main" id="cx-main" role="main"></div>' +
      '</div>';
  }

  function open(sectionId) {
    if (state.open) {
      if (sectionId) goSection(sectionId, true);
      return;
    }

    savedTitle = document.title;
    state.open = true;
    state.section = sectionMeta(sectionId || 'rules').id;
    state.q = '';
    state.era = '';
    state.faction = '';

    mount.classList.remove('hidden');
    mount.setAttribute('aria-hidden', 'false');
    if (!mount.hasAttribute('tabindex')) mount.setAttribute('tabindex', '-1');
    document.body.classList.add('codex-open');

    const menu = document.getElementById('menu');
    if (menu) menu.setAttribute('inert', '');

    document.title = TITLE;
    mount.innerHTML = shellHTML();
    renderMain();
    mount.scrollTop = 0;
    focusEl(mount);
  }

  function close() {
    if (!state.open) return;
    state.open = false;

    mount.classList.add('hidden');
    mount.setAttribute('aria-hidden', 'true');
    mount.innerHTML = '';
    document.body.classList.remove('codex-open');

    const menu = document.getElementById('menu');
    if (menu) menu.removeAttribute('inert');

    document.title = savedTitle || '兵棋 · 线上战术桌';
    focusEl(document.querySelector('.menu-item[data-module="codex"]'));
  }

  /* ---------------- 鼠标 / 输入 ---------------- */
  mount.addEventListener('click', function (e) {
    const t = e.target && e.target.closest
      ? e.target.closest('[data-act], [data-section], [data-era], [data-faction], [data-goto-section]')
      : null;
    if (!t || !mount.contains(t)) return;

    if (t.getAttribute('data-act') === 'back') { close(); return; }

    const sec = t.getAttribute('data-section');
    if (sec) { goSection(sec, true); return; }

    const era = t.getAttribute('data-era');
    if (era) { pickEra(era); return; }

    const fac = t.getAttribute('data-faction');
    if (fac) { pickFaction(fac); return; }

    const target = t.getAttribute('data-goto-section');
    if (target) { goTo(target, t.getAttribute('data-goto-item')); }
  });

  mount.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'cx-q') return;
    state.q = e.target.value || '';
    renderMain();
  });

  /* ---------------- 键盘 ----------------
   * 捕获阶段接管：百科开着时按键不漏给 home.js / app3d.js。
   * 搜索框有焦点时不抢 1–3 和 /（那是在打字）。 */
  window.addEventListener('keydown', function (e) {
    if (!state.open) return;
    e.stopImmediatePropagation();

    const k = e.key;
    const active = document.activeElement;
    const inSearch = !!active && active.id === 'cx-q';

    if (k === 'Escape') {
      e.preventDefault();
      if (state.q) {
        clearSearch();
        renderMain();
      } else {
        close();
      }
      return;
    }

    if (inSearch) return;

    if (k === '/') { e.preventDefault(); focusSearch(); return; }
    if (/^[1-3]$/.test(k)) {
      e.preventDefault();
      goSection(SECTIONS[Number(k) - 1].id, true);
    }
  }, true);

  window.addEventListener('keyup', function (e) {
    if (state.open) e.stopImmediatePropagation();
  }, true);

  /* ---------------- 对外接口 ---------------- */
  window.Codex = {
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    sections: SECTIONS,
    units: UNIT_DATA,
    search: function (q) {
      state.q = String(q || '');
      return searchAll();
    },
  };
})();
