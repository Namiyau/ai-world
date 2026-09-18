# Lake Shoreline Ground Intersection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every lake shoreline be the true intersection between the rendered Ground triangles and the horizontal water plane, while rejecting lake candidates whose uncarved shore ring is below the water level.

**Architecture:** TerrainSampler will expose separate lake-basin membership and final-water state. Lake candidates are deterministic per seed/cell and are accepted only after an uncarved base-terrain shore-ring test. Geometry will consume only the lake mask plus final height for eligibility, then clip each Babylon Ground triangle against the water plane; `waterCoverage` remains visual metadata only.

**Tech Stack:** TypeScript, Babylon.js, Node test runner via `tsx`, Playwright browser acceptance, Vite.

## Global Constraints

- Keep `WATER_CONFIG.level` at `0`.
- Do not modify Shader, alpha, zOffset, backFaceCulling, or Water mesh Y/rendering parameters.
- Do not add rivers, POI, tasks, or effects.
- Water geometry must use only real Ground triangle height-plane clipping; `waterCoverage` cannot affect topology.
- Same seed and cell coordinates must produce deterministic lake results.

### Task 1: Lock the corrected water and lake semantics with failing tests

**Files:**
- Modify: `tests/world-geometry.test.ts`
- Modify: `tests/browser-water-acceptance.py`

**Interfaces:**
- Tests will use `lakeMask` and `hasWater` on terrain vertices.
- Shoreline tests will inspect boundary edges of `buildWaterTriangles` and rendered Water meshes.

- [x] **Step 1: Replace coverage-topology tests with height-only clipping tests**

Assert that a triangle with all three valid lake vertices is returned unchanged by the water clip even when its coverage values are zero, and assert no test requires coverage `>= 0.5`.

- [x] **Step 2: Add a deterministic lake shore-ring acceptance test**

Sample every generated lake candidate's 32-point uncarved ring through the sampler's deterministic public/debug helper and assert accepted candidates have `minRimHeight > WATER_CONFIG.level + shoreSafetyMargin`.

- [x] **Step 3: Add a pure Water Boundary / Shoreline test**

Collect edges used once by generated water triangles, ignore chunk perimeter edges, interpolate each edge's start/mid/end height from its source Ground triangle, and require `abs(height - WATER_CONFIG.level) <= 0.03`.

- [x] **Step 4: Update browser acceptance**

Remove `coverageWeight < 0.5` and use source `lakeMask`/`hasWater`. Add rendered boundary-edge collection, Ground-triangle lookup, start/mid/end contact checks, dry-side height checks, and retain deterministic/chunk-local/topology assertions.

- [x] **Step 5: Run the focused tests and confirm RED**

Run `npm test -- --test-name-pattern="water|lake"`. Expected: failures identify the existing coverage clipping and missing shore-ring validation.

### Task 2: Remove waterCoverage from geometry topology

**Files:**
- Modify: `src/game/world/geometry.ts`
- Modify: `src/game/world/TerrainGrid.ts`
- Modify: `src/game/world/WaterLayer.ts`

**Interfaces:**
- `clipTriangleToWater(triangle, waterLevel)` returns only the polygon produced by horizontal height clipping.
- A valid water vertex requires `lakeMask && hasWater && height < waterLevel`.

- [x] **Step 1: Delete coverage clipping helpers**

Delete `LAKE_COVERAGE_THRESHOLD`, `waterCoverageAtPoint`, `clipPolygonToWaterCoverage`, `triangleWaterCoverage`, and `isTriangleInLakeMask`; remove polygon coverage interpolation that exists only for topology.

- [x] **Step 2: Gate only by basin membership and final water state**

Use `lakeMask` and `hasWater` to reject below-water non-lake geometry, then run the existing edge-height interpolation and return the resulting polygon directly.

- [x] **Step 3: Make WaterLayer metadata and browser checks use the new names**

Keep coverage only as visual source data; do not use it to discard or split Water triangles.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run `npm test -- --test-name-pattern="water|lake"`; all height-only clipping and topology tests must pass.

### Task 3: Validate lake candidates as closed basins

**Files:**
- Modify: `src/game/config.ts`
- Modify: `src/game/world/TerrainSampler.ts`
- Modify: `src/game/world/TerrainGrid.ts`

**Interfaces:**
- Add `WATER_CONFIG.lake.shoreSafetyMargin` and `WATER_CONFIG.lake.shoreSamples` with values `0.6` and `32`.
- Terrain samples expose `lakeMask` and `hasWater`; `waterDepth = max(0, WATER_CONFIG.level - height)` when water exists.

- [x] **Step 1: Add deterministic candidate caching and shore-ring validation**

In `lakeAt(gx, gz)`, derive center/radius from the cell-seeded RNG, sample `shoreSamples` points at `radius` using uncarved `baseElevation`, reject the candidate when any ring sample is at or below `level + shoreSafetyMargin`, and cache the result by cell coordinates.

- [x] **Step 2: Split lake mask from water presence**

Return a continuous positive basin depth inside the accepted lake radius, compute `lakeMask` from basin membership, compute `hasWater` solely from final terrain height below the fixed surface, and retain `waterCoverage` only for visual color/foam data.

- [x] **Step 3: Remove the 0.3m hard cutoff**

Return the continuous maximum lake profile unless it is below a tiny floating-point epsilon; never snap a positive profile to zero at `0.3` meters.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run `npm test -- --test-name-pattern="water|lake"`; verify deterministic results and accepted lake rings.

### Task 4: Full verification

**Files:**
- Modify only the files required above.

- [x] **Step 1: Run all TypeScript tests**

Run `npm test` and require zero failures.

- [x] **Step 2: Run the production build**

Run `npm run build` and require exit code `0`.

- [x] **Step 3: Run browser acceptance on a fresh server**

Start Vite on a clean port and run `python tests/browser-water-acceptance.py`. Require no page errors, shoreline contact within `0.03m`, dry-side ground above water within epsilon, chunk-edge continuity, and identical same-seed signatures.

- [x] **Step 4: Confirm scope**

Verify no Shader/render-parameter changes, no river/POI/task/effect work, no coverage topology identifiers, and no stale test server remains.
