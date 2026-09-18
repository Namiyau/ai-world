import type { InventoryData, ItemId } from "../types";

const EMPTY_INVENTORY: InventoryData = {
  wood: 0,
  stone: 0,
  scrap: 0,
  relic: 0,
};

export class InventorySystem {
  private items: InventoryData;

  public constructor(initial?: Partial<InventoryData>) {
    this.items = { ...EMPTY_INVENTORY, ...initial };
  }

  public add(item: ItemId, amount = 1): void {
    this.items[item] += amount;
  }

  public get(item: ItemId): number {
    return this.items[item];
  }

  public snapshot(): InventoryData {
    return { ...this.items };
  }

  public clear(): void {
    this.items = { ...EMPTY_INVENTORY };
  }

  public isEmpty(): boolean {
    return Object.values(this.items).every((value) => value === 0);
  }
}
