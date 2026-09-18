# Visual Assets Update V2 Implementation Plan

> **Execution rule:** implement each task in order, keeping the world generator synchronous and using tests before the corresponding implementation.

## Task 1: Add the pure asset contracts and deterministic registry

**Files:**

- Create `src/game/assets/AssetTypes.ts`.
- Create `src/game/assets/AssetRegistry.ts`.
- Create `tests/asset-registry.test.ts`.

**Steps:**

1. Write tests for all eight categories, three variants for resource profiles,
   deterministic selection across repeated calls, and explicit fallback keys.
2. Implement the typed manifest using local `/assets/.../*.glb` URLs and
   `selectVariant` seeded by the existing deterministic hash utility or a local
   pure hash.
3. Run `npm test -- --test-name-pattern=asset-registry`.

## Task 2: Vendor and document the first CC0 GLB set

**Files:**

- Create `public/assets/nature/*.glb`.
- Create `public/assets/survival/*.glb`.
- Create `public/assets/ASSET_LICENSES.md`.
- Modify `package.json` and `package-lock.json` to add the matching
  `@babylonjs/loaders` package.

**Steps:**

1. Download only the selected GLBs from the official Kenney archives into a
   temporary directory, verify the files are non-empty, and copy them into the
   stable public asset folders.
2. Keep the upstream license text and record source URLs, pack names, version
   date, and logical registry mapping in `ASSET_LICENSES.md`.
3. Install the Babylon glTF loader at the same version as `@babylonjs/core`.
4. Verify the files are served by Vite and the package tree resolves.

## Task 3: Implement `AssetManager` with cache, slots, and diagnostics

**Files:**

- Create `src/game/assets/AssetManager.ts`.
- Create `tests/asset-manager.test.ts`.

**Steps:**

1. Write tests using an injected loader seam for cache reuse, deterministic
   variant choice, slot fallback visibility, successful replacement, and load
   failure retention.
2. Implement GLB container loading through Babylon `SceneLoader`, with one
   promise per variant, formal asset metadata, transform application, optional
   LOD/thin-instance hints, and disposal-safe slot roots.
3. Run the focused tests, then `npm test`.

## Task 4: Integrate formal assets into world details and major props

**Files:**

- Modify `src/game/world/Details.ts`.
- Modify `src/game/world/PoiLayer.ts`.
- Modify `src/game/world/WorldManager.ts`.
- Modify `src/game/world/CharacterShowcaseLayer.ts`.
- Modify `src/game/player/CharacterVisuals.ts` only where needed for explicit
  fallback metadata and modular attachment points.

**Steps:**

1. Add one `AssetManager` to `WorldManager` and warm selected assets before
   the first world build without making chunk placement async.
2. Give tree/rock masters and major POI/resource roots asset slots; retain
   procedural micro-details and current fallback geometry.
3. Attach stable metadata (`assetId`, `variantId`, `source`, `fallback`) to
   every formal or fallback root.
4. Ensure chunk disposal removes slots/imported roots and repeated seed builds
   produce the same logical asset selections.
5. Run focused world tests and the full test suite.

## Task 5: Implement semantic resource compositions and character contract

**Files:**

- Modify `src/game/world/WorldManager.ts`.
- Modify `src/game/world/CharacterShowcaseLayer.ts`.
- Create or modify `src/game/assets/CharacterAssetContract.ts`.
- Create `tests/asset-composition.test.ts`.

**Steps:**

1. Write pure tests for wood, stone, iron, copper, rare ore, and scrap profiles
   with three deterministic variants and metadata for future collection.
2. Move resource appearance decisions into profile data and build the low-poly
   combinations around an asset slot, without changing item ids or collection
   behavior.
3. Add shared character-role metadata and modular attachment points while
   leaving procedural character geometry as the documented debug fallback.
4. Run focused and full tests.

## Task 6: Browser acceptance and final verification

**Files:**

- Modify the existing browser asset/world acceptance script if present, or add
  `tests/browser-asset-acceptance.py` beside the existing browser checks.
- Modify `README.md` with the asset replacement workflow.

**Steps:**

1. Start the Vite app, load a deterministic seed, and assert no console errors.
2. Assert loaded formal assets or deliberate fallback diagnostics for each
   major category, stable variant ids after reload, and disposed chunks do not
   retain imported roots.
3. Capture a visual review image only if the browser harness already supports
   it; do not add new gameplay or menus.
4. Run `npm test` and `npm run build`, then report exact results and any
   documented external-asset fallback.
