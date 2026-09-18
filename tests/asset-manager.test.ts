import test from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder, NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { AssetManager, type AssetContainerHandle, type AssetLoader } from "../src/game/assets/AssetManager";

function fakeLoader(counter: { loads: number }, scene: Scene): AssetLoader {
  return {
    async load(): Promise<AssetContainerHandle> {
      counter.loads += 1;
      return {
        instantiate(namePrefix) {
          return { roots: [new TransformNode(`${namePrefix}-formal`, scene)] };
        },
        dispose() {},
      };
    },
  };
}

test("AssetManager caches GLB variants and replaces a fallback slot", async () => {
  const scene = new Scene(new NullEngine());
  const counter = { loads: 0 };
  const manager = new AssetManager(scene, { loader: fakeLoader(counter, scene) });
  const fallback = MeshBuilder.CreateBox("fallback", { size: 1 }, scene);
  const first = manager.createSlot("tree-round", 42, [fallback]);
  const second = manager.createSlot("tree-round", 42, []);

  assert.equal(await first.ready, true);
  assert.equal(await second.ready, true);
  assert.equal(counter.loads, 1);
  assert.equal(fallback.isEnabled(), false);
  assert.equal(first.root.metadata.asset.source, "glb");
  assert.equal(first.root.getChildren().filter((child) => child.name.includes("formal")).length, 1);
  manager.dispose();
  scene.dispose();
});

test("AssetManager preload warms one usable variant per asset instead of every variant", async () => {
  const scene = new Scene(new NullEngine());
  const counter = { loads: 0 };
  const manager = new AssetManager(scene, { loader: fakeLoader(counter, scene) });

  await manager.preload(["tree-round", "character-player"]);

  assert.equal(counter.loads, 1);
  manager.dispose();
  scene.dispose();
});

test("AssetManager retains a procedural fallback when a GLB fails", async () => {
  const scene = new Scene(new NullEngine());
  const fallback = MeshBuilder.CreateBox("fallback", { size: 1 }, scene);
  const manager = new AssetManager(scene, {
    loader: { async load(): Promise<AssetContainerHandle> { throw new Error("missing"); } },
    warn: () => {},
  });
  const slot = manager.createSlot("rock-large", 7, [fallback]);
  assert.equal(await slot.ready, false);
  assert.equal(fallback.isEnabled(), true);
  assert.equal(slot.root.metadata.asset.source, "procedural-fallback");
  assert.equal(manager.diagnostics.length, 1);
  manager.dispose();
  scene.dispose();
});

test("AssetManager documents deliberate character fallback until a rigged GLB is supplied", async () => {
  const scene = new Scene(new NullEngine());
  const manager = new AssetManager(scene, { warn: () => {} });
  const slot = manager.createSlot("character-player", 1);
  assert.equal(await slot.ready, false);
  assert.equal(slot.root.metadata.asset.source, "procedural-fallback");
  assert.equal(slot.root.metadata.asset.fallbackKey, "characterExplorer");
  manager.dispose();
  scene.dispose();
});
