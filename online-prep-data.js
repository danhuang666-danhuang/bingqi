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
        "traits": ""
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
        "traits": "声学反炮兵6"
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
        "price": 220.0,
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
        "traits": "重轰，高空，空中压制5/5，核弹"
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
        "traits": ""
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
        "traits": "声学反炮兵6"
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
        "price": 130.0,
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
        "traits": "重轰，空中压制2.5/2"
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
        "price": 28.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 20.0,
          "r1": 5.0,
          "r2": 4.0
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
        "price": 50.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 20.0,
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
            2.0
          ],
          "r1": [
            3.5,
            2.75
          ],
          "r2": [
            1.5,
            1.0
          ]
        },
        "counter": 1.25,
        "traits": "山地作战，政治军队"
      },
      "惩戒营": {
        "price": 15.0,
        "hp": 6.0,
        "cat": "main",
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
            4.0,
            1.5
          ],
          "r1": [
            2.0,
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
        "price": 28.0,
        "hp": 5.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 20.0,
          "r1": 3.0,
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
        "price": 32.0,
        "hp": 6.0,
        "cat": "main",
        "move": 8.0,
        "ap": {
          "urban": 20.0,
          "r1": 13.0,
          "r2": 10.0
        },
        "av": {
          "front": 3.0,
          "side": 2.0,
          "rear": 2.0
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
        "price": 35.0,
        "hp": 4.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 20.0,
          "r1": 5.0,
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
        "price": 32.0,
        "hp": 6.0,
        "cat": "main",
        "move": 3.0,
        "ap": {
          "urban": 20.0,
          "r1": 8.0,
          "r2": 6.0
        },
        "av": {
          "front": 0,
          "side": 0,
          "rear": 0
        },
        "attack": {
          "urban": [
            1.75,
            1.0
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
        "price": 70.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 20.0,
          "r1": 13.0,
          "r2": 11.0
        },
        "av": {
          "front": 7.0,
          "side": 5.0,
          "rear": 5.0
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
            1.0,
            1.0
          ]
        },
        "counter": 1.5,
        "traits": "机械化"
      },
      "SU100中型坦歼营": {
        "price": 95.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 24.0,
          "r1": 22.0,
          "r2": 17.0
        },
        "av": {
          "front": 7.0,
          "side": 5.0,
          "rear": 5.0
        },
        "attack": {
          "urban": [
            2.75,
            1.5
          ],
          "r1": [
            3.25,
            3.0
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
        "price": 85.0,
        "hp": 6.0,
        "cat": "main",
        "move": 4.0,
        "ap": {
          "urban": 20.0,
          "r1": 19.0,
          "r2": 17.0
        },
        "av": {
          "front": 13.0,
          "side": 9.0,
          "rear": 8.0
        },
        "attack": {
          "urban": [
            3.0,
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
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 3.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 2.0
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
            3.0
          ],
          "r2": [
            1.0,
            0.75
          ]
        },
        "counter": 1.75,
        "traits": "防空半径1，伤害1"
      },
      "85防空炮营": {
        "price": 40.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 15.0,
          "r1": 13.0,
          "r2": 11.0
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
            3.25
          ],
          "r2": [
            1.25,
            2.0
          ]
        },
        "counter": 1.75,
        "traits": "防空半径2，伤害1.5"
      },
      "ZSU37自行防空炮营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 0,
          "r1": 0,
          "r2": 2.0
        },
        "av": {
          "front": 3.0,
          "side": 2.0,
          "rear": 1.0
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
        "price": 30.0,
        "hp": 5.0,
        "cat": "air",
        "move": 450.0,
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
        "price": 25.0,
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
        "price": 125.0,
        "hp": 5.0,
        "cat": "air",
        "move": 350.0,
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
        "traits": "重轰，空中压制2/2"
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
        "traits": "声学反炮兵6"
      },
      "76炮兵营": {
        "price": 35.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 9.0,
          "r1": 8.0,
          "r2": 6.0
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
            1.0
          ],
          "r2": [
            1.0,
            0.75
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害1，半径7"
      },
      "122炮兵营": {
        "price": 50.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 2.0,
        "ap": {
          "urban": 21.0,
          "r1": 19.0,
          "r2": 17.0
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
            2.0
          ],
          "r2": [
            1.5,
            1.25
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害1.5，半径11"
      },
      "152炮兵营": {
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
            3.0,
            2.0
          ],
          "r2": [
            2.0,
            1.5
          ]
        },
        "counter": 1.0,
        "traits": "曲射伤害2，半径7"
      },
      "SU76自行火炮": {
        "price": 35.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 6.0,
        "ap": {
          "urban": 9.0,
          "r1": 8.0,
          "r2": 6.0
        },
        "av": {
          "front": 3.0,
          "side": 2.0,
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
            1.0,
            1.0
          ]
        },
        "counter": 1.0,
        "traits": "机械化，曲射伤害1，半径7"
      },
      "喀秋莎火箭炮营": {
        "price": 80.0,
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
            2.25,
            1.25
          ],
          "r2": [
            1.5,
            0.75
          ]
        },
        "counter": 1.0,
        "traits": "摩托化，火箭炮，半径5，杀伤半径1，伤害3"
      },
      "侦查营": {
        "price": 25.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
        "ap": {
          "urban": 20.0,
          "r1": 3.0,
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
        "price": 8.0,
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
        "counter": 1.25,
        "traits": "医疗"
      },
      "摩托化运输队": {
        "price": 13.0,
        "hp": 3.0,
        "cat": "aux",
        "move": 5.0,
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
      "T60轻坦营": {
        "price": 45.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 20.0,
          "r1": 3.0,
          "r2": 1.0
        },
        "av": {
          "front": 4.0,
          "side": 3.0,
          "rear": 3.0
        },
        "attack": {
          "urban": [
            3.25,
            2.25
          ],
          "r1": [
            2.75,
            2.0
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
        "price": 52.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 20.0,
          "r1": 9.0,
          "r2": 8.0
        },
        "av": {
          "front": 9.0,
          "side": 5.0,
          "rear": 5.0
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
            1.0,
            0.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化，中坦"
      },
      "T3485中坦营": {
        "price": 75.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 20.0,
          "r1": 13.0,
          "r2": 11.0
        },
        "av": {
          "front": 11.0,
          "side": 7.0,
          "rear": 5.0
        },
        "attack": {
          "urban": [
            3.0,
            2.25
          ],
          "r1": [
            3.25,
            3.0
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
        "price": 90.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 20.0,
          "r1": 13.0,
          "r2": 11.0
        },
        "av": {
          "front": 18.0,
          "side": 8.0,
          "rear": 8.0
        },
        "attack": {
          "urban": [
            3.0,
            2.25
          ],
          "r1": [
            3.25,
            3.0
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
        "price": 105.0,
        "hp": 6.0,
        "cat": "main",
        "move": 6.0,
        "ap": {
          "urban": 24.0,
          "r1": 22.0,
          "r2": 17.0
        },
        "av": {
          "front": 20.0,
          "side": 9.0,
          "rear": 8.0
        },
        "attack": {
          "urban": [
            4.0,
            2.25
          ],
          "r1": [
            4.5,
            3.5
          ],
          "r2": [
            2.0,
            1.25
          ]
        },
        "counter": 1.2,
        "traits": "机械化，中坦"
      },
      "IS2重坦营": {
        "price": 95.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 21.0,
          "r1": 19.0,
          "r2": 17.0
        },
        "av": {
          "front": 18.0,
          "side": 11.0,
          "rear": 10.0
        },
        "attack": {
          "urban": [
            3.75,
            2.0
          ],
          "r1": [
            4.25,
            2.75
          ],
          "r2": [
            1.75,
            1.0
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "IS3重坦营": {
        "price": 140.0,
        "hp": 6.0,
        "cat": "main",
        "move": 5.0,
        "ap": {
          "urban": 20.0,
          "r1": 19.0,
          "r2": 17.0
        },
        "av": {
          "front": 28.0,
          "side": 22.0,
          "rear": 14.0
        },
        "attack": {
          "urban": [
            2.75,
            1.75
          ],
          "r1": [
            3.0,
            2.5
          ],
          "r2": [
            1.0,
            0.75
          ]
        },
        "counter": 1.2,
        "traits": "机械化，重坦"
      },
      "Il2对地攻击机": {
        "price": 55.0,
        "hp": 5.0,
        "cat": "air",
        "move": 420.0,
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
      "运输车": {
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


window.PREP_DATA.factions.uk = {
  "name": "英国",
  "code": "UK",
  "color": "#b08a1e",
  "units": {
    "步兵营": {
      "price": 25,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 12,
        "r1": 10,
        "r2": 7
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          2,
          1
        ],
        "r1": [
          2,
          1
        ],
        "r2": [
          0.5,
          0.25
        ]
      },
      "counter": 1.375,
      "traits": "空降"
    },
    "SAS特勤营": {
      "price": 35,
      "hp": 5,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 12,
        "r1": 10,
        "r2": 7
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          3,
          1
        ],
        "r1": [
          2.5,
          0.75
        ],
        "r2": [
          0.75,
          0.25
        ]
      },
      "counter": 1.375,
      "traits": "空降"
    },
    "摩托化营": {
      "price": 22,
      "hp": 6,
      "cat": "main",
      "move": 6,
      "ap": {
        "urban": 12,
        "r1": 10,
        "r2": 7
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          2,
          1
        ],
        "r1": [
          2,
          1
        ],
        "r2": [
          0.5,
          0.25
        ]
      },
      "counter": 1.375,
      "traits": ""
    },
    "小领主轻坦营": {
      "price": 32,
      "hp": 4,
      "cat": "main",
      "move": 7,
      "ap": {
        "urban": 12,
        "r1": 6,
        "r2": 2
      },
      "av": {
        "front": 2,
        "side": 1,
        "rear": 1
      },
      "attack": {
        "urban": [
          1.5,
          1
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
      "traits": "空降"
    },
    "斯图亚特轻坦营": {
      "price": 45,
      "hp": 6,
      "cat": "main",
      "move": 7,
      "ap": {
        "urban": 12,
        "r1": 5,
        "r2": 3
      },
      "av": {
        "front": 4,
        "side": 3,
        "rear": 3
      },
      "attack": {
        "urban": [
          2.5,
          2
        ],
        "r1": [
          2.25,
          1.75
        ],
        "r2": [
          0.75,
          0.5
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "克伦威尔中坦营": {
      "price": 57,
      "hp": 6,
      "cat": "main",
      "move": 8,
      "ap": {
        "urban": 12,
        "r1": 9,
        "r2": 6
      },
      "av": {
        "front": 7,
        "side": 5,
        "rear": 4
      },
      "attack": {
        "urban": [
          3.25,
          2
        ],
        "r1": [
          3.25,
          2
        ],
        "r2": [
          1.25,
          0.75
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "萤火虫中坦营": {
      "price": 70,
      "hp": 6,
      "cat": "main",
      "move": 5,
      "ap": {
        "urban": 19,
        "r1": 17,
        "r2": 13
      },
      "av": {
        "front": 11,
        "side": 5,
        "rear": 5
      },
      "attack": {
        "urban": [
          3,
          1.75
        ],
        "r1": [
          3.25,
          2
        ],
        "r2": [
          1.5,
          1
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "挑战者中坦营": {
      "price": 75,
      "hp": 6,
      "cat": "main",
      "move": 7,
      "ap": {
        "urban": 27,
        "r1": 25,
        "r2": 19
      },
      "av": {
        "front": 7,
        "side": 5,
        "rear": 4
      },
      "attack": {
        "urban": [
          3,
          2
        ],
        "r1": [
          3.25,
          2.25
        ],
        "r2": [
          1.5,
          1.25
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "丘吉尔重坦营": {
      "price": 75,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 12,
        "r1": 9,
        "r2": 6
      },
      "av": {
        "front": 15,
        "side": 10,
        "rear": 7
      },
      "attack": {
        "urban": [
          3.25,
          2
        ],
        "r1": [
          3.25,
          2
        ],
        "r2": [
          1.25,
          0.75
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "鳄鱼喷火坦克营": {
      "price": 80,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 12,
        "r1": 9,
        "r2": 6
      },
      "av": {
        "front": 15,
        "side": 10,
        "rear": 7
      },
      "attack": {
        "urban": [
          4.25,
          2.25
        ],
        "r1": [
          5,
          2.25
        ],
        "r2": [
          1.25,
          0.75
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "黑亲王重坦营": {
      "price": 95,
      "hp": 6,
      "cat": "main",
      "move": 4,
      "ap": {
        "urban": 19,
        "r1": 17,
        "r2": 13
      },
      "av": {
        "front": 15,
        "side": 10,
        "rear": 7
      },
      "attack": {
        "urban": [
          3,
          1.75
        ],
        "r1": [
          3.25,
          2
        ],
        "r2": [
          1.5,
          1
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "百夫长中坦营": {
      "price": 105,
      "hp": 6,
      "cat": "main",
      "move": 5,
      "ap": {
        "urban": 28,
        "r1": 25,
        "r2": 19
      },
      "av": {
        "front": 16,
        "side": 7,
        "rear": 5
      },
      "attack": {
        "urban": [
          3,
          2
        ],
        "r1": [
          3.25,
          2.25
        ],
        "r2": [
          1.5,
          1.25
        ]
      },
      "counter": 1.2,
      "traits": ""
    },
    "反坦克小组": {
      "price": 5,
      "hp": 1,
      "cat": "support",
      "move": 4,
      "ap": {
        "urban": 12,
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
          0.25
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.375,
      "traits": ""
    },
    "反坦克营": {
      "price": 35,
      "hp": 6,
      "cat": "main",
      "move": 3,
      "ap": {
        "urban": 19,
        "r1": 17,
        "r2": 13
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          1.5,
          1
        ],
        "r1": [
          1.5,
          1.75
        ],
        "r2": [
          0.5,
          1
        ]
      },
      "counter": 1.75,
      "traits": "隐蔽"
    },
    "A39重坦营": {
      "price": 105,
      "hp": 6,
      "cat": "main",
      "move": 3,
      "ap": {
        "urban": 26,
        "r1": 24,
        "r2": 20
      },
      "av": {
        "front": 20,
        "side": 14,
        "rear": 10
      },
      "attack": {
        "urban": [
          2,
          1.25
        ],
        "r1": [
          2.75,
          2
        ],
        "r2": [
          1.25,
          1
        ]
      },
      "counter": 1.5,
      "traits": ""
    },
    "40防空炮营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 3,
      "ap": {
        "urban": 4,
        "r1": 3,
        "r2": 2
      },
      "av": {
        "front": 0,
        "side": 0,
        "rear": 0
      },
      "attack": {
        "urban": [
          2,
          1.25
        ],
        "r1": [
          2,
          1.25
        ],
        "r2": [
          0.25,
          0.25
        ]
      },
      "counter": 1.75,
      "traits": "防空半径1，伤害1/2"
    },
    "90防空炮营": {
      "price": 40,
      "hp": 3,
      "cat": "aux",
      "move": 2,
      "ap": {
        "urban": 18,
        "r1": 16,
        "r2": 12
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
          2
        ]
      },
      "counter": 1.75,
      "traits": "防空半径2，伤害1.5"
    },
    "十字军防空营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 7,
      "ap": {
        "urban": 4,
        "r1": 2,
        "r2": 1
      },
      "av": {
        "front": 3,
        "side": 2,
        "rear": 2
      },
      "attack": {
        "urban": [
          1.5,
          1.75
        ],
        "r1": [
          1.25,
          1.5
        ],
        "r2": [
          0.25,
          0.25
        ]
      },
      "counter": 1.2,
      "traits": "防空半径1，伤害1.5/1.5"
    },
    "25磅炮兵营": {
      "price": 33,
      "hp": 3,
      "cat": "aux",
      "move": 2,
      "ap": {
        "urban": 12,
        "r1": 12,
        "r2": 12
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
          1.75,
          1.75
        ],
        "r2": [
          0.75,
          0.75
        ]
      },
      "counter": 1,
      "traits": "曲射伤害0.75，半径7"
    },
    "155炮兵营": {
      "price": 65,
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
          0.25
        ],
        "r1": [
          2.5,
          1.5
        ],
        "r2": [
          1.5,
          1
        ]
      },
      "counter": 1,
      "traits": "曲射伤害1.5，半径11"
    },
    "司事自行火炮营": {
      "price": 33,
      "hp": 3,
      "cat": "aux",
      "move": 5,
      "ap": {
        "urban": 0,
        "r1": 0,
        "r2": 0
      },
      "av": {
        "front": 4,
        "side": 3,
        "rear": 2
      },
      "attack": {
        "urban": [
          1.25,
          0.5
        ],
        "r1": [
          2.5,
          2
        ],
        "r2": [
          1.25,
          1
        ]
      },
      "counter": 1,
      "traits": "曲射伤害0.75，半径7"
    },
    "侦察营": {
      "price": 25,
      "hp": 3,
      "cat": "aux",
      "move": 5,
      "ap": {
        "urban": 12,
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
          1,
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
    "探照灯营": {
      "price": 40,
      "hp": 3,
      "cat": "aux",
      "move": 0,
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
          0
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
      "traits": "照明"
    },
    "野狗装甲侦察营": {
      "price": 45,
      "hp": 4,
      "cat": "main",
      "move": 7,
      "ap": {
        "urban": 12,
        "r1": 6,
        "r2": 2
      },
      "av": {
        "front": 3,
        "side": 1,
        "rear": 1
      },
      "attack": {
        "urban": [
          1.5,
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
      "counter": 1.2,
      "traits": "侦查半径1"
    },
    "工兵营": {
      "price": 25,
      "hp": 4,
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
          1.25,
          0.25
        ],
        "r1": [
          1,
          0.25
        ],
        "r2": [
          0.25,
          0
        ]
      },
      "counter": 1.375,
      "traits": "工程"
    },
    "突击工兵营": {
      "price": 35,
      "hp": 4,
      "cat": "main",
      "move": 0,
      "ap": {
        "urban": 12,
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
          0.5
        ],
        "r1": [
          1,
          0.25
        ],
        "r2": [
          0.25,
          0
        ]
      },
      "counter": 1.375,
      "traits": ""
    },
    "宪兵": {
      "price": 10,
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
          0.25
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.375,
      "traits": "宪兵"
    },
    "医疗营": {
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
          0.25
        ],
        "r2": [
          0,
          0
        ]
      },
      "counter": 1.375,
      "traits": "医疗"
    },
    "摩托化运输队": {
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
    "蚊式侦察机": {
      "price": 25,
      "hp": 4,
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
      "traits": "侦查半径2"
    },
    "喷火战斗机": {
      "price": 35,
      "hp": 4,
      "cat": "air",
      "move": 625,
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
      "traits": "拦截伤害1.75"
    },
    "台风战斗轰炸机": {
      "price": 50,
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
      "traits": "拦截伤害1.5，空中压制1.5/2"
    },
    "惠灵顿轰炸机": {
      "price": 135,
      "hp": 6,
      "cat": "air",
      "move": 400,
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
    }
  },
  "corps": [
    {
      "id": "uk-2a",
      "name": "第2集团军直属",
      "units": [
        {
          "name": "宪兵",
          "max": 3
        },
        {
          "name": "医疗营",
          "max": 5
        },
        {
          "name": "155炮兵营",
          "max": 3
        },
        {
          "name": "丘吉尔重坦营",
          "max": 3
        },
        {
          "name": "台风战斗轰炸机",
          "max": 3
        },
        {
          "name": "摩托化运输队",
          "max": 3
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
      "id": "uk-3inf",
      "name": "第3步兵师",
      "type": "infantry",
      "phase": "AB",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 2,
      "attack": {
        "A": 235,
        "B": 305
      },
      "defense": {
        "A": 185,
        "B": 280
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "步兵营",
            "max": 2
          },
          {
            "name": "SAS特勤营",
            "max": 2
          },
          {
            "name": "工兵营",
            "max": 1
          },
          {
            "name": "40防空炮营",
            "max": 1
          },
          {
            "name": "25磅炮兵营",
            "max": 3
          },
          {
            "name": "反坦克营",
            "max": 1
          },
          {
            "name": "反坦克小组",
            "max": 3
          },
          {
            "name": "探照灯营",
            "max": 1
          },
          {
            "name": "野狗装甲侦察营",
            "max": 1
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          },
          {
            "name": "喷火战斗机",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "斯图亚特轻坦营",
            "max": 2
          },
          {
            "name": "挑战者中坦营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "uk-6abn",
      "name": "第6空降师",
      "type": "airborne",
      "phase": "AB",
      "slots": {
        "main": 8,
        "support": 5
      },
      "planes": 3,
      "attack": {
        "A": 240,
        "B": 265
      },
      "defense": {
        "A": 175,
        "B": 230
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "步兵营",
            "max": 2
          },
          {
            "name": "40防空炮营",
            "max": 1
          },
          {
            "name": "侦察营",
            "max": 1
          },
          {
            "name": "小领主轻坦营",
            "max": 2
          },
          {
            "name": "反坦克小组",
            "max": 2
          },
          {
            "name": "工兵营",
            "max": 1
          },
          {
            "name": "25磅炮兵营",
            "max": 1
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          },
          {
            "name": "喷火战斗机",
            "max": 2
          },
          {
            "name": "台风战斗轰炸机",
            "max": 2
          }
        ],
        "B": [
          {
            "name": "SAS特勤营",
            "max": 1
          },
          {
            "name": "克伦威尔中坦营",
            "max": 1
          },
          {
            "name": "惠灵顿轰炸机",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "uk-51high",
      "name": "第51高地师",
      "type": "infantry",
      "phase": "AB",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 2,
      "attack": {
        "A": 240,
        "B": 300
      },
      "defense": {
        "A": 175,
        "B": 275
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
            "name": "SAS特勤营",
            "max": 3
          },
          {
            "name": "侦察营",
            "max": 2
          },
          {
            "name": "25磅炮兵营",
            "max": 2
          },
          {
            "name": "反坦克营",
            "max": 2
          },
          {
            "name": "反坦克小组",
            "max": 3
          },
          {
            "name": "探照灯营",
            "max": 1
          },
          {
            "name": "喷火战斗机",
            "max": 2
          },
          {
            "name": "台风战斗轰炸机",
            "max": 1
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          },
          {
            "name": "斯图亚特轻坦营",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "SAS特勤营",
            "max": 1
          },
          {
            "name": "挑战者中坦营",
            "max": 1
          },
          {
            "name": "40防空炮营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "uk-15scot",
      "name": "第15苏格兰步兵师",
      "type": "infantry",
      "phase": "AB",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 2,
      "attack": {
        "A": 245,
        "B": 295
      },
      "defense": {
        "A": 165,
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
            "max": 3
          },
          {
            "name": "SAS特勤营",
            "max": 1
          },
          {
            "name": "侦察营",
            "max": 2
          },
          {
            "name": "鳄鱼喷火坦克营",
            "max": 1
          },
          {
            "name": "25磅炮兵营",
            "max": 2
          },
          {
            "name": "反坦克营",
            "max": 1
          },
          {
            "name": "探照灯营",
            "max": 1
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          },
          {
            "name": "台风战斗轰炸机",
            "max": 1
          },
          {
            "name": "40防空炮营",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "鳄鱼喷火坦克营",
            "max": 1
          },
          {
            "name": "克伦威尔中坦营",
            "max": 1
          },
          {
            "name": "工兵营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "uk-11ind",
      "name": "印度第11步兵师",
      "type": "infantry",
      "phase": "AB",
      "slots": {
        "main": 8,
        "support": 4
      },
      "planes": 2,
      "attack": {
        "A": 225,
        "B": 275
      },
      "defense": {
        "A": 185,
        "B": 275
      },
      "fundsC": null,
      "pool": {
        "A": [
          {
            "name": "步兵营",
            "max": 4
          },
          {
            "name": "侦察营",
            "max": 3
          },
          {
            "name": "25磅炮兵营",
            "max": 3
          },
          {
            "name": "反坦克营",
            "max": 2
          },
          {
            "name": "40防空炮营",
            "max": 2
          },
          {
            "name": "喷火战斗机",
            "max": 2
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          }
        ],
        "B": [
          {
            "name": "斯图亚特轻坦营",
            "max": 2
          },
          {
            "name": "步兵营",
            "max": 1
          }
        ],
        "C": []
      }
    },
    {
      "id": "uk-7arm",
      "name": "第7装甲师",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 8,
        "support": 4
      },
      "planes": 2,
      "attack": {
        "A": 0,
        "B": 0
      },
      "defense": {
        "A": 0,
        "B": 0
      },
      "fundsC": 545,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "斯图亚特轻坦营",
            "max": 2
          },
          {
            "name": "十字军防空营",
            "max": 2
          },
          {
            "name": "司事自行火炮营",
            "max": 2
          },
          {
            "name": "克伦威尔中坦营",
            "max": 1
          },
          {
            "name": "萤火虫中坦营",
            "max": 2
          },
          {
            "name": "野狗装甲侦察营",
            "max": 1
          },
          {
            "name": "黑亲王重坦营",
            "max": 1
          },
          {
            "name": "摩托化营",
            "max": 3
          },
          {
            "name": "蚊式侦察机",
            "max": 2
          },
          {
            "name": "喷火战斗机",
            "max": 3
          },
          {
            "name": "台风战斗轰炸机",
            "max": 2
          },
          {
            "name": "惠灵顿轰炸机",
            "max": 1
          }
        ]
      }
    },
    {
      "id": "uk-11arm",
      "name": "第11装甲师",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 2,
      "attack": {
        "A": 0,
        "B": 0
      },
      "defense": {
        "A": 0,
        "B": 0
      },
      "fundsC": 555,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "摩托化营",
            "max": 3
          },
          {
            "name": "克伦威尔中坦营",
            "max": 3
          },
          {
            "name": "萤火虫中坦营",
            "max": 1
          },
          {
            "name": "百夫长中坦营",
            "max": 1
          },
          {
            "name": "野狗装甲侦察营",
            "max": 1
          },
          {
            "name": "十字军防空营",
            "max": 2
          },
          {
            "name": "司事自行火炮营",
            "max": 2
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          },
          {
            "name": "喷火战斗机",
            "max": 2
          },
          {
            "name": "台风战斗轰炸机",
            "max": 1
          },
          {
            "name": "惠灵顿轰炸机",
            "max": 1
          }
        ]
      }
    },
    {
      "id": "uk-79arm",
      "name": "第79装甲师",
      "type": "armored",
      "phase": "C",
      "slots": {
        "main": 7,
        "support": 5
      },
      "planes": 2,
      "attack": {
        "A": 0,
        "B": 0
      },
      "defense": {
        "A": 0,
        "B": 0
      },
      "fundsC": 530,
      "pool": {
        "A": [],
        "B": [],
        "C": [
          {
            "name": "突击工兵营",
            "max": 1
          },
          {
            "name": "摩托化营",
            "max": 2
          },
          {
            "name": "斯图亚特轻坦营",
            "max": 1
          },
          {
            "name": "克伦威尔中坦营",
            "max": 2
          },
          {
            "name": "A39重坦营",
            "max": 1
          },
          {
            "name": "鳄鱼喷火坦克营",
            "max": 2
          },
          {
            "name": "萤火虫中坦营",
            "max": 2
          },
          {
            "name": "蚊式侦察机",
            "max": 1
          },
          {
            "name": "喷火战斗机",
            "max": 2
          },
          {
            "name": "台风战斗轰炸机",
            "max": 2
          },
          {
            "name": "十字军防空营",
            "max": 2
          },
          {
            "name": "司事自行火炮营",
            "max": 2
          }
        ]
      }
    }
  ]
};
window.PREP_DATA.modelIndex = Object.assign(window.PREP_DATA.modelIndex || {}, {"40防空炮营":{"uk":["unit/u-0043.js","uk|40s|aa|40防空炮营"]},"90防空炮营":{"uk":["unit/u-0044.js","uk|40s|aa|90防空炮营"]},"十字军防空营":{"uk":["unit/u-0045.js","uk|40s|aa|十字军防空营"]},"台风战斗轰炸机":{"uk":["unit/u-0046.js","uk|40s|air|台风战斗轰炸机"]},"喷火战斗机":{"uk":["unit/u-0047.js","uk|40s|air|喷火战斗机"]},"惠灵顿轰炸机":{"uk":["unit/u-0048.js","uk|40s|air|惠灵顿轰炸机"]},"蚊式侦察机":{"uk":["unit/u-0049.js","uk|40s|air|蚊式侦察机"]},"丘吉尔重坦营":{"uk":["unit/u-0050.js","uk|40s|armor|丘吉尔重坦营"]},"克伦威尔中坦营":{"uk":["unit/u-0051.js","uk|40s|armor|克伦威尔中坦营"]},"小领主轻坦营":{"uk":["unit/u-0052.js","uk|40s|armor|小领主轻坦营"]},"挑战者中坦营":{"uk":["unit/u-0053.js","uk|40s|armor|挑战者中坦营"]},"斯图亚特轻坦营":{"uk":["unit/u-0054.js","uk|40s|armor|斯图亚特轻坦营"]},"百夫长中坦营":{"uk":["unit/u-0055.js","uk|40s|armor|百夫长中坦营"]},"萤火虫中坦营":{"uk":["unit/u-0056.js","uk|40s|armor|萤火虫中坦营"]},"鳄鱼喷火坦克营":{"uk":["unit/u-0057.js","uk|40s|armor|鳄鱼喷火坦克营"]},"黑亲王重坦营":{"uk":["unit/u-0058.js","uk|40s|armor|黑亲王重坦营"]},"155炮兵营":{"uk":["unit/u-0059.js","uk|40s|arty|155炮兵营"]},"25磅炮兵营":{"uk":["unit/u-0060.js","uk|40s|arty|25磅炮兵营"]},"司事自行火炮营":{"uk":["unit/u-0061.js","uk|40s|arty|司事自行火炮营"]},"A39重坦营":{"uk":["unit/u-0062.js","uk|40s|at|A39重坦营"]},"反坦克小组":{"uk":["unit/u-0063.js","uk|40s|at|反坦克小组"]},"反坦克营":{"uk":["unit/u-0064.js","uk|40s|at|反坦克营"]},"SAS特勤营":{"uk":["unit/u-0065.js","uk|40s|inf|SAS特勤营"]},"摩托化营":{"uk":["unit/u-0066.js","uk|40s|inf|摩托化营"]},"步兵营":{"uk":["unit/u-0067.js","uk|40s|inf|步兵营"]},"侦察营":{"uk":["unit/u-0068.js","uk|40s|recon|侦察营"]},"探照灯营":{"uk":["unit/u-0069.js","uk|40s|recon|探照灯营"]},"野狗装甲侦察营":{"uk":["unit/u-0070.js","uk|40s|recon|野狗装甲侦察营"]},"医疗营":{"uk":["unit/u-0071.js","uk|40s|support|医疗营"]},"宪兵":{"uk":["unit/u-0072.js","uk|40s|support|宪兵"]},"工兵营":{"uk":["unit/u-0073.js","uk|40s|support|工兵营"]},"摩托化运输队":{"uk":["unit/u-0074.js","uk|40s|support|摩托化运输队"]},"突击工兵营":{"uk":["unit/u-0075.js","uk|40s|support|突击工兵营"]}});

window.PREP_DATA.modelIndex = {"20防空炮营":{"de":["unit/u-0001.js","de|40s|aa|20防空炮营"]},"88防空炮营":{"de":["unit/u-0002.js","de|40s|aa|88防空炮营"]},"东风自行防空炮营":{"de":["unit/u-0003.js","de|40s|aa|东风自行防空炮营"]},"卡车自行防空炮营":{"de":["unit/u-0004.js","de|40s|aa|卡车自行防空炮营"]},"Bf109战斗机":{"de":["unit/u-0005.js","de|40s|air|Bf109战斗机"]},"Fw189侦察机":{"de":["unit/u-0006.js","de|40s|air|Fw189侦察机"]},"Fw190战斗轰炸机":{"de":["unit/u-0007.js","de|40s|air|Fw190战斗轰炸机"]},"Ju88轰炸机":{"de":["unit/u-0008.js","de|40s|air|Ju88轰炸机"]},"Me262战斗机":{"de":["unit/u-0009.js","de|40s|air|Me262战斗机"]},"四号中坦营":{"de":["unit/u-0010.js","de|40s|armor|四号中坦营"]},"虎式重坦营":{"de":["unit/u-0011.js","de|40s|armor|虎式重坦营"]},"虎王重坦营":{"de":["unit/u-0012.js","de|40s|armor|虎王重坦营"]},"豹式中坦营":{"de":["unit/u-0013.js","de|40s|armor|豹式中坦营"]},"鼠式超重坦营":{"de":["unit/u-0014.js","de|40s|armor|鼠式超重坦营"]},"105炮兵营":{"de":["unit/u-0015.js","de|40s|arty|105炮兵营"],"us":["unit/u-0128.js","us|40s|arty|105炮兵营"]},"150炮兵营":{"de":["unit/u-0016.js","de|40s|arty|150炮兵营"]},"反炮兵小组":{"de":["unit/u-0017.js","de|40s|arty|反炮兵小组"],"ussr":["unit/u-0094.js","ussr|40s|arty|反炮兵小组"],"us":["unit/u-0132.js","us|40s|arty|反炮兵小组"]},"野蜂自行火炮营":{"de":["unit/u-0018.js","de|40s|arty|野蜂自行火炮营"]},"黄蜂自行火炮营":{"de":["unit/u-0019.js","de|40s|arty|黄蜂自行火炮营"]},"反坦克小组":{"de":["unit/u-0020.js","de|40s|at|反坦克小组"],"uk":["unit/u-0063.js","uk|40s|at|反坦克小组"],"us":["unit/u-0136.js","us|40s|at|反坦克小组"]},"反坦克敢死队":{"de":["unit/u-0021.js","de|40s|at|反坦克敢死队"]},"反坦克营":{"de":["unit/u-0022.js","de|40s|at|反坦克营"],"uk":["unit/u-0064.js","uk|40s|at|反坦克营"],"ussr":["unit/u-0099.js","ussr|40s|at|反坦克营"],"us":["unit/u-0137.js","us|40s|at|反坦克营"]},"四号中型坦歼营":{"de":["unit/u-0023.js","de|40s|at|四号中型坦歼营"]},"四号突击炮营":{"de":["unit/u-0024.js","de|40s|at|四号突击炮营"]},"猎虎重型坦歼营":{"de":["unit/u-0025.js","de|40s|at|猎虎重型坦歼营"]},"猎豹重型坦歼营":{"de":["unit/u-0026.js","de|40s|at|猎豹重型坦歼营"]},"追猎者轻型坦歼营":{"de":["unit/u-0027.js","de|40s|at|追猎者轻型坦歼营"]},"黄鼠狼轻型坦歼营":{"de":["unit/u-0028.js","de|40s|at|黄鼠狼轻型坦歼营"]},"人民冲锋队":{"de":["unit/u-0029.js","de|40s|inf|人民冲锋队"]},"山地猎兵营":{"de":["unit/u-0030.js","de|40s|inf|山地猎兵营"]},"步兵营":{"de":["unit/u-0031.js","de|40s|inf|步兵营"],"uk":["unit/u-0067.js","uk|40s|inf|步兵营"],"ussr":["unit/u-0103.js","ussr|40s|inf|步兵营"],"us":["unit/u-0141.js","us|40s|inf|步兵营"]},"猎兵营":{"de":["unit/u-0032.js","de|40s|inf|猎兵营"]},"突击步兵营":{"de":["unit/u-0033.js","de|40s|inf|突击步兵营"]},"装甲掷弹兵营":{"de":["unit/u-0034.js","de|40s|inf|装甲掷弹兵营"]},"222装甲侦察营":{"de":["unit/u-0035.js","de|40s|recon|222装甲侦察营"]},"侦察营":{"de":["unit/u-0036.js","de|40s|recon|侦察营"],"uk":["unit/u-0068.js","uk|40s|recon|侦察营"],"us":["unit/u-0144.js","us|40s|recon|侦察营"]},"美洲狮装甲侦察营":{"de":["unit/u-0037.js","de|40s|recon|美洲狮装甲侦察营"]},"医疗连":{"de":["unit/u-0038.js","de|40s|support|医疗连"],"ussr":["unit/u-0106.js","ussr|40s|support|医疗连"],"us":["unit/u-0147.js","us|40s|support|医疗连"]},"宪兵连":{"de":["unit/u-0039.js","de|40s|support|宪兵连"],"us":["unit/u-0148.js","us|40s|support|宪兵连"]},"工兵营":{"de":["unit/u-0040.js","de|40s|support|工兵营"],"uk":["unit/u-0073.js","uk|40s|support|工兵营"],"ussr":["unit/u-0107.js","ussr|40s|support|工兵营"],"us":["unit/u-0149.js","us|40s|support|工兵营"]},"摩托化运输队":{"de":["unit/u-0041.js","de|40s|support|摩托化运输队"],"uk":["unit/u-0074.js","uk|40s|support|摩托化运输队"],"ussr":["unit/u-0108.js","ussr|40s|support|摩托化运输队"],"us":["unit/u-0150.js","us|40s|support|摩托化运输队"]},"突击工兵营":{"de":["unit/u-0042.js","de|40s|inf|突击工兵营"],"uk":["unit/u-0075.js","uk|40s|support|突击工兵营"],"ussr":["unit/u-0110.js","ussr|40s|inf|突击工兵营"],"us":["unit/u-0151.js","us|40s|inf|突击工兵营"]},"40防空炮营":{"uk":["unit/u-0043.js","uk|40s|aa|40防空炮营"],"us":["unit/u-0111.js","us|40s|aa|40防空炮营"]},"90防空炮营":{"uk":["unit/u-0044.js","uk|40s|aa|90防空炮营"],"us":["unit/u-0112.js","us|40s|aa|90防空炮营"]},"十字军防空营":{"uk":["unit/u-0045.js","uk|40s|aa|十字军防空营"]},"台风战斗轰炸机":{"uk":["unit/u-0046.js","uk|40s|air|台风战斗轰炸机"]},"喷火战斗机":{"uk":["unit/u-0047.js","uk|40s|air|喷火战斗机"]},"惠灵顿轰炸机":{"uk":["unit/u-0048.js","uk|40s|air|惠灵顿轰炸机"]},"蚊式侦察机":{"uk":["unit/u-0049.js","uk|40s|air|蚊式侦察机"]},"丘吉尔重坦营":{"uk":["unit/u-0050.js","uk|40s|armor|丘吉尔重坦营"]},"克伦威尔中坦营":{"uk":["unit/u-0051.js","uk|40s|armor|克伦威尔中坦营"]},"小领主轻坦营":{"uk":["unit/u-0052.js","uk|40s|armor|小领主轻坦营"]},"挑战者中坦营":{"uk":["unit/u-0053.js","uk|40s|armor|挑战者中坦营"]},"斯图亚特轻坦营":{"uk":["unit/u-0054.js","uk|40s|armor|斯图亚特轻坦营"],"us":["unit/u-0125.js","us|40s|armor|斯图亚特轻坦营"]},"百夫长中坦营":{"uk":["unit/u-0055.js","uk|40s|armor|百夫长中坦营"]},"萤火虫中坦营":{"uk":["unit/u-0056.js","uk|40s|armor|萤火虫中坦营"]},"鳄鱼喷火坦克营":{"uk":["unit/u-0057.js","uk|40s|armor|鳄鱼喷火坦克营"]},"黑亲王重坦营":{"uk":["unit/u-0058.js","uk|40s|armor|黑亲王重坦营"]},"155炮兵营":{"uk":["unit/u-0059.js","uk|40s|arty|155炮兵营"],"us":["unit/u-0129.js","us|40s|arty|155炮兵营"]},"25磅炮兵营":{"uk":["unit/u-0060.js","uk|40s|arty|25磅炮兵营"]},"司事自行火炮营":{"uk":["unit/u-0061.js","uk|40s|arty|司事自行火炮营"]},"A39重坦营":{"uk":["unit/u-0062.js","uk|40s|at|A39重坦营"]},"SAS特勤营":{"uk":["unit/u-0065.js","uk|40s|inf|SAS特勤营"]},"摩托化营":{"uk":["unit/u-0066.js","uk|40s|inf|摩托化营"]},"探照灯营":{"uk":["unit/u-0069.js","uk|40s|recon|探照灯营"]},"野狗装甲侦察营":{"uk":["unit/u-0070.js","uk|40s|recon|野狗装甲侦察营"]},"医疗营":{"uk":["unit/u-0071.js","uk|40s|support|医疗营"]},"宪兵":{"uk":["unit/u-0072.js","uk|40s|support|宪兵"]},"37防空炮营":{"ussr":["unit/u-0076.js","ussr|40s|aa|37防空炮营"]},"85防空炮营":{"ussr":["unit/u-0077.js","ussr|40s|aa|85防空炮营"]},"ZSU37自行防空炮营":{"ussr":["unit/u-0078.js","ussr|40s|aa|ZSU37自行防空炮营"]},"Il2侦察机":{"ussr":["unit/u-0079.js","ussr|40s|air|Il2侦察机"]},"Il2攻击机":{"ussr":["unit/u-0080.js","ussr|40s|air|Il2攻击机"]},"Tu2轰炸机":{"ussr":["unit/u-0081.js","ussr|40s|air|Tu2轰炸机"]},"Yak9战斗机":{"ussr":["unit/u-0082.js","ussr|40s|air|Yak9战斗机"]},"IS2重坦营":{"ussr":["unit/u-0083.js","ussr|40s|armor|IS2重坦营"]},"IS3重坦营":{"ussr":["unit/u-0084.js","ussr|40s|armor|IS3重坦营"]},"T3476中坦营":{"ussr":["unit/u-0085.js","ussr|40s|armor|T3476中坦营"]},"T3485中坦营":{"ussr":["unit/u-0086.js","ussr|40s|armor|T3485中坦营"]},"T44-100中坦营":{"ussr":["unit/u-0087.js","ussr|40s|armor|T44-100中坦营"]},"T44中坦营":{"ussr":["unit/u-0088.js","ussr|40s|armor|T44中坦营"]},"T60轻坦营":{"ussr":["unit/u-0089.js","ussr|40s|armor|T60轻坦营"]},"122炮兵营":{"ussr":["unit/u-0090.js","ussr|40s|arty|122炮兵营"]},"152炮兵营":{"ussr":["unit/u-0091.js","ussr|40s|arty|152炮兵营"]},"76炮兵营":{"ussr":["unit/u-0092.js","ussr|40s|arty|76炮兵营"]},"SU76自行火炮":{"ussr":["unit/u-0093.js","ussr|40s|arty|SU76自行火炮"]},"喀秋莎火箭炮营":{"ussr":["unit/u-0095.js","ussr|40s|arty|喀秋莎火箭炮营"]},"ISU152重型坦歼营":{"ussr":["unit/u-0096.js","ussr|40s|at|ISU152重型坦歼营"]},"SU100中型坦歼营":{"ussr":["unit/u-0097.js","ussr|40s|at|SU100中型坦歼营"]},"SU85中型坦歼营":{"ussr":["unit/u-0098.js","ussr|40s|at|SU85中型坦歼营"]},"伞兵营":{"ussr":["unit/u-0100.js","ussr|40s|inf|伞兵营"],"us":["unit/u-0138.js","us|40s|inf|伞兵营"]},"惩戒营":{"ussr":["unit/u-0101.js","ussr|40s|inf|惩戒营"]},"机械化步兵营":{"ussr":["unit/u-0102.js","ussr|40s|inf|机械化步兵营"],"us":["unit/u-0140.js","us|40s|inf|机械化步兵营"]},"近卫步兵营":{"ussr":["unit/u-0104.js","ussr|40s|inf|近卫步兵营"]},"侦查营":{"ussr":["unit/u-0105.js","ussr|40s|recon|侦查营"]},"教导营":{"ussr":["unit/u-0109.js","ussr|40s|support|教导营"]},"M15自行防空炮营":{"us":["unit/u-0113.js","us|40s|aa|M15自行防空炮营"]},"M16自行防空炮营":{"us":["unit/u-0114.js","us|40s|aa|M16自行防空炮营"]},"B25轰炸机":{"us":["unit/u-0115.js","us|40s|air|B25轰炸机"]},"B29轰炸机":{"us":["unit/u-0116.js","us|40s|air|B29轰炸机"]},"F5侦察机":{"us":["unit/u-0117.js","us|40s|air|F5侦察机"]},"F6战斗侦察机":{"us":["unit/u-0118.js","us|40s|air|F6战斗侦察机"]},"P38战斗机":{"us":["unit/u-0119.js","us|40s|air|P38战斗机"]},"P47战斗轰炸机":{"us":["unit/u-0120.js","us|40s|air|P47战斗轰炸机"]},"P51战斗机":{"us":["unit/u-0121.js","us|40s|air|P51战斗机"]},"75谢尔曼中坦营":{"us":["unit/u-0122.js","us|40s|armor|75谢尔曼中坦营"]},"76谢尔曼中坦营":{"us":["unit/u-0123.js","us|40s|armor|76谢尔曼中坦营"]},"巨无霸重坦营":{"us":["unit/u-0124.js","us|40s|armor|巨无霸重坦营"]},"潘兴重坦营":{"us":["unit/u-0126.js","us|40s|armor|潘兴重坦营"]},"超级潘兴重坦营":{"us":["unit/u-0127.js","us|40s|armor|超级潘兴重坦营"]},"M12自行火炮营":{"us":["unit/u-0130.js","us|40s|arty|M12自行火炮营"]},"M7自行火炮营":{"us":["unit/u-0131.js","us|40s|arty|M7自行火炮营"]},"管风琴火箭炮营":{"us":["unit/u-0133.js","us|40s|arty|管风琴火箭炮营"]},"M10中型坦歼营":{"us":["unit/u-0134.js","us|40s|at|M10中型坦歼营"]},"T95超重坦营":{"us":["unit/u-0135.js","us|40s|at|T95超重坦营"]},"山地步兵营":{"us":["unit/u-0139.js","us|40s|inf|山地步兵营"]},"海军陆战队营":{"us":["unit/u-0142.js","us|40s|inf|海军陆战队营"]},"游骑兵营":{"us":["unit/u-0143.js","us|40s|inf|游骑兵营"]},"地狱猫装甲侦察营":{"us":["unit/u-0145.js","us|40s|recon|地狱猫装甲侦察营"]},"灰狗装甲侦察营":{"us":["unit/u-0146.js","us|40s|recon|灰狗装甲侦察营"]}};
