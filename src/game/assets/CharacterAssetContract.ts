import { CHARACTER_MODULE_SLOTS, type CharacterModuleSlot, type CharacterRole } from "../player/CharacterCatalog";

export interface CharacterAssetContract {
  readonly role: CharacterRole;
  readonly assetId: string;
  readonly skeletonId: "humanoid-base-v1";
  readonly moduleSlots: readonly CharacterModuleSlot[];
  readonly source: "glb" | "procedural-fallback";
}

const contracts: Record<CharacterRole, CharacterAssetContract> = {
  explorer: { role: "explorer", assetId: "character-player", skeletonId: "humanoid-base-v1", moduleSlots: CHARACTER_MODULE_SLOTS, source: "procedural-fallback" },
  merchant: { role: "merchant", assetId: "character-merchant", skeletonId: "humanoid-base-v1", moduleSlots: CHARACTER_MODULE_SLOTS, source: "procedural-fallback" },
  wildernessEnemy: { role: "wildernessEnemy", assetId: "character-enemy", skeletonId: "humanoid-base-v1", moduleSlots: CHARACTER_MODULE_SLOTS, source: "procedural-fallback" },
};

export function characterAssetContract(role: CharacterRole): CharacterAssetContract {
  return contracts[role];
}

