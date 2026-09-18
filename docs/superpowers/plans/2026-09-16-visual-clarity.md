# 画面清晰度与视觉表现修复 Implementation Plan

> **For agentic workers:** This plan is executed inline in the current workspace. Steps use checkboxes for tracking.

**Goal:** 修复浏览器画面降采样和过重雾效，改善太阳、湖面及角色几何，同时保持既有世界拓扑和生成逻辑不变。

**Architecture:** 将画质缩放映射保持为纯函数并由 Game 使用；Atmosphere 继续作为唯一天空、雾和光照入口；WaterLayer 只调整材质表现；CharacterVisuals 只调整共享角色几何和局部比例。

**Tech Stack:** Babylon.js 9、TypeScript、Node test runner、Playwright/Chrome。

## Global Constraints

- 不修改地形、水体拓扑、道路、POI、Chunk 流式加载和存档结构。
- 湖面继续使用现有水平几何；本轮只修改材质/波纹表现。
- 太阳与角色全部使用低模几何，不引入外部资源或大型贴图。
- 不新增 NPC AI、任务、联机行为或采集系统。

### Task 1: 回归测试

**Files:**
- Modify: `tests/esc-avatar-foundation.test.ts`
- Modify: `tests/character-visuals.test.ts`
- Modify: `tests/world-geometry.test.ts`

- [x] 增加画质缩放测试：balanced 必须为原生 1，performance 大于 1，quality 不大于 1。
- [x] 增加太阳材质和雾测试：sun-disc 必须关闭 fog，光晕也必须不参与场景雾。
- [x] 增加角色尺寸/头部测试：生成模型总高度低于 3.2m，头部使用圆润多面体而非 type 1 尖顶。
- [x] 运行相关测试并确认新断言在旧实现上失败。

### Task 2: 清晰度、雾和太阳

**Files:**
- Modify: `src/game/ui/PauseSettings.ts`
- Modify: `src/game/Game.ts`
- Modify: `src/game/config.ts`
- Modify: `src/game/world/Atmosphere.ts`
- Modify: `tests/browser-lighting-poi-acceptance.py`

- [x] 实现稳定的画质缩放映射并让默认/平衡模式不降采样。
- [x] 降低基础雾密度与天空 haze，重新平衡环境光和太阳光。
- [x] 给太阳材质关闭 fog，并新增轻量圆形光晕；光晕不写深度且不参与地形遮挡。
- [x] 更新光照浏览器验收，使其检查新的亮度关系和太阳可见性，而非旧的 ambient>=sun 假设。

### Task 3: Stylized water

**Files:**
- Modify: `src/game/config.ts`
- Modify: `src/game/world/WaterLayer.ts`
- Modify: `tests/world-atmosphere-exploration.test.ts`

- [x] 调整浅水/深水调色和反射强度，保持 alpha 1 与 backFaceCulling。
- [x] 将波纹控制在低频、低振幅且可见的范围；岸边平滑淡出。
- [x] 保持水面所有顶点水平和既有几何拓扑。

### Task 4: Character proportions

**Files:**
- Modify: `src/game/player/CharacterVisuals.ts`
- Modify: `src/game/player/CharacterCatalog.ts` only if proportion constants need semantic adjustment
- Modify: `tests/character-visuals.test.ts`

- [x] 将头部和头发从尖顶 polyhedron 改成圆润低模多面体。
- [x] 将角色根缩放控制在约 0.78，保持略大头、清晰职业轮廓和脚底锚点。
- [x] 运行角色测试并检查模块节点、mesh 数量和高度仍有限。

### Task 5: Browser visual acceptance and docs

**Files:**
- Modify: `tests/browser-character-showcase-acceptance.cjs`
- Create: `tests/browser-visual-clarity-acceptance.cjs`
- Modify: `README.md`

- [x] 采集真实 render size、雾、灯光和太阳材质状态。
- [x] 保存正常、太阳、水面、角色近景截图并检查无页面/控制台错误。
- [x] 运行 `npm.cmd test`、`npm.cmd run build` 和浏览器验收。
