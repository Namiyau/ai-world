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
    page.wait_for_timeout(350)

    before = page.evaluate(
        """
        () => {
          const debug = window.__aiWorldDebug;
          const entry = [...debug.interactions.entries.values()].find((candidate) => candidate.label === "收集 石料")
            ?? [...debug.interactions.entries.values()].find((candidate) => candidate.label.startsWith("收集 "));
          if (!entry) throw new Error("no collectible resource was loaded");
          entry.mesh.metadata = { ...(entry.mesh.metadata ?? {}), acceptanceResourceId: entry.id };
          const camera = debug.player.camera;
          const position = entry.mesh.getAbsolutePosition();
          camera.position.copyFrom(position).addInPlaceFromFloats(0, 0.2, 0);
          debug.interactions.update();
          return { id: entry.id, label: entry.label, prompt: document.querySelector("[data-prompt]")?.textContent };
        }
        """
    )
    assert before["prompt"] == f"[E] {before['label']}"
    page.keyboard.press("KeyE")
    page.wait_for_timeout(100)

    after = page.evaluate(
        """
        (id) => {
          const debug = window.__aiWorldDebug;
          const prompt = document.querySelector("[data-prompt]");
          const entry = debug.interactions.entries.get(id);
          const resource = debug.scene.meshes.find((mesh) => mesh.metadata?.acceptanceResourceId === id);
          return {
            entryPresent: Boolean(entry),
            promptVisible: prompt?.classList.contains("show") ?? false,
            promptText: prompt?.textContent ?? "",
            matchingResourceDisposed: resource ? resource.isDisposed() : true,
          };
        }
        """,
        before["id"],
    )
    assert not after["entryPresent"], after
    assert not after["promptVisible"], after
    assert after["promptText"] == "", after
    page.screenshot(path=str(ROOT / "browser-collection-after.png"), full_page=True)
    assert not errors, errors
    print(f"collected={before['label']} after={after} page-errors={errors!r}")
    browser.close()
