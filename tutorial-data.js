window.TUTORIAL_LEVELS = [
  {
    "id": "t01",
    "title": "第一关 · 移动、地形与攻击",
    "subtitle": "选中 · 移动 · 山地消耗 · 视野 · 巷战 · 反击",
    "map": {
      "format": "bingqi-map",
      "version": 3,
      "app": "bingqi-map-editor",
      "savedAt": "2026-11-24T13:08:17.482Z",
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
        0,
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
          0,
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
        "c": 1,
        "r": 3,
        "id": "tutorial-us-inf"
      },
      {
        "side": "defender",
        "name": "步兵营",
        "c": 6,
        "r": 3,
        "id": "tutorial-de-inf"
      }
    ],
    "steps": [
      {
        "text": "左键选中美军步兵营，右键点击城区房屋（3,3），左键可取消，确认后再右键一次完成移动。",
        "allow": {
          "type": "move",
          "unitId": "tutorial-us-inf",
          "c": 3,
          "r": 3
        },
        "focus": {
          "c": 3,
          "r": 3,
          "label": "城区 · 移动到这里"
        }
      },
      {
        "text": "左侧山地格标红：同样是走一格，山地要消耗 3 点行动力。看完后点击「结束回合」。",
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
        "text": "回合交给德军。德军步兵移动到了河格（6,2）。上河会立刻清空该单位剩余行动力。确认后点「下一步」继续。",
        "auto": "enemyRiver",
        "focus": {
          "c": 6,
          "r": 2,
          "label": "德军上河 · 行动力清零"
        }
      },
      {
        "text": "回到你的回合。现在隔着房区看德军：房屋会阻挡视线，不能直接攻击。",
        "blocked": true,
        "blockedText": "房屋阻挡了视线：需要先移动到能看到目标的位置。",
        "allow": {
          "type": "attack",
          "unitId": "tutorial-us-inf",
          "targetId": "tutorial-de-inf"
        },
        "focus": {
          "c": 6,
          "r": 2,
          "label": "房区后的德军"
        }
      },
      {
        "text": "把步兵移动到（5,2）房屋，绕开阻挡获得德军视野。",
        "allow": {
          "type": "move",
          "unitId": "tutorial-us-inf",
          "c": 5,
          "r": 2
        },
        "focus": {
          "c": 5,
          "r": 2,
          "label": "攻击位置"
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
          "c": 6,
          "r": 2,
          "label": "德军"
        }
      },
      {
        "text": "德军会反击。点顶部座位切换到「教程敌军」，选择反击目标，再切回「教程玩家」。",
        "focus": {
          "c": 6,
          "r": 2,
          "label": "反击选择"
        }
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
  }
];
