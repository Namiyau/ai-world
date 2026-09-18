# 可调节区块加载与性能审计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加可持久化的 Minecraft 风格 Chunk 加载半径，并用运行时指标验证当前世界流式加载没有明显泄漏或预算失控。

**Architecture:** PauseSettings 保存用户选择；Game 负责把设置转给 WorldManager；WorldManager 用可变加载半径维护 wanted window，用 `pendingChunkKeys` 去重并按距离优先渐进构建。性能快照由 WorldManager 公开，浏览器验收从真实页面读取而不是正则检查。

**Tech Stack:** Babylon.js 9.26、TypeScript、Vite、Node test runner/tsx、Playwright Python。

## Global Constraints

- 保留现有 Ground/Water/Road/POI 生成算法与 seed 语义。
- 不引入新玩法，不修改外部资源。
- 生产代码必须先有会失败的行为测试，再实现。
- 设置范围固定为 2–6，默认 3；半径含义为方形加载窗口。
- 所有卸载必须复用现有 `disposeChunk`，确保交互、Combat、Detail、POI、Landmark 和 Shadow 注册一起释放。

## File Map

- `src/game/ui/PauseSettings.ts`：加入 Chunk 加载半径类型、默认值、持久化解析。
- `src/game/ui/Hud.ts`：ESC 设置控件、显示文本和事件解析。
- `src/game/Game.ts`：应用加载半径设置并触发 WorldManager 重排窗口。
- `src/game/world/WorldManager.ts`：可变半径、队列去重/排序、窗口刷新、性能快照。
- `src/styles.css`：仅补充加载距离控件的布局样式。
- `tests/esc-avatar-foundation.test.ts` 或新测试：设置解析与档位映射。
- `tests/world-environment.test.ts` 或新测试：wanted window、队列和性能快照的纯逻辑边界。
- `tests/browser-chunk-performance-acceptance.cjs`：真实浏览器测试设置切换、Chunk 边界、实例预算和连续帧指标。

## Tasks

### 1. 写设置行为测试并确认 RED

- [x] 测试空存储默认 `chunkLoadRadius=3`。
- [x] 测试合法档位 2–6 可恢复，非法值回退 3。
- [x] 测试 `(2r+1)^2` 预估数量与边界值。
- [x] 运行设置测试，确认新断言因生产代码缺少字段而失败。

### 2. 实现设置持久化与 ESC 控件

- [x] 为 PauseSettings 增加 `ChunkLoadRadius` 类型和解析/保存。
- [x] 在 HUD ESC 设置增加下拉框与预计 Chunk 数输出。
- [x] 让 input/change 事件传递完整设置对象。
- [x] 运行设置与 HUD 相关测试，确认 GREEN。

### 3. 写 WorldManager 流式窗口测试并确认 RED

- [x] 抽出或导出纯的加载窗口坐标计算函数，测试半径 2/3/6 的数量与唯一性。
- [x] 测试中心移动时不保留窗口外坐标，pending key 不重复。
- [x] 测试性能快照字段存在且计数可解释。
- [x] 运行测试，确认在实现动态半径前失败。

### 4. 实现可变 Chunk 半径与优先队列

- [x] WorldManager 保存当前加载半径并提供只读 getter/性能快照。
- [x] 将窗口计算从 `GAME_CONFIG.chunkRadius` 改为当前设置。
- [x] 使用 pending key Set，按 Manhattan/平方距离排序新候选。
- [x] 保持中心 3×3 同步构建，远处按现有每帧预算构建。
- [x] 设置变化时强制刷新窗口；清理窗口外已加载和待处理 Chunk。
- [x] 统计窗口刷新、生成和卸载耗时，不在每帧做高成本扫描。

### 5. 接入 Game 与样式

- [x] `applyPauseSettings` 调用 WorldManager 的加载半径入口。
- [x] 仅为新控件增加小范围 CSS，不改动既有菜单风格。
- [x] 增加设置切换后 HUD 状态与 WorldManager 快照一致的测试。

### 6. 全量性能体检与浏览器验收

- [x] 先查看并运行 `with_server.py --help`，再用现有 Playwright Chromium 运行时启动本地 Vite。
- [x] 在默认半径下记录 3 秒稳定窗口的帧时间、active mesh、Chunk、实例、pending 和 shadow caster。
- [x] 切换到半径 2、6，再切回 3；断言 Chunk 坐标窗口、最大数量、pending 去重和卸载后计数恢复。
- [x] 快速 teleport/跨 Chunk 多次，断言没有 page error、重复 Chunk、无限增长实例或交互对象。
- [x] 输出性能报告和截图用于审查。

### 7. 最终验证

- [x] `npm test`
- [x] `npm run build`
- [x] `node tests/browser-chunk-performance-acceptance.cjs`（通过 `with_server.py` 启动服务）
- [x] 复核 diff 与新增文档，记录 Vite 仅有的 bundle 体积警告或实际遗留问题。
