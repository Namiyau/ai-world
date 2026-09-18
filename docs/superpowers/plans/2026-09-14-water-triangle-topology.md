# Water Triangle Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lake water geometry consume the exact Babylon ground triangle topology and clip each ground triangle against the horizontal water plane using the shared terrain vertices, eliminating water triangles that extend onto dry land.

**Architecture:** Build one 25×25 `TerrainGrid` per chunk in Babylon's `CreateGround` vertex order. Ground and Water both consume that grid; Water processes the two explicit ground triangles `[b,d,c]` and `[a,b,c]`, clipping only by the three stored terrain heights and lake mask. Water vertices are chunk-local and translated by the chunk center.

**Tech Stack:** TypeScript, Babylon.js 9.26, Node test runner via `tsx`, Playwright browser acceptance.

## Global Constraints

- Pause all unrelated development; do not add rivers, POI, tasks, or effects.
- Delete the old WaterLayer `cornerOrder`, `centerWet`, `diagonalWet`, `interpolateWetEdge`, polygon, and quad triangle-fan path.
- Ground triangles are exactly `Triangle1 = b,d,c` and `Triangle2 = a,b,c`, where `a=minX,minZ`, `b=maxX,minZ`, `c=minX,maxZ`, `d=maxX,maxZ`.
- Water vertices use only `WATER_CONFIG.level` for Y and use local X/Z approximately in `[-32,+32]`.
- Lake membership remains authoritative; low terrain without `isLake` must not become water.
- Debug water alpha is fixed at `1.0`; no minimum-alpha shoreline film.

---

### Task 1: Add failing procedural geometry tests

**Files:**
- Modify: `tests/world-geometry.test.ts`
- Modify: `tests/browser-water-acceptance.py`

**Interfaces:**
- Tests will consume `buildTerrainGrid`, `groundTrianglesForCell`, and `clipTriangleToWater` from `src/game/world/geometry.ts`.
- Browser acceptance will consume a development-only `window.__aiWorldDebug` handle and inspect real Babylon meshes plus their source-triangle metadata.

- [x] **Step 1: Write the failing pure-geometry tests**

Add programmatic tests that construct a known four-vertex grid cell and assert:

```ts
const triangles = groundTrianglesForCell(grid, 0, 0);
assert.deepEqual(triangles.map((triangle) => triangle.map((v) => v.id)), [
  ["b", "d", "c"],
  ["a", "b", "c"],
]);

const clipped = clipTriangleToWater(
  [
    { x: 0, z: 0, height: 1, isLake: true, waterDepth: 0, waterCoverage: 0 },
    { x: 1, z: 0, height: -1, isLake: true, waterDepth: 1, waterCoverage: 1 },
    { x: 0, z: 1, height: -1, isLake: true, waterDepth: 1, waterCoverage: 1 },
  ],
  0,
);
assert.equal(clipped?.length, 4);
for (const point of clipped ?? []) assert.equal(point.y, 0);
```

Also test that a below-water triangle with `isLake=false` returns `null`, that all vertices use the same diagonal, and that clipping is deterministic for the same seed.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test
```

Expected: failure because the shared grid and triangle clipping functions do not exist and the old WaterLayer implementation is still referenced.

- [x] **Step 3: Replace regex-only WaterLayer assertions with structural assertions**

Remove tests that require `cornerOrder`, `centerWet`, `diagonalWet`, or `interpolateWetEdge`. Add assertions that the source no longer contains those identifiers and that the new build signature consumes a `TerrainGrid`.

### Task 2: Implement the shared TerrainGrid and exact ground topology

**Files:**
- Create: `src/game/world/TerrainGrid.ts`
- Modify: `src/game/world/geometry.ts`
- Modify: `src/game/world/WorldManager.ts`

**Interfaces:**
- `buildTerrainGrid(sampler, centerX, centerZ, size): TerrainGrid`
- `groundTrianglesForCell(grid, ix, iz): [TerrainGridTriangle, TerrainGridTriangle]`
- `TerrainGrid` stores `centerX`, `centerZ`, `size`, `subdivisions`, `step`, and 25×25 vertices in Babylon `CreateGround` row order.

- [x] **Step 1: Add `TerrainGrid` types and builder**

Use Babylon's exact vertex order: row 0 is `maxZ`, the last row is `minZ`, and each row increases X. For each vertex store `x`, `z`, `height`, `isLake`, `waterDepth`, `waterCoverage`, `moisture`, `rockiness`, and `onRoad` from one `sampler.sample` call.

- [x] **Step 2: Add exact cell triangle mapping**

For `cells = subdivisions + 1`, define:

```ts
const a = (iz + 1) * cells + ix;
const b = (iz + 1) * cells + ix + 1;
const c = iz * cells + ix;
const d = iz * cells + ix + 1;
return [[grid.vertices[b], grid.vertices[d], grid.vertices[c]], [grid.vertices[a], grid.vertices[b], grid.vertices[c]]];
```

This is the same index order emitted by Babylon `CreateGround`.

- [x] **Step 3: Make WorldManager build one grid per chunk**

In `createChunk`, build the grid before Ground and Water, pass it into `buildGroundMesh` and `water.build`, and remove independent Water sampling from that chunk path. Ground positions and colors must come from the grid while retaining the existing flat-normal expansion.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npm test
```

Expected: the exact-topology and shared-grid tests pass; Water implementation tests remain RED until Task 3.

### Task 3: Replace WaterLayer with per-ground-triangle plane clipping

**Files:**
- Modify: `src/game/world/geometry.ts`
- Rewrite: `src/game/world/WaterLayer.ts`

**Interfaces:**
- `clipTriangleToWater(triangle, waterLevel): WaterPolygonPoint[] | null`
- `WaterLayer.build(grid: TerrainGrid): Mesh | null`

- [x] **Step 1: Add the pure clipping function**

Classify a vertex as inside only when `vertex.isLake && vertex.waterDepth > 0.02 && vertex.height < waterLevel`. For each of the triangle's three directed edges, add inside vertices and, for an inside/outside transition, linearly interpolate `t = (waterLevel - h0) / (h1 - h0)` from the two stored Ground heights. If a mask transition occurs without a height crossing, reject that source triangle instead of inventing a lake boundary.

Return a 3- or 4-point polygon with every point's Y equal to `waterLevel`; carry interpolated coverage for future art use.

- [x] **Step 2: Rewrite WaterLayer around the two explicit triangles**

Delete the old quad sampling and shoreline logic. Iterate every cell from `groundTrianglesForCell`, call `clipTriangleToWater` for each of `[b,d,c]` and `[a,b,c]`, and emit either one triangle or two explicit triangles for a clipped quad. Do not use `cornerOrder`, `centerWet`, `diagonalWet`, `interpolateWetEdge`, or a whole-quad fan.

- [x] **Step 3: Use chunk-local water positions and opaque debug alpha**

Write `point.x - grid.centerX`, `WATER_CONFIG.level`, `point.z - grid.centerZ` to the vertex buffer; set `water.position.x = grid.centerX` and `water.position.z = grid.centerZ`. Use `colors.push(r, g, b, 1.0)` and keep `material.backFaceCulling = true`.

- [x] **Step 4: Add source-triangle metadata for browser validation**

In development builds, store each emitted water triangle's source Ground triangle vertices and chunk center in `water.metadata`. This is only diagnostic data and does not alter rendering.

- [x] **Step 5: Run the pure tests and verify GREEN**

Run:

```powershell
npm test
```

Expected: all topology, clipping, lake-mask, local-coordinate, and determinism tests pass.

### Task 4: Turn browser-water-acceptance into geometry acceptance

**Files:**
- Modify: `tests/browser-water-acceptance.py`
- Modify: `src/main.ts` (development-only debug handle if needed)

**Interfaces:**
- The browser test will assert scene geometry rather than only `pageerror` state.

- [x] **Step 1: Add real mesh assertions**

For every rendered water triangle, use its source Ground triangle metadata and sample the water triangle centroid plus three interior barycentric points. Assert the corresponding linear Ground height is at or below `WATER_CONFIG.level + 1e-5`, every water vertex Y equals the configured level, and every water centroid samples an `isLake` source region.

- [x] **Step 2: Add topology, edge, chunk, and determinism checks**

Assert source triangles are only `[b,d,c]` or `[a,b,c]`, water local X/Z stay within `[-size/2,size/2]` with epsilon, adjacent chunk edge water points agree within `1e-4`, and two pages initialized with the same save/seed produce identical water vertex/index signatures.

- [x] **Step 3: Run browser acceptance against a live Vite server**

Run:

```powershell
npm run dev -- --host 127.0.0.1
python tests/browser-water-acceptance.py
```

Expected: the script prints `page-errors=[]` and all geometry assertions pass for normal, high, near-water, and underground views.

### Task 5: Final verification and cleanup

**Files:**
- Modify only files required by Tasks 1–4.

- [x] **Step 1: Run the full test suite**

```powershell
npm test
```

Expected: all tests pass with zero failures.

- [x] **Step 2: Run the production build**

```powershell
npm run build
```

Expected: TypeScript and Vite build exit 0.

- [x] **Step 3: Remove temporary diagnostics and confirm scope**

Verify no old WaterLayer identifiers remain, no river/POI/task/effect files changed, and the browser server is stopped after acceptance.

- [x] **Step 4: Review requirements against evidence**

Report test counts, build exit status, browser geometry assertion results, and any pre-existing non-page-error warnings separately.
