import { RESOURCE_PRICES } from "../config";
import type { ItemId } from "../types";
import { InventorySystem } from "./InventorySystem";

export class EconomySystem {
  private balance: number;

  public constructor(initialBalance = 120) {
    this.balance = initialBalance;
  }

  public get money(): number {
    return this.balance;
  }

  public sellAll(inventory: InventorySystem): number {
    const snapshot = inventory.snapshot();
    let total = 0;

    for (const [item, quantity] of Object.entries(snapshot) as [ItemId, number][]) {
      total += RESOURCE_PRICES[item] * quantity;
    }

    if (total > 0) {
      this.balance += total;
      inventory.clear();
    }

    return total;
  }
}
