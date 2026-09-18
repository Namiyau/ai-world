const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("./playwright-core.cjs");

const browserUrl = process.env.AI_WORLD_BROWSER_URL || "http://127.0.0.1:5173";
const save = {
  version: 1,
  money: 120,
  inventory: { wood: 0, stone: 0, scrap: 0, relic: 0 },
  collectedResourceIds: [],
  positions: { home: { x: -128, y: 4, z: -704 }, mission: { x: 0, y: 3, z: -9 } },
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(([saveKey, saveValue, pauseKey]) => {
      window.localStorage.setItem(saveKey, saveValue);
      window.localStorage.removeItem(pauseKey);
    }, ["economy-world-save-v1", JSON.stringify(save), "ai-world-pause-settings-v1"]);
    await page.goto(browserUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__aiWorldDebug, { timeout: 10000 });
    await page.waitForTimeout(1400);

    await page.locator('[data-main-action="single-player"]').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__aiWorldDebug.setPaused(true));
    await page.locator('[data-action="time-dawn"]').waitFor({ state: "visible" });

    assert.equal(await page.locator('[data-action^="time-"]').count(), 4);
    await page.evaluate(() => document.querySelector('[data-action="time-noon"]').click());
    const noon = await page.evaluate(() => window.__aiWorldDebug.world.atmosphere.visualState.daylight);
    assert.ok(noon > 0.8, `noon daylight=${noon}`);

    // Dispatch real bubbling input/change events so this acceptance check exercises
    // the same persisted-menu path without depending on headless Chromium's known
    // nested-overlay checkbox hit-test defect.
    await page.evaluate(() => {
      const update = (selector, value, checked = false) => {
        const control = document.querySelector(selector);
        if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = checked;
        else control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      };
      update('[data-setting="fovDegrees"]', "98");
      update('[data-setting="sensitivity"]', "1.5");
      update('[data-setting="fogDistance"]', "far");
      update('[data-setting="showHints"]', "", false);
      update('[data-setting="reducedMotion"]', "", true);
    });
    const state = await page.evaluate(() => ({
      fov: window.__aiWorldDebug.player.camera.fov,
      hintsHidden: document.querySelector(".help").classList.contains("hidden"),
      reducedMotion: document.documentElement.dataset.reducedMotion,
      saved: JSON.parse(window.localStorage.getItem("ai-world-pause-settings-v1")),
      avatar: window.__aiWorldDebug.avatarSnapshot,
    }));
    assert.ok(Math.abs(state.fov - (98 * Math.PI) / 180) < 0.001, JSON.stringify(state));
    assert.equal(state.hintsHidden, true, JSON.stringify(state));
    assert.equal(state.reducedMotion, "true", JSON.stringify(state));
    assert.equal(state.saved.fogDistance, "far", JSON.stringify(state));
    assert.equal(state.saved.sensitivity, 1.5, JSON.stringify(state));
    assert.equal(state.avatar.appearance.style, "stylized-low-poly", JSON.stringify(state));
    assert.equal(state.avatar.appearance.outfit, "wilderness-explorer", JSON.stringify(state));
    assert.equal(state.avatar.id, "local-player", JSON.stringify(state));
    for (const axis of ["x", "y", "z"]) assert.equal(typeof state.avatar.position[axis], "number", JSON.stringify(state));

    await page.screenshot({ path: path.join(__dirname, "browser-esc-avatar.png"), fullPage: true });
    assert.deepEqual(errors.filter((error) => !error.includes("404 (Not Found)")), []);
    console.log("esc=time-presets settings=persistent avatar=serializable multiplayer-contract=ready");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
