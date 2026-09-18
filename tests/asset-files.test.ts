import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { listAssetDefinitions } from "../src/game/assets/AssetRegistry";

test("every vendored registry GLB resolves to a local public asset", () => {
  const missing: string[] = [];
  for (const definition of listAssetDefinitions()) {
    for (const variant of definition.variants) {
      if (!variant.url) continue;
      if (!existsSync(`public${variant.url}`)) missing.push(`${definition.id}/${variant.id}: ${variant.url}`);
    }
  }
  assert.deepEqual(missing, []);
});

