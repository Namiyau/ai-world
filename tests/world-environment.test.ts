import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chooseDetailKind, type DetailSampleForPlacement } from "../src/game/world/Details.ts";
import { TerrainSampler, type BiomeId, type TerrainZone } from "../src/game/world/TerrainSampler.ts";

const source = async (relativePath: string): Promise<string> =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("same seed gives stable terrain zones", () => {
  const first = new TerrainSampler(18421);
  const second = new TerrainSampler(18421);
  const points = [[-128, -704], [0, 0], [240, -320], [620, 180], [-900, 400]] as const;
  assert.deepEqual(
    points.map(([x, z]) => first.sample(x, z).zone),
    points.map(([x, z]) => second.sample(x, z).zone),
  );
});

test("home terrain exposes five natural visual zones in a deterministic scan", () => {
  const sampler = new TerrainSampler(18421);
  const zones = new Set<TerrainZone>();
  for (let z = -1400; z <= 900; z += 32) {
    for (let x = -1200; x <= 1200; x += 32) zones.add(sampler.sample(x, z).zone);
  }
  assert.deepEqual([...zones].sort(), ["forestFloor", "grassland", "gravel", "mudflat", "shore"]);
});

const placementSample = (
  zone: TerrainZone,
  biome: BiomeId,
  moisture = 0.5,
  height = 4,
): DetailSampleForPlacement => ({
  zone,
  biome,
  moisture,
  height,
  waterDepth: 0,
  roadDistance: 20,
  roadInfluence: 0,
});

test("detail policy favors wetland reeds and rejects deep water", () => {
  assert.equal(chooseDetailKind({ ...placementSample("shore", "grass"), waterDepth: 0.5 }, 0.1, 0.1), "reed");
  assert.equal(chooseDetailKind({ ...placementSample("shore", "grass"), waterDepth: 2 }, 0.1, 0.1), null);
});

test("detail policy separates forest, grassland and gravel roles", () => {
  assert.equal(chooseDetailKind(placementSample("forestFloor", "forest", 0.8, 7), 0.1, 0.02), "treeRound");
  assert.equal(chooseDetailKind(placementSample("gravel", "rocky", 0.2, 18), 0.2, 0.02), "rock");
  assert.equal(chooseDetailKind(placementSample("grassland", "grass", 0.35, 5), 0.1, 0.7), "flower");
  assert.equal(chooseDetailKind(placementSample("forestFloor", "forest"), 0.8, 0.02), null);
});

test("detail layer has shared low-poly masters for every requested natural prop", async () => {
  const details = await source("src/game/world/Details.ts");
  for (const key of ["tree-canopy-round", "tree-canopy-pine", "tree-canopy-birch", "grass", "flower-head", "reed", "log", "rock", "pebble"]) {
    assert.match(details, new RegExp(key));
  }
  assert.match(details, /createInstance/);
  assert.match(details, /chooseDetailKind/);
});
