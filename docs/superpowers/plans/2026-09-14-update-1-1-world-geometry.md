# Update 1.1 World Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Update 1.1 的道路、湖泊、水面、chunk、法线和环境光照结构，使世界几何稳定、水平、无巨型三角形并保持 seed 确定性。

**Architecture:** 保留 `TerrainSampler` 作为唯一世界函数源；将道路 Ribbon 和 flat triangle 展开各自收敛为可测试的几何辅助逻辑。河流从采样链完全移除，WaterLayer 只消费固定湖面高度；WorldManager 统一使用半开 chunk 范围。

**Tech Stack:** TypeScript 7, Babylon.js Core 9.26, Vite 8, Node 24 `node:test`, 浏览器手动验收。

## Global Constraints

- 只实现 Update 1.1 世界几何修复；不开始 POI、商店或 Update 2。
- Roads 的每个 Ribbon 的 `pathArray` 必须严格是同一道路的 `[leftPath, rightPath]`。
- 道路采样步长保持在约 2～4m。
- 河流与支流完全停用；水体只保留水平湖泊。
- lake cell 是否存在只依赖 world seed、cell 坐标和湖中心基础高度。
- 水面顶点使用同一水平水位；shader 的 `color.a` 只表示 coverage。
- 开发阶段水面 `backFaceCulling = true`。
- 道路地形影响半径为道路半宽加合理 shoulder，不得使用 58m 异常范围。
- chunk 实际地面范围与索引定义一致。
- 环境 fog 和 lights 只由 `Atmosphere` 创建。
- flat normals 必须是独立面法线，不能平均共享顶点法线。

---

### Task 1: 建立失败测试与纯几何合同

**Files:**
- Create: `tests/world-geometry.test.ts`
- Create: `src/game/world/geometry.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `RoadEdgeSample`, `roadEdgesFromTangent`, `expandIndexedTrianglesToFlat`, `chunkBounds`，供后续生产代码和测试使用。

- [ ] **Step 1: Write the failing tests**

  写测试断言：道路边缘来自单位切线垂线；flat 展开后每个三角形拥有独立顶点且共享原顶点的相邻面可以有不同法线；chunk `cx=0` 的范围是 `[0, size]`；source-level contract 不再允许道路把交错点数组交给 Ribbon。

- [ ] **Step 2: Run tests and verify the expected failures**

  Run: `npm test`

  Expected: FAIL because `src/game/world/geometry.ts` and the new test command do not yet exist.

- [ ] **Step 3: Add the minimal test command and geometry contracts**

  在 `package.json` 增加 `"test": "node --experimental-strip-types --test tests/*.test.ts"`。在 `geometry.ts` 实现纯函数：`roadEdgesFromTangent(center, tangent, halfWidth)` 归一化 XZ 切线后用垂线生成左右点；`expandIndexedTrianglesToFlat(positions, indices)` 为每个索引三角形复制三个位置、计算朝上的面法线并生成顺序索引；`chunkBounds(index, size)` 返回 `{min: index*size, max: (index+1)*size, center: (index+0.5)*size}`。

- [ ] **Step 4: Run tests and verify the contracts pass**

  Run: `npm test`

  Expected: PASS for the helper contracts; the integration/source contract tests remain red until their production files are changed.

### Task 2: 停用河流、修复湖泊确定性并收窄道路压平

**Files:**
- Modify: `src/game/world/TerrainSampler.ts`
- Modify: `src/game/config.ts`
- Modify: `tests/world-geometry.test.ts`

**Interfaces:**
- `TerrainSampler.sample/height/colorContext` continues to be the public world query API.
- Lake cell resolution is stable for a given sampler seed and cell coordinate.

- [ ] **Step 1: Extend failing tests**

  增加测试：同一个 `TerrainSampler(seed)` 在不同查询顺序下对相同坐标返回相同 lake/water 结果；公开的水样本不再出现 river-specific local water surface；`ROAD_CONFIG.halfWidth + shoulderWidth` 小于 20m 且配置不再使用 58m flatten width。

- [ ] **Step 2: Run the focused tests and confirm they fail against the old implementation**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts`

  Expected: FAIL on the current query-dependent lake logic, river fields/logic, and 58m road flatten configuration.

- [ ] **Step 3: Implement the minimal sampler/config change**

  删除 `WaterField.riverDepth`、`riverDepth`、`sideChannelDepth`、`riverBandExists`、`riverWind` 及其调用。`waterField` 只按 lake depth 返回全局 `WATER_CONFIG.level`。`lakeAt(gx,gz)` 先生成候选湖中心，再用 `baseElevation(centerX, centerZ).base` 做低地资格判断。`waterCoverage` 只消费 lake surface。将道路配置改为 `shoulderWidth`，在 `roadField` 中使用 `ROAD_CONFIG.halfWidth + ROAD_CONFIG.shoulderWidth` 计算影响半径；道路中心线基线只对 lake carve 做有限处理。更新 `isLake` 和相关注释，使无水样本不伪称 river。

- [ ] **Step 4: Run focused tests and build**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts` and `npm run build`

  Expected: focused sampler/config tests PASS and build exits 0.

### Task 3: 重写 Roads.ts 的独立 Ribbon 与切线采样

**Files:**
- Modify: `src/game/world/Roads.ts`
- Modify: `src/game/world/WorldManager.ts`
- Modify: `tests/world-geometry.test.ts`

**Interfaces:**
- `RoadLayer.build(...)` returns `Mesh[]`, one valid mesh per road intersecting the chunk.
- `RoadLayer.traceSpine(...)` returns one road's left/right paths and vertex colors.

- [ ] **Step 1: Extend failing tests**

  测试 Roads 源码/辅助合同：每个 Ribbon 构造的 `pathArray` 只包含两个 path；每个 path 的相同索引属于同一道路；采样步长在 2～4m；弯道边缘相对中心线保持半宽。

- [ ] **Step 2: Run focused tests and verify old Roads fails**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts`

  Expected: FAIL because the current implementation aggregates all paths and emits `[left0,right0,...]` as a single path with 12m spacing.

- [ ] **Step 3: Implement independent road ribbons**

  重写 `build`：分别收集纵向/横向道路，调用 `traceSpine` 后立即创建 `CreateRibbon({pathArray: [leftPath, rightPath], ...})`；返回所有道路 mesh。重写 `traceSpine`：用相邻中心线样本求切线，调用 `roadEdgesFromTangent` 生成左右点；用 `sampler.sample` 取边缘地面高度并添加小幅 surface lift；以 3.2m 为目标步长并稳定包含端点。修改 WorldManager 将返回的 mesh 数组全部加入 chunk record。不要把不同道路 merge 成一个 Ribbon。

- [ ] **Step 4: Run tests and build**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts` and `npm run build`

  Expected: road geometry tests PASS and build exits 0.

### Task 4: 重写水平湖面 shader 与水网格

**Files:**
- Modify: `src/game/world/WaterLayer.ts`
- Modify: `tests/world-geometry.test.ts`

**Interfaces:**
- `WaterLayer.build(...)` returns null or a mesh whose every position Y equals `WATER_CONFIG.level`.
- Shader vertex alpha semantics are coverage-only.

- [ ] **Step 1: Extend failing tests**

  增加测试：水面生成源码不把 `color.a` 当 surface height；创建的水面网格顶点 Y 全部相同；`backFaceCulling` 为 true。

- [ ] **Step 2: Run focused tests and verify old WaterLayer fails**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts`

  Expected: FAIL because the old shader declares alpha as surface and disables back-face culling.

- [ ] **Step 3: Implement horizontal lake surface**

  删除逐顶点水位语义、`uNormalOffset` 和波浪位移；采样阶段只对 lake water coverage 生成三角形，并把每个水顶点 Y 写成 `WATER_CONFIG.level`。顶点 shader 读取 `color.a` 为 coverage 并原样传给 varying；fragment shader 输出 `vec4(finalColor, vCoverage)`。设置 `material.backFaceCulling = true`，保留 alpha blending 和雾/水下色调但不改变几何 Y。

- [ ] **Step 4: Run tests and build**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts` and `npm run build`

  Expected: water tests PASS and build exits 0.

### Task 5: 统一 chunk 范围并真正生成 flat normals

**Files:**
- Modify: `src/game/world/WorldManager.ts`
- Modify: `tests/world-geometry.test.ts`

**Interfaces:**
- `createChunk` and all chunk-owned systems receive center `((cx+0.5)*size, (cz+0.5)*size)`.
- Ground mesh uses expanded flat triangle data.

- [ ] **Step 1: Extend failing tests**

  增加测试：chunk 0 的地面范围与 chunk 1 只在边界相接；`buildGroundMesh` 使用 flat expansion；相邻三角形可拥有不同 normal。

- [ ] **Step 2: Run focused tests and verify old chunk/normals fail**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts`

  Expected: FAIL on old `centerX = cx * size` and averaged `applyFlatNormals` implementation.

- [ ] **Step 3: Implement coordinate and normal fixes**

  在 `createChunk` 使用 `chunkBounds(cx,size).center` 与 Z 对应值；所有地面、水面、道路、details、resource、enemy、landmark owner 查询继续使用这个中心。地标 owner 的边界判断改为半开范围。`buildGroundMesh` 读取 CreateGround 的局部位置、抬高和顶点色后调用 `expandIndexedTrianglesToFlat`，写回展开后 position/normal/color/indices，移除平均法线函数及不再需要的 `VertexData`/`IndicesArray` 依赖。

- [ ] **Step 4: Run tests and build**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts` and `npm run build`

  Expected: chunk and flat-normal tests PASS; build exits 0.

### Task 6: 合并环境光照责任并同步文档

**Files:**
- Modify: `src/game/Game.ts`
- Modify: `src/game/world/Atmosphere.ts`
- Modify: `README.md`
- Modify: `tests/world-geometry.test.ts`

**Interfaces:**
- `Atmosphere` remains the only creator of scene fog and environment lights.

- [ ] **Step 1: Extend failing source contract tests**

  断言 Game.ts 不再 import/create `HemisphericLight` 或 `DirectionalLight`，不再设置 fog；Atmosphere.ts 保留唯一 fog/light 设置。README 不再声称存在程序化河流或局部河流水位。

- [ ] **Step 2: Run focused tests and verify old duplication fails**

  Run: `node --experimental-strip-types --test tests/world-geometry.test.ts`

  Expected: FAIL because Game.ts currently creates duplicate fog and lights.

- [ ] **Step 3: Remove duplicate setup and update documentation**

  删除 Game.ts 中的 fog、clearColor、HemisphericLight、DirectionalLight 配置及对应 imports；Atmosphere 继续负责这些设置。README 的世界生成、水体、性能和已实现列表改为“湖泊-only”，并记录 chunk 半开范围、道路 3m 级采样、真实 flat normals。

- [ ] **Step 4: Run tests and full build**

  Run: `npm test` and `npm run build`

  Expected: all tests PASS and build exits 0.

### Task 7: 浏览器验收与最终回归

**Files:**
- No new production files; inspect generated app and test output.

- [ ] **Step 1: Start the dev server**

  Run: `npm run dev -- --host 127.0.0.1`

- [ ] **Step 2: Check the acceptance viewpoints**

  In the browser, inspect the world in normal view and flight mode: high altitude shows no giant road/water triangles; below ground shows no water spikes/walls; roads stay on terrain through chunk boundaries; lakes are flat; reload with the same seed produces the same geometry.

- [ ] **Step 3: Run final verification commands**

  Run: `npm test` and `npm run build`

  Expected: both commands exit 0; report any browser-only limitation explicitly instead of claiming unverified visual success.
