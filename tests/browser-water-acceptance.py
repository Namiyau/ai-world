import json
import os
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SAVE_KEY = "economy-world-save-v1"
WATER_LEVEL = 0.0
EPSILON = 1e-4
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


GEOMETRY_ASSERTION = """
() => {
  const debug = window.__aiWorldDebug;
  if (!debug) throw new Error("Water geometry debug handle is unavailable in development build.");
  const waterLevel = 0.0;
  const epsilon = 1e-4;
  const waterMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("water-"));
  const groundMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("ground-"));
  const groundVertices = new Map();
  const groundTriangles = [];
  for (const ground of groundMeshes) {
    const positions = ground.getVerticesData("position") ?? [];
    const indices = ground.getIndices() ?? [];
    for (let index = 0; index < positions.length; index += 3) {
      const x = ground.position.x + positions[index];
      const z = ground.position.z + positions[index + 2];
      groundVertices.set(`${x.toFixed(5)},${z.toFixed(5)}`, ground.position.y + positions[index + 1]);
    }
    for (let index = 0; index < indices.length; index += 3) {
      groundTriangles.push([indices[index], indices[index + 1], indices[index + 2]].map((vertexIndex) => ({
        x: ground.position.x + positions[vertexIndex * 3],
        y: ground.position.y + positions[vertexIndex * 3 + 1],
        z: ground.position.z + positions[vertexIndex * 3 + 2],
      })));
    }
  }

  const barycentric = (point, triangle) => {
    const area = (triangle[1].x - triangle[0].x) * (triangle[2].z - triangle[0].z) -
      (triangle[1].z - triangle[0].z) * (triangle[2].x - triangle[0].x);
    const w0 = ((triangle[1].x - point.x) * (triangle[2].z - point.z) -
      (triangle[1].z - point.z) * (triangle[2].x - point.x)) / area;
    const w1 = ((triangle[2].x - point.x) * (triangle[0].z - point.z) -
      (triangle[2].z - point.z) * (triangle[0].x - point.x)) / area;
    return [w0, w1, 1 - w0 - w1];
  };

  const sourceHeightAt = (point, source) => {
    const weights = barycentric(point, source);
    return weights[0] * source[0].height + weights[1] * source[1].height + weights[2] * source[2].height;
  };

  const groundHeightAt = (point) => {
    for (const triangle of groundTriangles) {
      const weights = barycentric(point, triangle);
      if (weights.every((weight) => weight >= -epsilon)) {
        return weights[0] * triangle[0].y + weights[1] * triangle[1].y + weights[2] * triangle[2].y;
      }
    }
    throw new Error(`Ground triangle not found for shoreline sample ${JSON.stringify(point)}`);
  };

  let waterTriangleCount = 0;
  let edgePointCount = 0;
  const edgePoints = new Map();
  const waterEdges = new Map();
  const signature = [];
  for (const water of waterMeshes) {
    const positions = water.getVerticesData("position") ?? [];
    const indices = water.getIndices() ?? [];
    const metadataTriangles = water.metadata?.triangles ?? [];
    if (indices.length / 3 !== metadataTriangles.length) {
      throw new Error(`${water.name}: metadata triangle count does not match index count`);
    }
    const half = (water.metadata?.chunkSize ?? 64) / 2;
    for (let triangleIndex = 0; triangleIndex < indices.length; triangleIndex += 3) {
      const metadata = metadataTriangles[triangleIndex / 3];
      const source = metadata.source.vertices;
      const sourceDiagonal = metadata.source.diagonal;
      for (const vertex of source) {
        if (vertex.height < waterLevel - epsilon && (!vertex.lakeMask || !vertex.hasWater)) {
          throw new Error(`${water.name}: below-water source vertex is not part of a valid lake basin`);
        }
      }
      const sourceXs = source.map((point) => point.x);
      const sourceZs = source.map((point) => point.z);
      const minX = Math.min(...sourceXs), maxX = Math.max(...sourceXs);
      const minZ = Math.min(...sourceZs), maxZ = Math.max(...sourceZs);
      const expected = sourceDiagonal === "bdc"
        ? [[maxX, minZ], [maxX, maxZ], [minX, maxZ]]
        : [[minX, minZ], [maxX, minZ], [minX, maxZ]];
      for (let i = 0; i < 3; i += 1) {
        if (Math.abs(source[i].x - expected[i][0]) > epsilon || Math.abs(source[i].z - expected[i][1]) > epsilon) {
          throw new Error(`${water.name}: source triangle does not use ${sourceDiagonal} Ground diagonal`);
        }
        const key = `${source[i].x.toFixed(5)},${source[i].z.toFixed(5)}`;
        const groundHeight = groundVertices.get(key);
        if (groundHeight === undefined || Math.abs(groundHeight - source[i].height) > epsilon) {
          throw new Error(`${water.name}: Water source vertex is not the rendered Ground vertex`);
        }
      }

      const points = [];
      for (let pointIndex = 0; pointIndex < 3; pointIndex += 1) {
        const vertexIndex = indices[triangleIndex + pointIndex];
        const local = {
          x: positions[vertexIndex * 3],
          y: positions[vertexIndex * 3 + 1],
          z: positions[vertexIndex * 3 + 2],
        };
        if (Math.abs(local.x) > half + epsilon || Math.abs(local.z) > half + epsilon) {
          throw new Error(`${water.name}: water vertex is not chunk-local`);
        }
        if (Math.abs(local.y + water.position.y - waterLevel) > epsilon) {
          throw new Error(`${water.name}: water vertex is not level`);
        }
        points.push({ x: water.position.x + local.x, y: water.position.y + local.y, z: water.position.z + local.z });
        const edge = Math.abs(Math.abs(local.x) - half) <= epsilon || Math.abs(Math.abs(local.z) - half) <= epsilon;
        if (edge) {
          edgePointCount += 1;
          const edgeKey = `${points[pointIndex].x.toFixed(5)},${points[pointIndex].z.toFixed(5)}`;
          const values = edgePoints.get(edgeKey) ?? [];
          values.push(points[pointIndex].y);
          edgePoints.set(edgeKey, values);
        }
      }

      const samples = [
        { x: (points[0].x + points[1].x + points[2].x) / 3, z: (points[0].z + points[1].z + points[2].z) / 3 },
        { x: points[0].x * 0.6 + points[1].x * 0.2 + points[2].x * 0.2, z: points[0].z * 0.6 + points[1].z * 0.2 + points[2].z * 0.2 },
        { x: points[0].x * 0.2 + points[1].x * 0.6 + points[2].x * 0.2, z: points[0].z * 0.2 + points[1].z * 0.6 + points[2].z * 0.2 },
        { x: points[0].x * 0.2 + points[1].x * 0.2 + points[2].x * 0.6, z: points[0].z * 0.2 + points[1].z * 0.2 + points[2].z * 0.6 },
      ];
      for (const samplePoint of samples) {
        const weights = barycentric(samplePoint, source);
        if (weights.some((weight) => weight < -epsilon)) {
          throw new Error(`${water.name}: water triangle escaped its Ground triangle`);
        }
        if (sourceHeightAt(samplePoint, source) > waterLevel + epsilon) {
          throw new Error(`${water.name}: water triangle extends above Ground`);
        }
        const lakeWeight = weights.reduce((sum, weight, index) => sum + (source[index].lakeMask ? weight : 0), 0);
        if (lakeWeight <= 0) {
          throw new Error(`${water.name}: water triangle centroid/interior sample is outside the lake basin ${JSON.stringify({ triangleIndex: triangleIndex / 3, sourceDiagonal, source, points, samplePoint, lakeWeight })}`);
        }
      }
      for (let pointIndex = 0; pointIndex < 3; pointIndex += 1) {
        const start = points[pointIndex];
        const end = points[(pointIndex + 1) % 3];
        const edgeKey = [
          `${start.x.toFixed(5)},${start.z.toFixed(5)}`,
          `${end.x.toFixed(5)},${end.z.toFixed(5)}`,
        ].sort().join("|");
        const existing = waterEdges.get(edgeKey);
        if (existing) {
          existing.count += 1;
        } else {
          waterEdges.set(edgeKey, {
            count: 1,
            start,
            end,
            inside: points[(pointIndex + 2) % 3],
            water,
            half,
          });
        }
      }
      waterTriangleCount += 1;
      signature.push(JSON.stringify({ sourceDiagonal, source, points }));
    }
  }

  let shorelineEdgeCount = 0;
  for (const edge of waterEdges.values()) {
    const onChunkBoundary = (point) =>
      Math.abs(Math.abs(point.x - edge.water.position.x) - edge.half) <= epsilon ||
      Math.abs(Math.abs(point.z - edge.water.position.z) - edge.half) <= epsilon;
    if (edge.count !== 1 || onChunkBoundary(edge.start) || onChunkBoundary(edge.end)) continue;
    shorelineEdgeCount += 1;
    for (const t of [0, 0.5, 1]) {
      const point = {
        x: edge.start.x + (edge.end.x - edge.start.x) * t,
        z: edge.start.z + (edge.end.z - edge.start.z) * t,
      };
      const groundHeight = groundHeightAt(point);
      if (Math.abs(groundHeight - waterLevel) > 0.03) {
        throw new Error(`shoreline edge does not touch Ground at water level ${JSON.stringify({ point, groundHeight, edge })}`);
      }
    }
    const midpoint = {
      x: (edge.start.x + edge.end.x) / 2,
      z: (edge.start.z + edge.end.z) / 2,
    };
    const away = { x: midpoint.x - edge.inside.x, z: midpoint.z - edge.inside.z };
    const length = Math.hypot(away.x, away.z) || 1;
    const drySidePoint = {
      x: midpoint.x + away.x / length * 0.25,
      z: midpoint.z + away.z / length * 0.25,
    };
    if (groundHeightAt(drySidePoint) < waterLevel - 0.03) {
      throw new Error(`shoreline outside remains below water ${JSON.stringify({ drySidePoint, edge })}`);
    }
  }
  if (shorelineEdgeCount === 0) throw new Error("no internal shoreline edges were found");

  signature.sort();
  for (const [key, values] of edgePoints.entries()) {
    if (Math.max(...values) - Math.min(...values) > epsilon) throw new Error(`chunk boundary water mismatch at ${key}`);
  }
  return { waterMeshes: waterMeshes.length, waterTriangleCount, edgePointCount, edgePoints: [...edgePoints.entries()].sort(), shorelineEdgeCount, signature };
}
"""


def geometry_report(page: Page):
    report = page.evaluate(GEOMETRY_ASSERTION)
    assert report["waterMeshes"] > 0
    assert report["waterTriangleCount"] > 0
    for _, values in report["edgePoints"]:
        for y in values:
            assert abs(y - WATER_LEVEL) <= EPSILON
    return report


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(
        "window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(save))
    )
    page.goto(BROWSER_URL, wait_until="networkidle")
    page.wait_for_timeout(2500)

    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(250)

    first_report = geometry_report(page)
    page.screenshot(path=str(ROOT / "browser-water-normal.png"), full_page=True)

    canvas = page.locator("#game-canvas")
    canvas.click(position={"x": 720, "y": 450})
    page.mouse.move(720, 450)
    page.mouse.move(0, 450)
    page.wait_for_timeout(500)
    geometry_report(page)
    page.screenshot(path=str(ROOT / "browser-water-rotated.png"), full_page=True)

    page.keyboard.press("Space")
    page.wait_for_timeout(80)
    page.keyboard.press("Space")
    page.wait_for_timeout(300)
    page.keyboard.down("Space")
    page.wait_for_timeout(800)
    page.keyboard.up("Space")
    geometry_report(page)
    page.screenshot(path=str(ROOT / "browser-water-high.png"), full_page=True)

    page.keyboard.down("ShiftLeft")
    page.wait_for_timeout(6000)
    page.keyboard.up("ShiftLeft")
    geometry_report(page)
    page.screenshot(path=str(ROOT / "browser-water-underground.png"), full_page=True)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2500)
    second_report = geometry_report(page)
    assert second_report["signature"] == first_report["signature"], "same seed must produce identical water geometry"

    print(f"page-errors={errors!r}")
    print(
        f"geometry water-meshes={first_report['waterMeshes']} "
        f"water-triangles={first_report['waterTriangleCount']} "
        f"chunk-edge-points={first_report['edgePointCount']} "
        f"shoreline-edges={first_report['shorelineEdgeCount']} deterministic=yes"
    )
    assert not errors
    browser.close()
