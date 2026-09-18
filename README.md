# AI World — Babylon.js 程序化世界原型

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

一个面向「低模卡通 + 无限程序化世界 + 任务世界 + 经济循环」的 Babylon.js + TypeScript 浏览器原型。

项目目前处于可运行原型阶段：主世界、任务世界、资源循环、低模角色和视觉资产已经接入；多人网络、服务器权威存档和完整生产管线仍在规划中。

## 功能亮点

| 领域 | 能力 |
| --- | --- |
| 世界生成 | 基于 seed 的无限 chunk 流式世界，包含丘陵、山地、草地、森林、岩地和稳定湖泊 |
| 场景系统 | 道路、远景地标、湖岸码头、桥梁、营地、仓库、矿区和废车点等确定性 POI |
| 探索 | 第一人称移动、冲刺、跳跃、爬台阶、涉水减速和创造模式飞行 |
| 角色 | 玩家探索者、普通商人、荒野近战敌人；服装、帽子、背负物和道具采用模块化槽位 |
| 资源与经济 | 木材、石料、废料、遗物、现金、资源价格和商店出售循环 |
| 任务世界 | 从主世界进入更危险的任务世界，近战敌人追击并掉落资源，完成后撤离返回 |
| 视觉 | 程序化天空、轻量雾效、低模水面、逐面法线、顶点色和实例化散布物 |
| 存档 | `localStorage` 自动存档；World Delta 只记录已收集资源，不保存整张无限地图 |

## 快速开始

### 环境要求

- Node.js 20.19+，或 Node.js 22.12+
- 支持 WebGL 的现代浏览器

### 安装与运行

```bash
npm install
npm run dev
```

然后打开 Vite 输出的本地地址，通常是 `http://localhost:5173`。

也可以在 Windows 下运行项目根目录中的 `start-ai-world.ps1` 或 `启动AI世界.ps1`。

### 构建与检查

```bash
# 类型检查
npx tsc --noEmit

# 单元测试
npm test

# 生产构建与本地预览
npm run build
npm run preview
```

浏览器验收脚本位于 `tests/browser-*`，属于额外的本地验收工具，不包含在 `npm test` 中；运行它们需要单独配置 Playwright 和浏览器。

## 操作手册

| 输入 | 动作 |
| --- | --- |
| 点击画面 | 锁定鼠标 |
| W / A / S / D | 移动 |
| Shift | 冲刺；飞行时下降 |
| 空格 | 跳跃；连按两次进入或退出创造模式飞行 |
| E | 交互、收集、商店和传送 |
| 鼠标左键 | 近战攻击 |
| Tab | 打开背包 |
| Esc | 打开游戏菜单 |

飞行模式下，空格上升，Shift 下降，并且不受地形阻挡。进入水体会明显减速，镜头沉入水下时会出现屏幕色调变化。

## 技术架构

```text
Browser / Vite
      │
      ▼
Game composition root
      │
      ├─ PlayerController   相机、移动、碰撞、跳跃、飞行、涉水
      ├─ Hud                金钱、背包、提示、地标、Esc 菜单
      ├─ Systems            交互、背包、经济、战斗、存档
      └─ WorldManager
           ├─ TerrainSampler  地形、水体和道路的统一采样真相源
           ├─ WaterLayer      湖泊网格与水面 shader
           ├─ Roads           程序化道路 ribbon
           ├─ Landmarks       远景地标和方向指引
           ├─ PoiLayer        人工场景、装饰和矿物节点
           ├─ Details         实例化自然散布物
           ├─ Atmosphere       天空、雾、光照和远裁剪面
           └─ AssetManager     GLB 缓存、实例化和 fallback 资产
```

### 世界生成

所有下游系统共用纯函数 `TerrainSampler.sample(x, z)`：

```text
Terrain → Climate → Water → Road
```

它一次返回最终高度、水面高度、水深、道路距离、生物群系、地表分类以及调色所需的环境数据。因此相邻 chunk 可以天然无缝，世界卸载后重新加载也能得到完全一致的结果。

### 角色与资产

角色外观拆分为 `hair / headwear / outfit / lowerBody / footwear / carry / prop` 模块槽，为后续第三人称、换装和联机同步预留接口。

世界生成器只使用逻辑资产 ID。`AssetRegistry.ts` 管理分类、variant、LOD 和确定性选择，`AssetManager.ts` 负责 GLB 缓存、实例化、资产替换和失败时的程序化 fallback。

当前内置的 Kenney CC0 GLB 资产、来源和许可证见 [`public/assets/ASSET_LICENSES.md`](public/assets/ASSET_LICENSES.md)。

## 目录结构

```text
src/
  main.ts                         应用入口
  styles.css                     HUD 样式
  game/
    Game.ts                       组合根与渲染循环
    config.ts                     分层世界配置
    types.ts                      共享类型
    player/
      PlayerController.ts         移动、碰撞、跳跃、飞行和涉水
      CharacterCatalog.ts         角色外观和模块槽目录
      CharacterVisuals.ts         低模角色几何构建器
    assets/
      AssetRegistry.ts            逻辑资产清单与 variant 选择
      AssetManager.ts              GLB 缓存、实例化和 fallback
      ResourceVisuals.ts           资源语义组合
    systems/
      CombatSystem.ts             近战判定
      EconomySystem.ts            经济与出售
      InteractionSystem.ts        距离交互与 E 键触发
      InventorySystem.ts          背包
      SaveSystem.ts               存档
    ui/
      Hud.ts                      HUD 与 Esc 菜单
    world/
      TerrainSampler.ts           世界生成唯一真相源
      WaterLayer.ts               水面网格与 shader
      Roads.ts                    道路 ribbon
      Landmarks.ts                地标与罗盘
      PoiLayer.ts                 POI、装饰实例和矿物节点
      CharacterShowcaseLayer.ts   角色展示点
      Details.ts                  实例化散布物
      Atmosphere.ts               天空、雾和光照
      WorldManager.ts             chunk 流式加载
tests/
  *.test.ts                       单元测试
  browser-*                       可选浏览器验收脚本
public/assets/                    Kenney CC0 GLB 与许可记录
```

## 已实现

- 第一人称移动、冲刺、跳跃、爬台阶、地形碰撞和创造模式飞行
- Seed 驱动的无限程序化世界与 chunk 流式加载
- 稳定湖泊、程序化路网、远景地标和 HUD 方向指引
- 道路 POI、湖岸码头、桥梁、矿区工棚、废车点和裸露矿物
- 玩家探索者、普通商人和荒野近战敌人的统一低模角色目录
- 程序化资源、E 键交互收集、现金、价格和主世界商店出售
- 主世界 → 任务世界 → 撤离回主世界的基础循环
- 任务世界敌人追击、避水、贴地和近战掉落
- `localStorage` 自动存档与 World Delta 增量记录
- GitHub Actions：类型检查、单元测试和生产构建

## 路线图

1. 任务生成器：独立 seed、危险等级、奖励倍率和 Biome 配置
2. 玩家生命、受击反馈、Hit Stop 和击退
3. 让道路真正连接小屋、营地、洞穴和仓库
4. 箱子 Loot Table、稀有度和商店购买
5. 银行账户、存款利息、房屋与资产数据模型
6. 昼夜循环和更多环境状态
7. 长期探索下的资源 ID 压缩存储
8. 多人网络协议与服务器权威经济边界设计

## 许可与第三方资产

本仓库当前没有声明项目级开源许可证。第三方资源仍遵循各自原始许可证；Kenney 资源为 CC0，完整记录见 [`public/assets/ASSET_LICENSES.md`](public/assets/ASSET_LICENSES.md) 及对应资源目录中的 `License.txt`。

这是一个可扩展的浏览器原型，不是最终生产架构。程序化几何会继续作为可测试、可运行的 fallback，角色模块槽和 humanoid skeleton 契约则为未来兼容的 rigged GLB 资产预留。
