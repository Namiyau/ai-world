import type { SaveStateV1 } from "../types";

const STORAGE_KEY = "economy-world-save-v1";

export class SaveSystem {
  public load(): SaveStateV1 | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SaveStateV1;
      if (parsed.version !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public save(state: SaveStateV1): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  public clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
