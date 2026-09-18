import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SAVE_KEY = "economy-world-save-v1"
BROWSER_URL = os.environ.get("AI_WORLD_BROWSER_URL", "http://127.0.0.1:5173")


save = {
    "version": 1,
    "money": 120,
    "inventory": {"wood": 0, "stone": 0, "scrap": 0, "relic": 0},
    "collectedResourceIds": [],
    "positions": {
        "home": {"x": -128, "y": 4, "z": -704},
        "mission": {"x": 0, "y": 3, "z": -9},
    },
}


ENVIRONMENT_ASSERTION = """
() => {
  const debug = window.__aiWorldDebug;
  if (!debug) throw new Error("World debug handle is unavailable in development build.");
  const world = debug.world;
  if (!world?.sampler || !world?.details || !world?.atmosphere) throw new Error("World environment systems are unavailable.");

  const samplePoints = [];
  for (let z = -1200; z <= 1200; z += 32) {
    for (let x = -1200; x <= 1200; x += 32) samplePoints.push([x, z]);
  }
  const zones = [...new Set(samplePoints.map(([x, z]) => world.sampler.sample(x, z).zone))].sort();
  const expectedZones = ["forestFloor", "grassland", "gravel", "mudflat", "shore"];
  for (const zone of expectedZones) {
    if (!zones.includes(zone)) throw new Error(`Missing generated terrain zone ${zone}; got ${zones.join(",")}`);
  }
  const surfaceSamples = [[-128, -704], [0, 0], [240, -320], [620, 180], [-900, 400]]
    .map(([x, z]) => ({ x, z, zone: world.sampleSurface(x, z).zone }));
  if (surfaceSamples.some((sample) => !sample.zone)) throw new Error("sampleSurface did not expose a terrain zone");

  const masters = [...world.details.masters.keys()].sort();
  const expectedMasters = [
    "tree-canopy-round", "tree-canopy-pine", "tree-canopy-birch",
    "grass", "flower-head", "reed", "log", "rock", "pebble",
  ];
  for (const key of expectedMasters) {
    if (!masters.includes(key)) throw new Error(`Missing low-poly detail master ${key}`);
  }

  const detailMeshes = debug.scene.meshes
    .filter((mesh) => mesh.name.includes("-i-"))
    .map((mesh) => ({ name: mesh.name, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (detailMeshes.length < 20 || world.stats.instances < 20) {
    throw new Error(`Expected instanced natural details, got ${detailMeshes.length} visible instances`);
  }
  if (world.stats.chunks > 49 || world.stats.instances > 5000) {
    throw new Error(`Chunk/instance budget exceeded: ${JSON.stringify(world.stats)}`);
  }
  if (!(world.details.visibleInstanceCount > 0 && world.details.visibleInstanceCount < world.stats.instances)) {
    throw new Error(`Detail LOD did not cull distant instances: visible=${world.details.visibleInstanceCount}, total=${world.stats.instances}`);
  }

  const rhythmPhases = new Set();
  for (let z = -3200; z <= 3200; z += 320) {
    for (let x = -3200; x <= 3200; x += 320) rhythmPhases.add(world.explorationRhythmAt(x, z).phase);
  }
  for (const phase of ["quiet", "lush", "landmark"]) {
    if (!rhythmPhases.has(phase)) throw new Error(`Missing exploration rhythm phase ${phase}`);
  }
  const visual = world.atmosphere.visualState;
  if (!visual || !Number.isFinite(visual.daylight) || !Number.isFinite(visual.fogDensity) || !visual.skyReflectionColor) {
    throw new Error("Atmosphere did not publish a valid day visual state");
  }
  const audio = world.ambientAudio;
  for (const key of ["forestWind", "birds", "shoreWater", "nightInsects"]) {
    if (!Number.isFinite(audio?.[key])) throw new Error(`Ambient soundscape cue missing: ${key}`);
  }
  const landmarkKinds = new Set(world.landmarks.query(0, 0, 8000, world.sampler).map((placement) => placement.kind));
  for (const kind of ["summitOutpost", "distantBridge"]) {
    if (!landmarkKinds.has(kind)) throw new Error(`Missing distant exploration landmark ${kind}`);
  }

  const waterMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("water-"));
  if (waterMeshes.length === 0) throw new Error("No lake water mesh was generated.");
  for (const water of waterMeshes) {
    const material = water.material;
    if (!material || material.backFaceCulling !== true) throw new Error(`${water.name}: water must cull back faces`);
    if (material.alpha < 0.9) throw new Error(`${water.name}: debug water must remain opaque`);
  }

  const waterSignature = waterMeshes.map((water) => ({
    name: water.name,
    x: water.position.x,
    z: water.position.z,
    triangles: water.metadata?.triangles?.length ?? 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    zones,
    surfaceSamples,
    masters,
    detailCount: detailMeshes.length,
    stats: world.stats,
    waterMeshes: waterMeshes.length,
    waterSignature,
    detailSignature: detailMeshes,
    visibleDetailCount: world.details.visibleInstanceCount,
    rhythmPhases: [...rhythmPhases].sort(),
    atmosphere: { daylight: visual.daylight, fogDensity: visual.fogDensity, isNight: visual.isNight },
    ambientAudio: audio,
    landmarkKinds: [...landmarkKinds].sort(),
  };
}
"""


def snapshot(page):
    return page.evaluate(ENVIRONMENT_ASSERTION)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.add_init_script("window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(save)))
    page.goto(BROWSER_URL, wait_until="networkidle")
    page.wait_for_timeout(2500)

    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(250)

    first = snapshot(page)
    page.screenshot(path=str(ROOT / "browser-environment-normal.png"), full_page=True)

    page.evaluate("window.__aiWorldDebug.teleportToLake()")
    page.wait_for_timeout(1800)
    page.screenshot(path=str(ROOT / "browser-environment-lake.png"), full_page=True)

    canvas = page.locator("#game-canvas")
    canvas.click(position={"x": 720, "y": 450})
    page.keyboard.press("Space")
    page.wait_for_timeout(80)
    page.keyboard.press("Space")
    page.wait_for_timeout(300)
    page.keyboard.down("Space")
    page.wait_for_timeout(700)
    page.keyboard.up("Space")
    page.screenshot(path=str(ROOT / "browser-environment-flight.png"), full_page=True)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2500)
    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(350)
    second = snapshot(page)

    assert first["zones"] == second["zones"]
    assert first["waterSignature"] == second["waterSignature"], "same seed must keep water chunk layout stable"
    assert first["detailSignature"] == second["detailSignature"], "same seed must keep detail placement stable"
    assert not page_errors, page_errors
    print(
        f"zones={first['zones']} masters={len(first['masters'])} "
        f"detail-instances={first['detailCount']}/{first['visibleDetailCount']} water-meshes={first['waterMeshes']} "
        f"rhythm={first['rhythmPhases']} landmarks={first['landmarkKinds']} "
        f"day={first['atmosphere']} deterministic=yes"
    )
    browser.close()
