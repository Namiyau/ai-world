# 主世界更新 2-A3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic atmosphere, exploration rhythm, environmental sound hooks, distant landmarks, and story scenes without changing terrain, water geometry, or roads.

**Architecture:** A pure macro rhythm field gates already-valid candidates. Atmosphere remains the only lighting owner and publishes a visual state to WaterLayer and an audio-state interface. Landmarks/POIs are created through their existing owner-chunk paths; Details remains instanced.

**Tech Stack:** Babylon.js, TypeScript, Node test runner, Playwright acceptance tests.

## Global Constraints

- Do not alter terrain/water topology or `WATER_CONFIG.level`.
- Keep water mesh horizontal and opaque geometry validation intact.
- Use deterministic seed + world coordinates for all placement and rhythm decisions.
- Create and destroy new meshes only through current owner-chunk disposal paths.
- No audio asset download or automatic playback; publish environment audio cues only.

---

### Task 1: Deterministic exploration rhythm

**Files:**
- Create: `src/game/world/ExplorationRhythm.ts`
- Modify: `src/game/config.ts`, `src/game/world/Details.ts`, `src/game/world/PoiRules.ts`, `src/game/world/Landmarks.ts`
- Test: `tests/world-atmosphere-exploration.test.ts`

- [x] Write a failing test that samples the same macro cells twice, expects equal rhythm signatures, and finds quiet/lush/landmark phases in a 6km scan.
- [x] Run `npm.cmd test -- --test-name-pattern="exploration rhythm"` and verify the test fails because the module is unavailable.
- [x] Implement `rhythmAt(x, z, seed)` returning phase and density multipliers; gate detail/POI/landmark candidate acceptance without bypassing existing terrain validation.
- [x] Run the targeted test and verify it passes.

### Task 2: Atmosphere, water visual hand-off, and audio cues

**Files:**
- Create: `src/game/world/AmbientSoundscape.ts`
- Modify: `src/game/config.ts`, `src/game/world/Atmosphere.ts`, `src/game/world/WaterLayer.ts`, `src/game/world/WorldManager.ts`
- Test: `tests/world-atmosphere-exploration.test.ts`

- [x] Write failing tests for continuous deterministic day state, bounded water wave configuration, and forest/shore/night sound cues.
- [x] Run the targeted tests and verify each fails for its missing interface.
- [x] Implement a single Atmosphere day clock and `visualState`; pass its lighting/reflection values to WaterLayer; add soundscape cue evaluation exposed by WorldManager.
- [x] Run the targeted test and verify it passes without modifying water mesh positions or geometry.

### Task 3: Landmarks and story templates

**Files:**
- Modify: `src/game/world/Landmarks.ts`, `src/game/world/PoiRules.ts`, `src/game/world/PoiLayer.ts`, `src/game/world/WorldManager.ts`
- Test: `tests/world-atmosphere-exploration.test.ts`, `tests/world-poi.test.ts`

- [x] Write failing deterministic scan tests requiring a summit outpost, distant bridge and the crash/hunter/supply story templates.
- [x] Run the targeted tests and verify missing kinds fail.
- [x] Add low-poly builders using shared materials and parent roots; retain terrain, water, road and owner-chunk restrictions.
- [x] Run targeted tests and verify all generated positions and ownership are finite and deterministic.

### Task 4: Browser and full regression validation

**Files:**
- Modify: `tests/browser-environment-acceptance.py`, `tests/browser-poi-acceptance.py`

- [x] Add browser assertions for day state, water visual uniforms, soundscape cue availability, rhythm variety, new landmark/story kinds, and bounded chunk statistics.
- [x] Run `npm.cmd test`, `npm.cmd run build`, `python tests\\browser-environment-acceptance.py`, `python tests\\browser-poi-acceptance.py`, and `python tests\\browser-water-acceptance.py`.
- [x] Review generated screenshots and browser console errors; fix only A3-related defects before reporting completion.
