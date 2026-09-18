import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BROWSER_URL = os.environ.get("AI_WORLD_BROWSER_URL", "http://127.0.0.1:5173")
SAVE_KEY = "economy-world-save-v1"

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

POI_ASSERTION = """
() => {
  const debug = window.__aiWorldDebug;
  if (!debug?.world?.pois) throw new Error("PoiLayer is not available in the running world.");
  const world = debug.world;
  const sceneRoots = debug.scene.meshes.filter((mesh) => mesh.name.startsWith("poi-poi:"));

  for (const root of sceneRoots) {
    const placement = root.metadata?.poiPlacement;
    if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.z) || !Number.isFinite(placement.groundY)) {
      throw new Error(`${root.name}: invalid POI placement metadata`);
    }
    for (const child of root.getChildMeshes()) {
      if (![child.position.x, child.position.y, child.position.z].every(Number.isFinite)) {
        throw new Error(`${child.name}: invalid POI child transform`);
      }
    }
  }

  const placements = world.pois.query(0, 0, 10000, world.sampler);
  if (placements.length === 0) throw new Error("No deterministic POI placement exists in the scan.");
  const expectedKinds = ["cabin", "gasStation", "warehouse", "abandonedCamp", "dock", "woodBridge", "roadBridge", "mineShed", "wreck", "crashSite", "hunterCamp", "supplyCache", "mineralOutcrop"];
  const kinds = [...new Set(placements.map((placement) => placement.kind))].sort();
  for (const kind of expectedKinds) {
    if (!kinds.includes(kind)) throw new Error(`Missing deterministic POI kind ${kind}`);
  }

  const mineralNodes = placements.flatMap((placement) => placement.minerals ?? []);
  const mineralTypes = [...new Set(mineralNodes.map((node) => node.type))].sort();
  if (JSON.stringify(mineralTypes) !== JSON.stringify(["copper", "iron", "rare", "stone"])) {
    throw new Error(`Mineral interface is incomplete: ${mineralTypes.join(",")}`);
  }
  for (const node of mineralNodes) {
    if (!node.id || !Number.isFinite(node.amount) || !node.position || !Number.isFinite(node.position.y)) {
      throw new Error(`Invalid future mineral node ${JSON.stringify(node)}`);
    }
  }

  const bridges = placements.filter((placement) => placement.kind === "woodBridge" || placement.kind === "roadBridge");
  for (const bridge of bridges) {
    if (bridge.roadDistance !== 0 || !Number.isFinite(bridge.groundY) || !Number.isFinite(bridge.bridgeStartY) || !Number.isFinite(bridge.bridgeEndY)) {
      throw new Error("Bridge is not attached to a valid road crossing");
    }
  }

  const signature = placements.map((placement) => ({
    id: placement.id,
    kind: placement.kind,
    x: placement.x,
    z: placement.z,
    y: placement.groundY,
    rotation: placement.rotation,
    minerals: placement.minerals,
  })).sort((a, b) => a.id.localeCompare(b.id));
  return { roots: sceneRoots.length, kinds, minerals: mineralNodes.length, bridges: bridges.length, signature, firstMineral: placements.find((placement) => placement.minerals.length > 0), firstPlacement: placements[0] };
}
"""


def snapshot(page):
    return page.evaluate(POI_ASSERTION)


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
    page.add_init_script("window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(save)))
    page.goto(BROWSER_URL, wait_until="networkidle")
    page.wait_for_timeout(3000)

    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(250)

    first = snapshot(page)
    if first["roots"] == 0:
        page.evaluate(
            """
            (target) => {
              const game = window.__aiWorldDebug;
              game.world.loadWorld("home", { x: target.x, y: target.groundY + 4, z: target.z });
              game.player.camera.position.set(target.x + 18, target.groundY + 12, target.z + 18);
              const lookAt = game.player.camera.position.clone();
              lookAt.y = target.groundY;
              lookAt.x = target.x;
              lookAt.z = target.z;
              game.player.camera.setTarget(lookAt);
            }
            """,
            first["firstPlacement"],
        )
        page.wait_for_timeout(1400)
        first = snapshot(page)
    assert first["roots"] > 0
    page.screenshot(path=str(ROOT / "browser-poi-normal.png"), full_page=True)

    mineral = first["firstMineral"]
    page.evaluate(
        """
        (target) => {
          const game = window.__aiWorldDebug;
          game.world.loadWorld("home", { x: target.x, y: target.y + 4, z: target.z });
          game.player.camera.position.set(target.x, target.y + 10, target.z);
          const lookAt = game.player.camera.position.clone();
          lookAt.y -= 3;
          lookAt.z -= 12;
          game.player.camera.setTarget(lookAt);
        }
        """,
        mineral,
    )
    page.wait_for_timeout(2200)
    mining_roots = page.evaluate("() => window.__aiWorldDebug.scene.meshes.filter((mesh) => mesh.name.startsWith('poi-poi:')).length")
    mineral_meshes = page.evaluate("() => window.__aiWorldDebug.scene.meshes.filter((mesh) => mesh.metadata?.mineralNode).length")
    assert mining_roots > 0
    assert mineral_meshes > 0
    page.screenshot(path=str(ROOT / "browser-poi-mining.png"), full_page=True)

    page.keyboard.press("Space")
    page.wait_for_timeout(80)
    page.keyboard.press("Space")
    page.wait_for_timeout(300)
    page.keyboard.down("Space")
    page.wait_for_timeout(600)
    page.keyboard.up("Space")
    page.screenshot(path=str(ROOT / "browser-poi-flight.png"), full_page=True)

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(3000)
    second = snapshot(page)
    assert first["signature"] == second["signature"], "same seed must keep POI and mineral signatures stable"
    assert not page_errors, page_errors
    unexpected_console = [error for error in console_errors if "404 (Not Found)" not in error]
    assert not unexpected_console, unexpected_console
    print(
        f"poi-roots={first['roots']} kinds={first['kinds']} minerals={first['minerals']} "
        f"bridges={first['bridges']} mineral-meshes={mineral_meshes} deterministic=yes"
    )
    browser.close()
