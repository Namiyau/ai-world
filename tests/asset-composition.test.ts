import test from "node:test";
import assert from "node:assert/strict";
import { resourceVisualProfile, selectResourceVisual } from "../src/game/assets/ResourceVisuals";

test("resource visual profiles describe semantic low-poly compositions", () => {
  const expected: Record<string, string[]> = {
    wood: ["log", "stump", "wood-block"],
    stone: ["mother-rock", "stone-a", "stone-b"],
    iron: ["mother-rock", "iron-vein"],
    copper: ["mother-rock", "copper-vein"],
    rare: ["mother-rock", "rare-crystal"],
    scrap: ["iron-plate", "pipe", "gear", "damaged-can"],
  };
  for (const [kind, components] of Object.entries(expected)) {
    const profile = resourceVisualProfile(kind as keyof typeof expected);
    assert.deepEqual(profile.components, components);
    assert.equal(profile.variants.length, 3);
    assert.ok(profile.assetId.length > 0);
  }
});

test("resource visual selection is deterministic and keeps collection metadata", () => {
  for (const kind of ["wood", "stone", "iron", "copper", "rare", "scrap"] as const) {
    const first = selectResourceVisual(kind, 90210);
    const second = selectResourceVisual(kind, 90210);
    assert.equal(first.variantId, second.variantId);
    assert.equal(first.profile.collectionTag, kind);
  }
});

