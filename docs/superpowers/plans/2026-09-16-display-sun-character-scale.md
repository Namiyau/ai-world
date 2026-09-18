# 显示分辨率、太阳与角色比例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加明确的 Esc 渲染分辨率控制，消除太阳黑芯，并让展示角色符合第一人称比例。

**Architecture:** PauseSettings 提供可迁移的分辨率枚举；Game 将其唯一映射到 Engine 缩放并把实际尺寸回报给 HUD；Atmosphere 将太阳实现为独立 shader 日轮；CharacterVisuals 只调整共享根比例。

**Tech Stack:** Babylon.js 9、TypeScript、Node test runner、Playwright/Chrome。

## Global Constraints

- 不修改地形、水面、道路、Chunk、POI 或角色模块接口。
- 浏览器只调整内部 render buffer，不伪造或改变操作系统显示分辨率。
- 太阳保持零贴图、低成本、无雾和无深度写入。

### Task 1: 分辨率设置与存档迁移

**Files:**
- Modify: `src/game/ui/PauseSettings.ts`
- Modify: `src/game/ui/Hud.ts`
- Modify: `src/game/Game.ts`
- Modify: `tests/esc-avatar-foundation.test.ts`

- [x] 写入失败测试，要求 75/100/125/150% 映射明确且旧 `renderQuality` 存档可迁移。
- [x] 运行测试并确认旧设置没有 `renderResolution` 字段而失败。
- [x] 实现 `RenderResolution`、缩放映射、Esc 下拉框、实际 render 尺寸输出与旧字段迁移。
- [x] 重跑设置测试，确认通过。

### Task 2: 无黑芯太阳与柔和主光

**Files:**
- Modify: `src/game/config.ts`
- Modify: `src/game/world/Atmosphere.ts`
- Modify: `tests/esc-avatar-foundation.test.ts`
- Modify: `tests/browser-visual-clarity-acceptance.cjs`

- [x] 写入失败测试，要求 sun-disc 使用 shader 日轮、面向相机、禁 fog/深度写入，且环境填充不低于定向光。
- [x] 运行测试并确认当前 StandardMaterial 球体失败。
- [x] 用圆盘 shader 和独立光晕替换球体，调整填充光与日照对比。
- [x] 重跑太阳测试和浏览器验收。

### Task 3: 第一人称角色比例

**Files:**
- Modify: `src/game/player/CharacterVisuals.ts`
- Modify: `tests/character-visuals.test.ts`
- Modify: `tests/browser-visual-clarity-acceptance.cjs`

- [x] 写入失败测试，要求三种角色高度在 1.50–1.75m。
- [x] 运行测试并确认当前 2.7m 以上的模型失败。
- [x] 将共享根缩放降至 0.46，不改变模块结构。
- [x] 重跑角色测试和浏览器验收。

### Task 4: 全量验证与文档

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-16-display-sun-character-scale.md`

- [x] 运行 `npm.cmd test`、`npm.cmd run build` 和浏览器显示验收。
- [x] 更新 README 的 Esc 设置、太阳和角色比例说明。
- [x] 将已完成任务打钩并报告实际验证数据。
