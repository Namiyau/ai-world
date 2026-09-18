# 主世界角色视觉风格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes for tracking.

**Goal:** Add three modular stylized low-poly character archetypes and a terrain-attached showcase near the main-world spawn.

**Architecture:** Keep visual character data pure and independent from Babylon. A reusable character builder consumes catalog descriptors and creates modular nodes. A dedicated showcase layer owns only the three displayed characters and its small platform; `WorldManager` attaches/detaches it with the home world lifecycle.

**Tech Stack:** Babylon.js 9, TypeScript, Node test runner, Playwright/Chrome acceptance.

## Global Constraints

- Preserve existing terrain, water, road, POI and first-person collision systems.
- Use low-poly primitives and shared materials; do not add external assets or large textures.
- Do not add NPC AI, combat behavior, economy behavior, quests, networking or multiplayer UI.
- The player avatar remains an invisible transform anchor in current first-person play; the showcase is the only new visible character geometry.
- The showcase exists only in the home world and uses the sampler for its ground height.

### Task 1: Character catalog and tests

**Files:**
- Create: `src/game/player/CharacterCatalog.ts`
- Modify: `src/game/player/PlayerAvatar.ts`
- Test: `tests/character-visuals.test.ts`

**Interfaces:**
- Produces `CharacterRole`, `CharacterModuleSlot`, `CharacterDescriptor`, `CHARACTER_CATALOG`, `characterDescriptor(role)`.
- `PlayerAvatarAppearance.modules` consumes the catalog module IDs so later third-person/network code can share appearance data.

- [x] Write failing tests for the three roles, required modules, deterministic colors and front/side/back notes.
- [x] Run `npm.cmd test -- --test-name-pattern="character catalog"` and confirm it fails because the catalog is absent.
- [x] Implement pure descriptors for player explorer, merchant and wilderness melee enemy.
- [x] Extend the existing player appearance type with the module selections without changing snapshot shape semantics.
- [x] Run the targeted test and confirm it passes.

### Task 2: Reusable modular low-poly builder

**Files:**
- Create: `src/game/player/CharacterVisuals.ts`
- Test: `tests/character-visuals.test.ts`

**Interfaces:**
- `buildCharacterVisual(scene: Scene, descriptor: CharacterDescriptor): CharacterVisualBuild` returns `{ root: TransformNode, moduleNodes: Map<CharacterModuleSlot, TransformNode>, meshCount: number }`.
- Every generated module node name follows `character:<id>:module:<slot>:<variant>`.

- [x] Add a failing NullEngine test that builds all three descriptors and requires finite node transforms, modular node names and a bounded mesh count.
- [x] Run the test and confirm the builder is missing.
- [x] Implement shared cached materials and low-poly primitives for head, hair, torso, legs, boots, arms, headwear, carry item and role prop.
- [x] Keep modules as separate child nodes so future replacement can dispose one slot without rebuilding the character root.
- [x] Run the test and confirm all three builds pass.

### Task 3: Home-world character showcase

**Files:**
- Create: `src/game/world/CharacterShowcaseLayer.ts`
- Modify: `src/game/world/WorldManager.ts`
- Test: `tests/character-visuals.test.ts`

**Interfaces:**
- `CharacterShowcaseLayer.build(x: number, z: number, sampler: TerrainSampler): CharacterShowcaseBuild` creates one root at sampler height and returns the root plus labels/role metadata.
- `dispose()` removes every showcase node and material created by the layer.

- [x] Add a failing deterministic test for showcase placement, role count, terrain-attached height and home-only lifecycle expectation.
- [x] Run it and confirm the new showcase layer is absent.
- [x] Implement a small platform/backboard and place the three roles near the fixed home spawn at `(-190, -730)` with height from `sampler.height` and a dry-ground safety check.
- [x] Instantiate it from `WorldManager.loadWorld` only for `home`, dispose it from `clearWorld`/`dispose`, and expose read-only debug metadata.
- [x] Run targeted and existing world tests.

### Task 4: Visual acceptance and documentation

**Files:**
- Modify: `src/main.ts`, `src/styles.css` only if the showcase guide needs a minimal HUD hint.
- Create: `tests/browser-character-showcase-acceptance.cjs`.
- Modify: `README.md`.

- [x] Expose read-only showcase metadata for dev acceptance and add a browser screenshot from the home spawn area.
- [x] Verify all three role labels and modular parts are in the live scene, with no page errors.
- [x] Run `npm.cmd test` and `npm.cmd run build` after the browser acceptance.
- [x] Document the three front/side/back design descriptions, palettes and module replacement contract.
