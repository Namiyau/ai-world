export const ASSET_CATEGORIES = [
  "trees",
  "rocks",
  "plants",
  "ores",
  "props",
  "buildings",
  "characters",
  "weapons",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export interface AssetVariantDefinition {
  readonly id: string;
  readonly url?: string;
  readonly lodUrls?: readonly string[];
  readonly nominalScale: number;
  readonly fallbackKey: string;
  readonly tags: readonly string[];
}

export interface AssetDefinition {
  readonly id: string;
  readonly category: AssetCategory;
  readonly variants: readonly AssetVariantDefinition[];
  readonly defaultFallbackKey: string;
  readonly castsShadow: boolean;
  readonly supportsThinInstance: boolean;
}

export interface AssetSelection {
  readonly assetId: string;
  readonly category: AssetCategory;
  readonly variant: AssetVariantDefinition;
  readonly seed: number;
}

export interface AssetMetadata {
  assetId: string;
  category: AssetCategory;
  variantId: string;
  source: "glb" | "procedural-fallback";
  fallbackKey: string;
  lodLevel: number;
}
