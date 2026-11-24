/* =============================================================
 * online-prep-data.js —— 战前编制数据（军 / 师 / A·B·C 阶段卡池）
 *
 * 这个文件是“文档 + 数据源”：改完保存，刷新页面就生效。
 * 数据整理自 图鉴更新记录/图鉴.xlsx 的「二战编制」「二战价格」。
 * 格式说明见同目录 战前编制数据说明.md。
 *
 * 规则要点：
 *   - 军在一整局中不变；每个阶段加入一个师。
 *   - 步兵 / 空降 / 山地师只在 A、B 阶段加入；装甲师只在 C 阶段加入。
 *   - pool.A / pool.B 是“该阶段可用单位”；B 池是在 A 基础上追加的单位。
 *   - slots.main / slots.support 是主战 / 辅助格子；planes 是飞机格子，null = 不限。
 *   - 辅助作战（HP=3）占主战格；纯辅助（HP<3）才占辅助格。
 *   - attack.A / defense.A 是 A 阶段进攻 / 防守经费。
 *   - 军直属单位计入所在师的格子数和经费。
 * ============================================================= */
window.PREP_DATA = {
  version: 1,
  updatedAt: '2026-11-20',
  source: '图鉴更新记录/图鉴.xlsx · 二战编制 / 二战价格',
  factions: {
    us: {
      name: '美国',
      code: 'US',
      color: '#5b8ad6',
      units: {
      "75谢尔曼中坦营": {
        "price": 70.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 9.0,
          "side": 4.0,
          "rear": 4.0
        },
        "attack": {
          "urban": [
            4.25,
            2.25
          ],
          "r1": [
            4.5,
            2.25
          ],
          "r2": [
            1.75,
            1.0
          ]
        },
        "counter": 1.2,
        "traits": "机械化，中坦"
      },
      "76谢尔曼中坦营": {
        "price": 78.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 15.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 11.0,
          "side": 5.0,
          "rear": 5.0
        },
        "attack": {
          "urban": [
            4.0,
            2.25
          ],
          "r1": [
            4.25,
            2.5
          ],
          "r2": [
            1.75,
            1.25
          ]
        },
        "counter": 1.2,
        "traits": "机械化，中坦"
      },
      "M10中型坦歼营": {
        "price": 70.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 15.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 8.0,
          "side": 3.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            4.0,
            2.25
          ],
          "r1": [
            4.25,
            2.5
          ],
          "r2": [
            1.75,
            1.25
          ]
        },
        "counter": 1.2,
        "traits": "机械化"
      },
      "T95超重坦营": {
        "price": 125.0,
        "hp": 6.0,
        "cat": "main",
        "move": 3.0,
        "ap": {
          "urban": 25.0,
          "r1": 24.0,
          "r2": 19.0
        },
        "av": {
          "front": 32.0,
          "side": 15.0,
          "rear": 9.0
        },
        "attack": {
          "urban": [
            2.0,
            1.25
          ],
          "r1": [
            3.0,
            2.0
          ],
          "r2": [
            1.5,
            1.0
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "伞兵营": {
        "price": 25.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 13.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.0,
            0.75
          ],
          "r1": [
            1.5,
            0.25
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "空降"
      },
      "反坦克营": {
        "price": 35.0,
        "hp": 6.0,
        "cat": "main",
        "move": 3.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.5,
            0.75
          ],
          "r1": [
            1.5,
            1.0
          ],
          "r2": [
            0.25,
            0.25
          ]
        },
        "counter": 1.75,
        "traits": ""
      },
      "地狱猫装甲侦察营": {
        "price": 65.0,
        "hp": 4.0,
        "cat": "main",
        "move": 7.0,
        "ap": {
          "urban": 15.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 4.0,
          "side": 2.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            2.5,
            1.5
          ],
          "r1": [
            2.75,
            1.75
          ],
          "r2": [
            1.25,
            0.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化，侦查半径1"
      },
      "山地营": {
        "price": 35.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 11.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "山地作战"
      },
      "巨无霸重坦营": {
        "price": 95.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 20.0,
          "side": 9.0,
          "rear": 9.0
        },
        "attack": {
          "urban": [
            4.25,
            2.25
          ],
          "r1": [
            4.5,
            2.25
          ],
          "r2": [
            1.75,
            1.0
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "战斗工兵营": {
        "price": 40.0,
        "hp": 4.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 13.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "爆破"
      },
      "斯图亚特轻坦营": {
        "price": 50.0,
        "hp": 6.0,
        "cat": "main",
        "move": 7.0,
        "ap": {
          "urban": 13.0,
          "r1": 5.0,
          "r2": 3.0
        },
        "av": {
          "front": 6.0,
          "side": 4.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            3.5,
            1.75
          ],
          "r1": [
            3.5,
            1.5
          ],
          "r2": [
            1.5,
            0.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化"
      },
      "机械化步兵营": {
        "price": 28.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 2.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            3.25,
            1.25
          ],
          "r1": [
            3.25,
            1.25
          ],
          "r2": [
            1.0,
            0.5
          ]
        },
        "counter": 1.25,
        "traits": "机械化"
      },
      "步兵营": {
        "price": 30.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 13.0,
          "r1": 5.0,
          "r2": 3.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.0,
            0.75
          ],
          "r1": [
            1.75,
            0.5
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.375,
        "traits": ""
      },
      "海军陆战队步兵营": {
        "price": 38.0,
        "hp": 4.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "政治军队"
      },
      "游骑兵营": {
        "price": 42.0,
        "hp": 5.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            3.5,
            1.25
          ],
          "r1": [
            1.5,
            0.5
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.25,
        "traits": "山地作战"
      },
      "潘兴重坦营": {
        "price": 110.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 18.0,
          "r1": 16.0,
          "r2": 12.0
        },
        "av": {
          "front": 16.0,
          "side": 8.0,
          "rear": 8.0
        },
        "attack": {
          "urban": [
            4.25,
            2.5
          ],
          "r1": [
            5.0,
            3.25
          ],
          "r2": [
            2.25,
            1.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "灰狗装甲侦察营": {
        "price": 55.0,
        "hp": 4.0,
        "cat": "main",
        "move": 7.0,
        "ap": {
          "urban": 13.0,
          "r1": 5.0,
          "r2": 3.0
        },
        "av": {
          "front": 3.0,
          "side": 2.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            2.25,
            1.25
          ],
          "r1": [
            2.25,
            1.0
          ],
          "r2": [
            1.0,
            0.5
          ]
        },
        "counter": 1.2,
        "traits": "机械化，侦查半径1"
      },
      "超级潘兴重坦营": {
        "price": 120.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 22.0,
          "r1": 20.0,
          "r2": 18.0
        },
        "av": {
          "front": 23.0,
          "side": 9.0,
          "rear": 8.0
        },
        "attack": {
          "urban": [
            4.0,
            2.25
          ],
          "r1": [
            4.75,
            3.0
          ],
          "r2": [
            2.0,
            1.5
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "105炮兵营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.75,
            0.25
          ],
          "r1": [
            1.75,
            0.75
          ],
          "r2": [
            1.0,
            0.5
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害1，半径7"
      },
      "155炮兵营": {
        "price": 60.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.75,
            0.5
          ],
          "r1": [
            2.5,
            1.5
          ],
          "r2": [
            1.5,
            1.0
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害1.5，半径11"
      },
      "40防空炮营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 3.0,
        "ap": {
          "urban": 4.0,
          "r1": 3.0,
          "r2": 2.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.25,
            1.5
          ],
          "r1": [
            2.0,
            1.25
          ],
          "r2": [
            0.25,
            0.25
          ]
        },
        "counter": 1.75,
        "traits": "防空半径1，伤害1"
      },
      "90防空炮营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 18.0,
          "r1": 16.0,
          "r2": 12.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.25,
            1.5
          ],
          "r1": [
            2.5,
            3.5
          ],
          "r2": [
            1.5,
            2.0
          ]
        },
        "counter": 1.75,
        "traits": "防空半径2，伤害1.5"
      },
      "M12自行火炮营": {
        "price": 60.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 2.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            0.75,
            0.5
          ],
          "r1": [
            2.5,
            1.5
          ],
          "r2": [
            1.5,
            1.0
          ]
        },
        "counter": 1.0,
        "traits": "机械化，曲射伤害1.5，半径11"
      },
      "M13自行防空炮营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 2.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "机械化，辅助防空，伤害0.5"
      },
      "M15自行防空炮营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 4.0,
          "r1": 3.0,
          "r2": 2.0
        },
        "av": {
          "front": 2.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            2.5,
            0.75
          ],
          "r1": [
            2.75,
            1.0
          ],
          "r2": [
            1.25,
            0.5
          ]
        },
        "counter": 1.2,
        "traits": "机械化，防空半径1，伤害1"
      },
      "M7自行火炮营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 4.0,
          "side": 3.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            1.5,
            0.5
          ],
          "r1": [
            2.5,
            1.0
          ],
          "r2": [
            1.5,
            0.75
          ]
        },
        "counter": 1.0,
        "traits": "机械化，曲射伤害1，半径7"
      },
      "侦察营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.0,
            0.5
          ],
          "r1": [
            0.75,
            0.25
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "侦查半径2"
      },
      "工兵营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.0,
            0.25
          ],
          "r1": [
            0.75,
            0.25
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "工程"
      },
      "管风琴火箭炮营": {
        "price": 80.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 11.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 11.0,
          "side": 4.0,
          "rear": 4.0
        },
        "attack": {
          "urban": [
            2.25,
            1.0
          ],
          "r1": [
            6.25,
            3.5
          ],
          "r2": [
            3.5,
            1.75
          ]
        },
        "counter": 1.0,
        "traits": "机械化，火箭炮，杀伤半径1，伤害2"
      },
      "运输车": {
        "price": 15,
        "hp": 3,
        "cat": "aux",
        "move": 6,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "地面运输，摩托化"
      },
      "医疗连": {
        "price": 5.0,
        "hp": 2.0,
        "cat": "support",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.75,
            0.25
          ],
          "r1": [
            0.5,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "医疗"
      },
      "反坦克小组": {
        "price": 5.0,
        "hp": 1.0,
        "cat": "support",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 13.0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            0.25,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "隐蔽"
      },
      "反炮兵小组": {
        "price": 10.0,
        "hp": 1.0,
        "cat": "support",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.0,
        "traits": "声学反炮兵"
      },
      "宪兵连": {
        "price": 10.0,
        "hp": 2.0,
        "cat": "support",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.75,
            0.25
          ],
          "r1": [
            0.5,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "宪兵"
      },
      "B25轰炸机": {
        "price": 120.0,
        "hp": 6.0,
        "cat": "air",
        "move": 400.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "重轰，空中压制3/2"
      },
      "B29轰炸机": {
        "price": 200.0,
        "hp": 6.0,
        "cat": "air",
        "move": 500.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "重轰，高空，空中压制4/3，核弹"
      },
      "F5侦察机": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "air",
        "move": 650.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "侦查半径2"
      },
      "F6战斗侦察机": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "air",
        "move": 650.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "拦截伤害1，侦查半径2"
      },
      "P38战斗机": {
        "price": 35.0,
        "hp": 4.0,
        "cat": "air",
        "move": 550.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "拦截伤害1"
      },
      "P47战斗轰炸机": {
        "price": 55.0,
        "hp": 4.0,
        "cat": "air",
        "move": 600.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "拦截伤害1.25，空中压制1.5/1.5"
      },
      "P51战斗机": {
        "price": 40.0,
        "hp": 4.0,
        "cat": "air",
        "move": 650.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "拦截伤害1.5"
      },
      "摩托化运输队": {
        "price": 15.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.0,
        "traits": "地面运输，摩托化"
      },
      "山地步兵营": {
        "price": 35.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 11.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.0,
            0.5
          ],
          "r1": [
            2.0,
            0.75
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.375,
        "traits": "山地作战"
      },
      "海军陆战队营": {
        "price": 38.0,
        "hp": 4.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 13.0,
          "r1": 10.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            3.25,
            1.0
          ],
          "r1": [
            1.25,
            0.5
          ],
          "r2": [
            0.25,
            0.25
          ]
        },
        "counter": 1.25,
        "traits": "政治军队"
      },
      "突击工兵营": {
        "price": 40.0,
        "hp": 4.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 13.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.5,
            0.75
          ],
          "r1": [
            1.0,
            0.25
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "爆破"
      },
      "M16自行防空炮营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 2.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            3.25,
            1.5
          ],
          "r1": [
            3.25,
            1.5
          ],
          "r2": [
            1.0,
            0.5
          ]
        },
        "counter": 1.2,
        "traits": "机械化，辅助防空，伤害0.5"
      }
    },
      corps: [
        {
          id: 'us-7corps',
          name: '第7军直属',
          units: [{ name: '宪兵连', max: 3 }, { name: '灰狗装甲侦察营', max: 2 }, { name: '155炮兵营', max: 3 }, { name: '医疗连', max: 5 }, { name: '运输车', max: 3 }, { name: '反炮兵小组', max: 2 }],
        },
        {
          id: 'us-18abn',
          name: '第18空降军直属',
          units: [{ name: '宪兵连', max: 3 }, { name: '医疗连', max: 5 }, { name: 'B29轰炸机', max: 1 }, { name: '155炮兵营', max: 1 }, { name: '海军陆战队步兵营', max: 2 }, { name: '运输车', max: 2 }, { name: '反炮兵小组', max: 2 }],
        },
      ],
      divisions: [
        {
          id: 'us-9id',
          name: '第9步兵师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 230,
            B: 305,
          },
          defense: {
            A: 180,
            B: 280,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '步兵营', max: 2 }, { name: '游骑兵营', max: 1 }, { name: '侦察营', max: 2 }, { name: '105炮兵营', max: 2 }, { name: '40防空炮营', max: 2 }, { name: '反坦克小组', max: 4 }, { name: '反坦克营', max: 2 }, { name: 'P38战斗机', max: 2 }, { name: 'F5侦察机', max: 2 }, { name: '斯图亚特轻坦营', max: 1 }],
            B: [{ name: '90防空炮营', max: 1 }, { name: 'M10中型坦歼营', max: 1 }, { name: 'P47战斗轰炸机', max: 1 }, { name: '76谢尔曼中坦营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'us-101abn',
          name: '101空降师（空降）',
          type: 'airborne',
          phase: 'AB',
          slots: {
            main: 7,
            support: 4,
          },
          planes: null,
          attack: {
            A: 240,
            B: 265,
          },
          defense: {
            A: 175,
            B: 230,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '步兵营', max: 2 }, { name: '伞兵营', max: 3 }, { name: '游骑兵营', max: 2 }, { name: '侦察营', max: 3 }, { name: '40防空炮营', max: 2 }, { name: '反坦克小组', max: 3 }, { name: 'P51战斗机', max: 2 }, { name: 'P47战斗轰炸机', max: 1 }, { name: 'F6战斗侦察机', max: 1 }],
            B: [{ name: '105炮兵营', max: 2 }, { name: 'P47战斗轰炸机', max: 1 }, { name: '斯图亚特轻坦营', max: 2 }, { name: '战斗工兵营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'us-2id',
          name: '第2步兵师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 8,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 225,
            B: 295,
          },
          defense: {
            A: 190,
            B: 285,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '步兵营', max: 2 }, { name: '侦察营', max: 3 }, { name: '反坦克营', max: 3 }, { name: '40防空炮营', max: 1 }, { name: '反坦克小组', max: 4 }, { name: 'P38战斗机', max: 2 }, { name: 'F5侦察机', max: 2 }, { name: '105炮兵营', max: 3 }],
            B: [{ name: '90防空炮营', max: 1 }, { name: 'P47战斗轰炸机', max: 1 }, { name: '76谢尔曼中坦营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'us-1id',
          name: '第1步兵师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 250,
            B: 305,
          },
          defense: {
            A: 180,
            B: 265,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '战斗工兵营', max: 1 }, { name: '步兵营', max: 2 }, { name: '游骑兵营', max: 4 }, { name: '105炮兵营', max: 3 }, { name: '40防空炮营', max: 2 }, { name: '侦察营', max: 2 }, { name: 'P38战斗机', max: 1 }, { name: 'F5侦察机', max: 1 }, { name: '反坦克小组', max: 3 }],
            B: [{ name: 'P51战斗机', max: 1 }, { name: '105炮兵营', max: 1 }, { name: '巨无霸重坦营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'us-10mtn',
          name: '第10山地师',
          type: 'mountain',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 245,
            B: 295,
          },
          defense: {
            A: 165,
            B: 270,
          },
          fundsC: null,
          pool: {
            A: [{ name: '战斗工兵营', max: 1 }, { name: '山地营', max: 3 }, { name: '游骑兵营', max: 2 }, { name: '侦察营', max: 2 }, { name: '反坦克小组', max: 3 }, { name: '40防空炮营', max: 1 }, { name: 'P38战斗机', max: 2 }, { name: 'F5侦察机', max: 2 }, { name: '105炮兵营', max: 2 }, { name: '灰狗装甲侦察营', max: 1 }],
            B: [{ name: 'M10中型坦歼营', max: 1 }, { name: 'P47战斗轰炸机', max: 1 }, { name: '斯图亚特轻坦营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'us-2ad',
          name: '第2装甲师',
          type: 'armored',
          phase: 'C',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: null,
          defense: null,
          fundsC: 510,
          pool: {
            A: [],
            B: [],
            C: [{ name: '机械化步兵营', max: 2 }, { name: '斯图亚特轻坦营', max: 1 }, { name: '75谢尔曼中坦营', max: 3 }, { name: '76谢尔曼中坦营', max: 3 }, { name: '潘兴重坦营', max: 1 }, { name: 'M13自行防空炮营', max: 1 }, { name: 'M15自行防空炮营', max: 1 }, { name: 'M7自行火炮营', max: 2 }, { name: 'P51战斗机', max: 2 }, { name: 'P47战斗轰炸机', max: 2 }, { name: 'B25轰炸机', max: 2 }, { name: '超级潘兴重坦营', max: 1 }, { name: 'M12自行火炮营', max: 2 }],
          },
        },
        {
          id: 'us-4ad',
          name: '第4装甲师',
          type: 'armored',
          phase: 'C',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: null,
          defense: null,
          fundsC: 505,
          pool: {
            A: [],
            B: [],
            C: [{ name: '机械化步兵营', max: 4 }, { name: '斯图亚特轻坦营', max: 3 }, { name: '75谢尔曼中坦营', max: 2 }, { name: '76谢尔曼中坦营', max: 1 }, { name: '灰狗装甲侦察营', max: 2 }, { name: '地狱猫装甲侦察营', max: 2 }, { name: 'M13自行防空炮营', max: 2 }, { name: 'M7自行火炮营', max: 2 }, { name: 'P38战斗机', max: 2 }, { name: 'P47战斗轰炸机', max: 2 }, { name: 'B25轰炸机', max: 1 }, { name: 'T95超重坦营', max: 1 }],
          },
        },
        {
          id: 'us-3ad',
          name: '第3装甲师',
          type: 'armored',
          phase: 'C',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: null,
          defense: null,
          fundsC: 500,
          pool: {
            A: [],
            B: [],
            C: [{ name: '机械化步兵营', max: 3 }, { name: '斯图亚特轻坦营', max: 2 }, { name: '75谢尔曼中坦营', max: 2 }, { name: '76谢尔曼中坦营', max: 2 }, { name: '潘兴重坦营', max: 2 }, { name: '灰狗装甲侦察营', max: 1 }, { name: 'M13自行防空炮营', max: 2 }, { name: 'M15自行防空炮营', max: 1 }, { name: 'M7自行火炮营', max: 3 }, { name: '管风琴火箭炮营', max: 1 }, { name: 'P51战斗机', max: 2 }, { name: 'P47战斗轰炸机', max: 2 }, { name: 'B25轰炸机', max: 2 }],
          },
        },
      ],
    },
    de: {
      name: '德国',
      code: 'DE',
      color: '#909cab',
      units: {
      "222装甲侦察营": {
        "price": 50.0,
        "hp": 4.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 14.0,
          "r1": 5.0,
          "r2": 3.0
        },
        "av": {
          "front": 3.0,
          "side": 2.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            1.5,
            0.75
          ],
          "r1": [
            1.25,
            0.5
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.2,
        "traits": "机械化，侦查半径1"
      },
      "人民冲锋队": {
        "price": 10.0,
        "hp": 6.0,
        "cat": "main",
        "move": 3.0,
        "ap": {
          "urban": 14.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.5,
            0.75
          ],
          "r1": [
            0.5,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "碎心"
      },
      "反坦克营": {
        "price": 35.0,
        "hp": 6.0,
        "cat": "main",
        "move": 3.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.75,
            1.25
          ],
          "r1": [
            2.5,
            2.5
          ],
          "r2": [
            1.25,
            1.25
          ]
        },
        "counter": 1.75,
        "traits": ""
      },
      "四号中坦营": {
        "price": 65.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 8.0,
          "side": 3.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            2.5,
            1.75
          ],
          "r1": [
            2.5,
            1.75
          ],
          "r2": [
            1.0,
            1.0
          ]
        },
        "counter": 1.2,
        "traits": "机械化，中坦"
      },
      "四号中型坦歼营": {
        "price": 75.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 14.0,
          "side": 5.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            2.25,
            1.25
          ],
          "r1": [
            2.75,
            2.0
          ],
          "r2": [
            1.25,
            1.25
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "四号突击炮营": {
        "price": 67.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 8.0,
          "side": 4.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            2.0,
            1.25
          ],
          "r1": [
            2.5,
            1.5
          ],
          "r2": [
            1.0,
            0.75
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "山地猎兵营": {
        "price": 38.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 10.0,
          "r1": 9.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.25,
            0.5
          ],
          "r1": [
            1.75,
            0.75
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.375,
        "traits": "山地作战"
      },
      "步兵营": {
        "price": 25.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 14.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.75,
            0.75
          ],
          "r1": [
            1.5,
            0.5
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.375,
        "traits": ""
      },
      "猎兵营": {
        "price": 30.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 14.0,
          "r1": 9.0,
          "r2": 7.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.25,
            1.0
          ],
          "r1": [
            1.75,
            0.75
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.375,
        "traits": ""
      },
      "猎虎重型坦歼营": {
        "price": 130.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 31.0,
          "r1": 29.0,
          "r2": 25.0
        },
        "av": {
          "front": 24.0,
          "side": 10.0,
          "rear": 8.0
        },
        "attack": {
          "urban": [
            2.0,
            1.25
          ],
          "r1": [
            2.75,
            1.75
          ],
          "r2": [
            1.25,
            1.0
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "猎豹重型坦歼营": {
        "price": 80.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 24.0,
          "r1": 22.0,
          "r2": 19.0
        },
        "av": {
          "front": 16.0,
          "side": 5.0,
          "rear": 5.0
        },
        "attack": {
          "urban": [
            2.0,
            1.25
          ],
          "r1": [
            3.0,
            2.5
          ],
          "r2": [
            1.25,
            1.25
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "突击工兵营": {
        "price": 35.0,
        "hp": 4.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 14.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.5,
            0.5
          ],
          "r1": [
            1.0,
            0.25
          ],
          "r2": [
            0.25,
            0
          ]
        },
        "counter": 1.375,
        "traits": "爆破"
      },
      "突击步兵营": {
        "price": 45.0,
        "hp": 5.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            3.5,
            1.25
          ],
          "r1": [
            3.0,
            1.25
          ],
          "r2": [
            0.75,
            0.5
          ]
        },
        "counter": 1.25,
        "traits": ""
      },
      "美洲狮装甲侦察营": {
        "price": 60.0,
        "hp": 4.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 14.0,
          "r1": 12.0,
          "r2": 9.0
        },
        "av": {
          "front": 4.0,
          "side": 2.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            1.5,
            1.0
          ],
          "r1": [
            1.5,
            0.75
          ],
          "r2": [
            0.5,
            0.25
          ]
        },
        "counter": 1.2,
        "traits": "机械化，侦查半径1"
      },
      "虎式重坦营": {
        "price": 87.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 16.0,
          "r1": 15.0,
          "r2": 13.0
        },
        "av": {
          "front": 12.0,
          "side": 9.0,
          "rear": 9.0
        },
        "attack": {
          "urban": [
            3.25,
            2.0
          ],
          "r1": [
            3.75,
            2.75
          ],
          "r2": [
            1.75,
            1.5
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "虎王重坦营": {
        "price": 105.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 24.0,
          "r1": 22.0,
          "r2": 19.0
        },
        "av": {
          "front": 21.0,
          "side": 9.0,
          "rear": 9.0
        },
        "attack": {
          "urban": [
            3.5,
            2.25
          ],
          "r1": [
            4.25,
            3.25
          ],
          "r2": [
            2.0,
            1.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "装甲掷弹兵营": {
        "price": 28.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 2.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            2.75,
            1.25
          ],
          "r1": [
            3.0,
            1.25
          ],
          "r2": [
            1.5,
            0.5
          ]
        },
        "counter": 1.25,
        "traits": "机械化"
      },
      "豹式中坦营": {
        "price": 85.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 19.0,
          "r1": 17.0,
          "r2": 14.0
        },
        "av": {
          "front": 14.0,
          "side": 5.0,
          "rear": 5.0
        },
        "attack": {
          "urban": [
            3.0,
            1.75
          ],
          "r1": [
            3.75,
            2.75
          ],
          "r2": [
            1.75,
            1.25
          ]
        },
        "counter": 1.2,
        "traits": "机械化，中坦"
      },
      "追猎者轻型坦歼营": {
        "price": 50.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 14.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 10.0,
          "side": 3.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            1.75,
            1.0
          ],
          "r1": [
            2.0,
            1.5
          ],
          "r2": [
            1.0,
            0.75
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "黄鼠狼轻型坦歼营": {
        "price": 55.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 15.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 3.0,
          "side": 1.0,
          "rear": 1.0
        },
        "attack": {
          "urban": [
            1.0,
            1.0
          ],
          "r1": [
            1.5,
            1.5
          ],
          "r2": [
            0.5,
            0.75
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "鼠式超重坦营": {
        "price": 135.0,
        "hp": 6.0,
        "cat": "main",
        "move": 3.0,
        "ap": {
          "urban": 31.0,
          "r1": 29.0,
          "r2": 25.0
        },
        "av": {
          "front": 26.0,
          "side": 23.0,
          "rear": 20.0
        },
        "attack": {
          "urban": [
            2.75,
            2.0
          ],
          "r1": [
            3.5,
            2.75
          ],
          "r2": [
            1.75,
            1.5
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "105炮兵营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            1.5,
            0.75
          ],
          "r2": [
            1.0,
            0.5
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害1，半径7"
      },
      "150炮兵营": {
        "price": 60.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            2.25,
            1.5
          ],
          "r2": [
            1.5,
            1.0
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害1.5，半径11"
      },
      "20防空炮营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 3.0,
        "ap": {
          "urban": 5.0,
          "r1": 3.0,
          "r2": 1.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.25,
            1.5
          ],
          "r1": [
            0.75,
            1.0
          ],
          "r2": [
            0.25,
            0.25
          ]
        },
        "counter": 1.75,
        "traits": "防空半径1，伤害1"
      },
      "88防空炮营": {
        "price": 35.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 16.0,
          "r1": 15.0,
          "r2": 13.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.0,
            1.5
          ],
          "r1": [
            2.25,
            3.0
          ],
          "r2": [
            1.5,
            2.0
          ]
        },
        "counter": 1.75,
        "traits": "防空半径2，伤害1.5"
      },
      "东风自行防空炮营": {
        "price": 35.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 5.0,
          "r1": 3.0,
          "r2": 1.0
        },
        "av": {
          "front": 5.0,
          "side": 3.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            3.75,
            3.5
          ],
          "r1": [
            2.25,
            2.0
          ],
          "r2": [
            0.75,
            0.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化，防空半径1，伤害1.75"
      },
      "侦察营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 14.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.0,
            0.5
          ],
          "r1": [
            0.5,
            0.25
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "侦查半径2"
      },
      "卡车自行防空炮营": {
        "price": 30.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 5.0,
          "r1": 3.0,
          "r2": 1.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            2.0,
            1.75
          ],
          "r1": [
            1.25,
            1.0
          ],
          "r2": [
            0.25,
            0.25
          ]
        },
        "counter": 1.2,
        "traits": "摩托化，防空半径1，伤害0.75"
      },
      "工兵营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.0,
            0.25
          ],
          "r1": [
            0.5,
            0.25
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "工程"
      },
      "运输车": {
        "price": 15,
        "hp": 3,
        "cat": "aux",
        "move": 6,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "地面运输，摩托化"
      },
      "野蜂自行火炮": {
        "price": 60,
        "hp": 3,
        "cat": "aux",
        "move": 5,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 2,
          "side": 2,
          "rear": 2
        },
        "attack": {
          "urban": [
            0.75,
            0.5
          ],
          "r1": [
            2.25,
            1.5
          ],
          "r2": [
            1.5,
            1
          ]
        },
        "counter": 1,
        "traits": "机械化，曲射伤害1.5，半径11"
      },
      "黄蜂自行火炮": {
        "price": 40,
        "hp": 3,
        "cat": "aux",
        "move": 5,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 3,
          "side": 2,
          "rear": 2
        },
        "attack": {
          "urban": [
            1,
            0.5
          ],
          "r1": [
            2.25,
            1
          ],
          "r2": [
            1.25,
            0.5
          ]
        },
        "counter": 1,
        "traits": "机械化，曲射伤害1，半径7"
      },
      "医疗连": {
        "price": 5.0,
        "hp": 2.0,
        "cat": "support",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            0.5,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "医疗"
      },
      "反坦克小组": {
        "price": 6.0,
        "hp": 1.0,
        "cat": "support",
        "move": 5.0,
        "ap": {
          "urban": 18.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            0.5,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "隐蔽"
      },
      "反坦克敢死队": {
        "price": 2.0,
        "hp": 1.0,
        "cat": "support",
        "move": 3.0,
        "ap": {
          "urban": 14.0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            0.25,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "碎心"
      },
      "反炮兵小组": {
        "price": 10.0,
        "hp": 1.0,
        "cat": "support",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.0,
        "traits": "声学反炮兵"
      },
      "宪兵连": {
        "price": 10.0,
        "hp": 2.0,
        "cat": "support",
        "move": 4.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0.5,
            0.25
          ],
          "r1": [
            0.5,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.375,
        "traits": "宪兵"
      },
      "Bf109战斗机": {
        "price": 30.0,
        "hp": 4.0,
        "cat": "air",
        "move": 600.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "拦截伤害1.25"
      },
      "Fw189侦察机": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "air",
        "move": 500.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "侦查"
      },
      "Fw190战斗轰炸机": {
        "price": 48.0,
        "hp": 4.0,
        "cat": "air",
        "move": 550.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "拦截伤害0.75，空中压制1.5/1"
      },
      "Ju88轰炸机": {
        "price": 135.0,
        "hp": 6.0,
        "cat": "air",
        "move": 480.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "重轰，空中压制3/2"
      },
      "Me262战斗机": {
        "price": 45.0,
        "hp": 4.0,
        "cat": "air",
        "move": 900.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1,
        "traits": "高空，拦截伤害1.75"
      },
      "摩托化运输队": {
        "price": 15.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            0,
            0
          ],
          "r1": [
            0,
            0
          ],
          "r2": [
            0,
            0
          ]
        },
        "counter": 1.0,
        "traits": "地面运输，摩托化"
      },
      "黄蜂自行火炮营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 3.0,
          "side": 2.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            1.0,
            0.5
          ],
          "r1": [
            2.25,
            1.0
          ],
          "r2": [
            1.25,
            0.5
          ]
        },
        "counter": 1.0,
        "traits": "机械化，曲射伤害1，半径7"
      },
      "野蜂自行火炮营": {
        "price": 60.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 0
        },
        "av": {
          "front": 2.0,
          "side": 2.0,
          "rear": 2.0
        },
        "attack": {
          "urban": [
            0.75,
            0.5
          ],
          "r1": [
            2.25,
            1.5
          ],
          "r2": [
            1.5,
            1.0
          ]
        },
        "counter": 1.0,
        "traits": "机械化，曲射伤害1.5，半径11"
      }
    },
      corps: [
        {
          id: 'de-9corps',
          name: '第9军直属',
          units: [{ name: '150炮兵营', max: 3 }, { name: '222装甲侦察营', max: 3 }, { name: '宪兵连', max: 3 }, { name: '医疗连', max: 5 }, { name: '运输车', max: 3 }, { name: '反炮兵小组', max: 2 }],
        },
      ],
      divisions: [
        {
          id: 'de-16lwfd',
          name: '16空军野战师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: null,
          attack: {
            A: 240,
            B: 315,
          },
          defense: {
            A: 175,
            B: 275,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '猎兵营', max: 2 }, { name: '突击步兵营', max: 2 }, { name: '侦察营', max: 1 }, { name: '105炮兵营', max: 2 }, { name: '20防空炮营', max: 1 }, { name: '反坦克小组', max: 3 }, { name: 'Fw189侦察机', max: 1 }, { name: 'Bf109战斗机', max: 2 }, { name: 'Fw190战斗轰炸机', max: 1 }, { name: '四号突击炮营', max: 1 }],
            B: [{ name: 'Ju88轰炸机', max: 1 }, { name: '美洲狮装甲侦察营', max: 1 }, { name: '四号中坦营', max: 1 }, { name: 'Me262战斗机', max: 1 }],
            C: [],
          },
        },
        {
          id: 'de-352id',
          name: '352步兵师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 9,
            support: 4,
          },
          planes: 3,
          attack: {
            A: 225,
            B: 295,
          },
          defense: {
            A: 180,
            B: 265,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '步兵营', max: 3 }, { name: '人民冲锋队', max: 4 }, { name: '20防空炮营', max: 2 }, { name: '反坦克营', max: 2 }, { name: '反坦克小组', max: 1 }, { name: '反坦克敢死队', max: 2 }, { name: '侦察营', max: 1 }, { name: 'Bf109战斗机', max: 1 }, { name: '105炮兵营', max: 1 }],
            B: [{ name: '105炮兵营', max: 1 }, { name: '四号中型坦歼营', max: 1 }, { name: '88防空炮营', max: 1 }, { name: '四号中坦营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'de-1id',
          name: '第1步兵师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 245,
            B: 320,
          },
          defense: {
            A: 165,
            B: 265,
          },
          fundsC: null,
          pool: {
            A: [{ name: '工兵营', max: 1 }, { name: '步兵营', max: 2 }, { name: '突击步兵营', max: 2 }, { name: '侦察营', max: 2 }, { name: '105炮兵营', max: 3 }, { name: '反坦克营', max: 1 }, { name: '20防空炮营', max: 1 }, { name: '反坦克小组', max: 2 }, { name: 'Fw189侦察机', max: 1 }, { name: 'Bf109战斗机', max: 1 }, { name: '追猎者轻型坦歼营', max: 1 }],
            B: [{ name: 'Bf109战斗机', max: 1 }, { name: 'Fw190战斗轰炸机', max: 1 }, { name: '四号中型坦歼营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'de-78sturm',
          name: '第78突击师',
          type: 'infantry',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 255,
            B: 320,
          },
          defense: {
            A: 160,
            B: 255,
          },
          fundsC: null,
          pool: {
            A: [{ name: '突击工兵营', max: 1 }, { name: '侦察营', max: 2 }, { name: '步兵营', max: 1 }, { name: '突击步兵营', max: 2 }, { name: '105炮兵营', max: 2 }, { name: '四号突击炮营', max: 1 }, { name: '20防空炮营', max: 1 }, { name: '反坦克营', max: 2 }, { name: 'Fw189侦察机', max: 1 }, { name: 'Bf109战斗机', max: 2 }],
            B: [{ name: '四号突击炮营', max: 1 }, { name: '四号中坦营', max: 1 }, { name: '突击工兵营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'de-6mtn',
          name: '第6北方山地师',
          type: 'mountain',
          phase: 'AB',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: {
            A: 250,
            B: 315,
          },
          defense: {
            A: 165,
            B: 250,
          },
          fundsC: null,
          pool: {
            A: [{ name: '山地猎兵营', max: 2 }, { name: '猎兵营', max: 2 }, { name: '侦察营', max: 1 }, { name: '反坦克营', max: 1 }, { name: '工兵营', max: 1 }, { name: '105炮兵营', max: 2 }, { name: '四号中型坦歼营', max: 1 }, { name: 'Fw189侦察机', max: 1 }, { name: 'Bf109战斗机', max: 2 }, { name: '20防空炮营', max: 1 }],
            B: [{ name: '四号中坦营', max: 1 }, { name: '山地猎兵营', max: 1 }],
            C: [],
          },
        },
        {
          id: 'de-7ad',
          name: '第7装甲师',
          type: 'armored',
          phase: 'C',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: null,
          defense: null,
          fundsC: 515,
          pool: {
            A: [],
            B: [],
            C: [{ name: '装甲掷弹兵营', max: 3 }, { name: '四号中坦营', max: 3 }, { name: '豹式中坦营', max: 2 }, { name: '黄鼠狼轻型坦歼营', max: 2 }, { name: '黄蜂自行火炮', max: 2 }, { name: '野蜂自行火炮', max: 2 }, { name: '东风自行防空炮营', max: 1 }, { name: 'Me262战斗机', max: 1 }, { name: 'Fw190战斗轰炸机', max: 2 }, { name: '美洲狮装甲侦察营', max: 2 }, { name: '猎豹重型坦歼营', max: 2 }, { name: 'Ju88轰炸机', max: 1 }],
          },
        },
        {
          id: 'de-mb',
          name: '明谢贝格装甲师',
          type: 'armored',
          phase: 'C',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: null,
          defense: null,
          fundsC: 545,
          pool: {
            A: [],
            B: [],
            C: [{ name: '装甲掷弹兵营', max: 2 }, { name: '四号中坦营', max: 2 }, { name: '豹式中坦营', max: 2 }, { name: '猎虎重型坦歼营', max: 1 }, { name: '虎式重坦营', max: 2 }, { name: '野蜂自行火炮', max: 2 }, { name: '美洲狮装甲侦察营', max: 1 }, { name: '卡车自行防空炮营', max: 2 }, { name: 'Bf109战斗机', max: 2 }, { name: 'Fw189侦察机', max: 1 }, { name: 'Fw190战斗轰炸机', max: 2 }],
          },
        },
        {
          id: 'de-lehr',
          name: '装甲教导师',
          type: 'armored',
          phase: 'C',
          slots: {
            main: 7,
            support: 5,
          },
          planes: 3,
          attack: null,
          defense: null,
          fundsC: 575,
          pool: {
            A: [],
            B: [],
            C: [{ name: '装甲掷弹兵营', max: 2 }, { name: '四号中坦营', max: 2 }, { name: '豹式中坦营', max: 3 }, { name: '虎式重坦营', max: 2 }, { name: '虎王重坦营', max: 1 }, { name: '美洲狮装甲侦察营', max: 1 }, { name: '卡车自行防空炮营', max: 1 }, { name: '东风自行防空炮营', max: 1 }, { name: '黄蜂自行火炮', max: 2 }, { name: '鼠式超重坦营', max: 1 }, { name: 'Bf109战斗机', max: 2 }, { name: 'Fw190战斗轰炸机', max: 2 }, { name: 'Ju88轰炸机', max: 1 }],
          },
        },
      ],
    },
  },
};

window.PREP_DATA.factions.ussr = {
  "name": "苏联",
  "units": {
    "步兵营": {
      "price": 28,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 20,
        "r1": 5,
        "r2": 4
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          2.75,
          1.25
        ],
        "r1": [
          2.5,
          1.5
        ],
        "r2": [
          0.75,
          0.25
        ]
      },
      "counter": 1.25,
      "traits": ""
    },
    "近卫步兵营": {
      "price": 50,
      "hp": 6,
      "cat": "main",
      "move": 5,
      "ap": {
        "urban": 20,
        "r1": 13,
        "r2": 10
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          3.5,
          2
        ],
        "r1": [
          3.5,
          2.75
        ],
        "r2": [
          1.5,
          1
        ]
      },
      "counter": 1.25,
      "traits": "山地作战，政治军队"
    },
    "惩戒营": {
      "price": 15,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          4,
          1.5
        ],
        "r1": [
          2,
          1.75
        ],
        "r2": [
          0.75,
          0.5
        ]
      },
      "counter": 1.25,
      "traits": ""
    },
    "伞兵营": {
      "price": 28,
      "hp": 5,
      "cat": "main",
      "move": 5,
      "ap": {
        "urban": 20,
        "r1": 3,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1.5,
          0.5
        ],
        "r1": [
          0.75,
          0.5
        ],
        "r2": [
          0.25,
          0.25
        ]
      },
      "counter": 1.25,
      "traits": ""
    },
    "机械化步兵营": {
      "price": 32,
      "hp": 6,
      "cat": "main",
      "move": 8,
      "ap": {
        "urban": 20,
        "r1": 13,
        "r2": 10
      },
      "av": {
        "front": 3,
        "side": 2,
        "rear": 2
      },
      "attack": {
        "urban": [
          3.5,
          1.25
        ],
        "r1": [
          2.75,
          1.25
        ],
        "r2": [
          0.75,
          0.25
        ]
      },
      "counter": 1.2,
      "traits": "机械化"
    },
    "突击工兵营": {
      "price": 35,
      "hp": 4,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 20,
        "r1": 5,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          2.25,
          0.75
        ],
        "r1": [
          1.5,
          0.75
        ],
        "r2": [
          0.25,
          0
        ]
      },
      "counter": 1.25,
      "traits": "爆破"
    },
    "反坦克营": {
      "price": 32,
      "hp": 6,
      "cat": "main",
      "move": 3,
      "ap": {
        "urban": 20,
        "r1": 8,
        "r2": 6
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1.75,
          1
        ],
        "r1": [
          1.75,
          1.75
        ],
        "r2": [
          0.5,
          0.5
        ]
      },
      "counter": 1.75,
      "traits": ""
    },
    "SU85中型坦歼营": {
      "price": 70,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 20,
        "r1": 13,
        "r2": 11
      },
      "av": {
        "front": 7,
        "side": 5,
        "rear": 5
      },
      "attack": {
        "urban": [
          2.25,
          1.25
        ],
        "r1": [
          2.5,
          2.25
        ],
        "r2": [
          1,
          1
        ]
      },
      "counter": 1.5,
      "traits": "机械化"
    },
    "SU100中型坦歼营": {
      "price": 95,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 24,
        "r1": 22,
        "r2": 17
      },
      "av": {
        "front": 7,
        "side": 5,
        "rear": 5
      },
      "attack": {
        "urban": [
          2.75,
          1.5
        ],
        "r1": [
          3.25,
          3
        ],
        "r2": [
          1.25,
          1.25
        ]
      },
      "counter": 1.2,
      "traits": "机械化"
    },
    "ISU152重型坦歼营": {
      "price": 85,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 20,
        "r1": 19,
        "r2": 17
      },
      "av": {
        "front": 13,
        "side": 9,
        "rear": 8
      },
      "attack": {
        "urban": [
          3,
          1.5
        ],
        "r1": [
          3.25,
          2.5
        ],
        "r2": [
          1.25,
          0.75
        ]
      },
      "counter": 1.5,
      "traits": "机械化"
    },
    "37防空炮营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 3,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 2
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          4.5,
          3.5
        ],
        "r1": [
          3.75,
          3
        ],
        "r2": [
          1,
          0.75
        ]
      },
      "counter": 1.75,
      "traits": "防空半径1，伤害1"
    },
    "85防空炮营": {
      "price": 40,
      "hp": 3,
      "cat": "aux",
      "move": 2,
      "ap": {
        "urban": 15,
        "r1": 13,
        "r2": 11
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1,
          1.5
        ],
        "r1": [
          2.25,
          3.25
        ],
        "r2": [
          1.25,
          2
        ]
      },
      "counter": 1.75,
      "traits": "防空半径2，伤害1.5"
    },
    "ZSU37自行防空炮营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 6,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 2
      },
      "av": {
        "front": 3,
        "side": 2,
        "rear": 1
      },
      "attack": {
        "urban": [
          3.25,
          2.5
        ],
        "r1": [
          3.25,
          2.5
        ],
        "r2": [
          0.75,
          0.5
        ]
      },
      "counter": 1.2,
      "traits": "机械化，防空半径1，伤害1"
    },
    "Il2侦察机": {
      "price": 30,
      "hp": 5,
      "cat": "air",
      "move": 450,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "侦察半径2"
    },
    "Yak9战斗机": {
      "price": 25,
      "hp": 4,
      "cat": "air",
      "move": 600,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "拦截伤害0.75"
    },
    "Il2攻击机": {
      "price": 55,
      "hp": 5,
      "cat": "air",
      "move": 420,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "空中压制1.5/2.5"
    },
    "Tu2轰炸机": {
      "price": 125,
      "hp": 5,
      "cat": "air",
      "move": 350,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "重轰，空中压制3/2"
    },
    "反炮兵小组": {
      "price": 10,
      "hp": 1,
      "cat": "support",
      "move": 4,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "声学反炮兵6"
    },
    "76炮兵营": {
      "price": 35,
      "hp": 3,
      "cat": "aux",
      "move": 2,
      "ap": {
        "urban": 9,
        "r1": 8,
        "r2": 6
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0.5,
          0.25
        ],
        "r1": [
          1.5,
          1
        ],
        "r2": [
          1,
          0.75
        ]
      },
      "counter": 1,
      "traits": "曲射伤害1，半径7"
    },
    "122炮兵营": {
      "price": 50,
      "hp": 3,
      "cat": "aux",
      "move": 2,
      "ap": {
        "urban": 21,
        "r1": 19,
        "r2": 17
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0.5,
          0.5
        ],
        "r1": [
          2.25,
          2
        ],
        "r2": [
          1.5,
          1.25
        ]
      },
      "counter": 1,
      "traits": "曲射伤害1.5，半径11"
    },
    "152炮兵营": {
      "price": 60,
      "hp": 3,
      "cat": "aux",
      "move": 2,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0.75,
          0.5
        ],
        "r1": [
          3,
          2
        ],
        "r2": [
          2,
          1.5
        ]
      },
      "counter": 1,
      "traits": "曲射伤害2，半径7"
    },
    "SU76自行火炮": {
      "price": 35,
      "hp": 3,
      "cat": "aux",
      "move": 6,
      "ap": {
        "urban": 9,
        "r1": 8,
        "r2": 6
      },
      "av": {
        "front": 3,
        "side": 2,
        "rear": 0
      },
      "attack": {
        "urban": [
          0.5,
          0.25
        ],
        "r1": [
          1.5,
          1.5
        ],
        "r2": [
          1,
          1
        ]
      },
      "counter": 1,
      "traits": "机械化，曲射伤害1，半径7"
    },
    "喀秋莎火箭炮营": {
      "price": 80,
      "hp": 3,
      "cat": "aux",
      "move": 6,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          2.25,
          1.25
        ],
        "r2": [
          1.5,
          0.75
        ]
      },
      "counter": 1,
      "traits": "摩托化，火箭炮，杀伤半径1，伤害3"
    },
    "侦查营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 5,
      "ap": {
        "urban": 20,
        "r1": 3,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1.25,
          0.5
        ],
        "r1": [
          0.75,
          0.5
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.25,
      "traits": "侦查半径2"
    },
    "工兵营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 4,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1.25,
          0.25
        ],
        "r1": [
          0.75,
          0.25
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.25,
      "traits": "工程"
    },
    "教导营": {
      "price": 8,
      "hp": 3,
      "cat": "aux",
      "move": 4,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1.25,
          0.25
        ],
        "r1": [
          0.75,
          0.25
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.25,
      "traits": "宪兵"
    },
    "医疗连": {
      "price": 5,
      "hp": 2,
      "cat": "support",
      "move": 4,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0.75,
          0.25
        ],
        "r1": [
          0.5,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.25,
      "traits": "医疗"
    },
    "摩托化运输队": {
      "price": 13,
      "hp": 3,
      "cat": "aux",
      "move": 5,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "地面运输，摩托化"
    },
    "T60轻坦营": {
      "price": 45,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 20,
        "r1": 3,
        "r2": 1
      },
      "av": {
        "front": 4,
        "side": 3,
        "rear": 3
      },
      "attack": {
        "urban": [
          3.25,
          2.25
        ],
        "r1": [
          2.75,
          2
        ],
        "r2": [
          0.75,
          0.5
        ]
      },
      "counter": 1.2,
      "traits": "机械化"
    },
    "T3476中坦营": {
      "price": 52,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 20,
        "r1": 9,
        "r2": 8
      },
      "av": {
        "front": 9,
        "side": 5,
        "rear": 5
      },
      "attack": {
        "urban": [
          3.25,
          2.25
        ],
        "r1": [
          3.25,
          2.75
        ],
        "r2": [
          1,
          0.75
        ]
      },
      "counter": 1.2,
      "traits": "机械化，中坦"
    },
    "T3485中坦营": {
      "price": 75,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 20,
        "r1": 13,
        "r2": 11
      },
      "av": {
        "front": 11,
        "side": 7,
        "rear": 5
      },
      "attack": {
        "urban": [
          3,
          2.25
        ],
        "r1": [
          3.25,
          3
        ],
        "r2": [
          1.25,
          1.25
        ]
      },
      "counter": 1.2,
      "traits": "机械化，中坦"
    },
    "T44中坦营": {
      "price": 90,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 20,
        "r1": 13,
        "r2": 11
      },
      "av": {
        "front": 18,
        "side": 8,
        "rear": 8
      },
      "attack": {
        "urban": [
          3,
          2.25
        ],
        "r1": [
          3.25,
          3
        ],
        "r2": [
          1.25,
          1.25
        ]
      },
      "counter": 1.2,
      "traits": "机械化，中坦"
    },
    "T44-100中坦营": {
      "price": 105,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 24,
        "r1": 22,
        "r2": 17
      },
      "av": {
        "front": 20,
        "side": 9,
        "rear": 8
      },
      "attack": {
        "urban": [
          4,
          2.25
        ],
        "r1": [
          4.5,
          3.5
        ],
        "r2": [
          2,
          1.25
        ]
      },
      "counter": 1.2,
      "traits": "机械化，中坦"
    },
    "IS2重坦营": {
      "price": 95,
      "hp": 6,
      "cat": "main",
      "move": 5,
      "ap": {
        "urban": 21,
        "r1": 19,
        "r2": 17
      },
      "av": {
        "front": 18,
        "side": 11,
        "rear": 10
      },
      "attack": {
        "urban": [
          3.75,
          2
        ],
        "r1": [
          4.25,
          2.75
        ],
        "r2": [
          1.75,
          1
        ]
      },
      "counter": 1.2,
      "traits": "机械化，重坦"
    },
    "IS3重坦营": {
      "price": 140,
      "hp": 6,
      "cat": "main",
      "move": 5,
      "ap": {
        "urban": 20,
        "r1": 19,
        "r2": 17
      },
      "av": {
        "front": 28,
        "side": 22,
        "rear": 14
      },
      "attack": {
        "urban": [
          2.75,
          1.75
        ],
        "r1": [
          3,
          2.5
        ],
        "r2": [
          1,
          0.75
        ]
      },
      "counter": 1.2,
      "traits": "机械化，重坦"
    },
    "Il2对地攻击机": {
      "price": 55,
      "hp": 5,
      "cat": "air",
      "move": 420,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          0,
          0
        ],
        "r1": [
          0,
          0
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1,
      "traits": "空中压制1.5/2.5"
    }
  },
  "corps": [
    {
      "id": "ussr-belarus-2-front",
      "name": "白俄罗斯第2方面军直属",
      "units": [
        {
          "name": "医疗连",
          "max": 5
        },
        {
          "name": "152炮兵营",
          "max": 3
        },
        {
          "name": "喀秋莎火箭炮营",
          "max": 1
        },
        {
          "name": "IS2重坦营",
          "max": 2
        },
        {
          "name": "运输车",
          "max": 2
        },
        {
          "name": "反炮兵小组",
          "max": 2
        }
      ]
    },
    {
      "id": "ussr-stalingrad-front",
      "name": "斯大林格勒方面军直属",
      "units": [
        {
          "name": "医疗连",
          "max": 5
        },
        {
          "name": "喀秋莎火箭炮营",
          "max": 1
        },
        {
          "name": "惩戒营",
          "max": 4
        },
        {
          "name": "Tu2轰炸机",
          "max": 1
        },
        {
          "name": "运输车",
          "max": 2
        },
        {
          "name": "反炮兵小组",
          "max": 2
        }
      ]
    }
  ],
  "divisions": [
    {
      "id": "ussr-32gds-rifle",
      "name": "第32近卫步兵军",
      "type": "infantry",
      "phase": "AB",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 3,
      "attack": {
        "A": 235,
        "B": 300
      },
      "defense": {
        "A": 185,
        "B": 285
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "突击工兵营",
            "max": 1
          },
          {
            "name": "步兵营",
            "max": 2
          },
          {
            "name": "近卫步兵营",
            "max": 2
          },
          {
            "name": "76炮兵营",
            "max": 2
          },
          {
            "name": "122炮兵营",
            "max": 1
          },
          {
            "name": "37防空炮营",
            "max": 1
          },
          {
            "name": "反坦克营",
            "max": 1
          },
          {
            "name": "Yak9战斗机",
            "max": 1
          },
          {
            "name": "Il2对地攻击机",
            "max": 1
          },
          {
            "name": "T60轻坦营",
            "max": 1
          },
          {
            "name": "教导营",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "ISU152重型坦歼营",
            "max": 1
          },
          {
            "name": "T3476中坦营",
            "max": 1
          },
          {
            "name": "近卫步兵营",
            "max": 1
          },
          {
            "name": "工兵营",
            "max": 1
          },
          {
            "name": "85防空炮营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "ussr-4gds-abn",
      "name": "第4近卫空降军",
      "type": "airborne",
      "phase": "AB",
      "slots": {
        "main": 8,
        "support": 5
      },
      "planes": null,
      "attack": {
        "A": 250,
        "B": 320
      },
      "defense": {
        "A": 170,
        "B": 270
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "工兵营",
            "max": 1
          },
          {
            "name": "伞兵营",
            "max": 3
          },
          {
            "name": "近卫步兵营",
            "max": 2
          },
          {
            "name": "侦查营",
            "max": 1
          },
          {
            "name": "76炮兵营",
            "max": 2
          },
          {
            "name": "37防空炮营",
            "max": 1
          },
          {
            "name": "Yak9战斗机",
            "max": 3
          },
          {
            "name": "Il2对地攻击机",
            "max": 2
          },
          {
            "name": "T60轻坦营",
            "max": 1
          },
          {
            "name": "教导营",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "喀秋莎火箭炮营",
            "max": 1
          },
          {
            "name": "SU85中型坦歼营",
            "max": 1
          },
          {
            "name": "Il2对地攻击机",
            "max": 1
          },
          {
            "name": "T60轻坦营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "ussr-22gds-rifle",
      "name": "第22近卫步兵军",
      "type": "infantry",
      "phase": "AB",
      "slots": {
        "main": 8,
        "support": 5
      },
      "planes": 3,
      "attack": {
        "A": 225,
        "B": 265
      },
      "defense": {
        "A": 200,
        "B": 295
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "工兵营",
            "max": 1
          },
          {
            "name": "步兵营",
            "max": 3
          },
          {
            "name": "近卫步兵营",
            "max": 1
          },
          {
            "name": "侦查营",
            "max": 1
          },
          {
            "name": "76炮兵营",
            "max": 2
          },
          {
            "name": "122炮兵营",
            "max": 1
          },
          {
            "name": "37防空炮营",
            "max": 2
          },
          {
            "name": "反坦克营",
            "max": 2
          },
          {
            "name": "Yak9战斗机",
            "max": 2
          },
          {
            "name": "Il2对地攻击机",
            "max": 1
          },
          {
            "name": "Il2侦察机",
            "max": 1
          },
          {
            "name": "教导营",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "T60轻坦营",
            "max": 2
          },
          {
            "name": "85防空炮营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "ussr-6-breakthrough-art",
      "name": "第6突破炮兵军",
      "type": "artillery",
      "phase": "AB",
      "slots": {
        "main": 8,
        "support": 5
      },
      "planes": 3,
      "attack": {
        "A": 255,
        "B": 305
      },
      "defense": {
        "A": 185,
        "B": 275
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "工兵营",
            "max": 1
          },
          {
            "name": "突击工兵营",
            "max": 1
          },
          {
            "name": "近卫步兵营",
            "max": 1
          },
          {
            "name": "步兵营",
            "max": 2
          },
          {
            "name": "76炮兵营",
            "max": 3
          },
          {
            "name": "122炮兵营",
            "max": 2
          },
          {
            "name": "喀秋莎火箭炮营",
            "max": 2
          },
          {
            "name": "37防空炮营",
            "max": 1
          },
          {
            "name": "Yak9战斗机",
            "max": 2
          },
          {
            "name": "Il2侦察机",
            "max": 1
          },
          {
            "name": "教导营",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "T3476中坦营",
            "max": 1
          },
          {
            "name": "近卫步兵营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "ussr-2gds-tank",
      "name": "第2近卫坦克军",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 8,
        "support": 5
      },
      "planes": 3,
      "attack": null,
      "defense": null,
      "fundsC": 495,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "机械化步兵营",
            "max": 4
          },
          {
            "name": "T3476中坦营",
            "max": 1
          },
          {
            "name": "T3485中坦营",
            "max": 2
          },
          {
            "name": "SU85中型坦歼营",
            "max": 2
          },
          {
            "name": "T44中坦营",
            "max": 1
          },
          {
            "name": "T44-100中坦营",
            "max": 1
          },
          {
            "name": "ZSU37自行防空炮营",
            "max": 1
          },
          {
            "name": "SU76自行火炮",
            "max": 1
          },
          {
            "name": "喀秋莎火箭炮营",
            "max": 1
          },
          {
            "name": "Yak9战斗机",
            "max": 2
          },
          {
            "name": "Il2对地攻击机",
            "max": 1
          },
          {
            "name": "Il2侦察机",
            "max": 1
          },
          {
            "name": "Tu2轰炸机",
            "max": 1
          }
        ]
      }
    },
    {
      "id": "ussr-7gds-heavy-tank",
      "name": "第7近卫重型坦克军",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 3,
      "attack": null,
      "defense": null,
      "fundsC": 515,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "机械化步兵营",
            "max": 2
          },
          {
            "name": "T3476中坦营",
            "max": 2
          },
          {
            "name": "IS2重坦营",
            "max": 2
          },
          {
            "name": "ISU152重型坦歼营",
            "max": 2
          },
          {
            "name": "T44中坦营",
            "max": 2
          },
          {
            "name": "SU76自行火炮",
            "max": 2
          },
          {
            "name": "ZSU37自行防空炮营",
            "max": 1
          },
          {
            "name": "喀秋莎火箭炮营",
            "max": 2
          },
          {
            "name": "Yak9战斗机",
            "max": 2
          },
          {
            "name": "Il2对地攻击机",
            "max": 1
          },
          {
            "name": "Il2侦察机",
            "max": 1
          }
        ]
      }
    },
    {
      "id": "ussr-6gds-tank",
      "name": "第6近卫坦克军",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 3,
      "attack": null,
      "defense": null,
      "fundsC": 490,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "机械化步兵营",
            "max": 3
          },
          {
            "name": "T60轻坦营",
            "max": 2
          },
          {
            "name": "T3476中坦营",
            "max": 1
          },
          {
            "name": "T3485中坦营",
            "max": 2
          },
          {
            "name": "IS2重坦营",
            "max": 1
          },
          {
            "name": "ZSU37自行防空炮营",
            "max": 1
          },
          {
            "name": "SU76自行火炮",
            "max": 3
          },
          {
            "name": "T44中坦营",
            "max": 2
          },
          {
            "name": "IS3重坦营",
            "max": 1
          },
          {
            "name": "喀秋莎火箭炮营",
            "max": 2
          },
          {
            "name": "Il2侦察机",
            "max": 1
          },
          {
            "name": "Yak9战斗机",
            "max": 2
          },
          {
            "name": "Il2对地攻击机",
            "max": 2
          },
          {
            "name": "Tu2轰炸机",
            "max": 1
          }
        ]
      }
    },
    {
      "id": "ussr-18gds-tank",
      "name": "第18红旗坦克军",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 3,
      "attack": null,
      "defense": null,
      "fundsC": 500,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "机械化步兵营",
            "max": 3
          },
          {
            "name": "T60轻坦营",
            "max": 3
          },
          {
            "name": "T3476中坦营",
            "max": 2
          },
          {
            "name": "SU100中型坦歼营",
            "max": 2
          },
          {
            "name": "T44中坦营",
            "max": 2
          },
          {
            "name": "SU76自行火炮",
            "max": 2
          },
          {
            "name": "喀秋莎火箭炮营",
            "max": 1
          },
          {
            "name": "ZSU37自行防空炮营",
            "max": 1
          },
          {
            "name": "Yak9战斗机",
            "max": 2
          },
          {
            "name": "Il2对地攻击机",
            "max": 1
          },
          {
            "name": "Il2侦察机",
            "max": 1
          }
        ]
      }
    }
  ]
};

window.PREP_DATA.modelIndex = Object.assign(window.PREP_DATA.modelIndex || {}, {"37防空炮营":{"ussr":["ussr-40s-aa.js","ussr|40s|aa|37防空炮营"]},"85防空炮营":{"ussr":["ussr-40s-aa.js","ussr|40s|aa|85防空炮营"]},"ZSU37自行防空炮营":{"ussr":["ussr-40s-aa.js","ussr|40s|aa|ZSU37自行防空炮营"]},"Il2侦察机":{"ussr":["ussr-40s-air.js","ussr|40s|air|Il2侦察机"]},"Yak9战斗机":{"ussr":["ussr-40s-air.js","ussr|40s|air|Yak9战斗机"]},"Il2攻击机":{"ussr":["ussr-40s-air.js","ussr|40s|air|Il2攻击机"]},"Tu2轰炸机":{"ussr":["ussr-40s-air.js","ussr|40s|air|Tu2轰炸机"]},"T60轻坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|T60轻坦营"]},"T3476中坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|T3476中坦营"]},"T3485中坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|T3485中坦营"]},"T44中坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|T44中坦营"]},"T44-100中坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|T44-100中坦营"]},"IS2重坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|IS2重坦营"]},"IS3重坦营":{"ussr":["ussr-40s-armor.js","ussr|40s|armor|IS3重坦营"]},"反炮兵小组":{"ussr":["ussr-40s-arty.js","ussr|40s|arty|反炮兵小组"]},"76炮兵营":{"ussr":["ussr-40s-arty.js","ussr|40s|arty|76炮兵营"]},"122炮兵营":{"ussr":["ussr-40s-arty.js","ussr|40s|arty|122炮兵营"]},"152炮兵营":{"ussr":["ussr-40s-arty.js","ussr|40s|arty|152炮兵营"]},"SU76自行火炮":{"ussr":["ussr-40s-arty.js","ussr|40s|arty|SU76自行火炮"]},"喀秋莎火箭炮营":{"ussr":["ussr-40s-arty.js","ussr|40s|arty|喀秋莎火箭炮营"]},"反坦克营":{"ussr":["ussr-40s-at.js","ussr|40s|at|反坦克营"]},"SU85中型坦歼营":{"ussr":["ussr-40s-at.js","ussr|40s|at|SU85中型坦歼营"]},"SU100中型坦歼营":{"ussr":["ussr-40s-at.js","ussr|40s|at|SU100中型坦歼营"]},"ISU152重型坦歼营":{"ussr":["ussr-40s-at.js","ussr|40s|at|ISU152重型坦歼营"]},"步兵营":{"ussr":["ussr-40s-inf.js","ussr|40s|inf|步兵营"]},"近卫步兵营":{"ussr":["ussr-40s-inf.js","ussr|40s|inf|近卫步兵营"]},"惩戒营":{"ussr":["ussr-40s-inf.js","ussr|40s|inf|惩戒营"]},"伞兵营":{"ussr":["ussr-40s-inf.js","ussr|40s|inf|伞兵营"]},"机械化步兵营":{"ussr":["ussr-40s-inf.js","ussr|40s|inf|机械化步兵营"]},"侦查营":{"ussr":["ussr-40s-recon.js","ussr|40s|recon|侦查营"]},"突击工兵营":{"ussr":["ussr-40s-support.js","ussr|40s|support|突击工兵营"]},"工兵营":{"ussr":["ussr-40s-support.js","ussr|40s|support|工兵营"]},"教导营":{"ussr":["ussr-40s-support.js","ussr|40s|support|教导营"]},"医疗连":{"ussr":["ussr-40s-support.js","ussr|40s|support|医疗连"]},"摩托化运输队":{"ussr":["ussr-40s-support.js","ussr|40s|support|摩托化运输队"]}});

window.PREP_DATA.factions.ussr.units['运输车'] = Object.assign({}, window.PREP_DATA.factions.ussr.units['摩托化运输队']);
