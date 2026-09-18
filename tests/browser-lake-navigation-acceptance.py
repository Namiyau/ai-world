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
        "home": {"x": 212, "y": 4, "z": -1212},
        "mission": {"x": 0, "y": 3, "z": -9},
    },
}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script(f"localStorage.setItem({json.dumps(SAVE_KEY)}, {json.dumps(json.dumps(save))});")
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto(BROWSER_URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1800)

    coordinates = page.locator("[data-coordinates]")
    lake_target = page.locator("[data-lake-target]")
    assert coordinates.inner_text().startswith("坐标 X ")
    assert "湖泊 X" in lake_target.inner_text()

    # Headless Chrome may reject pointer lock, which immediately re-opens the
    # pause menu through the game's safety handler. Open it through the same
    # public Game state transition so this test remains about the navigation
    # button rather than pointer-lock availability.
    page.evaluate("window.__aiWorldDebug.setPaused(true)")
    page.locator('[data-action="lake"]').wait_for(state="visible")
    page.locator('[data-action="lake"]').click()
    page.wait_for_timeout(900)

    result = page.evaluate(
        """
        () => {
          const debug = window.__aiWorldDebug;
          if (!debug) throw new Error("debug handle unavailable");
          const position = debug.player.camera.position;
          const target = debug.world.nearestLakeTarget(position.x, position.z);
          if (!target) throw new Error("lake target unavailable after teleport");
          return {
            x: position.x,
            z: position.z,
            lakeX: target.x,
            lakeZ: target.z,
            distance: Math.hypot(position.x - target.x, position.z - target.z),
            height: debug.world.getTerrainHeight(position.x, position.z),
          };
        }
        """
    )
    assert result["distance"] < 150, result
    assert result["height"] > 0.6, result
    assert coordinates.inner_text().startswith("坐标 X ")
    assert "湖泊 X" in lake_target.inner_text()
    assert "已到达湖岸" in page.locator("[data-toast]").inner_text()
    assert not [error for error in console_errors if "404 (Not Found)" not in error]
    assert not page_errors

    page.screenshot(path=str(ROOT / "browser-lake-navigation.png"), full_page=True)
    print(f"lake-navigation={result}")
    browser.close()
