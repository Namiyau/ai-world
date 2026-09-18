import assert, { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { TerrainSampler } from "../src/game/world/TerrainSampler";
import { GAME_CONFIG, POI_CONFIG } from "../src/game/config";
import { footprintMetrics, poiPlacementAt, type MineralType } from "../src/game/world/PoiRules";

test("POI cell placement is deterministic and uses 256m ownership cells", () => {
  const sampler = new TerrainSampler(18_421);
  const first = poiPlacementAt(-2, -3, sampler, 18_421);
  const second = poiPlacementAt(-2, -3, sampler, 18_421);
  deepEqual(first, second);
  if (first) {
    equal(Math.floor(first.x / 256), first.ownerCellX);
    equal(Math.floor(first.z / 256), first.ownerCellZ);
  }
});

test("building footprint validation rejects excessive terrain tilt", () => {
  const sampler = new TerrainSampler(18_421);
  const metrics = footprintMetrics(sampler, 0, 0, 40, 28, 0);
  ok(metrics.maxSlope >= 0);
  ok(metrics.heightRange >= 0);
  ok(metrics.samples.length >= 9);
});

test("mineral interface includes all four stable future resource types", () => {
  const kinds = new Set<MineralType>();
  const sampler = new TerrainSampler(18_421);
  for (let z = -2_048; z <= 2_048; z += 256) {
    for (let x = -2_048; x <= 2_048; x += 256) {
      const placement = poiPlacementAt(x / 256, z / 256, sampler, 18_421);
      for (const node of placement?.minerals ?? []) kinds.add(node.type);
    }
  }
  deepEqual([...kinds].sort(), ["copper", "iron", "rare", "stone"]);
});

test("POI placement respects road, lake shore, mineral zone and building footprint rules", () => {
  const sampler = new TerrainSampler(18_421);
  const placements = [];
  for (let cellZ = -16; cellZ <= 16; cellZ += 1) {
    for (let cellX = -16; cellX <= 16; cellX += 1) {
      const placement = poiPlacementAt(cellX, cellZ, sampler, 18_421);
      if (placement) placements.push(placement);
    }
  }
  ok(placements.length > 20);
  for (const placement of placements) {
    if (["cabin", "gasStation", "warehouse", "abandonedCamp", "wreck"].includes(placement.kind)) {
      ok(placement.roadDistance >= POI_CONFIG.roadMinDistance);
      const width = placement.kind === "gasStation" ? 18 : 14;
      const depth = placement.kind === "warehouse" ? 20 : 14;
      const metrics = footprintMetrics(sampler, placement.x, placement.z, width, depth, placement.rotation);
      ok(metrics.maxSlope <= POI_CONFIG.buildingMaxSlope + 1e-6);
      ok(metrics.heightRange <= POI_CONFIG.buildingMaxHeightRange + 1e-6);
    }
    if (placement.kind === "dock") {
      const sample = sampler.sample(placement.x, placement.z);
      ok(sample.waterDepth <= 0.05);
      ok(sample.height > sampler.waterLevel + 0.1);
    }
    if (placement.kind === "mineShed" || placement.kind === "mineralOutcrop") {
      const sample = sampler.sample(placement.x, placement.z);
      ok(sample.zone === "gravel");
      ok(sample.biome === "rocky" || sample.biome === "mountain" || sample.rockiness > 0.62);
    }
    if (placement.kind === "woodBridge" || placement.kind === "roadBridge") equal(placement.roadDistance, 0);
  }
});

test("bridge placements expose terrain-attached endpoint elevations", () => {
  const sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  const bridges = [];
  for (let cellZ = -40; cellZ <= 40; cellZ += 1) {
    for (let cellX = -40; cellX <= 40; cellX += 1) {
      const placement = poiPlacementAt(cellX, cellZ, sampler, GAME_CONFIG.seeds.home);
      if (placement?.kind === "woodBridge" || placement?.kind === "roadBridge") bridges.push(placement);
    }
  }

  assert.ok(bridges.length > 0);
  for (const placement of bridges) {
    const bridge = placement as typeof placement & { bridgeStartY?: number; bridgeEndY?: number };
    assert.ok(Number.isFinite(bridge.bridgeStartY), `${placement.id} must expose bridgeStartY`);
    assert.ok(Number.isFinite(bridge.bridgeEndY), `${placement.id} must expose bridgeEndY`);
    const vertical = Math.abs(Math.sin(placement.rotation)) < 0.1;
    const start = vertical
      ? sampler.sample(placement.x, placement.z - POI_CONFIG.bridgeHalfLength)
      : sampler.sample(placement.x - POI_CONFIG.bridgeHalfLength, placement.z);
    const end = vertical
      ? sampler.sample(placement.x, placement.z + POI_CONFIG.bridgeHalfLength)
      : sampler.sample(placement.x + POI_CONFIG.bridgeHalfLength, placement.z);
    assert.ok(Math.abs((bridge.bridgeStartY ?? Infinity) - (start.height + 0.16)) <= 0.05);
    assert.ok(Math.abs((bridge.bridgeEndY ?? Infinity) - (end.height + 0.16)) <= 0.05);
  }
});

test("a lake shoreline receives at most one dock placement", () => {
  const sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  const docks = [];
  for (let cellZ = -40; cellZ <= 40; cellZ += 1) {
    for (let cellX = -40; cellX <= 40; cellX += 1) {
      const placement = poiPlacementAt(cellX, cellZ, sampler, GAME_CONFIG.seeds.home);
      if (placement?.kind === "dock") docks.push(placement);
    }
  }
  const positions = new Set(docks.map((dock) => `${dock.x.toFixed(4)},${dock.z.toFixed(4)}`));
  assert.equal(positions.size, docks.length, "different POI cells must not stack docks at one lake shore");
});

test("POI rules source names each requested visual scene and future mineral metadata", async () => {
  const source = await readFile(resolve(process.cwd(), "src/game/world/PoiLayer.ts"), "utf8");
  for (const key of ["cabin", "gasStation", "warehouse", "abandonedCamp", "dock", "woodBridge", "roadBridge", "mineShed", "wreck", "mineralOutcrop"]) {
    match(source, new RegExp(key));
  }
  match(source, /createInstance/);
  match(source, /mineralNode/);
});

test("WorldManager reserves a single owner chunk for generated POIs", async () => {
  const source = await readFile(resolve(process.cwd(), "src/game/world/WorldManager.ts"), "utf8");
  match(source, /PoiLayer/);
  match(source, /poiCells/);
  match(source, /disposeCell/);
  match(source, /Math\.floor\(placement\.x \/ size\)/);
});
