import { TransformNode, Vector3, type Scene } from "@babylonjs/core";
import type { MovementMode, PlayerController } from "./PlayerController";
import { characterDescriptor, type CharacterAppearance } from "./CharacterCatalog";

/**
 * The deliberately mesh-free avatar contract for the next player-art update.
 *
 * Gameplay remains first-person today.  Keeping this as a transform + serializable
 * appearance/state makes the later low-poly character, third-person camera and a
 * network replica consume one stable source of truth instead of reverse-engineering
 * the camera after the fact.
 */
export type PlayerAvatarAppearance = CharacterAppearance;

export interface PlayerAvatarSnapshot {
  id: string;
  appearance: PlayerAvatarAppearance;
  position: { x: number; y: number; z: number };
  yaw: number;
  movementMode: MovementMode;
}

export const DEFAULT_PLAYER_AVATAR: PlayerAvatarAppearance = characterDescriptor("explorer").appearance;

export function createPlayerAvatarSnapshot(
  id: string,
  appearance: PlayerAvatarAppearance,
  position: { x: number; y: number; z: number },
  yaw: number,
  movementMode: MovementMode,
): PlayerAvatarSnapshot {
  return {
    id,
    appearance,
    position: { x: position.x, y: position.y, z: position.z },
    yaw,
    movementMode,
  };
}

/** A non-rendered, terrain-aligned origin for the future visible player model. */
export class PlayerAvatarAnchor {
  public readonly root: TransformNode;

  public constructor(
    scene: Scene,
    public readonly id = "local-player",
    public readonly appearance: PlayerAvatarAppearance = DEFAULT_PLAYER_AVATAR,
  ) {
    this.root = new TransformNode("player-avatar-anchor", scene);
  }

  public update(player: PlayerController): void {
    const camera = player.camera;
    const forward = camera.getDirection(Vector3.Forward());
    // The camera lives at eye height; the avatar root is the contact/foot origin.
    this.root.position.set(
      camera.position.x,
      camera.position.y - camera.ellipsoid.y + camera.ellipsoidOffset.y,
      camera.position.z,
    );
    this.root.rotation.y = Math.atan2(forward.x, forward.z);
  }

  public snapshot(player: PlayerController): PlayerAvatarSnapshot {
    return createPlayerAvatarSnapshot(this.id, this.appearance, this.root.position, this.root.rotation.y, player.movementMode);
  }

  public dispose(): void {
    this.root.dispose(false, false);
  }
}
