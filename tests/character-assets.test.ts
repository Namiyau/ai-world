import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_MODULE_SLOTS } from "../src/game/player/CharacterCatalog";
import { characterAssetContract } from "../src/game/assets/CharacterAssetContract";

test("character assets share one skeleton and all modular replacement slots", () => {
  for (const role of ["explorer", "merchant", "wildernessEnemy"] as const) {
    const contract = characterAssetContract(role);
    assert.equal(contract.skeletonId, "humanoid-base-v1");
    assert.deepEqual(contract.moduleSlots, CHARACTER_MODULE_SLOTS);
    assert.ok(contract.assetId.startsWith("character-"));
  }
});

