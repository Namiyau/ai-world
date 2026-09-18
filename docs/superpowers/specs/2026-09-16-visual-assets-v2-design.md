# Visual Assets Update V2 Design

## Scope

This update introduces a replaceable visual-asset layer without changing the
world-generation rules for terrain, water, roads, POIs, or chunk streaming.
Generators continue to choose semantic content and placement. `AssetRegistry`
chooses the visual definition and deterministic variant, while `AssetManager`
handles GLB loading, caching, instantiation, and fallback slots.

The first shipped external assets are local CC0 GLB files from Kenney's Nature
Kit and Survival Kit. Their license/source mapping is recorded in
`public/assets/ASSET_LICENSES.md`. No remote URL is required at runtime.

## Architecture

### Registry

`src/game/assets/AssetTypes.ts` contains the pure data contracts. An asset is
identified by category and logical id, and owns two or more variants. A variant
contains a local GLB URL, optional LOD URLs, a nominal scale, and tags. The
registry is pure TypeScript and has no Babylon dependency so deterministic
selection can be tested in Node.

`src/game/assets/AssetRegistry.ts` contains the manifest for:

- trees, rocks, plants, ores, props, buildings, characters, and weapons;
- Nature/Survival GLB variants where available;
- explicit procedural fallback keys for every logical asset family;
- deterministic `selectVariant(logicalId, seed)`.

### Runtime manager

`AssetManager` owns a per-variant `AssetContainer` promise cache. It exposes:

- `preload()` for startup warming;
- `instantiate()` for a loaded GLB with transform metadata;
- `createSlot()` for synchronous generators. A slot keeps the existing fallback
  children visible until the GLB is loaded, then attaches the imported roots,
  marks them as formal assets, and hides the fallback. Failed loads keep the
  fallback visible and record the failure without breaking world generation;
- optional `preferThinInstance` metadata for future repeated static assets;
- LOD metadata and a stable asset identity in `mesh.metadata`.

This slot approach keeps all existing synchronous chunk APIs intact and lets
asset replacement happen without changing `WorldManager`'s placement logic.

### Scene integration

`DetailLayer` uses asset slots for the major tree and rock masters when a
registry variant is ready, while its low-cost grass/flower/reed instances stay
procedural and do not cast shadows. POI props/buildings and resource clusters
also use slots for their GLB base or a category-specific GLB where one exists;
veins, crystals, logs, and debris remain procedural children of the same slot,
so resource identity and future collection hooks are unchanged.

`CharacterVisuals` remains the debug fallback. `CharacterShowcaseLayer` and
future role spawns use a shared character asset contract with modular slots for
headwear, hair, top, trousers, shoes, backpack, and weapon. Until the official
rigged character pack is vendored and verified, the shared procedural fallback
is kept stable rather than mixing incompatible skeletons.

## Resource visual language

Resource construction is moved behind semantic visual profiles:

- wood: two logs plus a stump/block;
- stone: an irregular three-stone cluster;
- iron: a rock base with dark red-brown vein plates;
- copper: a rock base with copper-colored vein plates;
- rare ore: a rock base with a small crystal group;
- scrap: an iron plate, pipe, gear, and damaged barrel composition.

Each profile has three deterministic composition variants. Asset identity and
variant are written to metadata for later economy/collection systems.

## Performance and failure policy

The manager caches loaded containers, shares materials where Babylon allows it,
and exposes instancing intent without forcing every current object through a
large asynchronous refactor. Micro-details remain thin/procedural and do not
receive formal-asset shadow cost. Chunk disposal disposes slots and imported
roots with the same lifecycle as existing meshes.

Missing or malformed GLB files are non-fatal. A single warning is recorded in
the manager diagnostics, the affected slot remains on its fallback, and tests
can assert that fallback behavior is deterministic.

## Acceptance

- pure registry tests cover categories, variants, deterministic selection, and
  fallback keys;
- manager tests cover cache reuse, slot replacement, metadata, and load failure;
- browser acceptance confirms at least one formal asset per major category is
  loaded or has a deliberate documented fallback, and no chunk generation
  errors occur;
- `npm test` and `npm run build` pass;
- no POI/gameplay systems beyond the asset abstraction are added.
