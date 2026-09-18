import assert from "node:assert/strict";
import { test } from "node:test";
import { rhythmAt } from "../src/game/world/ExplorationRhythm.ts";
import { dayStateAt } from "../src/game/world/Atmosphere.ts";
import { AmbientSoundscape } from "../src/game/world/AmbientSoundscape.ts";
import { WATER_CONFIG } from "../src/game/config.ts";
import { LandmarkLayer } from "../src/game/world/Landmarks.ts";
import { poiPlacementAt } from "../src/game/world/PoiRules.ts";
import { TerrainSampler } from "../src/game/world/TerrainSampler.ts";
import { castsDetailShadow, detailLodDistance } from "../src/game/world/Details.ts";

test("exploration rhythm is deterministic and includes quiet lush and landmark stretches", () => {
  const first = [];
  const second = [];
  const phases = new Set<string>();

  for (let z = -3_200; z <= 3_200; z += 320) {
    for (let x = -3_200; x <= 3_200; x += 320) {
      const a = rhythmAt(x, z, 18_421);
      const b = rhythmAt(x, z, 18_421);
      first.push(a);
      second.push(b);
      phases.add(a.phase);
      assert.ok(a.detailDensity >= 0 && a.detailDensity <= 1);
      assert.ok(a.poiDensity >= 0 && a.poiDensity <= 1);
      assert.ok(a.resourceDensity >= 0 && a.resourceDensity <= 1);
      assert.ok(a.landmarkDensity >= 0 && a.landmarkDensity <= 1);
    }
  }

  assert.deepEqual(first, second);
  assert.deepEqual([...phases].sort(), ["landmark", "lush", "quiet"]);
});

test("day cycle is deterministic, continuous and keeps stylized water waves bounded", () => {
  const dawn = dayStateAt(0);
  const morning = dayStateAt(90);
  const noon = dayStateAt(180);
  const night = dayStateAt(360);
  const nextMoment = dayStateAt(180.05);

  assert.deepEqual(dayStateAt(180), noon);
  assert.ok(noon.daylight > morning.daylight);
  assert.ok(night.daylight < dawn.daylight);
  assert.ok(Math.abs(noon.daylight - nextMoment.daylight) < 0.01);
  assert.ok(noon.sunDirection.y > 0);
  assert.ok(night.sunDirection.y < 0);
  assert.ok(WATER_CONFIG.visual.waveAmplitude >= 0.05 && WATER_CONFIG.visual.waveAmplitude <= 0.12);
  assert.ok(WATER_CONFIG.visual.reflectionStrength >= 0.14 && WATER_CONFIG.visual.reflectionStrength <= 0.28);
});

test("ambient soundscape exposes deterministic forest shore and night cues without audio assets", () => {
  const soundscape = new AmbientSoundscape();
  const forest = soundscape.evaluate({ biome: "forest", waterDepth: 0, daylight: 0.8 });
  const shore = soundscape.evaluate({ biome: "grass", waterDepth: 0.38, daylight: 0.8 });
  const night = soundscape.evaluate({ biome: "grass", waterDepth: 0, daylight: 0.04 });

  assert.ok(forest.forestWind > 0 && forest.birds > 0);
  assert.ok(shore.shoreWater > 0);
  assert.ok(night.nightInsects > 0 && night.birds < forest.birds);
  assert.deepEqual(forest, soundscape.evaluate({ biome: "forest", waterDepth: 0, daylight: 0.8 }));
});

test("exploration scan exposes summit bridge landmarks and environmental story templates", () => {
  const seed = 18_421;
  const sampler = new TerrainSampler(seed);
  const landmarks = new LandmarkLayer({} as never, seed);
  const landmarkKinds = new Set(landmarks.query(0, 0, 8_000, sampler).map((placement) => placement.kind));
  assert.ok(landmarkKinds.has("summitOutpost"));
  assert.ok(landmarkKinds.has("distantBridge"));

  const storyKinds = new Set<string>();
  for (let cellZ = -28; cellZ <= 28; cellZ += 1) {
    for (let cellX = -28; cellX <= 28; cellX += 1) {
      const placement = poiPlacementAt(cellX, cellZ, sampler, seed);
      if (placement) storyKinds.add(placement.kind);
    }
  }
  assert.ok(storyKinds.has("crashSite"));
  assert.ok(storyKinds.has("hunterCamp"));
  assert.ok(storyKinds.has("supplyCache"));
});

test("detail LOD keeps landmark silhouettes farther than tiny ground cover", () => {
  assert.ok(detailLodDistance("treeRound") > detailLodDistance("grass"));
  assert.ok(detailLodDistance("rock") > detailLodDistance("flower"));
  assert.ok(detailLodDistance("reed") >= detailLodDistance("grass"));
});

test("shadow policy includes substantial nature while excluding grass and flowers", () => {
  assert.equal(castsDetailShadow("tree-trunk"), true);
  assert.equal(castsDetailShadow("tree-canopy-pine"), true);
  assert.equal(castsDetailShadow("rock"), true);
  assert.equal(castsDetailShadow("log"), true);
  assert.equal(castsDetailShadow("grass"), false);
  assert.equal(castsDetailShadow("flower-head"), false);
  assert.equal(castsDetailShadow("reed"), false);
});
