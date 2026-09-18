import { hashInts } from "../utils/random";

export type ResourceVisualKind = "wood" | "stone" | "iron" | "copper" | "rare" | "scrap";

export interface ResourceVisualProfile {
  readonly kind: ResourceVisualKind;
  readonly assetId: string;
  readonly variants: readonly string[];
  readonly components: readonly string[];
  readonly collectionTag: string;
}

export interface ResourceVisualSelection {
  readonly profile: ResourceVisualProfile;
  readonly variantId: string;
  readonly seed: number;
}

const profiles: readonly ResourceVisualProfile[] = [
  { kind: "wood", assetId: "wood-resource", variants: ["logs-stump", "stack-block", "large-stack"], components: ["log", "stump", "wood-block"], collectionTag: "wood" },
  { kind: "stone", assetId: "stone-resource", variants: ["three-stone-cluster", "large-cluster", "flat-cluster"], components: ["mother-rock", "stone-a", "stone-b"], collectionTag: "stone" },
  { kind: "iron", assetId: "iron-ore", variants: ["red-vein-a", "red-vein-b", "red-vein-c"], components: ["mother-rock", "iron-vein"], collectionTag: "iron" },
  { kind: "copper", assetId: "copper-ore", variants: ["copper-vein-a", "copper-vein-b", "copper-vein-c"], components: ["mother-rock", "copper-vein"], collectionTag: "copper" },
  { kind: "rare", assetId: "rare-ore", variants: ["crystal-a", "crystal-b", "crystal-c"], components: ["mother-rock", "rare-crystal"], collectionTag: "rare" },
  { kind: "scrap", assetId: "scrap", variants: ["plate-pipe-gear", "barrel-panel-gear", "pipe-plate-can"], components: ["iron-plate", "pipe", "gear", "damaged-can"], collectionTag: "scrap" },
];

const byKind = new Map(profiles.map((profile) => [profile.kind, profile]));

export function resourceVisualProfile(kind: ResourceVisualKind): ResourceVisualProfile {
  const profile = byKind.get(kind);
  if (!profile) throw new Error(`Unknown resource visual: ${kind}`);
  return profile;
}

export function selectResourceVisual(kind: ResourceVisualKind, seed: number): ResourceVisualSelection {
  const profile = resourceVisualProfile(kind);
  const index = hashInts(seed, profile.kind.length * 313, 0x524553) % profile.variants.length;
  const variantId = profile.variants[index];
  if (!variantId) throw new Error(`Resource visual ${kind} has no variant`);
  return { profile, variantId, seed };
}

