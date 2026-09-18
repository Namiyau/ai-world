import { hashInts } from "../utils/random";
import type { AssetCategory, AssetDefinition, AssetSelection, AssetVariantDefinition } from "./AssetTypes";

const nature = (file: string): string => `/assets/nature/${file}`;
const survival = (file: string): string => `/assets/survival/${file}`;
const industrial = (file: string): string => `/assets/industrial/${file}`;

function variant(
  id: string,
  fallbackKey: string,
  nominalScale: number,
  url?: string,
  tags: readonly string[] = [],
): AssetVariantDefinition {
  return { id, url, nominalScale, fallbackKey, tags };
}

function definition(
  id: string,
  category: AssetCategory,
  variants: readonly AssetVariantDefinition[],
  castsShadow: boolean,
  supportsThinInstance = false,
): AssetDefinition {
  const firstVariant = variants[0];
  if (!firstVariant) throw new Error(`Asset definition ${id} needs a variant`);
  return {
    id,
    category,
    variants,
    defaultFallbackKey: firstVariant.fallbackKey,
    castsShadow,
    supportsThinInstance,
  };
}

const definitions: readonly AssetDefinition[] = [
  definition("tree-round", "trees", [
    variant("default", "treeRound", 1.0, nature("tree_default.glb"), ["temperate", "broadleaf"]),
    variant("oak", "treeRound", 1.04, nature("tree_oak.glb"), ["temperate", "broadleaf"]),
    variant("fat", "treeRound", 0.92, nature("tree_fat.glb"), ["temperate", "broadleaf"]),
  ], true, true),
  definition("tree-pine", "trees", [
    variant("default-a", "treePine", 1.0, nature("tree_pineDefaultA.glb"), ["cold", "conifer"]),
    variant("round-a", "treePine", 1.03, nature("tree_pineRoundA.glb"), ["cold", "conifer"]),
    variant("tall-a", "treePine", 0.9, nature("tree_pineTallA.glb"), ["cold", "conifer"]),
  ], true, true),
  definition("tree-birch", "trees", [
    variant("simple", "treeBirch", 1.0, nature("tree_simple.glb"), ["light", "broadleaf"]),
    variant("thin", "treeBirch", 1.02, nature("tree_thin.glb"), ["light", "broadleaf"]),
    variant("small", "treeBirch", 0.88, nature("tree_small.glb"), ["light", "broadleaf"]),
  ], true, true),
  definition("rock-large", "rocks", [
    variant("a", "rock", 1.0, nature("rock_largeA.glb"), ["rocky"]),
    variant("b", "rock", 0.96, nature("rock_largeB.glb"), ["rocky"]),
    variant("c", "rock", 1.08, nature("rock_largeC.glb"), ["rocky"]),
  ], true, true),
  definition("rock-small", "rocks", [
    variant("a", "pebble", 1.0, nature("rock_smallA.glb"), ["rocky"]),
    variant("b", "pebble", 0.94, nature("rock_smallB.glb"), ["rocky"]),
    variant("c", "pebble", 1.08, nature("rock_smallC.glb"), ["rocky"]),
  ], false, true),
  definition("bush", "plants", [
    variant("round", "bush", 1.0, nature("plant_bush.glb"), ["moisture", "shrub"]),
    variant("detailed", "bush", 0.96, nature("plant_bushDetailed.glb"), ["moisture", "shrub"]),
    variant("large", "bush", 1.08, nature("plant_bushLarge.glb"), ["moisture", "shrub"]),
  ], false, true),
  definition("grass", "plants", [
    variant("small", "grass", 1.0, nature("grass.glb"), ["grassland"]),
    variant("large", "grass", 1.18, nature("grass_large.glb"), ["grassland"]),
    variant("leafs", "grass", 0.92, nature("grass_leafs.glb"), ["grassland"]),
  ], false, true),
  definition("flower", "plants", [
    variant("purple", "flower", 1.0, nature("flower_purpleA.glb"), ["meadow"]),
    variant("red", "flower", 1.0, nature("flower_redA.glb"), ["meadow"]),
    variant("yellow", "flower", 1.0, nature("flower_yellowA.glb"), ["meadow"]),
  ], false, true),
  definition("reed", "plants", [
    variant("wetland-a", "reed", 1.0, survival("grass.glb"), ["wetland"]),
    variant("wetland-b", "reed", 1.12, survival("grass-large.glb"), ["wetland"]),
    variant("wetland-c", "reed", 0.9, nature("grass_leafsLarge.glb"), ["wetland"]),
  ], false, true),
  definition("wood-resource", "ores", [
    variant("logs", "resourceWood", 1.0, survival("resource-wood.glb"), ["wood", "collectible"]),
    variant("stack", "resourceWood", 1.02, nature("log_stack.glb"), ["wood", "collectible"]),
    variant("large-stack", "resourceWood", 1.08, nature("log_stackLarge.glb"), ["wood", "collectible"]),
  ], true),
  definition("stone-resource", "ores", [
    variant("cluster", "resourceStone", 1.0, survival("resource-stone.glb"), ["stone", "collectible"]),
    variant("large", "resourceStone", 1.1, survival("resource-stone-large.glb"), ["stone", "collectible"]),
    variant("rock-a", "resourceStone", 1.0, survival("rock-a.glb"), ["stone", "collectible"]),
  ], true),
  definition("iron-ore", "ores", [
    variant("rock-a", "ironOre", 1.0, survival("rock-a.glb"), ["iron", "vein"]),
    variant("rock-b", "ironOre", 1.05, survival("rock-b.glb"), ["iron", "vein"]),
    variant("rock-c", "ironOre", 0.94, survival("rock-c.glb"), ["iron", "vein"]),
  ], true),
  definition("copper-ore", "ores", [
    variant("rock-a", "copperOre", 1.0, survival("rock-a.glb"), ["copper", "vein"]),
    variant("rock-b", "copperOre", 1.05, survival("rock-b.glb"), ["copper", "vein"]),
    variant("rock-c", "copperOre", 0.94, survival("rock-c.glb"), ["copper", "vein"]),
  ], true),
  definition("rare-ore", "ores", [
    variant("rock-a", "rareOre", 1.0, survival("rock-a.glb"), ["rare", "crystal"]),
    variant("rock-b", "rareOre", 1.02, survival("rock-b.glb"), ["rare", "crystal"]),
    variant("rock-c", "rareOre", 0.96, survival("rock-c.glb"), ["rare", "crystal"]),
  ], true),
  definition("scrap", "props", [
    variant("barrel", "scrap", 1.0, survival("barrel-open.glb"), ["scrap", "metal"]),
    variant("panel", "scrap", 1.0, survival("metal-panel.glb"), ["scrap", "metal"]),
    variant("barrel-closed", "scrap", 1.06, survival("barrel.glb"), ["scrap", "metal"]),
  ], true),
  definition("fence", "props", [
    variant("nature", "fence", 1.0, nature("fence_simple.glb"), ["boundary"]),
    variant("gate", "fence", 1.0, nature("fence_gate.glb"), ["boundary"]),
    variant("survival", "fence", 1.0, survival("fence.glb"), ["boundary"]),
  ], true),
  definition("sign", "props", [
    variant("wood", "sign", 1.0, nature("sign.glb"), ["road"]),
    variant("post", "sign", 1.0, survival("signpost.glb"), ["road"]),
    variant("single", "sign", 1.0, survival("signpost-single.glb"), ["road"]),
  ], true),
  definition("barrel", "props", [
    variant("closed", "barrel", 1.0, survival("barrel.glb"), ["industrial"]),
    variant("open", "barrel", 1.0, survival("barrel-open.glb"), ["industrial"]),
    variant("large", "barrel", 1.12, survival("barrel.glb"), ["industrial"]),
  ], true),
  definition("crate", "props", [
    variant("small", "crate", 1.0, survival("box.glb"), ["storage"]),
    variant("large", "crate", 1.12, survival("box-large.glb"), ["storage"]),
    variant("open", "crate", 1.0, survival("box-open.glb"), ["storage"]),
  ], true),
  definition("cabin", "buildings", [
    variant("industrial-a", "building", 0.8, industrial("building-a.glb"), ["cabin", "shelter"]),
    variant("industrial-b", "building", 0.8, industrial("building-b.glb"), ["cabin", "shelter"]),
    variant("industrial-c", "building", 0.8, industrial("building-c.glb"), ["cabin", "shelter"]),
  ], true),
  definition("warehouse", "buildings", [
    variant("a", "building", 0.82, industrial("building-d.glb"), ["warehouse", "industrial"]),
    variant("b", "building", 0.82, industrial("building-e.glb"), ["warehouse", "industrial"]),
    variant("c", "building", 0.82, industrial("building-f.glb"), ["warehouse", "industrial"]),
  ], true),
  definition("gas-station", "buildings", [
    variant("a", "building", 0.8, industrial("building-g.glb"), ["service", "roadside"]),
    variant("b", "building", 0.8, industrial("building-h.glb"), ["service", "roadside"]),
    variant("c", "building", 0.8, industrial("building-i.glb"), ["service", "roadside"]),
  ], true),
  definition("bridge", "buildings", [
    variant("wood", "bridge", 1.0, nature("bridge_wood.glb"), ["bridge"]),
    variant("wood-round", "bridge", 1.0, nature("bridge_woodRound.glb"), ["bridge"]),
    variant("side", "bridge", 1.0, nature("bridge_side_wood.glb"), ["bridge"]),
  ], true),
  definition("dock", "buildings", [
    variant("wood", "dock", 1.0, nature("bridge_wood.glb"), ["dock", "waterfront"]),
    variant("round", "dock", 1.0, nature("bridge_woodRound.glb"), ["dock", "waterfront"]),
    variant("side", "dock", 1.0, nature("bridge_side_wood.glb"), ["dock", "waterfront"]),
  ], true),
  definition("character-player", "characters", [
    variant("explorer", "characterExplorer", 1.0, undefined, ["player", "humanoid"]),
    variant("explorer-alt", "characterExplorer", 1.0, undefined, ["player", "humanoid"]),
    variant("explorer-winter", "characterExplorer", 1.0, undefined, ["player", "humanoid"]),
  ], true),
  definition("character-merchant", "characters", [
    variant("merchant", "characterMerchant", 1.0, undefined, ["merchant", "humanoid"]),
    variant("merchant-alt", "characterMerchant", 1.0, undefined, ["merchant", "humanoid"]),
    variant("merchant-traveler", "characterMerchant", 1.0, undefined, ["merchant", "humanoid"]),
  ], true),
  definition("character-enemy", "characters", [
    variant("raider", "characterEnemy", 1.0, undefined, ["enemy", "humanoid"]),
    variant("scavenger", "characterEnemy", 1.0, undefined, ["enemy", "humanoid"]),
    variant("bruiser", "characterEnemy", 1.0, undefined, ["enemy", "humanoid"]),
  ], true),
  definition("tool", "weapons", [
    variant("axe", "tool", 1.0, survival("tool-axe-upgraded.glb"), ["tool"]),
    variant("pick", "tool", 1.0, undefined, ["tool"]),
    variant("bat", "tool", 1.0, undefined, ["tool"]),
  ], true),
];

const byId = new Map(definitions.map((asset) => [asset.id, asset]));

export function listAssetDefinitions(): readonly AssetDefinition[] {
  return definitions;
}

export function getAssetDefinition(assetId: string): AssetDefinition {
  const asset = byId.get(assetId);
  if (!asset) throw new Error(`Unknown asset definition: ${assetId}`);
  return asset;
}

export function selectAssetVariant(assetId: string, seed: number): AssetSelection {
  const asset = getAssetDefinition(assetId);
  const index = hashInts(seed, assetId.length * 97, 0x415353) % asset.variants.length;
  const selected = asset.variants[index];
  if (!selected) throw new Error(`Asset ${assetId} has no selected variant`);
  return { assetId, category: asset.category, variant: selected, seed };
}

export function listAssetsByCategory(category: AssetCategory): readonly AssetDefinition[] {
  return definitions.filter((asset) => asset.category === category);
}

