window.TUTORIAL_LEVELS = [
  {
    "id": "t01",
    "title": "第一关 · 移动、地形与攻击",
    "subtitle": "选中 · 移动 · 山地消耗 · 视野 · 巷战 · 反击",
    "map": {
      "format": "bingqi-map",
      "version": 3,
      "app": "bingqi-map-editor",
      "savedAt": "2026-11-24T13:35:21.115Z",
      "cols": 8,
      "rows": 6,
      "mode": "attack",
      "terrains": [
        "plain",
        "road",
        "rail",
        "house",
        "city",
        "forest",
        "hill",
        "mountain",
        "river",
        "swamp"
      ],
      "cells": [
        0,
        0,
        0,
        0,
        0,
        8,
        0,
        0,
        0,
        0,
        0,
        0,
        8,
        0,
        0,
        0,
        0,
        0,
        0,
        3,
        3,
        8,
        0,
        0,
        0,
        0,
        7,
        3,
        8,
        3,
        0,
        0,
        0,
        0,
        0,
        7,
        8,
        3,
        0,
        0,
        0,
        0,
        0,
        0,
        8,
        0,
        0,
        0
      ],
      "rules": {
        "plain": {
          "move": 1,
          "moveMech": 1,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "road": {
          "move": 1,
          "moveMech": 0.5,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "rail": {
          "move": 1,
          "moveMech": 0.5,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "house": {
          "move": 1,
          "moveMech": 1,
          "protect": 0.3,
          "blocksSight": true,
          "urban": true,
          "riverReset": false,
          "chaos": 0
        },
        "city": {
          "move": 1,
          "moveMech": 1,
          "protect": 0.5,
          "blocksSight": true,
          "urban": true,
          "riverReset": false,
          "chaos": 0
        },
        "forest": {
          "move": 1,
          "moveMech": 2,
          "protect": 0.2,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "hill": {
          "move": 2,
          "moveMech": 2,
          "protect": 0.25,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "mountain": {
          "move": 3,
          "moveMech": 3,
          "protect": 0.4,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "river": {
          "move": 1,
          "moveMech": 1,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": true,
          "chaos": 0
        },
        "swamp": {
          "move": 2,
          "moveMech": 2,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 1
        }
      },
      "grid": {
        "move": [
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          3,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          3,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "moveMech": [
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          3,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          3,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "protect": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0.3,
          0.3,
          0,
          0,
          0,
          0,
          0,
          0.4,
          0.3,
          0,
          0.3,
          0,
          0,
          0,
          0,
          0,
          0.4,
          0,
          0.3,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      "phases": {
        "a": 1,
        "b": null,
        "c": null
      },
      "facing": 0,
      "deploy": {
        "spawn": null,
        "hqA": null,
        "hqD": null,
        "zone": []
      }
    },
    "factions": {
      "attacker": "us",
      "defender": "de"
    },
    "units": [
      {
        "side": "attacker",
        "name": "步兵营",
        "c": 2,
        "r": 2,
        "id": "tutorial-us-inf"
      },
      {
        "side": "defender",
        "name": "步兵营",
        "c": 6,
        "r": 2,
        "id": "tutorial-de-inf"
      }
    ],
    "steps": [
      {
        "text": "左键选中美军步兵营，右键点击 D3 房屋（3,2），左键可取消，确认后再右键一次完成移动。",
        "allow": {
          "type": "move",
          "unitId": "tutorial-us-inf",
          "c": 3,
          "r": 2
        },
        "focus": {
          "c": 3,
          "r": 2,
          "label": "D3 · 城区"
        }
      },
      {
        "text": "左侧山地格 C4（2,3）标黄：同样是走一格，山地要消耗 3 点行动力。看完后点击「结束回合」。",
        "allow": {
          "type": "endTurn"
        },
        "focus": {
          "c": 2,
          "r": 3,
          "label": "山地 · 3行动力"
        }
      },
      {
        "text": "点顶部座位切换到「教程敌军」，选中德军步兵，移动到 F3 河格（5,2）。上河会立刻清空它的剩余行动力。",
        "allow": {
          "type": "move",
          "unitId": "tutorial-de-inf",
          "c": 5,
          "r": 2
        },
        "focus": {
          "c": 5,
          "r": 2,
          "label": "F3 · 德军上河"
        }
      },
      {
        "text": "德军已经上河，行动力清零。现在点顶部座位切回「教程玩家」，再点「下一步」继续。",
        "focus": {
          "c": 5,
          "r": 2,
          "label": "F3 · 行动力清零"
        }
      },
      {
        "text": "把步兵移动到 E3 房屋（4,2），绕开阻挡获得 F3 德军视野。",
        "allow": {
          "type": "move",
          "unitId": "tutorial-us-inf",
          "c": 4,
          "r": 2
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 攻击位置"
        }
      },
      {
        "text": "右键德军步兵攻击：观察预计伤害、地形修正和反击预览。",
        "allow": {
          "type": "attack",
          "unitId": "tutorial-us-inf",
          "targetId": "tutorial-de-inf"
        },
        "focus": {
          "c": 5,
          "r": 2,
          "label": "F3 · 德军"
        }
      },
      {
        "text": "单位血量用模型朝向表示：满 6 血时正面朝地图基准方向，每掉 1 血逆时针旋转 60°。观察德军模型转向，判断它还剩多少血。",
        "focus": {
          "c": 5,
          "r": 2,
          "label": "模型朝向 · 表示剩余血量"
        }
      },
      {
        "text": "德军会反击。点顶部座位切换到「教程敌军」，选择反击目标，再切回「教程玩家」。",
        "focus": {
          "c": 5,
          "r": 2,
          "label": "反击选择"
        }
      },
      {
        "text": "小数伤害：最终伤害的小数部分不是直接舍去，而是按概率补成整点。例如 1.75 点伤害，必定造成 1 点，再以 75% 概率额外造成 1 点。看完后点「下一步」继续。"
      },
      {
        "text": "打开「对战历史」，确认攻击者、目标、伤害和反击记录；教程完成。",
        "focus": {
          "c": 3,
          "r": 3,
          "label": "教程完成"
        }
      }
    ]
  },
  {
    "id": "t02",
    "title": "第二关 · 锁定、集火与推进",
    "subtitle": "德军先手 · 战壕 · 高抗性格 · 集火 · 回退 · 推进",
    "map": {
      "format": "bingqi-map",
      "version": 3,
      "app": "bingqi-map-editor",
      "savedAt": "2026-11-24T13:42:33.864Z",
      "cols": 8,
      "rows": 6,
      "mode": "attack",
      "terrains": [
        "plain",
        "road",
        "rail",
        "house",
        "city",
        "forest",
        "hill",
        "mountain",
        "river",
        "swamp"
      ],
      "cells": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        4,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "rules": {
        "plain": {
          "move": 1,
          "moveMech": 1,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "road": {
          "move": 1,
          "moveMech": 0.5,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "rail": {
          "move": 1,
          "moveMech": 0.5,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "house": {
          "move": 1,
          "moveMech": 1,
          "protect": 0.3,
          "blocksSight": true,
          "urban": true,
          "riverReset": false,
          "chaos": 0
        },
        "city": {
          "move": 1,
          "moveMech": 1,
          "protect": 0.5,
          "blocksSight": true,
          "urban": true,
          "riverReset": false,
          "chaos": 0
        },
        "forest": {
          "move": 1,
          "moveMech": 2,
          "protect": 0.2,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "hill": {
          "move": 2,
          "moveMech": 2,
          "protect": 0.25,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "mountain": {
          "move": 3,
          "moveMech": 3,
          "protect": 0.4,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "river": {
          "move": 1,
          "moveMech": 1,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": true,
          "chaos": 0
        },
        "swamp": {
          "move": 2,
          "moveMech": 2,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 1
        }
      },
      "grid": {
        "move": [
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "moveMech": [
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "protect": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0.5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      "phases": {
        "a": 1,
        "b": null,
        "c": null
      },
      "facing": 0,
      "deploy": {
        "spawn": null,
        "hqA": null,
        "hqD": null,
        "zone": []
      }
    },
    "firstSide": "defender",
    "factions": {
      "attacker": "us",
      "defender": "de"
    },
    "units": [
      {
        "side": "attacker",
        "name": "步兵营",
        "c": 2,
        "r": 3,
        "id": "tutorial2-us-1"
      },
      {
        "side": "attacker",
        "name": "步兵营",
        "c": 2,
        "r": 1,
        "id": "tutorial2-us-2"
      },
      {
        "side": "defender",
        "name": "工兵营",
        "c": 5,
        "r": 2,
        "id": "tutorial2-de-eng"
      },
      {
        "side": "defender",
        "name": "步兵营",
        "c": 5,
        "r": 1,
        "id": "tutorial2-de-inf"
      }
    ],
    "steps": [
      {
        "text": "德军先行动。工兵可以修建战壕等建筑：战壕会让所在格提供额外减伤。选中 F3 德军工兵，在 E3 城区修建战壕。",
        "allow": {
          "type": "build",
          "unitId": "tutorial2-de-eng",
          "c": 4,
          "r": 2,
          "buildingType": "trench"
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 修建战壕"
        }
      },
      {
        "text": "战壕修好了。选中德军步兵（F2），移动到 E3 战壕上。",
        "allow": {
          "type": "move",
          "unitId": "tutorial2-de-inf",
          "c": 4,
          "r": 2
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 进入战壕"
        }
      },
      {
        "text": "德军结束回合。点「结束回合」，然后切换顶部座位到「教程玩家」。",
        "allow": {
          "type": "endTurn"
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 高抗性格"
        }
      },
      {
        "text": "轮到美军。切换座位到「教程玩家」，把第一组步兵从 C4 移动到 D4，贴近 E3。",
        "allow": {
          "type": "move",
          "unitId": "tutorial2-us-1",
          "c": 3,
          "r": 3
        },
        "focus": {
          "c": 3,
          "r": 3,
          "label": "D4 · 第一组步兵"
        }
      },
      {
        "text": "把第二组步兵从 C2 移动到 D2，准备远程集火。",
        "allow": {
          "type": "move",
          "unitId": "tutorial2-us-2",
          "c": 3,
          "r": 1
        },
        "focus": {
          "c": 3,
          "r": 1,
          "label": "D2 · 第二组步兵"
        }
      },
      {
        "text": "E3 城区加战壕后抗性极高。先让第一组步兵锁定德军：锁定不是伤害，而是标记目标，让其他单位可以一起集火。",
        "allow": {
          "type": "lock",
          "unitId": "tutorial2-us-1",
          "targetId": "tutorial2-de-inf"
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 锁定德军"
        }
      },
      {
        "text": "第二组步兵对 E3 集火。集火把多个单位的伤害合并成一次攻击，只触发一次反击，能明显减少我方挨反击的次数。",
        "allow": {
          "type": "focus",
          "unitId": "tutorial2-us-2",
          "targetId": "tutorial2-de-inf"
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 集火"
        }
      },
      {
        "text": "集火后，德军只能选择一次反击。切换顶部座位到「教程敌军」，选择被集火单位要反击的美军目标；完成后再切回「教程玩家」。",
        "expectCounter": true,
        "focus": {
          "c": 4,
          "r": 2,
          "label": "德军反击一次"
        }
      },
      {
        "text": "观察这次反击和集火结果。点「下一步」回退到美军回合开始，改学推进：把德军推出高防护格，让后续攻击打出更高伤害。",
        "auto": "rewind",
        "focus": {
          "c": 4,
          "r": 2,
          "label": "准备回退"
        }
      },
      {
        "text": "回退完成。现在不要集火：让第一组步兵推进 E3 德军，把它推出战壕和城区的高防护格。",
        "allow": {
          "type": "push",
          "unitId": "tutorial2-us-1",
          "targetId": "tutorial2-de-inf"
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "推进德军"
        }
      },
      {
        "text": "德军被推到 E2 平原。第二组步兵从 D2 攻击它，比较离开战壕后的伤害和反击。",
        "allow": {
          "type": "attack",
          "unitId": "tutorial2-us-2",
          "targetId": "tutorial2-de-inf"
        },
        "focus": {
          "c": 4,
          "r": 1,
          "label": "E2 · 德军失去掩护"
        }
      },
      {
        "text": "打开对战历史，比较锁定集火和推进后攻击的伤害与反击；教程完成。",
        "focus": {
          "c": 3,
          "r": 1,
          "label": "教程完成"
        }
      }
    ]
  },
  {
    "id": "t03",
    "title": "第三关 · 装甲、巷战与混乱",
    "subtitle": "装甲单位 · 穿深 · 巷战 · 前后包夹 · 混乱 · 鼠式",
    "map": {
      "format": "bingqi-map",
      "version": 3,
      "app": "bingqi-map-editor",
      "savedAt": "2026-11-24T13:42:33.864Z",
      "cols": 8,
      "rows": 6,
      "mode": "attack",
      "terrains": [
        "plain",
        "road",
        "rail",
        "house",
        "city",
        "forest",
        "hill",
        "mountain",
        "river",
        "swamp"
      ],
      "cells": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        4,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "rules": {
        "plain": {
          "move": 1,
          "moveMech": 1,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "road": {
          "move": 1,
          "moveMech": 0.5,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "rail": {
          "move": 1,
          "moveMech": 0.5,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "house": {
          "move": 1,
          "moveMech": 1,
          "protect": 0.3,
          "blocksSight": true,
          "urban": true,
          "riverReset": false,
          "chaos": 0
        },
        "city": {
          "move": 1,
          "moveMech": 1,
          "protect": 0.5,
          "blocksSight": true,
          "urban": true,
          "riverReset": false,
          "chaos": 0
        },
        "forest": {
          "move": 1,
          "moveMech": 2,
          "protect": 0.2,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "hill": {
          "move": 2,
          "moveMech": 2,
          "protect": 0.25,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "mountain": {
          "move": 3,
          "moveMech": 3,
          "protect": 0.4,
          "blocksSight": true,
          "urban": false,
          "riverReset": false,
          "chaos": 0
        },
        "river": {
          "move": 1,
          "moveMech": 1,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": true,
          "chaos": 0
        },
        "swamp": {
          "move": 2,
          "moveMech": 2,
          "protect": 0,
          "blocksSight": false,
          "urban": false,
          "riverReset": false,
          "chaos": 1
        }
      },
      "grid": {
        "move": [
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "moveMech": [
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "protect": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0.5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      "phases": {
        "a": 1,
        "b": null,
        "c": null
      },
      "facing": 0,
      "deploy": {
        "spawn": null,
        "hqA": null,
        "hqD": null,
        "zone": []
      }
    },
    "firstSide": "attacker",
    "factions": {
      "attacker": "us",
      "defender": "de"
    },
    "units": [
      {
        "side": "attacker",
        "name": "步兵营",
        "c": 3,
        "r": 3,
        "id": "tutorial3-us-1"
      },
      {
        "side": "defender",
        "name": "四号突击炮营",
        "c": 4,
        "r": 3,
        "id": "tutorial3-target"
      }
    ],
    "steps": [
      {
        "text": "E4 是德军四号突击炮，属于装甲单位。先右键美军步兵 D4 对它的攻击预览：预计伤害只有约 0.25，AP 不足，无法有效击穿正面装甲。",
        "blocked": true,
        "blockedText": "预计伤害约 0.25：AP 不足，无法击穿四号突击炮的正面装甲。",
        "allow": {
          "type": "attack",
          "unitId": "tutorial3-us-1",
          "targetId": "tutorial3-target"
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "E4 · 装甲"
        }
      },
      {
        "text": "把步兵移动到 E3 城区。城区提供额外防护，同时让步兵攻击相邻目标时采用巷战数值，穿深更高。",
        "allow": {
          "type": "move",
          "unitId": "tutorial3-us-1",
          "c": 4,
          "r": 2
        },
        "focus": {
          "c": 4,
          "r": 2,
          "label": "E3 · 城区"
        }
      },
      {
        "text": "从城区攻击相邻的四号突击炮，观察巷战伤害和穿深是否提高。",
        "allow": {
          "type": "attack",
          "unitId": "tutorial3-us-1",
          "targetId": "tutorial3-target"
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "巷战攻击"
        }
      },
      {
        "text": "方向判定：从目标正面、侧面或后方进入，分别取正面、侧面或背面装甲。系统会自动选择能打出最高伤害的方向；集火时还会取全队最高穿透。观察四号这次是否反击。",
        "focus": {
          "c": 4,
          "r": 3,
          "label": "方向与反击"
        }
      },
      {
        "text": "现在把地图刷成纯平原，并增加第二组美军。E3 的第二组先待命，准备从侧面/后方包夹。",
        "auto": "stagePlain",
        "focus": {
          "c": 4,
          "r": 2,
          "label": "第二组美军"
        }
      },
      {
        "text": "把第二组美军从 E3 移动到 F4，与 D4 的第一组形成前后包夹。",
        "allow": {
          "type": "move",
          "unitId": "tutorial3-us-2",
          "c": 5,
          "r": 3
        },
        "focus": {
          "c": 5,
          "r": 3,
          "label": "F4 · 后方"
        }
      },
      {
        "text": "先让正面 D4 的第一组锁定四号突击炮，锁定后可以组织集火，减少反击次数。",
        "allow": {
          "type": "lock",
          "unitId": "tutorial3-us-1",
          "targetId": "tutorial3-target"
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "正面锁定"
        }
      },
      {
        "text": "让后方 F4 的第二组集火。教学演示中四号突击炮会 100% 混乱：混乱单位无法反击，且下一次被击中会直接消灭。",
        "allow": {
          "type": "focus",
          "unitId": "tutorial3-us-2",
          "targetId": "tutorial3-target",
          "facing": 3
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "后方集火"
        }
      },
      {
        "text": "四号突击炮已经混乱。混乱单位无法反击，而且下一次被击中会直接消灭。",
        "focus": {
          "c": 4,
          "r": 3,
          "label": "混乱 · 必杀"
        }
      },
      {
        "text": "现在任意一次攻击都会直接消灭混乱的四号突击炮。",
        "allow": {
          "type": "attack",
          "unitId": "tutorial3-us-1",
          "targetId": "tutorial3-target"
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "混乱 · 必杀"
        }
      },
      {
        "text": "现在重置为鼠式超重坦。鼠式正面装甲极高，即使成功绕后，步兵 AP 仍然无法击穿；无法击穿就不会触发混乱。两个美军会直接放在前后包夹位置。",
        "auto": "stageMaus",
        "focus": {
          "c": 4,
          "r": 3,
          "label": "鼠式超重坦"
        }
      },
      {
        "text": "鼠式已经直接放在前后包夹位置。先让正面 D4 的第一组锁定它。",
        "allow": {
          "type": "lock",
          "unitId": "tutorial3-us-1",
          "targetId": "tutorial3-target"
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "鼠式 · 锁定"
        }
      },
      {
        "text": "让后方 F4 的第二组集火鼠式。观察：即使绕后，AP 仍无法击穿，伤害很低，也不会混乱。",
        "allow": {
          "type": "focus",
          "unitId": "tutorial3-us-2",
          "targetId": "tutorial3-target",
          "facing": 3
        },
        "focus": {
          "c": 4,
          "r": 3,
          "label": "鼠式 · 无法击穿"
        }
      },
      {
        "text": "第三关完成。记住：绕后能创造机会，但能不能打出效果仍取决于穿深；完全无法击穿时不会触发混乱。",
        "focus": {
          "c": 4,
          "r": 3,
          "label": "教程完成"
        }
      }
    ]
  }
];
