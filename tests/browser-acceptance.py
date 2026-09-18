from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto("http://127.0.0.1:5173", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2500)

    page.locator('[data-main-action="single-player"]').click()
    page.wait_for_timeout(250)

    canvas = page.locator("#game-canvas")
    hud = page.locator("#hud-root")
    assert canvas.count() == 1
    assert hud.count() == 1
    page.screenshot(path=str(ROOT / "browser-normal.png"), full_page=True)

    canvas.click(position={"x": 720, "y": 450})
    page.keyboard.press("Space")
    page.wait_for_timeout(80)
    page.keyboard.press("Space")
    page.wait_for_timeout(300)
    page.keyboard.down("Space")
    page.wait_for_timeout(1600)
    page.keyboard.up("Space")
    page.screenshot(path=str(ROOT / "browser-high-flight.png"), full_page=True)

    page.keyboard.down("Shift")
    page.wait_for_timeout(2200)
    page.keyboard.up("Shift")
    page.screenshot(path=str(ROOT / "browser-underground-flight.png"), full_page=True)

    print(f"canvas={canvas.bounding_box()}")
    hud_text = hud.inner_text()[:240].encode("ascii", "backslashreplace").decode("ascii")
    print(f"hud-text={hud_text!r}")
    print(f"console-errors={console_errors!r}")
    print(f"page-errors={page_errors!r}")
    unexpected_console_errors = [
        error for error in console_errors if "404 (Not Found)" not in error
    ]
    assert not unexpected_console_errors
    assert not page_errors
    browser.close()
