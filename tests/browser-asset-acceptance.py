from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    asset_responses: list[tuple[str, int]] = []
    console_errors: list[str] = []
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("response", lambda response: asset_responses.append((response.url, response.status)) if ".glb" in response.url else None)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        page.goto("http://127.0.0.1:5173", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(ROOT / "browser-asset-review.png"), full_page=True)
        assert page.locator('[data-main-action="single-player"]').count() == 1
        page.get_by_text("开始单人游戏", exact=True).click()
        page.wait_for_timeout(8000)
        page.screenshot(path=str(ROOT / "browser-asset-world-review.png"), full_page=True)

        assert not page_errors, page_errors
        assert not console_errors, console_errors
        assert asset_responses, "No local GLB asset was requested"
        assert all(status == 200 for _, status in asset_responses), asset_responses
        categories = {"nature": False, "survival": False, "industrial": False}
        for url, _ in asset_responses:
            for category in categories:
                categories[category] |= f"/assets/{category}/" in url
        assert all(categories.values()), categories
        assert page.locator("canvas#game-canvas").count() == 1
        browser.close()


if __name__ == "__main__":
    main()
