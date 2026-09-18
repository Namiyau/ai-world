import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "模型"
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

POI_KINDS = {
    "cabin": "小木屋",
    "gasStation": "加油站",
    "warehouse": "小仓库",
    "abandonedCamp": "废弃营地",
    "dock": "小码头",
    "woodBridge": "木桥",
    "roadBridge": "公路桥",
    "mineShed": "矿区工棚",
    "wreck": "废车点",
    "mineralOutcrop": "裸露矿物点",
}

MINERALS = {
    "stone": "普通石材",
    "iron": "铁矿",
    "copper": "铜矿",
    "rare": "稀有矿",
}

DECORATIONS = {
    "fence": "围栏",
    "sign": "路牌",
    "utility-pole": "电线杆",
    "street-lamp": "路灯",
    "crate": "木箱",
    "barrel": "油桶",
    "pallet": "托盘",
    "trash-bin": "垃圾桶",
    "bench": "长椅",
}

NATURAL = {
    "roundTree": {"label": "圆冠树", "keys": ["tree-trunk", "tree-canopy-round"]},
    "pineTree": {"label": "松树", "keys": ["tree-trunk", "tree-canopy-pine"]},
    "birchTree": {"label": "桦树", "keys": ["tree-trunk-light", "tree-canopy-birch"]},
    "bush": {"label": "灌木", "keys": ["bush"]},
    "grass": {"label": "草簇", "keys": ["grass"]},
    "flower": {"label": "小花", "keys": ["flower-stem", "flower-head"]},
    "reed": {"label": "芦苇", "keys": ["reed"]},
    "log": {"label": "倒木", "keys": ["log"]},
    "rock": {"label": "岩石", "keys": ["rock"]},
    "pebble": {"label": "碎石", "keys": ["pebble"]},
}

LANDMARKS = {
    "radioTower": "无线电塔",
    "windmill": "风车",
    "monolith": "巨石阵",
    "greatTree": "巨树",
}

CHARACTERS = {
    "explorer": "玩家探索者",
    "merchant": "普通商人",
    "wildernessEnemy": "荒野近战敌人",
}

SETUP = """
() => {
  const debug = window.__aiWorldDebug;
  if (!debug?.world || !debug?.scene || !debug?.player?.camera) throw new Error("World debug handle unavailable");
  debug.player.setMode("flight");
  debug.setPaused(true);
  document.querySelector("#main-menu-root")?.classList.remove("open");
  const scene = debug.scene;
  scene.fogEnabled = false;
  scene.clearColor.r = 0.72;
  scene.clearColor.g = 0.80;
  scene.clearColor.b = 0.84;
  scene.clearColor.a = 1;
  const hud = document.querySelector("#hud-root");
  if (hud) hud.style.visibility = "hidden";
  return { meshes: scene.meshes.length };
}
"""

PREPARE_ROOT = """
({ kind, target }) => {
  const debug = window.__aiWorldDebug;
  const scene = debug.scene;
  const camera = debug.player.camera;
  const world = debug.world;
  const hideAll = () => {
    for (const mesh of scene.meshes) {
      mesh.isVisible = false;
      mesh.setEnabled(false);
    }
  };
  const show = (mesh) => {
    if (!mesh) return;
    mesh.setEnabled(true);
    mesh.isVisible = true;
  };
  const descendants = (root) => [root, ...root.getChildMeshes()];
  const boundsFor = (meshes, tight = false) => {
    const visible = meshes.filter((mesh) => mesh && !mesh.isDisposed() && (!mesh.getTotalVertices || mesh.getTotalVertices() > 0));
    if (!visible.length) throw new Error("No visible meshes to frame");
    let min = null;
    let max = null;
    for (const mesh of visible) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const a = box.minimumWorld;
      const b = box.maximumWorld;
      min = min ? { x: Math.min(min.x, a.x), y: Math.min(min.y, a.y), z: Math.min(min.z, a.z) } : { x: a.x, y: a.y, z: a.z };
      max = max ? { x: Math.max(max.x, b.x), y: Math.max(max.y, b.y), z: Math.max(max.z, b.z) } : { x: b.x, y: b.y, z: b.z };
    }
    const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 2);
    const radius = tight ? Math.max(size * 0.22, 0.72) : size * 0.62 + 2;
    camera.position.set(center.x + radius * 1.9, center.y + radius * 1.05, center.z + radius * 1.9);
    const lookAt = camera.position.clone();
    lookAt.set(center.x, center.y, center.z);
    camera.setTarget(lookAt);
    camera.minZ = 0.08;
    camera.maxZ = 5000;
    return { center, size, meshCount: visible.length };
  };
  const loadAt = (point) => {
    world.loadWorld("home", { x: point.x, y: point.groundY + 8, z: point.z });
  };
  const roots = () => scene.meshes.filter((mesh) => mesh.name.startsWith("poi-poi:"));
  const nearestPoiRoot = (poiKind, point) => roots()
    .filter((mesh) => mesh.metadata?.poiKind === poiKind)
    .sort((a, b) => {
      const da = Math.hypot(a.position.x - point.x, a.position.z - point.z);
      const db = Math.hypot(b.position.x - point.x, b.position.z - point.z);
      return da - db;
    })[0];
  const frameRoot = (root) => {
    hideAll();
    const children = root.getChildMeshes();
    show(root);
    for (const mesh of children) show(mesh);
    return boundsFor(children.filter((mesh) => mesh.isVisible));
  };

  if (kind.startsWith("poi:")) {
    const poiKind = kind.slice(4);
    loadAt(target);
    const root = nearestPoiRoot(poiKind, target);
    if (!root) throw new Error(`POI root not found: ${poiKind}`);
    return { mode: "poi", name: root.name, ...frameRoot(root) };
  }

  if (kind.startsWith("mineral:")) {
    const mineralType = kind.slice(8);
    loadAt(target);
    const root = roots().find((mesh) => mesh.metadata?.poiPlacement?.id === target.id) || roots()[0];
    if (!root) throw new Error("Mineral POI root not found");
    const child = root.getChildren().find((node) => node.metadata?.mineralNode?.type === mineralType);
    if (!child) throw new Error(`Mineral mesh not found: ${mineralType}`);
    hideAll();
    show(root);
    const meshes = child.getChildMeshes();
    for (const mesh of meshes) show(mesh);
    return { mode: "mineral", name: child.name, ...boundsFor(meshes) };
  }

  if (kind.startsWith("decor:")) {
    const key = kind.slice(6);
    loadAt(target);
    const child = roots().flatMap((root) => root.getChildMeshes()).find((mesh) => mesh.name.includes(`poi-${key}-`));
    if (!child) throw new Error(`Decoration mesh not found: ${key}`);
    hideAll();
    show(child.parent);
    show(child);
    return { mode: "decor", name: child.name, ...boundsFor([child]) };
  }

  if (kind.startsWith("natural:")) {
    const keys = kind.slice(8).split(",");
    hideAll();
    const masters = debug.world.details.masters;
    const visible = [];
    for (const key of keys) {
      const mesh = masters.get(key) || debug.world.details.master(key);
      if (!mesh) throw new Error(`Detail master not found: ${key}`);
      mesh.position.set(0, key.includes("trunk") ? 2.7 : key.includes("canopy") ? 5.3 : key.includes("flower-head") ? 0.68 : key.includes("flower-stem") ? 0.3 : key === "grass" ? 0.28 : key === "reed" ? 0.85 : key === "log" ? 0.34 : key === "rock" ? 0.42 : 0.16, 0);
      mesh.rotation.set(0, key.includes("log") ? 0 : 0.35, key.includes("log") ? Math.PI / 2 : 0);
      mesh.setEnabled(true);
      mesh.isVisible = true;
      visible.push(mesh);
    }
    return { mode: "natural", name: keys.join(","), ...boundsFor(visible) };
  }

  if (kind.startsWith("landmark:")) {
    loadAt(target);
    const root = scene.meshes
      .filter((mesh) => mesh.name.startsWith("landmark-"))
      .sort((a, b) => Math.hypot(a.position.x - target.x, a.position.z - target.z) - Math.hypot(b.position.x - target.x, b.position.z - target.z))[0];
    if (!root) throw new Error(`Landmark root not found: ${kind}`);
    return { mode: "landmark", name: root.name, ...frameRoot(root) };
  }

  if (kind.startsWith("character:")) {
    const role = kind.slice(10);
    const showcase = world.characterShowcaseBuild;
    const entry = showcase?.roles.find((candidate) => candidate.role === role);
    if (!entry) throw new Error(`Character role not found: ${role}`);
    hideAll();
    const meshes = entry.visual.root.getChildMeshes();
    for (const mesh of meshes) show(mesh);
    return { mode: "character", name: entry.visual.root.name, ...boundsFor(meshes, true) };
  }

  if (kind === "lake") {
    loadAt({ x: -128, groundY: 4, z: -704 });
    const waters = scene.meshes.filter((mesh) => mesh.name.startsWith("water-"));
    if (!waters.length) throw new Error("No water meshes found");
    const water = waters[0];
    const nearbyGround = scene.meshes.find((mesh) => mesh.name.startsWith("ground-") && Math.hypot(mesh.position.x - water.position.x, mesh.position.z - water.position.z) < 50);
    hideAll();
    show(water);
    if (nearbyGround) show(nearbyGround);
    return { mode: "lake", name: water.name, ...boundsFor([water, ...(nearbyGround ? [nearbyGround] : [])]) };
  }

  if (kind === "road") {
    loadAt({ x: -128, groundY: 4, z: -704 });
    const roads = scene.meshes.filter((mesh) => mesh.name.startsWith("road-"));
    if (!roads.length) throw new Error("No road meshes found");
    hideAll();
    for (const road of roads.slice(0, 4)) show(road);
    return { mode: "road", name: roads.slice(0, 4).map((mesh) => mesh.name).join(","), ...boundsFor(roads.slice(0, 4)) };
  }

  throw new Error(`Unknown catalog kind: ${kind}`);
}
"""


def capture(page, kind, target, filename):
    result = page.evaluate(PREPARE_ROOT, {"kind": kind, "target": target or {}})
    page.wait_for_timeout(100)
    page.locator("#game-canvas").screenshot(path=str(OUTPUT / filename))
    return result


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
    page.wait_for_timeout(2800)
    page.evaluate(SETUP)

    world = page.evaluate(
        """
        () => {
          const debug = window.__aiWorldDebug;
          const pois = debug.world.pois.query(0, 0, 14000, debug.world.sampler);
          const landmarks = debug.world.landmarks.query(0, 0, 18000, debug.world.sampler);
          const firstMineral = pois.find((placement) => (placement.minerals ?? []).length > 0);
          return { pois, landmarks, firstMineral };
        }
        """
    )

    generated = []
    for kind, label in POI_KINDS.items():
        target = next((item for item in world["pois"] if item["kind"] == kind), None)
        if target is None:
            raise RuntimeError(f"Missing deterministic POI kind: {kind}")
        capture(page, f"poi:{kind}", target, f"{label}.png")
        generated.append(label)

    mineral_target = world["firstMineral"]
    if mineral_target is None:
        raise RuntimeError("No deterministic mineral-bearing POI found")
    for mineral, label in MINERALS.items():
        if not any(node["type"] == mineral for node in mineral_target.get("minerals", [])):
            mineral_target = next((item for item in world["pois"] if any(node["type"] == mineral for node in item.get("minerals", []))), None)
        if mineral_target is None:
            raise RuntimeError(f"Missing deterministic mineral type: {mineral}")
        capture(page, f"mineral:{mineral}", mineral_target, f"{label}.png")
        generated.append(label)

    decor_owner_kind = {
        "fence": "cabin",
        "sign": "cabin",
        "utility-pole": "warehouse",
        "street-lamp": "gasStation",
        "crate": "cabin",
        "barrel": "gasStation",
        "pallet": "warehouse",
        "trash-bin": "gasStation",
        "bench": "cabin",
    }
    for key, label in DECORATIONS.items():
        decor_target = next((item for item in world["pois"] if item["kind"] == decor_owner_kind[key]), None)
        if decor_target is None:
            raise RuntimeError(f"No decoration owner for {key}")
        capture(page, f"decor:{key}", decor_target, f"{label}.png")
        generated.append(label)

    for key, spec in NATURAL.items():
        capture(page, f"natural:{','.join(spec['keys'])}", None, f"{spec['label']}.png")
        generated.append(spec["label"])

    for kind, label in LANDMARKS.items():
        target = next((item for item in world["landmarks"] if item["kind"] == kind), None)
        if target is None:
            raise RuntimeError(f"Missing deterministic landmark kind: {kind}")
        capture(page, f"landmark:{kind}", target, f"{label}.png")
        generated.append(label)

    for role, label in CHARACTERS.items():
        capture(page, f"character:{role}", None, f"{label}.png")
        generated.append(label)

    capture(page, "lake", None, "湖泊.png")
    generated.append("湖泊")
    capture(page, "road", None, "道路.png")
    generated.append("道路")

    if page_errors:
        raise AssertionError(page_errors)
    print(json.dumps({"generated": generated, "count": len(generated), "output": str(OUTPUT)}, ensure_ascii=False))
    browser.close()
