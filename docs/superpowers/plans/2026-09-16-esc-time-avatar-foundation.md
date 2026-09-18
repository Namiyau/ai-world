# ESC 时间控制与玩家模型前置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pause-menu time controls and practical settings while exposing a model-free player avatar anchor and multiplayer-ready player snapshot.

**Architecture:** Atmosphere remains the only time/light owner. HUD dispatches explicit time and settings actions to Game; Game applies settings to Engine/PlayerController and persists them. PlayerAvatar owns a transform-only anchor and serializable descriptor, never a visible mesh.

**Tech Stack:** Babylon.js, TypeScript, Node test runner, Playwright.

## Global Constraints

- Do not add a second light, time clock, player collision mesh, network transport, or server.
- Time controls must work while ESC pauses simulation.
- Settings must be browser-local and safe when old/malformed storage is present.
- Avatar prework must not make a character mesh visible in current first-person play.

---

### Task 1: Time and ESC settings contracts

**Files:**
- Modify: `src/game/world/Atmosphere.ts`, `src/game/world/WorldManager.ts`, `src/game/ui/Hud.ts`, `src/game/Game.ts`
- Test: `tests/esc-avatar-foundation.test.ts`

- [x] Write failing tests that require four named time presets and an immediate Atmosphere state change without advancing delta time.
- [x] Run the targeted test against the missing exports and confirm it fails.
- [x] Implement preset mapping in Atmosphere, WorldManager forwarding, HUD buttons, and Game callbacks.
- [x] Run the targeted test and confirm it passes.

### Task 2: Persistent ESC preferences

**Files:**
- Create: `src/game/ui/PauseSettings.ts`
- Modify: `src/game/ui/Hud.ts`, `src/game/Game.ts`, `src/game/player/PlayerController.ts`, `src/styles.css`
- Test: `tests/esc-avatar-foundation.test.ts`

- [x] Write failing tests for defaults, malformed storage fallback, and valid preference persistence.
- [x] Run the targeted test against the missing module and confirm it fails.
- [x] Implement display quality, fog preference, FOV, sensitivity, HUD hints, and reduced-motion controls with callbacks.
- [x] Run the targeted test and confirm it passes.

### Task 3: Avatar and multiplayer snapshot foundation

**Files:**
- Create: `src/game/player/PlayerAvatar.ts`
- Modify: `src/game/Game.ts`, `src/game/player/PlayerController.ts`
- Test: `tests/esc-avatar-foundation.test.ts`

- [x] Write failing tests for the default stylized explorer descriptor and finite player snapshot fields.
- [x] Run the targeted test against the missing module and confirm it fails.
- [x] Implement TransformNode anchor, update/dispose path, descriptor, and snapshot contract.
- [x] Run the targeted test and confirm it passes.

### Task 4: Browser acceptance

**Files:**
- Create: `tests/browser-esc-avatar-acceptance.py`

- [x] Open ESC through the real game state transition, verify the four time controls and immediate preset action, then validate persisted settings and anchor/snapshot fields. (The headless browser has a nested-overlay pointer hit-test defect for lower controls, so its settings events are dispatched through the same bubbling handlers after DOM visibility is verified.)
- [x] Run the new browser test plus `npm.cmd test` and `npm.cmd run build`.
