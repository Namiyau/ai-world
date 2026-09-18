const assert = require("node:assert/strict");
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.addInitScript((saveValue) => {
      window.localStorage.removeItem("ai-world-pause-settings-v1");
      window.localStorage.setItem("economy-world-save-v1", saveValue);
    }, JSON.stringify(save));
    await page.goto(browserUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__aiWorldDebug, undefined, { timeout: 10000 });
    await page.waitForTimeout(900);
    await page.locator('[data-main-action="single-player"]').click();
    await page.waitForTimeout(1400);

    const positions = [];
    for (let i = 0; i < 50; i += 1) {
      positions.push(await page.evaluate(() => {
        const point = window.__aiWorldDebug.player.camera.position;
        return { x: point.x, y: point.y, z: point.z };
      }));
      await page.waitForTimeout(50);
    }

    const report = await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      const atmosphere = game.world.atmosphere;
      const generator = atmosphere.shadowGenerator;
      const shadowMap = generator?.getShadowMap();
      const casterNames = shadowMap?.renderList?.map((mesh) => mesh.name) ?? [];
      const groundReceivers = game.scene.meshes.filter((mesh) => mesh.name.startsWith("ground-") && mesh.receiveShadows).length;
      return {
        shadows: {
          kind: generator?.getClassName?.(),
          cascades: atmosphere.shadowStats.cascades,
          maxDistance: atmosphere.shadowStats.maxDistance,
          casterCount: atmosphere.shadowStats.casterCount,
          renderList: casterNames,
          groundReceivers,
        },
        lighting: {
          ambient: game.scene.getLightByName("ambient-light")?.intensity,
          sun: game.scene.getLightByName("sun")?.intensity,
          fog: game.scene.fogDensity,
        },
      };
    });

    const ySpan = Math.max(...positions.map((point) => point.y)) - Math.min(...positions.map((point) => point.y));
    const planarSpan = Math.max(...positions.map((point) => Math.hypot(point.x - positions[0].x, point.z - positions[0].z)));
    assert.ok(ySpan <= 0.003, `still camera Y drift ${ySpan}: ${JSON.stringify(positions.slice(0, 4))}`);
    assert.ok(planarSpan <= 0.003, `still camera planar drift ${planarSpan}`);
    assert.equal(report.shadows.kind, "CascadedShadowGenerator", JSON.stringify(report.shadows));
    assert.equal(report.shadows.cascades, 3, JSON.stringify(report.shadows));
    assert.ok(report.shadows.maxDistance >= 90 && report.shadows.maxDistance <= 160, JSON.stringify(report.shadows));
    assert.ok(report.shadows.casterCount >= 5, JSON.stringify(report.shadows));
    assert.ok(report.shadows.groundReceivers > 0, JSON.stringify(report.shadows));
    assert.ok(report.shadows.renderList.some((name) => name.startsWith("tree-") || name.startsWith("poi-") || name.startsWith("showcase-")), JSON.stringify(report.shadows));
    assert.ok(report.shadows.renderList.every((name) => !name.startsWith("grass-i-") && !name.startsWith("flower-")), JSON.stringify(report.shadows));
    assert.ok(report.lighting.ambient < report.lighting.sun, JSON.stringify(report.lighting));
    assert.ok(report.lighting.fog < 0.004, JSON.stringify(report.lighting));
    assert.deepEqual(consoleErrors.filter((error) => !error.includes("404 (Not Found)")), []);
    assert.deepEqual(pageErrors, []);
    console.log(`visual-foundation=${JSON.stringify({ ySpan, planarSpan, ...report })}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
