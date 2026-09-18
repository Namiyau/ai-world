import type { AbstractMesh, Vector3 } from "@babylonjs/core";

export type WorldId = "home" | "mission";
export type ItemId = "wood" | "stone" | "scrap" | "relic";

export interface InventoryData {
  wood: number;
  stone: number;
  scrap: number;
  relic: number;
}

export interface PositionData {
  x: number;
  y: number;
  z: number;
}

export interface SaveStateV1 {
  version: 1;
  money: number;
  inventory: InventoryData;
  collectedResourceIds: string[];
  positions: Record<WorldId, PositionData>;
}

export interface Interactable {
  id: string;
  mesh: AbstractMesh;
  label: string;
  range?: number;
  onInteract: () => void;
}

export interface Damageable {
  id: string;
  mesh: AbstractMesh;
  position: () => Vector3;
  health: number;
  onDamage: (amount: number) => void;
}
