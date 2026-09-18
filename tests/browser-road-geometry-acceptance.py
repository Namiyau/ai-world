import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SAVE_KEY = "economy-world-save-v1"
SAVE = {
    "version": 1,
    "money": 120,
    "inventory": {"wood": 0, "stone": 0, "scrap": 0, "relic": 0},
    "collectedResourceIds": [],
    "positions": {"home": {"x": -128, "y": 4, "z": -704}, "mission": {"x": 0, "y": 3, "z": -9}},
}


def move_to(page, x, z, y=34):
    page.evaluate(
        """
        ({ x, z, y }) => {
          const debug = window.__aiWorldDebug;
          const camera = debug.player.camera;
          camera.position.set(x, y, z + 38);
          const target = camera.position.clone();
          target.set(x, 0, z);
          camera.setTarget(target);
          debug.world.update(camera.position, true);
        }
        """,
        {"x": x, "z": z, "y": y},
    )
    page.wait_for_timeout(1000)


JUNCTION_ASSERTION = """
() => {
  const debug = window.__aiWorldDebug;
  const meshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("road-"));
  const vertical = meshes.filter((mesh) => mesh.name.includes("vertical"));
  const horizontal = meshes.filter((mesh) => mesh.name.includes("horizontal"));
  if (!vertical.length || !horizontal.length) throw new Error("junction fixture did not load both road directions");

  const signedArea = (points) => points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - point.z * next.x;
  }, 0) / 2;
  const clipEdge = (polygon, start, end, orientation) => {
    const result = [];
    const side = (point) => orientation * ((end.x - start.x) * (point.z - start.z) - (end.z - start.z) * (point.x - start.x));
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const currentSide = side(current);
      const nextSide = side(next);
      if (currentSide >= -1e-7) result.push(current);
      if ((currentSide >= 0) !== (nextSide >= 0)) {
        const t = currentSide / (currentSide - nextSide);
        result.push({ x: current.x + (next.x - current.x) * t, z: current.z + (next.z - current.z) * t });
      }
    }
    return result;
  };
  const triangles = (mesh) => {
    const positions = mesh.getVerticesData("position") ?? [];
    const indices = mesh.getIndices() ?? [];
    const output = [];
    for (let index = 0; index < indices.length; index += 3) {
      output.push([0, 1, 2].map((offset) => {
        const vertex = indices[index + offset];
        return { x: mesh.position.x + positions[vertex * 3], z: mesh.position.z + positions[vertex * 3 + 2] };
      }));
    }
    return output;
  };
  const overlapArea = (first, second) => {
    let clipped = [...first];
    const orientation = Math.sign(signedArea(second)) || 1;
    for (let index = 0; index < second.length && clipped.length; index += 1) {
      clipped = clipEdge(clipped, second[index], second[(index + 1) % second.length], orientation);
    }
    return Math.abs(signedArea(clipped));
  };

  let overlap = 0;
  for (const first of vertical) for (const second of horizontal) {
    for (const firstTriangle of triangles(first)) for (const secondTriangle of triangles(second)) {
      overlap += overlapArea(firstTriangle, secondTriangle);
    }
  }
  if (overlap > 1e-4) throw new Error(`road junction still has ${overlap.toFixed(4)}m2 of stacked surfaces`);
  return { vertical: vertical.length, horizontal: horizontal.length, overlap };
}
"""


LAKE_ASSERTION = """
() => {
  const debug = window.__aiWorldDebug;
  const roadMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("road-"));
  if (!roadMeshes.length) throw new Error("lake fixture did not load road geometry");
  let triangles = 0;
  for (const mesh of roadMeshes) {
    const positions = mesh.getVerticesData("position") ?? [];
    const indices = mesh.getIndices() ?? [];
    for (let index = 0; index < indices.length; index += 3) {
      const point = [0, 1, 2].reduce((sum, offset) => {
        const vertex = indices[index + offset];
        return {
          x: sum.x + (mesh.position.x + positions[vertex * 3]) / 3,
          z: sum.z + (mesh.position.z + positions[vertex * 3 + 2]) / 3,
        };
      }, { x: 0, z: 0 });
      const terrain = debug.world.sampler.sample(point.x, point.z);
      if (terrain.hasWater) throw new Error(`road triangle entered lake at ${point.x.toFixed(2)}, ${point.z.toFixed(2)}`);
      triangles += 1;
    }
  }
  const submerged = debug.world.sampler.sample(2552, -3512);
  if (!submerged.hasWater || submerged.height >= 0) throw new Error(`lake road corridor was raised dry: ${JSON.stringify(submerged)}`);
  return { roadMeshes: roadMeshes.length, triangles, lakebedHeight: submerged.height };
}
"""


ROAD_CLEARANCE_ASSERTION = """
() => {
  const debug = window.__aiWorldDebug;
  const meshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("road-"));
  const weightsToCheck = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]];
  let minClearance = Infinity;
  for (const mesh of meshes) {
    const positions = mesh.getVerticesData("position") ?? [];
    const indices = mesh.getIndices() ?? [];
    for (let index = 0; index < indices.length; index += 3) {
      const vertices = [indices[index], indices[index + 1], indices[index + 2]];
      for (const weights of weightsToCheck) {
        let x = 0, y = 0, z = 0;
        for (let point = 0; point < 3; point += 1) {
          const vertex = vertices[point];
          x += (mesh.position.x + positions[vertex * 3]) * weights[point];
          y += (mesh.position.y + positions[vertex * 3 + 1]) * weights[point];
          z += (mesh.position.z + positions[vertex * 3 + 2]) * weights[point];
        }
        const clearance = y - debug.world.sampler.height(x, z);
        minClearance = Math.min(minClearance, clearance);
        if (clearance < 0.04) throw new Error(`road penetrated terrain at ${x.toFixed(2)}, ${z.toFixed(2)}: ${clearance.toFixed(4)}m`);
      }
    }
  }
  return { meshes: meshes.length, minClearance };
}
"""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(SAVE)))
    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.wait_for_timeout(2500)
    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(400)

    move_to(page, -224, -224)
    junction = page.evaluate(JUNCTION_ASSERTION)
    page.screenshot(path=str(ROOT / "browser-road-junction.png"), full_page=True)

    move_to(page, 2528, -3488)
    lake = page.evaluate(LAKE_ASSERTION)
    page.screenshot(path=str(ROOT / "browser-road-lake.png"), full_page=True)

    move_to(page, 2656, -250)
    clearance = page.evaluate(ROAD_CLEARANCE_ASSERTION)
    page.screenshot(path=str(ROOT / "browser-road-clearance.png"), full_page=True)

    assert not errors, errors
    print(f"junction={junction} lake={lake} clearance={clearance} page-errors={errors!r}")
    browser.close()
