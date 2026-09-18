import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
BROWSER_URL = os.environ.get("AI_WORLD_BROWSER_URL", "http://127.0.0.1:5173")
SAVE_KEY = "economy-world-save-v1"
SETTINGS_KEY = "ai-world-settings-v1"

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


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.add_init_script("window.localStorage.setItem(%r, %r);" % (SAVE_KEY, json.dumps(save)))
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(BROWSER_URL, wait_until="networkidle")
    page.wait_for_timeout(2500)

    expect(page.locator("[data-main-menu]")).to_be_visible()
    expect(page.locator('[data-main-action="single-player"]')).to_be_visible()
    expect(page.locator('[data-main-action="settings"]')).to_be_visible()
    expect(page.locator('[data-main-action="controls"]')).to_be_visible()
    expect(page.locator("#hud-root")).to_have_class(re.compile(r"\bgame-hud-hidden\b"))
    page.locator("#main-menu-root").screenshot(path=str(ROOT / "browser-main-menu.png"))

    mobile = context.new_page()
    mobile.set_viewport_size({"width": 390, "height": 844})
    mobile.goto(BROWSER_URL, wait_until="networkidle")
    mobile.wait_for_timeout(1800)
    expect(mobile.locator("[data-main-menu]")).to_be_visible()
    mobile.locator("#main-menu-root").screenshot(path=str(ROOT / "browser-main-menu-mobile.png"))
    mobile.close()

    page.locator('[data-main-action="multiplayer"]').click()
    expect(page.locator('[data-main-page="multiplayer"]')).to_be_visible()
    expect(page.locator('[data-main-status="coming-soon"]')).to_have_text("即将推出")
    page.locator('[data-main-page="multiplayer"] [data-main-action="back"]').click()
    expect(page.locator('[data-main-page="home"]')).to_be_visible()

    page.locator('[data-main-action="settings"]').click()
    reduced_motion = page.locator('[data-setting="reduced-motion"]')
    expect(reduced_motion).not_to_be_checked()
    reduced_motion.check()
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2000)
    expect(page.locator('[data-setting="reduced-motion"]')).to_be_checked()
    page.locator('[data-main-action="settings"]').click()
    page.locator('[data-main-page="settings"] [data-main-action="back"]').click()

    page.locator('[data-main-action="single-player"]').click()
    expect(page.locator('[data-main-menu]')).not_to_be_visible()
    expect(page.locator("#hud-root")).not_to_have_class(re.compile(r"\bgame-hud-hidden\b"))
    paused = page.evaluate("() => window.__aiWorldDebug?.paused")
    if paused is True:
        raise AssertionError("single-player action did not resume the game")

    assert not page_errors, page_errors
    print("main-menu=visible multiplayer=coming-soon settings=persistent single-player=started")
    browser.close()
