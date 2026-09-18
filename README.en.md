# AI World — Babylon.js Procedural World Prototype

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

A Babylon.js + TypeScript browser prototype focused on stylized low-poly visuals, an infinite seeded procedural world, quest worlds, and an exploration economy loop.

The project is currently a playable prototype: the main world, quest world, resource loop, low-poly characters, and visual assets are connected. Multiplayer, server-authoritative saves, and a complete production pipeline are still planned.

## Features

| Area | Capability |
| --- | --- |
| World generation | Seeded infinite chunk streaming with hills, mountains, grassland, forest, rocky zones, and stable lakes |
| Scene system | Deterministic roads, landmarks, lakeside docks, bridges, camps, warehouses, mining sites, and wrecks |
| Exploration | First-person movement, sprinting, jumping, step climbing, water slowdown, and creative flight |
| Characters | Explorer, ordinary merchant, and wilderness melee enemy with modular clothing, headwear, carry, and prop slots |
| Resources & economy | Wood, stone, scrap, relics, cash, resource prices, and a shop selling loop |
| Quest world | Enter a more dangerous world, fight chasing melee enemies, collect drops, and extract back to the main world |
| Rendering | Procedural sky, light fog, low-poly water, flat-shaded terrain, vertex colors, and instanced details |
| Persistence | Automatic `localStorage` saves; World Delta records collected resource IDs instead of the full infinite map |

## Quick Start

### Requirements

- Node.js 20.19+, or Node.js 22.12+
- A modern browser with WebGL support

### Install & Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

On Windows, you can also run `start-ai-world.ps1` or `启动AI世界.ps1` from the project root.

### Build & Check

```bash
# Type check
npx tsc --noEmit

# Unit tests
npm test

# Production build and local preview
npm run build
npm run preview
```

Browser acceptance scripts are located in `tests/browser-*`. They are optional local tools and are not included in `npm test`; running them requires a separate Playwright and browser setup.

## Controls

| Input | Action |
| --- | --- |
| Click the canvas | Lock the mouse |
| W / A / S / D | Move |
| Shift | Sprint; descend while flying |
| Space | Jump; double-press to toggle creative flight |
| E | Interact, collect, use shops, and teleport |
| Left mouse button | Melee attack |
| Tab | Open inventory |
| Esc | Open the game menu |

While flying, Space ascends and Shift descends without terrain blocking. Water slows the player down, and the screen changes tone when the camera goes underwater.

## Technical Architecture

```text
Browser / Vite
      │
      ▼
Game composition root
      │
      ├─ PlayerController   camera, movement, collision, jump, flight, water
      ├─ Hud                money, inventory, prompts, landmarks, Esc menu
      ├─ Systems            interaction, inventory, economy, combat, saves
      └─ WorldManager
           ├─ TerrainSampler  shared source of truth for terrain, water, roads
           ├─ WaterLayer      lake meshes and water shader
           ├─ Roads           procedural road ribbons
           ├─ Landmarks       distant landmarks and navigation
           ├─ PoiLayer        artificial scenes, details, and resource nodes
           ├─ Details         instanced natural scattering
           ├─ Atmosphere       sky, fog, lighting, far clip
           └─ AssetManager     GLB cache, instancing, asset fallback
```

### World Generation

All downstream systems share the pure function `TerrainSampler.sample(x, z)`:

```text
Terrain → Climate → Water → Road
```

It returns the final height, water height, depth, road distance, biome, surface type, and environmental values used for coloring. Neighboring chunks are therefore naturally seamless, and unloading/reloading the world produces the same result.

### Characters & Assets

Character visuals are split into `hair / headwear / outfit / lowerBody / footwear / carry / prop` slots, leaving room for third-person play, customization, and multiplayer synchronization.

The world generator uses logical asset IDs rather than model paths. `AssetRegistry.ts` manages categories, variants, LOD metadata, and deterministic selection. `AssetManager.ts` handles GLB caching, instancing, asset replacement, and procedural fallbacks.

Built-in Kenney CC0 GLB assets, sources, and licenses are documented in [`public/assets/ASSET_LICENSES.md`](public/assets/ASSET_LICENSES.md).

## Project Structure

```text
src/
  main.ts                         application entry point
  styles.css                     HUD styles
  game/
    Game.ts                       composition root and render loop
    config.ts                     layered world configuration
    types.ts                      shared types
    player/
      PlayerController.ts         movement, collision, jump, flight, water
      CharacterCatalog.ts         character appearance and slot catalog
      CharacterVisuals.ts         low-poly character builder
    assets/
      AssetRegistry.ts            logical assets and variant selection
      AssetManager.ts              GLB cache, instancing, fallback
      ResourceVisuals.ts           semantic resource combinations
    systems/
      CombatSystem.ts             melee checks
      EconomySystem.ts            economy and selling
      InteractionSystem.ts        distance targeting and E actions
      InventorySystem.ts          inventory
      SaveSystem.ts               persistence
    ui/
      Hud.ts                      HUD and Esc menu
    world/
      TerrainSampler.ts           shared world-generation source of truth
      WaterLayer.ts               water mesh and shader
      Roads.ts                    road ribbons
      Landmarks.ts                landmarks and compass
      PoiLayer.ts                 POIs, instanced details, resource nodes
      CharacterShowcaseLayer.ts   character showcase point
      Details.ts                  instanced scattering
      Atmosphere.ts               sky, fog, and lighting
      WorldManager.ts             chunk streaming
tests/
  *.test.ts                       unit tests
  browser-*                       optional browser acceptance scripts
public/assets/                    Kenney CC0 GLB assets and license records
```

## Implemented

- First-person movement, sprinting, jumping, step climbing, terrain collision, and creative flight
- Seeded infinite procedural world with chunk streaming
- Stable lakes, procedural roads, distant landmarks, and HUD navigation
- Roadside POIs, lakeside docks, bridges, mining shelters, wrecks, and exposed minerals
- Shared low-poly character catalog for the explorer, merchant, and wilderness melee enemy
- Procedural resources, nearby E-key collection, cash, prices, and a main-world shop
- Main world → quest world → extraction loop
- Quest-world enemy pursuit, water avoidance, ground alignment, and melee drops
- `localStorage` autosave and World Delta incremental records
- GitHub Actions for type checking, unit tests, and production builds

## Roadmap

1. Quest generator with independent seeds, danger levels, reward multipliers, and biome settings
2. Player health, hit feedback, hit stop, and knockback
3. Connect roads to cabins, camps, caves, and warehouses
4. Chest loot tables, rarity, and shop purchases
5. Bank accounts, interest, housing, and asset data models
6. Day/night cycle and more environmental states
7. Compact resource-ID persistence for long-term exploration
8. Multiplayer protocol and server-authoritative economy boundaries

## License & Third-Party Assets

This repository does not currently declare a project-level open-source license. Third-party resources remain under their original licenses; Kenney assets are CC0. See [`public/assets/ASSET_LICENSES.md`](public/assets/ASSET_LICENSES.md) and the `License.txt` files in the corresponding asset directories.

This is an extensible browser prototype, not a final production architecture. Procedural geometry remains a testable, runnable fallback, while the modular character slots and humanoid skeleton contract leave room for compatible rigged GLB assets later.
