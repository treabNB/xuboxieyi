# Anti-Slop Check

## Risk Register

| Group | Risk in this game | Planned response | Final evidence |
| --- | --- | --- | --- |
| G 灰色 AI 小字 | 用浅灰小字解释武器、输入和错误 | 关键状态进入 HUD 或按钮旁的正文级文字；不写制作说明 | `proof/final-entry-1440.png`：入口文案、键位和错误提示均高于装饰刻度；通过 |
| N 数字卡 | 把武器属性做成三列 KPI 卡 | 属性只在选中武器时显示为短行，核心画面仍是可玩战场 | `proof/final-entry-1440.png`：三把武器是纵向选择清单，不是 KPI 卡；通过 |
| P 题材配色 | 枪战题材自动落入黑底紫蓝或橙红发光 | 采用印刷战术图、奶油纸色地图、单一钴蓝/朱红职责色 | `proof/sniper-aim.png`：颜色由阵营和瞄准状态承担，无霓虹渐变；通过 |
| B 表达块 | 每个状态都套相同卡片容器 | 房间入口、HUD、记分板是不同任务层级，不共享无职责胶囊 | 最终检查 |
| T 胶囊堆 | 键帽、网络、分数都做成药丸标签 | 键帽保持键帽形态；比分、房间码使用排版和分隔线 | 最终检查 |
| O 双语题眉 | 每个标题都重复英文/中文 | 品牌只在入口出现一次；HUD 使用当前语言与必要英文战术词 | 最终检查 |
| S 编号仪式 | 为每块内容强行编号 | 编号只用于 01/02/03 武器槽、倒计时和靶道坐标，直接服务选择与定位 | 最终检查 |
| W 模板文案 | 欢迎语、贴士、口号占空间 | 入口只给创建/加入、输入方式和武器差异；无问候与气氛说明 | 最终检查 |
| D 发光概念图 | 用发光几何、抽象 SVG 替代游戏场景 | 竞技场和角色全部由 Phaser 状态驱动；不使用假概念视觉 | `proof/multiplayer-guest-aim.png`：实际可玩场景和输入反馈；通过 |

## Completion

- 页面不使用营销 hero、卡片网格或 dashboard 外壳；成立。
- 主要视觉是可玩的战场，入口只覆盖左侧局部；成立。
- 选择、建房、加入、开局、切枪、换弹、结束和回房均经过真实浏览器输入；成立。
- 不使用手写 SVG 充当插画或生成式背景；成立。
- 满员四行 HUD 在 1416×761 实际视口内完整显示，线上 2× 入口截图 `proof/live-final-2x.png` 为 2880×1800；成立。
- 最终视觉结论由线上 `proof/final-entry.png`、`proof/sniper-aim.png`、`proof/multiplayer-host.png` 与 `proof/match-end-guest.png` 支撑；成立。
- 多地图不是换色卡：三张 `proof/map-*.png` 分别具有不同掩体轮廓、出生点和场景构件；成立。
- 角色不是单纯色点：装甲躯干、护肩、背包、头盔视窗和当前武器轮廓在 `proof/multiplayer-guest-aim.png` 与 `proof/mg-suppression.png` 中可辨；成立。
- 视野不是装饰暗角：`proof/visibility-occlusion.png` 中视锥、近身圈和攻击线均在炉芯前截断；成立。
