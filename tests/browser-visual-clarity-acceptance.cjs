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
    await page.addInitScript((saveValue) => {
      window.localStorage.removeItem("ai-world-pause-settings-v1");
      window.localStorage.setItem("economy-world-save-v1", saveValue);
    }, JSON.stringify(save));
    await page.goto(browserUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__aiWorldDebug, undefined, { timeout: 10000 });
    await page.waitForTimeout(1800);
    await page.locator('[data-main-action="single-player"]').click();
    await page.waitForTimeout(450);

    const report = await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      const canvas = document.querySelector("#game-canvas");
      const engine = game.engine;
      const scene = game.scene;
      const sun = scene.getMeshByName("sun-disc");
      const halo = scene.getMeshByName("sun-halo");
      const waterMeshes = scene.meshes.filter((mesh) => mesh.name.startsWith("water-"));
      const characterBuild = game.world.characterShowcaseBuild;
      const ambient = scene.lights.find((light) => light.name === "ambient-light");
      const directional = scene.lights.find((light) => light.name === "sun");
      if (!canvas || !sun || !halo || !waterMeshes.length || !characterBuild || !ambient || !directional) {
        throw new Error("visual systems are incomplete");
      }
      const sunExtent = sun.getBoundingInfo().boundingBox.extendSizeWorld;
      return {
        canvas: { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
        render: { width: engine.getRenderWidth(), height: engine.getRenderHeight(), scaling: engine.getHardwareScalingLevel() },
        fog: { enabled: scene.fogEnabled, density: scene.fogDensity, color: scene.fogColor.toHexString() },
        shadowDarkness: game.world.atmosphere.shadowGenerator?.darkness ?? null,
        lights: {
          ambient: ambient.intensity,
          directional: directional.intensity,
          ground: ambient.groundColor.toHexString(),
        },
        sun: {
          extent: sunExtent.asArray(),
          billboardMode: sun.billboardMode,
          materialType: sun.material?.getClassName?.(),
          fogEnabled: sun.material?.fogEnabled,
          depthWriteDisabled: sun.material?.disableDepthWrite,
          haloFogEnabled: halo.material?.fogEnabled,
        },
        water: {
          meshes: waterMeshes.length,
          triangles: waterMeshes.reduce((sum, mesh) => sum + (mesh.metadata?.triangles?.length ?? 0), 0),
          alpha: waterMeshes[0].material?.alpha,
          backFaceCulling: waterMeshes[0].material?.backFaceCulling,
        },
        characters: characterBuild.roles.map((entry) => ({
          role: entry.role,
          meshCount: entry.visual.meshCount,
          height: (() => {
            const bounds = entry.visual.root.getHierarchyBoundingVectors(true);
            return bounds.max.y - bounds.min.y;
          })(),
          headVertices: entry.visual.root.getChildMeshes(false).find((mesh) => mesh.name === "head")?.getTotalVertices() ?? 0,
        })),
        characterReceivers: characterBuild.roles
          .flatMap((entry) => entry.visual.root.getChildMeshes(false))
          .filter((mesh) => mesh.receiveShadows).length,
      };
    });

    assert.ok(report.render.scaling <= 1, JSON.stringify(report.render));
    assert.ok(report.render.width >= report.canvas.clientWidth * 0.99, JSON.stringify(report));
    assert.ok(report.render.height >= report.canvas.clientHeight * 0.99, JSON.stringify(report));
    assert.ok(report.fog.density < 0.006, JSON.stringify(report.fog));
    assert.ok(report.shadowDarkness === null || (report.shadowDarkness >= 0.45 && report.shadowDarkness <= 0.8), JSON.stringify(report));
    assert.ok(report.lights.ambient < report.lights.directional, JSON.stringify(report.lights));
    assert.ok(Math.abs(report.sun.extent[0] - report.sun.extent[1]) <= 0.01 && report.sun.extent[0] > 0 && report.sun.extent[2] <= 0.01, JSON.stringify(report.sun));
    assert.equal(report.sun.billboardMode, 7, JSON.stringify(report.sun));
    assert.equal(report.sun.materialType, "ShaderMaterial", JSON.stringify(report.sun));
    assert.equal(report.sun.fogEnabled, false);
    assert.equal(report.sun.depthWriteDisabled, true);
    assert.equal(report.sun.haloFogEnabled, false);
    assert.equal(report.water.backFaceCulling, true);
    assert.ok(report.water.alpha >= 0.9 && report.water.triangles > 0, JSON.stringify(report.water));
    assert.ok(report.characters.every((entry) => entry.height >= 1.5 && entry.height <= 1.75 && entry.headVertices >= 12), JSON.stringify(report.characters));
    assert.equal(report.characterReceivers, 0, JSON.stringify(report));

    await page.keyboard.press("Escape");
    await page.locator('[data-setting="renderResolution"]').selectOption("75");
    await page.waitForTimeout(120);
    const lowResolution = await page.evaluate(() => ({
      width: window.__aiWorldDebug.engine.getRenderWidth(),
      height: window.__aiWorldDebug.engine.getRenderHeight(),
      scaling: window.__aiWorldDebug.engine.getHardwareScalingLevel(),
      status: document.querySelector('[data-setting-output="renderResolution"]')?.textContent,
    }));
    assert.ok(lowResolution.scaling > 1, JSON.stringify(lowResolution));
    assert.ok(lowResolution.width <= report.canvas.clientWidth * 0.76, JSON.stringify(lowResolution));
    assert.match(lowResolution.status ?? "", /75%/);
    await page.locator('[data-setting="renderResolution"]').selectOption("100");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);

    await page.screenshot({ path: path.join(__dirname, "browser-visual-clarity-normal.png"), fullPage: false });

    await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      game.setPaused(true);
      game.world.setTimePreset("noon");
      const camera = game.player.camera;
      camera.setTarget(camera.position.add(game.world.atmosphere.sunDirection.scale(1000)));
      document.querySelector("[data-menu]")?.classList.remove("open");
    });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(__dirname, "browser-visual-clarity-sun.png"), fullPage: false });

    await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      game.player.camera.position.set(-174, 5.6, -730);
      game.player.camera.rotation.set(0, -Math.PI / 2, 0);
    });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(__dirname, "browser-visual-clarity-water-characters.png"), fullPage: false });

    assert.deepEqual(consoleErrors.filter((error) => !error.includes("404 (Not Found)")), []);
    assert.deepEqual(pageErrors, []);
    console.log(`visual-clarity=${JSON.stringify(report)}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
