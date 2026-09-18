# Update 2-A1 Stylized Water and Natural Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变已稳定地形、水体拓扑、道路和无限 Chunk 核心的前提下，为湖面增加轻微 stylized water 质感，并扩展至少五类地表区域与多种实例化低模自然细节。

**Architecture:** WaterLayer 继续使用现有 Ground-triangle clipping；为裁剪点添加只用于视觉的 waterDepth，Shader 以 world-space 时间波纹、深度调色、Fresnel 和天空色反射增强固定水平湖面。TerrainSampler 增加只读派生 TerrainZone；Ground 顶点色和 DetailLayer 都消费该 zone，DetailLayer 使用 chunk-seeded `createInstance` 与纯规则选择器生成环境细节。

**Tech Stack:** TypeScript 7, Babylon.js Core 9.26, Vite 8, Node `node:test` via `tsx`, Playwright browser acceptance.

## Global Constraints

- 不改变 `TerrainSampler` 的高度、湖泊合法性、道路几何或 chunk 坐标算法。
- 不改变 `buildWaterTriangles` 的 Ground triangle 对角线与岸线拓扑。
- 水面保持不透明、`backFaceCulling = true`、最终 alpha 为 `1.0`；不重新引入透明排序、zOffset 或岸边透明薄膜。
- Shader 波纹振幅为 0.03～0.05m，按水深在岸线平滑衰减到零。
- 所有新自然细节必须是 seed + chunk 坐标确定的 Babylon instances；不加载外部资源。
- 禁止河流、POI、任务、商店、建筑和非本需求的世界生成重构。
- 每个任务先写失败测试，再写最小实现，再运行对应测试。

## Files and responsibilities

- Modify `src/game/world/geometry.ts`: keep Ground clipping topology; carry interpolated visual water depth.
- Modify `src/game/world/WaterLayer.ts`: add animated stylized-water uniforms, attributes and shader calculations.
- Modify `src/game/world/TerrainSampler.ts`: add `TerrainZone`, derive it from existing sample data, and use it for stable palette selection.
- Modify `src/game/world/TerrainGrid.ts`: copy `zone` into shared chunk vertices.
- Modify `src/game/world/WorldManager.ts`: pass zone to Ground color generation; do not change chunk ownership.
- Modify `src/game/config.ts`: add bounded water visual constants and detail budgets/densities.
- Modify `src/game/world/Details.ts`: add pure zone-aware placement policy and low-poly instance masters.
- Modify `tests/world-geometry.test.ts`: water depth and shader contracts.
- Create `tests/world-environment.test.ts`: deterministic zones, zone coverage, placement rules, and detail budgets.
- Create `tests/browser-environment-acceptance.py`: browser screenshots, console checks, rendered mesh/instance signatures, and water visual contracts.
- Modify `README.md`: document Update 2-A1 natural zones, detail types, and stylized water without claiming rivers.

### Task 1: Lock the water-depth and stylized-shader contracts

**Files:**
- Modify: `tests/world-geometry.test.ts`
- Modify: `src/game/world/geometry.ts` only after RED is observed

**Interfaces:**
- `WaterPolygonPoint.waterDepth: number` is non-negative and interpolated from the source Ground triangle.
- `buildWaterTriangles` keeps the same triangle count/topology for the same grid.

- [ ] **Step 1: Write failing tests**

Add these tests to `tests/world-geometry.test.ts`:

```ts
test("water clipping carries zero depth at the real shoreline and positive depth inside", () => {
  const triangle: TerrainGridVertex[] = [
    { x: 0, z: 0, height: 1, lakeMask: true, hasWater: false, waterDepth: 0, waterCoverage: 0, waterColor: [0, 0, 0], moisture: 0, rockiness: 0, onRoad: false },
    { x: 1, z: 0, height: -2, lakeMask: true, hasWater: true, waterDepth: 2, waterCoverage: 1, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
    { x: 0, z: 1, height: -4, lakeMask: true, hasWater: true, waterDepth: 4, waterCoverage: 1, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
  ];
  const clipped = clipTriangleToWater({ vertices: triangle, indices: [0, 1, 2], diagonal: "abc" }, 0);
  assert.ok(clipped);
  assert.equal(clipped?.[0].waterDepth, 0);
  assert.ok((clipped?.[1].waterDepth ?? 0) > 0);
  assert.ok((clipped?.[2].waterDepth ?? 0) > 0);
});

test("stylized water shader keeps opaque output and defines wave, depth, fresnel and reflection inputs", async () => {
  const water = await source("src/game/world/WaterLayer.ts");
  assert.match(water, /uTime/);
  assert.match(water, /uCameraPosition/);
  assert.match(water, /waterDepth|vWaterDepth/);
  assert.match(water, /Fresnel|fresnel/i);
  assert.match(water, /reflection|uSky/i);
  assert.match(water, /gl_FragColor\s*=\s*vec4\([^;]*,\s*1\.0\s*\)/);
  assert.match(water, /material\.backFaceCulling\s*=\s*true/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --test-name-pattern="water clipping carries|stylized water shader"`

Expected: the depth assertion fails because `WaterPolygonPoint` has no `waterDepth`, and the shader contract fails because the current shader has no time/depth/Fresnel/reflection path.

- [ ] **Step 3: Implement minimal depth propagation**

In `src/game/world/geometry.ts`:

```ts
export interface WaterPolygonPoint {
  x: number;
  y: number;
  z: number;
  waterDepth: number;
  waterColor: [number, number, number];
}
```

Set water-vertex depth to `Math.max(0, waterLevel - vertex.height)`. In `interpolateWaterPoint`, interpolate the two source depths using the same clamped `t`; because the edge intersects the water plane, its value must be zero within epsilon. Keep all lake-mask and Ground-triangle decisions unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --test-name-pattern="water clipping carries"`.

Expected: the new depth test and all existing geometry tests pass.

### Task 2: Implement the opaque stylized water shader

**Files:**
- Modify: `src/game/world/WaterLayer.ts`
- Modify: `src/game/config.ts`

**Interfaces:**
- `WaterLayer.update(deltaSeconds, cameraY, cameraPosition?)` updates `uTime`, `uCameraY`, and `uCameraPosition`.
- `WaterLayer.build` writes one `waterDepth` float attribute per vertex and leaves CPU position Y at `WATER_CONFIG.level`.

- [ ] **Step 1: Add failing implementation-level checks**

Extend the shader source test from Task 1 to assert:

```ts
assert.match(water, /attributes:\s*\[[^\]]*waterDepth/);
assert.match(water, /setFloat\("uTime"/);
assert.match(water, /setVector3\("uCameraPosition"/);
assert.match(water, /smoothstep\(0\.0,\s*1\.2,\s*vWaterDepth\)/);
```

Run the focused test and confirm it fails against the current source.

- [ ] **Step 2: Add bounded visual configuration**

Add to `WATER_CONFIG`:

```ts
visual: {
  waveAmplitude: 0.04,
  waveFrequency: [0.035, 0.022] as [number, number],
  waveSpeed: [0.42, 0.27] as [number, number],
  shoreFadeDepth: 1.2,
  reflectionStrength: 0.12,
} as const,
```

- [ ] **Step 3: Implement the shader without moving shoreline CPU geometry**

Add uniforms `uTime`, `uCameraPosition`, `uSkyReflectionColor`, and `uReflectionStrength`; add `attribute float waterDepth`, `varying float vWaterDepth`, and `varying vec3 vWorldPosition`.

In the vertex shader, calculate two low-frequency waves from world X/Z and `uTime`. Offset only the rendered world Y by `waveAmplitude * smoothstep(0.0, shoreFadeDepth, waterDepth)`. Keep CPU positions at the fixed water level. Pass world position and depth to the fragment shader.

In the fragment shader:

```glsl
float depthT = smoothstep(0.0, 4.2, vWaterDepth);
float edge = 1.0 - clamp(dot(normalize(uCameraPosition - vWorldPosition), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
float fresnel = pow(edge, 3.0);
color += vec3(0.012, 0.026, 0.03) * depthT;
color = mix(color, uSkyReflectionColor, fresnel * uReflectionStrength);
color += vec3(0.008) * sin(vWorldPosition.x * 0.12 + vWorldPosition.z * 0.07 + uTime * 0.45);
gl_FragColor = vec4(mix(uFogColor, color, fog), 1.0);
```

Use the existing `waterColor` as the shallow/deep base; do not use alpha as depth. Set `uTime` from accumulated seconds and set the camera position when available. Preserve `backFaceCulling`, alpha disable, fog, and underwater tint.

- [ ] **Step 4: Wire depth attributes and update callers**

In `WaterLayer.build`, push `point.waterDepth` into a `waterDepths` array and call `setVerticesData("waterDepth", new Float32Array(waterDepths), false, 1)`. In `WorldManager.updateVisuals`, pass `this.camera.position` to `water.update`.

- [ ] **Step 5: Run focused tests and build**

Run: `npm test -- --test-name-pattern="water"` and `npm run build`.

Expected: all water geometry/shader tests pass; build exits 0.

### Task 3: Add deterministic terrain zones and five visual ground palettes

**Files:**
- Modify: `src/game/world/TerrainSampler.ts`
- Modify: `src/game/world/TerrainGrid.ts`
- Modify: `src/game/world/WorldManager.ts`
- Modify: `tests/world-geometry.test.ts`
- Create: `tests/world-environment.test.ts`

**Interfaces:**
- `export type TerrainZone = "grassland" | "forestFloor" | "mudflat" | "gravel" | "shore"`.
- `TerrainSample.zone` and `TerrainGridVertex.zone` are deterministic derived fields.
- `TerrainColorContext.zone` is consumed only by `surfaceColor`.

- [ ] **Step 1: Write failing zone tests**

Create `tests/world-environment.test.ts` with:

```ts
test("same seed gives stable terrain zones", () => {
  const a = new TerrainSampler(18421);
  const b = new TerrainSampler(18421);
  const points = [[-128, -704], [0, 0], [240, -320], [620, 180], [-900, 400]] as const;
  assert.deepEqual(points.map(([x, z]) => a.sample(x, z).zone), points.map(([x, z]) => b.sample(x, z).zone));
});

test("home terrain exposes five natural visual zones in a deterministic scan", () => {
  const sampler = new TerrainSampler(18421);
  const zones = new Set<string>();
  for (let z = -1400; z <= 900; z += 32) {
    for (let x = -1200; x <= 1200; x += 32) zones.add(sampler.sample(x, z).zone);
  }
  assert.deepEqual([...zones].sort(), ["forestFloor", "grassland", "gravel", "mudflat", "shore"]);
});
```

Update `TerrainColorContext` test fixtures in `tests/world-geometry.test.ts` with `zone: "grassland"` where needed.

- [ ] **Step 2: Run zone tests and verify RED**

Run: `npm test -- --test-name-pattern="terrain zones|natural visual zones"`.

Expected: TypeScript/runtime failure because `zone` is not defined on samples.

- [ ] **Step 3: Add the zone type and derivation**

Add `TerrainZone` and `zone` to `TerrainSample`, `TerrainColorContext`, and `TerrainGridVertex`. Derive with this precedence:

```ts
if (onRoad) return "gravel";
if (waterDepth > 0.05 || height < waterSurface + 0.85) return "shore";
if ((biome === "rocky" || biome === "mountain") || rockiness > 0.62) return "gravel";
if (height < waterSurface + 2.2 && moisture > 0.48) return "mudflat";
if (biome === "forest" && moisture > 0.5) return "forestFloor";
return "grassland";
```

Keep `surfaceFor` unchanged for movement semantics. Add `zone` to `sample`, `colorContext`, and `buildTerrainGrid`.

- [ ] **Step 4: Update Ground palette and verify color contracts**

In `surfaceColor`, blend a zone palette into the existing palette:

```ts
const zonePalette: Record<TerrainZone, [number, number, number]> = {
  grassland: [0.52, 0.69, 0.38],
  forestFloor: [0.28, 0.39, 0.27],
  mudflat: [0.42, 0.36, 0.28],
  gravel: [0.48, 0.47, 0.43],
  shore: [0.49, 0.61, 0.42],
};
const zoneMix = ctx.zone === "grassland" ? 0.35 : 0.62;
r = lerpValue(r, zonePalette[ctx.zone][0], zoneMix);
g = lerpValue(g, zonePalette[ctx.zone][1], zoneMix);
b = lerpValue(b, zonePalette[ctx.zone][2], zoneMix);
```

Update WorldManager’s `surfaceColor` context with `vertex.zone`. Add a test that these five zone palette keys are present in the source and that the scan exposes all five zones.

- [ ] **Step 5: Run focused tests and build**

Run: `npm test -- --test-name-pattern="zone|natural visual"` and `npm run build`.

Expected: all zone tests pass and build exits 0.

### Task 4: Add pure zone-aware natural detail selection rules

**Files:**
- Modify: `src/game/config.ts`
- Modify: `src/game/world/Details.ts`
- Create: `tests/world-environment.test.ts`

**Interfaces:**
- `export type DetailKind = "treeRound" | "treePine" | "treeBirch" | "bush" | "grass" | "flower" | "reed" | "log" | "rock" | "pebble"`.
- `export function chooseDetailKind(sample: DetailSampleForPlacement, slope: number, roll: number): DetailKind | null` is deterministic and has no Babylon dependency.

- [ ] **Step 1: Write failing policy tests**

Add a helper fixture and tests:

```ts
const sample = (zone: TerrainZone, biome: BiomeId, moisture = 0.5, height = 4): DetailSampleForPlacement => ({
  zone, biome, moisture, height, waterDepth: 0, roadDistance: 20, roadInfluence: 0,
});

test("detail policy favors wetland reeds and rejects deep water", () => {
  assert.equal(chooseDetailKind({ ...sample("shore", "grass"), waterDepth: 0.5 }, 0.1, 0.1), "reed");
  assert.equal(chooseDetailKind({ ...sample("shore", "grass"), waterDepth: 2 }, 0.1, 0.1), null);
});

test("detail policy separates forest, grassland and gravel roles", () => {
  assert.equal(chooseDetailKind(sample("forestFloor", "forest", 0.8, 7), 0.1, 0.02), "treeRound");
  assert.equal(chooseDetailKind(sample("gravel", "rocky", 0.2, 18), 0.2, 0.02), "rock");
  assert.equal(chooseDetailKind(sample("grassland", "grass", 0.35, 5), 0.1, 0.7), "flower");
  assert.equal(chooseDetailKind(sample("forestFloor", "forest"), 0.8, 0.02), null);
});
```

- [ ] **Step 2: Run policy tests and verify RED**

Run: `npm test -- --test-name-pattern="detail policy"`.

Expected: import/type failures because `DetailKind`, `DetailSampleForPlacement`, and `chooseDetailKind` do not exist.

- [ ] **Step 3: Add bounded detail configuration and policy**

Replace the single tree/bush density assumptions with explicit bounded values in `DETAIL_CONFIG` while keeping `candidatesPerChunk` at or below `72`. Define the exported placement input from `TerrainSample` fields and implement rules in priority order:

1. deep water, roads, or road clearance => `null`;
2. shallow `waterDepth <= 1.2` and `shore`/`mudflat` => reed/grass/flower by roll;
3. `gravel` or slope `>= 0.55` => rock/pebble only;
4. `forestFloor` with moisture `>= 0.5`, height below `24`, slope `< 0.42` => round/pine/birch tree, then bush/grass/log;
5. `grassland` => grass/flower/bush and low-probability tree below height `18` and slope `< 0.35`;
6. `mudflat` => grass/flower/reed only with low density.

Use `roll` thresholds from named config values; do not call `Math.random`.

- [ ] **Step 4: Run policy tests and build**

Run: `npm test -- --test-name-pattern="detail policy"` and `npm run build`.

Expected: policy tests pass and build exits 0.

### Task 5: Implement low-poly instance masters and chunk placement

**Files:**
- Modify: `src/game/world/Details.ts`
- Modify: `tests/world-environment.test.ts`

**Interfaces:**
- `DetailLayer.build` remains the existing chunk lifecycle entry point.
- `DetailLayer.instanceCount` remains the performance counter.

- [ ] **Step 1: Add failing master/source contracts**

Add source assertions:

```ts
const details = await source("src/game/world/Details.ts");
for (const key of ["tree-canopy-round", "tree-canopy-pine", "tree-canopy-birch", "grass", "flower-head", "reed", "log", "rock", "pebble"]) {
  assert.match(details, new RegExp(key));
}
assert.match(details, /createInstance/);
assert.match(details, /chooseDetailKind/);
```

Run the test and verify it fails for the missing keys.

- [ ] **Step 2: Add master meshes and material palette**

Extend `Details.ts` masters with:

- shared tapered cylinder trunk;
- round polyhedron canopy, five-sided cone canopy, and lighter birch canopy;
- polyhedron bush;
- three-blade grass cluster using small tapered cylinders;
- flower stem plus low-poly head;
- reed cluster using three tapered cylinders;
- horizontal six-sided log with bark material;
- boulder and smaller pebble polyhedra.

All masters must be disabled, non-pickable, collision-free, and cached by key. Use close low-saturation colors consistent with current low-poly palette.

- [ ] **Step 3: Route chunk candidates through the pure policy**

In `build`, keep the existing chunk-seeded RNG, clear-zone filtering, terrain sample and slope finite difference. Call `chooseDetailKind(sample, slope, rng())`; if it returns a kind, record the position and call `place`. Keep `waterDepth`, road clearance, spacing and clear-zone checks before placement.

- [ ] **Step 4: Implement composite placement with deterministic variation**

`place` may append multiple instances for one logical candidate:

- tree kinds append trunk + matching canopy;
- grass appends three offset blades;
- flower appends stem + head;
- reed appends three offset stalks;
- log appends one tilted instance;
- rock/pebble/bush append one instance.

Use only the passed chunk RNG for scale, rotation and offsets. Keep the logical placement count separate from `instanceCount` so performance assertions can distinguish candidates from render instances.

- [ ] **Step 5: Run full TypeScript tests and build**

Run: `npm test` and `npm run build`.

Expected: all existing Update 1.1 tests plus new environment tests pass; build exits 0.

### Task 6: Add browser visual and determinism acceptance

**Files:**
- Create: `tests/browser-environment-acceptance.py`
- Modify: `README.md`

**Interfaces:**
- Browser test reads the existing `window.__aiWorldDebug` handle in dev mode.
- Browser test uses the existing fresh localStorage seed setup and does not alter production state.

- [ ] **Step 1: Write the browser acceptance script**

The script must:

1. launch headless Chrome and set a known home save;
2. wait for `networkidle` and initial chunk generation;
3. assert no unexpected console/page errors;
4. inspect `debug.scene.meshes` for water meshes and detail instances;
5. sample `debug.world.sampleSurface` at the current and several deterministic positions and assert `zone` exists;
6. capture normal, lake-near and flight screenshots;
7. record a signature containing sorted zone samples, water mesh names, and detail instance count;
8. reload with the same save and assert the same signature.

Use the existing `browser-water-acceptance.py` geometry assertions as a prerequisite by invoking that script separately in final verification; this new script focuses on visual/material and environment behavior.

- [ ] **Step 2: Update README**

Document the five zones, the added low-poly detail types, stylized-water behavior, and the fact that all details are deterministic instances. Replace stale “卡在河里” wording with lake/terrain wording where encountered; do not add river claims.

- [ ] **Step 3: Run browser acceptance**

Run: `python -u tests/browser-environment-acceptance.py` with Vite at `http://127.0.0.1:5173`.

Expected: no page errors, water/detail meshes found, signatures identical across reload, screenshots written for review.

### Task 7: Final regression and scope audit

**Files:**
- No additional production files unless a preceding test exposes a defect.

- [ ] **Step 1: Run all TypeScript tests**

Run: `npm test`.

Expected: zero failures.

- [ ] **Step 2: Run production build**

Run: `npm run build`.

Expected: TypeScript and Vite both exit 0. The existing bundle-size warning is acceptable and must be reported if unchanged.

- [ ] **Step 3: Run browser checks**

Run: `python -u tests/browser-water-acceptance.py`, `python -u tests/browser-environment-acceptance.py`, and the existing normal browser acceptance script against a fresh Vite server.

Expected: no unexpected errors; water topology/shoreline checks remain green; environment signature is deterministic.

- [ ] **Step 4: Audit scope and report**

Search for new river/POI/task/building changes and confirm none were added. Confirm CPU Water positions remain at `WATER_CONFIG.level`, `backFaceCulling` remains true, alpha output remains 1, and all new detail geometry is instance-based. Report any browser-only limitation or performance issue explicitly.
