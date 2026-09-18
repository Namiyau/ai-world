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
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.addInitScript((saveValue) => window.localStorage.setItem("economy-world-save-v1", saveValue), JSON.stringify(save));
    await page.goto(browserUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__aiWorldDebug, undefined, { timeout: 10000 });
    await page.waitForTimeout(1800);
    await page.locator('[data-main-action="single-player"]').click();
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      game.setPaused(true);
      game.player.setMode("flight");
      game.player.camera.position.set(-174, 5.6, -730);
      game.player.camera.rotation.set(0, -Math.PI / 2, 0);
    });
    await page.waitForTimeout(450);

    const result = await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      const showcase = game.world.characterShowcaseBuild;
      if (!showcase) throw new Error("home character showcase is not active");
      return {
        target: game.world.characterShowcaseTarget,
        roles: showcase.roles.map((entry) => ({
          role: entry.role,
          displayName: entry.displayName,
          meshCount: entry.visual.meshCount,
          modules: [...entry.visual.moduleNodes.keys()],
        })),
        rootY: showcase.root.position.y,
        terrainY: game.world.getTerrainHeight(showcase.center.x, showcase.center.z),
        hud: document.querySelector("[data-character-showcase]").textContent,
      };
    });
    assert.deepEqual(result.roles.map((entry) => entry.role), ["explorer", "merchant", "wildernessEnemy"]);
    assert.deepEqual(result.roles.map((entry) => entry.modules.length), [7, 7, 7]);
    assert.ok(result.roles.every((entry) => entry.meshCount >= 8 && entry.meshCount <= 28), JSON.stringify(result));
    assert.equal(result.rootY, result.terrainY);
    assert.match(result.hud, /角色展示点/);
    assert.ok(result.target && result.target.x === -190 && result.target.z === -730, JSON.stringify(result));

    // Keep the deterministic paused camera, but hide only the menu overlay so the
    // acceptance artifact shows the actual showcase geometry.
    await page.evaluate(() => document.querySelector("[data-menu]")?.classList.remove("open"));
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(__dirname, "browser-character-showcase.png"), fullPage: false });
    assert.deepEqual(consoleErrors.filter((error) => !error.includes("404 (Not Found)")), []);
    assert.deepEqual(pageErrors, []);
    console.log(`character-showcase=${JSON.stringify(result)}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
