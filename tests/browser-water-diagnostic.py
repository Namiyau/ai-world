import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SAVE_KEY = "economy-world-save-v1"
SAVE = {
    "version": 1,
    "money": 120,
    "inventory": {"wood": 0, "stone": 0, "scrap": 0, "relic": 0},
    "collectedResourceIds": [],
    "positions": {
        "home": {"x": 212, "y": 4, "z": -1212},
        "mission": {"x": 0, "y": 3, "z": -9},
    },
}


INSPECT = """
() => {
  const debug = window.__aiWorldDebug;
  if (!debug) throw new Error("debug handle unavailable");
  const waterMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("water-"));
  const groundMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("ground-"));
  const groundFaces = new Set();
  for (const ground of groundMeshes) {
    const positions = ground.getVerticesData("position") ?? [];
    const indices = ground.getIndices() ?? [];
    for (let i = 0; i < indices.length; i += 3) {
      const face = [0, 1, 2].map((offset) => {
        const vertex = indices[i + offset] * 3;
        return `${(ground.position.x + positions[vertex]).toFixed(5)},${(ground.position.z + positions[vertex + 2]).toFixed(5)}`;
      }).sort().join("|");
      groundFaces.add(face);
    }
  }
  const bounds = (mesh) => {
    const positions = mesh.getVerticesData("position") ?? [];
    const world = [];
    for (let i = 0; i < positions.length; i += 3) {
      world.push({
        x: mesh.position.x + positions[i],
        y: mesh.position.y + positions[i + 1],
        z: mesh.position.z + positions[i + 2],
      });
    }
    const range = (field) => world.length ? {
      min: Math.min(...world.map((point) => point[field])),
      max: Math.max(...world.map((point) => point[field])),
    } : null;
    return { position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, x: range("x"), y: range("y"), z: range("z"), vertexCount: world.length };
  };

  const sourceHeight = (point, source) => {
    const [a, b, c] = source;
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const w0 = ((b.x - point.x) * (c.z - point.z) - (b.z - point.z) * (c.x - point.x)) / area;
    const w1 = ((c.x - point.x) * (a.z - point.z) - (c.z - point.z) * (a.x - point.x)) / area;
    const w2 = 1 - w0 - w1;
    return { height: w0 * a.height + w1 * b.height + w2 * c.height, weights: [w0, w1, w2] };
  };

  let waterTriangles = 0;
  let maxWaterEdge = 0;
  let maxWaterArea = 0;
  let maxGroundAtWater = -Infinity;
  let maxGroundRecord = null;
  let minWaterCoverageAtWater = Infinity;
  let minWaterCoverageRecord = null;
  let sourceMismatch = 0;
  let missingGroundFaces = 0;
  for (const water of waterMeshes) {
    const positions = water.getVerticesData("position") ?? [];
    const indices = water.getIndices() ?? [];
    const triangles = water.metadata?.triangles ?? [];
    for (let i = 0; i < indices.length; i += 3) {
      const metadata = triangles[i / 3];
      const source = metadata.source.vertices;
      const points = [0, 1, 2].map((offset) => {
        const vertex = indices[i + offset] * 3;
        return { x: water.position.x + positions[vertex], y: water.position.y + positions[vertex + 1], z: water.position.z + positions[vertex + 2] };
      });
      const edgeLength = (first, second) => Math.hypot(first.x - second.x, first.z - second.z);
      maxWaterEdge = Math.max(maxWaterEdge, edgeLength(points[0], points[1]), edgeLength(points[1], points[2]), edgeLength(points[2], points[0]));
      maxWaterArea = Math.max(maxWaterArea, Math.abs((points[1].x - points[0].x) * (points[2].z - points[0].z) - (points[1].z - points[0].z) * (points[2].x - points[0].x)) / 2);
      const samples = [
        { x: (points[0].x + points[1].x + points[2].x) / 3, z: (points[0].z + points[1].z + points[2].z) / 3 },
        { x: points[0].x * 0.6 + points[1].x * 0.2 + points[2].x * 0.2, z: points[0].z * 0.6 + points[1].z * 0.2 + points[2].z * 0.2 },
        { x: points[0].x * 0.2 + points[1].x * 0.6 + points[2].x * 0.2, z: points[0].z * 0.2 + points[1].z * 0.6 + points[2].z * 0.2 },
      ];
      for (const sample of samples) {
        const sampled = sourceHeight(sample, source).height;
        if (sampled > maxGroundAtWater) {
          maxGroundAtWater = sampled;
          maxGroundRecord = { sampled, sample, sourceDiagonal: metadata.source.diagonal, source, points, metadataPoints: metadata.points };
        }
      }
      for (let row = 1; row <= 10; row += 1) {
        for (let col = 1; col <= 10 - row; col += 1) {
          const w0 = row / 12;
          const w1 = col / 12;
          const w2 = 1 - w0 - w1;
          const sample = {
            x: points[0].x * w0 + points[1].x * w1 + points[2].x * w2,
            z: points[0].z * w0 + points[1].z * w1 + points[2].z * w2,
          };
          const sourceInfo = sourceHeight(sample, source);
          const waterCoverage = sourceInfo.weights.reduce((sum, weight, index) => sum + weight * source[index].waterCoverage, 0);
          if (waterCoverage < minWaterCoverageAtWater) {
            minWaterCoverageAtWater = waterCoverage;
            minWaterCoverageRecord = { waterCoverage, sample, sourceDiagonal: metadata.source.diagonal, source, points };
          }
        }
      }
      const sourceKey = source.map((vertex) => `${vertex.x},${vertex.z}`).join("|");
      const meshKey = metadata.points.map((point) => `${point.x + water.position.x},${point.z + water.position.z}`).join("|");
      if (!sourceKey || !meshKey) sourceMismatch += 1;
      const sourceFace = source.map((vertex) => `${vertex.x.toFixed(5)},${vertex.z.toFixed(5)}`).sort().join("|");
      if (!groundFaces.has(sourceFace)) missingGroundFaces += 1;
      waterTriangles += 1;
    }
  }

  return {
    camera: { x: debug.scene.activeCamera?.position.x, y: debug.scene.activeCamera?.position.y, z: debug.scene.activeCamera?.position.z },
    water: waterMeshes.map(bounds),
    ground: groundMeshes.map(bounds),
    waterTriangles,
    maxWaterEdge,
    maxWaterArea,
    maxGroundAtWater,
    maxGroundRecord,
    minWaterCoverageAtWater,
    minWaterCoverageRecord,
    sourceMismatch,
    missingGroundFaces,
    pageMeshes: debug.scene.meshes.length,
    material: waterMeshes[0] ? {
      needAlphaBlending: waterMeshes[0].material?.needAlphaBlending?.(),
      needAlphaTesting: waterMeshes[0].material?.needAlphaTesting?.(),
      disableDepthWrite: waterMeshes[0].material?.disableDepthWrite,
      depthFunction: waterMeshes[0].material?.depthFunction,
      zOffset: waterMeshes[0].material?.zOffset,
      alphaMode: waterMeshes[0].material?.alphaMode,
      backFaceCulling: waterMeshes[0].material?.backFaceCulling,
    } : null,
    picks: [[1200, 600], [1300, 650], [1300, 730], [1100, 730], [900, 820], [700, 820]].map(([x, y]) => {
      const pick = debug.scene.pick(x, y);
      return { x, y, mesh: pick?.pickedMesh?.name ?? null, point: pick?.pickedPoint ? { x: pick.pickedPoint.x, y: pick.pickedPoint.y, z: pick.pickedPoint.z } : null };
    }),
  };
}
"""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(SAVE)))
    page.goto(os.environ.get("AI_WORLD_BROWSER_URL", "http://127.0.0.1:5186"), wait_until="networkidle")
    page.wait_for_timeout(3000)
    page.evaluate("""() => {
      for (const mesh of window.__aiWorldDebug.scene.meshes) {
        if (mesh.name.startsWith("water-")) mesh.isPickable = true;
      }
    }""")
    water_z_offset = os.environ.get("AI_WORLD_WATER_Z_OFFSET")
    if water_z_offset is not None:
        page.evaluate("""(zOffset) => {
          for (const mesh of window.__aiWorldDebug.scene.meshes) {
            if (mesh.name.startsWith("water-") && mesh.material) mesh.material.zOffset = zOffset;
          }
        }""", float(water_z_offset))
    if os.environ.get("AI_WORLD_HIDE_WATER") == "1":
        page.evaluate("""() => {
          for (const mesh of window.__aiWorldDebug.scene.meshes) {
            if (mesh.name.startsWith("water-")) mesh.isVisible = false;
          }
        }""")
    if os.environ.get("AI_WORLD_HIDE_GROUND") == "1":
        page.evaluate("""() => {
          for (const mesh of window.__aiWorldDebug.scene.meshes) {
            if (mesh.name.startsWith("ground-")) mesh.isVisible = false;
          }
        }""")
    if os.environ.get("AI_WORLD_WIREFRAME") == "1":
        page.evaluate("""() => {
          for (const mesh of window.__aiWorldDebug.scene.meshes) {
            if (mesh.name.startsWith("water-") || mesh.name.startsWith("ground-")) {
              if (mesh.material && "wireframe" in mesh.material) mesh.material.wireframe = true;
            }
          }
        }""")
        page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT / "browser-water-diagnostic.png"), full_page=True)
    print(json.dumps({"errors": errors, "report": page.evaluate(INSPECT)}, indent=2))
    browser.close()
