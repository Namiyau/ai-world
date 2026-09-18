import type { UniversalCamera } from "@babylonjs/core";
import { GAME_CONFIG } from "../config";
import type { Interactable } from "../types";

export class InteractionSystem {
  private readonly entries = new Map<string, Interactable>();
  private current: Interactable | null = null;
  private promptListener: ((text: string | null) => void) | null = null;

  public constructor(private readonly camera: UniversalCamera) {
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyE" && !event.repeat) {
        this.current?.onInteract();
      }
    });
  }

  public register(entry: Interactable): void {
    this.entries.set(entry.id, entry);
  }

  public unregister(id: string): void {
    this.entries.delete(id);
    if (this.current?.id === id) {
      this.current = null;
      // No following update can detect the transition: both the old and new
      // current ids are absent. Notify the HUD at the state-change boundary.
      this.promptListener?.(null);
    }
  }

  public onPrompt(listener: (text: string | null) => void): void {
    this.promptListener = listener;
  }

  public update(): void {
    let best: Interactable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entry of this.entries.values()) {
      if (entry.mesh.isDisposed()) continue;
      const distance = entry.mesh.getAbsolutePosition().subtract(this.camera.position).length();
      const range = entry.range ?? GAME_CONFIG.interactRange;
      if (distance <= range && distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }

    if (best?.id !== this.current?.id) {
      this.current = best;
      this.promptListener?.(best ? `[E] ${best.label}` : null);
    }
  }
}
