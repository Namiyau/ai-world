import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BROWSER_URL = os.environ.get("AI_WORLD_BROWSER_URL", "http://127.0.0.1:5173")
SAVE_KEY = "economy-world-save-v1"
PAUSE_SETTINGS_KEY = "ai-world-pause-settings-v1"

save = {
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
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script(
        "window.localStorage.setItem(%r, %r); window.localStorage.removeItem(%r);"
        % (SAVE_KEY, json.dumps(save), PAUSE_SETTINGS_KEY)
    )
    page_errors = []
    console_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto(BROWSER_URL, wait_until="domcontentloaded")
    page.wait_for_function("window.__aiWorldDebug")
    page.wait_for_timeout(1800)

    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(400)
    page.evaluate("window.__aiWorldDebug.setPaused(true)")
    page.locator('[data-action="time-dawn"]').wait_for(state="visible")

    page.evaluate("document.querySelector('[data-action=\"time-noon\"]').click()")
    noon = page.evaluate("() => window.__aiWorldDebug.world.atmosphere.visualState.daylight")
    assert noon > 0.8, noon

    page.evaluate("""
      () => {
        const update = (selector, value, checked = false) => {
          const control = document.querySelector(selector);
          if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = checked;
          else control.value = value;
          control.dispatchEvent(new Event('input', { bubbles: true }));
          control.dispatchEvent(new Event('change', { bubbles: true }));
        };
        update('[data-setting="fovDegrees"]', '98');
        update('[data-setting="sensitivity"]', '1.5');
        update('[data-setting="fogDistance"]', 'far');
        update('[data-setting="showHints"]', '', false);
        update('[data-setting="reducedMotion"]', '', true);
      }
    """)
    preferences = page.evaluate(
        """
        () => ({
          fov: window.__aiWorldDebug.player.camera.fov,
          fog: window.__aiWorldDebug.world.atmosphere.visualState.fogDensity,
          hintsHidden: document.querySelector('.help').classList.contains('hidden'),
          reducedMotion: document.documentElement.dataset.reducedMotion,
          saved: JSON.parse(localStorage.getItem('ai-world-pause-settings-v1')),
          avatar: window.__aiWorldDebug.avatarSnapshot,
        })
        """
    )
    assert abs(preferences["fov"] - 98 * 3.141592653589793 / 180) < 0.001, preferences
    assert preferences["hintsHidden"] is True, preferences
    assert preferences["reducedMotion"] == "true", preferences
    assert preferences["saved"]["fogDistance"] == "far", preferences
    assert preferences["saved"]["sensitivity"] == 1.5, preferences
    assert preferences["avatar"]["appearance"]["style"] == "stylized-low-poly", preferences
    assert preferences["avatar"]["appearance"]["outfit"] == "wilderness-explorer", preferences
    assert preferences["avatar"]["id"] == "local-player", preferences
    assert all(isinstance(preferences["avatar"]["position"][axis], (int, float)) for axis in ("x", "y", "z")), preferences

    page.screenshot(path=str(ROOT / "browser-esc-avatar.png"), full_page=True)
    assert not [error for error in console_errors if "404 (Not Found)" not in error], console_errors
    assert not page_errors, page_errors
    print("esc=time-presets settings=persistent avatar=serializable multiplayer-contract=ready")
    browser.close()
