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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.addInitScript((saveValue) => {
      window.localStorage.removeItem("ai-world-pause-settings-v1");
      window.localStorage.setItem("economy-world-save-v1", saveValue);
    }, JSON.stringify(save));
    await page.goto(browserUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__aiWorldDebug, undefined, { timeout: 10000 });
    await page.waitForTimeout(500);

    const snapshot = () => page.evaluate(() => {
      const game = window.__aiWorldDebug;
      if (!game?.world) throw new Error("World debug handle is unavailable");
      return game.world.performanceSnapshot;
    });

    const initial = await snapshot();
    assert.equal(initial.chunkLoadRadius, 3, JSON.stringify(initial));
    assert.equal(initial.targetChunks, 49, JSON.stringify(initial));
    assert.ok(initial.loadedChunks <= 9, `initial load must not synchronously build the full window: ${JSON.stringify(initial)}`);
    assert.equal(initial.pendingChunks, initial.targetChunks - initial.loadedChunks, JSON.stringify(initial));

    await page.locator('[data-main-action="single-player"]').click();
    await page.waitForTimeout(1200);
    const running = await snapshot();
    assert.ok(running.loadedChunks <= running.targetChunks, JSON.stringify(running));
    assert.ok(running.sceneMeshes > 0, JSON.stringify(running));

    const baselineFrames = await page.evaluate(() => new Promise((resolve) => {
      const frameTimes = [];
      let last = performance.now();
      const tick = (now) => {
        frameTimes.push(now - last);
        last = now;
        if (frameTimes.length < 60) {
          requestAnimationFrame(tick);
          return;
        }
        resolve({
          frames: frameTimes.length,
          averageFrameMs: frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length,
          maxFrameMs: Math.max(...frameTimes),
          p95FrameMs: [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)],
        });
      };
      requestAnimationFrame(tick);
    }));
    assert.equal(baselineFrames.frames, 60, JSON.stringify(baselineFrames));
    assert.ok(baselineFrames.maxFrameMs < 180, JSON.stringify(baselineFrames));

    await page.keyboard.press("Escape");
    await page.locator('[data-setting="chunkLoadRadius"]').selectOption("2");
    const switchedLow = await snapshot();
    assert.equal(switchedLow.chunkLoadRadius, 2, JSON.stringify(switchedLow));
    assert.equal(switchedLow.targetChunks, 25, JSON.stringify(switchedLow));
    assert.ok(switchedLow.loadedChunks <= 25, JSON.stringify(switchedLow));
    assert.ok(switchedLow.pendingChunks <= 25, JSON.stringify(switchedLow));

    await page.locator('[data-setting="chunkLoadRadius"]').selectOption("6");
    const switchedHigh = await snapshot();
    assert.equal(switchedHigh.chunkLoadRadius, 6, JSON.stringify(switchedHigh));
    assert.equal(switchedHigh.targetChunks, 169, JSON.stringify(switchedHigh));
    assert.equal(switchedHigh.loadedChunks + switchedHigh.pendingChunks, 169, JSON.stringify(switchedHigh));
    assert.ok(switchedHigh.pendingChunks > 0, "large view distance should stream in progressively");

    const streamingFrames = await page.evaluate(() => new Promise((resolve) => {
      const game = window.__aiWorldDebug;
      game.setPaused(false);
      const frameTimes = [];
      const longTasks = [];
      let last = performance.now();
      let observer = null;
      if ("PerformanceObserver" in window) {
        try {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
          });
          observer.observe({ entryTypes: ["longtask"] });
        } catch {
          observer = null;
        }
      }
      const tick = (now) => {
        frameTimes.push(now - last);
        last = now;
        if (frameTimes.length < 90) {
          requestAnimationFrame(tick);
          return;
        }
        game.setPaused(true);
        observer?.disconnect();
        const sorted = [...frameTimes].sort((a, b) => a - b);
        resolve({
          frames: frameTimes.length,
          averageFrameMs: frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length,
          maxFrameMs: Math.max(...frameTimes),
          p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
          longTaskCount: longTasks.length,
          snapshot: game.world.performanceSnapshot,
        });
      };
      requestAnimationFrame(tick);
    }));
    assert.equal(streamingFrames.frames, 90, JSON.stringify(streamingFrames));
    assert.ok(streamingFrames.maxFrameMs < 180, JSON.stringify(streamingFrames));
    assert.ok(streamingFrames.snapshot.loadedChunks <= 169, JSON.stringify(streamingFrames));

    await page.locator('[data-setting="chunkLoadRadius"]').selectOption("3");
    const reducedAgain = await snapshot();
    assert.equal(reducedAgain.chunkLoadRadius, 3, JSON.stringify(reducedAgain));
    assert.ok(reducedAgain.loadedChunks <= 49, JSON.stringify(reducedAgain));
    assert.ok(reducedAgain.pendingChunks <= 49, JSON.stringify(reducedAgain));
    assert.ok(reducedAgain.chunkDisposeCount > 0, JSON.stringify(reducedAgain));
    const savedSettings = await page.evaluate(() => JSON.parse(window.localStorage.getItem("ai-world-pause-settings-v1") || "{}"));
    assert.equal(savedSettings.chunkLoadRadius, 3, JSON.stringify(savedSettings));
    assert.match(await page.locator('[data-setting-output="chunkLoadRadius"]').textContent(), /3.*49/);

    const movedFar = await page.evaluate(() => {
      const game = window.__aiWorldDebug;
      game.player.camera.position.set(4096, 12, 4096);
      game.world.update(game.player.camera.position);
      return game.world.performanceSnapshot;
    });
    assert.ok(movedFar.loadedChunks <= 12, JSON.stringify(movedFar));
    assert.equal(movedFar.loadedChunks + movedFar.pendingChunks, 49, JSON.stringify(movedFar));
    assert.ok(movedFar.chunkDisposeCount > reducedAgain.chunkDisposeCount, JSON.stringify(movedFar));
    assert.ok(movedFar.sceneMeshes < reducedAgain.sceneMeshes, JSON.stringify({ reducedAgain, movedFar }));
    assert.ok(movedFar.shadowCasters < reducedAgain.shadowCasters, JSON.stringify({ reducedAgain, movedFar }));

    await page.screenshot({ path: path.join(__dirname, "browser-chunk-performance.png"), fullPage: false });
    assert.deepEqual(pageErrors, []);
    console.log(`chunk-performance=${JSON.stringify({ initial, running, baselineFrames, low: switchedLow, high: switchedHigh, streamingFrames, reduced: reducedAgain, movedFar })}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
