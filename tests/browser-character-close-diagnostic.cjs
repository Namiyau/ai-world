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
    await page.waitForTimeout(450);
    const report = await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      const showcase = game.world.characterShowcaseBuild;
      if (!showcase) throw new Error("showcase missing");
      game.setPaused(true);
      game.player.setMode("flight");
      const camera = game.player.camera;
      camera.position.set(showcase.center.x + 8, showcase.center.y + 3.2, showcase.center.z);
      const target = camera.position.clone();
      target.set(showcase.center.x, showcase.center.y + 1.4, showcase.center.z);
      camera.setTarget(target);
      document.querySelector("[data-menu]")?.classList.remove("open");
      const characterNames = showcase.roles.flatMap((entry) => [entry.visual.root, ...entry.visual.root.getChildMeshes()]).map((node) => node.name);
      const characterMeshes = showcase.roles.flatMap((entry) => entry.visual.root.getChildMeshes());
      const bounds = characterMeshes.map((mesh) => {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        return { name: mesh.name, min: box.minimumWorld.asArray(), max: box.maximumWorld.asArray(), receiveShadows: mesh.receiveShadows, material: mesh.material?.name ?? null };
      });
      return { center: showcase.center, camera: camera.position.asArray(), characterNames, bounds, shadowStats: game.world.atmosphere.shadowStats };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, "browser-character-close-diagnostic.png"), fullPage: false });
    if (pageErrors.length || consoleErrors.filter((entry) => !entry.includes("404 (Not Found)")).length) {
      throw new Error(JSON.stringify({ pageErrors, consoleErrors }));
    }
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
