import test from "node:test";
import assert from "node:assert/strict";
import { ASSET_CATEGORIES } from "../src/game/assets/AssetTypes";
import { getAssetDefinition, listAssetDefinitions, listAssetsByCategory, selectAssetVariant } from "../src/game/assets/AssetRegistry";

test("AssetRegistry covers every replaceable asset category", () => {
    for (const category of ASSET_CATEGORIES) {
      assert.ok(listAssetsByCategory(category).length > 0, category);
    }
});

test("AssetRegistry keeps resource and role variants deterministic", () => {
    for (const id of ["wood-resource", "stone-resource", "iron-ore", "copper-ore", "rare-ore", "scrap", "character-player", "character-merchant", "character-enemy"]) {
      const definition = getAssetDefinition(id);
      assert.ok(definition.variants.length >= 3, id);
      assert.equal(selectAssetVariant(id, 12345).variant.id, selectAssetVariant(id, 12345).variant.id);
      assert.equal(selectAssetVariant(id, 12345).assetId, id);
    }
});

test("AssetRegistry has a fallback key for every manifest entry", () => {
    for (const definition of listAssetDefinitions()) {
      assert.ok(definition.defaultFallbackKey.length > 0, definition.id);
      for (const variant of definition.variants) {
        assert.ok(variant.fallbackKey.length > 0, `${definition.id}/${variant.id}`);
      }
    }
});

test("AssetRegistry selects more than one visual variant across stable seeds", () => {
    const selected = new Set([11, 12, 13, 14, 15, 16].map((seed) => selectAssetVariant("rock-large", seed).variant.id));
    assert.ok(selected.size > 1);
});
