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
    "positions": {
        "home": {"x": -128, "y": 4, "z": -704},
        "mission": {"x": 0, "y": 3, "z": -9},
    },
}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page_errors = []
    console_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.add_init_script("window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(SAVE)))
    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.wait_for_timeout(2800)

    report = page.evaluate(
        """
        () => {
          const debug = window.__aiWorldDebug;
          const sun = debug.scene.getMeshByName("sun-disc");
          const halo = debug.scene.getMeshByName("sun-halo");
          if (!sun) throw new Error("round sun mesh is missing");
          if (!halo) throw new Error("soft sun halo is missing");
          const extent = sun.getBoundingInfo().boundingBox.extendSizeWorld;
          const lights = debug.scene.lights.map((light) => ({
            name: light.name,
            type: light.getClassName(),
            intensity: light.intensity,
          }));
          const ambient = lights.find((light) => light.name === "ambient-light");
          const directional = lights.find((light) => light.name === "sun");
          const shadows = debug.world.atmosphere.shadowGenerator;
          if (!ambient || !directional || ambient.intensity >= directional.intensity) {
            throw new Error(`sun must remain the primary sculpting light: ${JSON.stringify(lights)}`);
          }
          if (!shadows || shadows.getClassName() !== "CascadedShadowGenerator" || debug.world.atmosphere.shadowStats.cascades !== 3) {
            throw new Error("near-player cascaded shadows are missing");
          }
          if (debug.scene.fogDensity >= 0.004) {
            throw new Error(`daytime fog is too dense: ${debug.scene.fogDensity}`);
          }
          if (sun.material?.fogEnabled !== false || halo.material?.fogEnabled !== false) {
            throw new Error("sun and halo must remain visible through scene fog");
          }
          if (Math.abs(extent.x - extent.y) > 0.01 || extent.x <= 0 || extent.z > 0.01) {
            throw new Error(`sun mesh is not a camera-facing circle: ${JSON.stringify(extent)}`);
          }

          const roadMeshes = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("road-"));
          if (roadMeshes.some((mesh) => !mesh.receiveShadows)) throw new Error("road mesh is not receiving terrain shadows");
          if (!debug.scene.meshes.some((mesh) => mesh.name.startsWith("ground-") && mesh.receiveShadows)) {
            throw new Error("terrain is not receiving shadows");
          }
          const roadSignatures = roadMeshes.map((mesh) => Array.from(mesh.getVerticesData("position") ?? [], (value) => value.toFixed(4)).join(","));
          if (new Set(roadSignatures).size !== roadSignatures.length) throw new Error("duplicate road ribbon across chunk ownership");

          const placements = debug.world.pois.query(0, 0, 10000, debug.world.sampler);
          const counts = {};
          for (const placement of placements) counts[placement.kind] = (counts[placement.kind] ?? 0) + 1;
          const bridges = placements.filter((placement) => placement.kind === "woodBridge" || placement.kind === "roadBridge");
          for (const bridge of bridges) {
            if (!Number.isFinite(bridge.bridgeStartY) || !Number.isFinite(bridge.bridgeEndY)) throw new Error(`bridge profile missing: ${bridge.id}`);
          }
          const roots = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("poi-poi:")).length;
          return {lights, shadows: debug.world.atmosphere.shadowStats, sunExtent: {x: extent.x, y: extent.y, z: extent.z}, roads: roadMeshes.length, roots, counts, bridges: bridges.length};
        }
        """
    )
    page.screenshot(path=str(ROOT / "browser-visual-review.png"), full_page=True)

    page.evaluate(
        """
        () => {
          const debug = window.__aiWorldDebug;
          const camera = debug.player.camera;
          const view = debug.world.atmosphere.sunDirection.clone();
          view.z += 1;
          view.normalize();
          camera.setTarget(camera.position.add(view.scale(1000)));
        }
        """
    )
    page.wait_for_timeout(350)
    page.screenshot(path=str(ROOT / "browser-sun-review.png"), full_page=True)

    assert not page_errors, page_errors
    unexpected_console = [error for error in console_errors if "404 (Not Found)" not in error]
    assert not unexpected_console, unexpected_console
    print(
        f"lights={report['lights']} shadows={report['shadows']} sun-round=yes sun-visible=yes roads={report['roads']} "
        f"rendered-poi-roots={report['roots']} bridge-profiles={report['bridges']} "
        f"poi-counts={report['counts']}"
    )
    browser.close()
