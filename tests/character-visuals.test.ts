import assert from "node:assert/strict";
import { test } from "node:test";
import { NullEngine, Scene } from "@babylonjs/core";
import {
  CHARACTER_CATALOG,
  CHARACTER_MODULE_SLOTS,
  characterDescriptor,
  type CharacterRole,
} from "../src/game/player/CharacterCatalog.ts";
import { buildCharacterVisual } from "../src/game/player/CharacterVisuals.ts";
import { TerrainSampler } from "../src/game/world/TerrainSampler.ts";
import { CharacterShowcaseLayer } from "../src/game/world/CharacterShowcaseLayer.ts";

const ROLES: CharacterRole[] = ["explorer", "merchant", "wildernessEnemy"];

test("character catalog contains three deterministic low-poly roles with complete modular outfits", () => {
  assert.deepEqual(Object.keys(CHARACTER_CATALOG), ROLES);
  for (const role of ROLES) {
    const descriptor = characterDescriptor(role);
    assert.equal(descriptor.appearance.style, "stylized-low-poly");
    assert.ok(descriptor.displayName.length > 0);
    for (const slot of CHARACTER_MODULE_SLOTS) {
      assert.ok(descriptor.appearance.modules[slot].length > 0, `${role} missing ${slot}`);
    }
    for (const value of Object.values(descriptor.appearance.palette)) {
      assert.match(value, /^#[0-9a-f]{6}$/i);
    }
    assert.ok(descriptor.views.front.length > 20);
    assert.ok(descriptor.views.side.length > 20);
    assert.ok(descriptor.views.back.length > 20);
  }
});

test("character catalog keeps role silhouettes and profession cues distinct", () => {
  const explorer = characterDescriptor("explorer");
  const merchant = characterDescriptor("merchant");
  const enemy = characterDescriptor("wildernessEnemy");

  assert.notEqual(explorer.appearance.modules.headwear, merchant.appearance.modules.headwear);
  assert.notEqual(explorer.appearance.modules.carry, merchant.appearance.modules.carry);
  assert.notEqual(merchant.appearance.modules.outfit, enemy.appearance.modules.outfit);
  assert.match(merchant.views.front, /帽|挂牌|货/);
  assert.match(enemy.views.side, /护腕|短棒|前倾/);
});

test("player avatar default appearance is the explorer catalog appearance with replaceable modules", async () => {
  const { DEFAULT_PLAYER_AVATAR } = await import("../src/game/player/PlayerAvatar.ts");
  assert.deepEqual(DEFAULT_PLAYER_AVATAR, characterDescriptor("explorer").appearance);
  assert.ok(DEFAULT_PLAYER_AVATAR.modules.carry.length > 0);
});

test("modular character visuals build bounded finite low-poly parts for every role", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  for (const role of ROLES) {
    const build = buildCharacterVisual(scene, characterDescriptor(role));
    assert.equal(build.moduleNodes.size, CHARACTER_MODULE_SLOTS.length);
    assert.ok(build.meshCount >= 8 && build.meshCount <= 28, `${role} mesh count=${build.meshCount}`);
    for (const [slot, node] of build.moduleNodes) {
      assert.equal(node.name, `character:${characterDescriptor(role).id}:module:${slot}:${characterDescriptor(role).appearance.modules[slot]}`);
      assert.ok(Number.isFinite(node.position.x));
      assert.ok(Number.isFinite(node.rotation.y));
    }
    assert.ok(build.root.getChildMeshes().every((mesh) => !mesh.isPickable));
    const bounds = build.root.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    assert.ok(height >= 1.5 && height <= 1.75, `${role} first-person scale height=${height}`);
    const head = build.root.getChildMeshes(false).find((mesh) => mesh.name === "head");
    assert.ok(head, `${role} head mesh is missing`);
    assert.ok(head!.getTotalVertices() >= 12, `${role} head should be rounded, not an octahedron spike`);
    for (const feature of ["neck", "eye-left", "eye-right", "nose", "mouth"]) {
      assert.ok(build.root.getChildMeshes(false).some((mesh) => mesh.name === feature), `${role} ${feature} is missing`);
    }
    assert.ok(build.root.getChildMeshes(false).every((mesh) => !mesh.receiveShadows), `${role} face parts must not self-receive shadows`);
  }
  scene.dispose();
  engine.dispose();
});

test("home character showcase is deterministic, terrain-attached and contains one display for each role", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sampler = new TerrainSampler(18421);
  const layer = new CharacterShowcaseLayer(scene);
  const first = layer.build(-190, -730, sampler);
  const second = layer.build(-190, -730, sampler);

  assert.equal(first.roles.length, 3);
  assert.deepEqual(first.roles.map((role) => role.role), ROLES);
  assert.deepEqual(first.center, second.center);
  assert.equal(first.center.y, sampler.height(-190, -730));
  assert.ok(first.root.name.includes("character-showcase"));
  assert.ok(first.roles.every((role) => role.root.getChildMeshes(false).every((mesh) => !mesh.isPickable)));
  layer.dispose();
  scene.dispose();
  engine.dispose();
});
