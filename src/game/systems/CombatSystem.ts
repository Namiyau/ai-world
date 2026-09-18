import type { UniversalCamera } from "@babylonjs/core";
import { GAME_CONFIG } from "../config";
import type { Damageable } from "../types";

export class CombatSystem {
  private readonly targets = new Map<string, Damageable>();
  private lastAttack = 0;
  private hitListener: ((hit: boolean) => void) | null = null;

  public constructor(private readonly camera: UniversalCamera) {
    window.addEventListener("mousedown", (event) => {
      if (event.button === 0 && document.pointerLockElement) {
        this.attack();
      }
    });
  }

  public register(target: Damageable): void {
    this.targets.set(target.id, target);
  }

  public unregister(id: string): void {
    this.targets.delete(id);
  }

  public onAttack(listener: (hit: boolean) => void): void {
    this.hitListener = listener;
  }

  private attack(): void {
    const now = performance.now();
    if (now - this.lastAttack < GAME_CONFIG.meleeCooldownMs) return;
    this.lastAttack = now;

    const forward = this.camera.getForwardRay(1).direction.normalize();
    let best: Damageable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const target of this.targets.values()) {
      if (target.mesh.isDisposed()) continue;
      const delta = target.position().subtract(this.camera.position);
      const distance = delta.length();
      if (distance > GAME_CONFIG.meleeRange) continue;
      const facing = distance > 0 ? forward.dot(delta.scale(1 / distance)) : 1;
      if (facing < 0.55) continue;
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }

    if (best) best.onDamage(1);
    this.hitListener?.(Boolean(best));
  }
}
