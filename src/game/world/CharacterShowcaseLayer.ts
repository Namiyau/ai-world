import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import { characterDescriptor, type CharacterRole } from "../player/CharacterCatalog";
import { buildCharacterVisual, type CharacterVisualBuild } from "../player/CharacterVisuals";
import { characterAssetContract } from "../assets/CharacterAssetContract";
import type { TerrainSampler } from "./TerrainSampler";

export interface CharacterShowcaseRole {
  role: CharacterRole;
  displayName: string;
  root: TransformNode;
  visual: CharacterVisualBuild;
}

export interface CharacterShowcaseBuild {
  root: TransformNode;
  center: { x: number; y: number; z: number };
  roles: CharacterShowcaseRole[];
}

const SHOWCASE_ROLES: CharacterRole[] = ["explorer", "merchant", "wildernessEnemy"];
const ROLE_COLORS: Record<CharacterRole, string> = {
  explorer: "#668c62",
  merchant: "#c59a58",
  wildernessEnemy: "#9a5f50",
};

/** Fixed, lightweight home-world gallery for reviewing the three model silhouettes. */
export class CharacterShowcaseLayer {
  private readonly materials = new Map<string, StandardMaterial>();
  private current: CharacterShowcaseBuild | null = null;

  public constructor(private readonly scene: Scene) {}

  public build(x: number, z: number, sampler: TerrainSampler): CharacterShowcaseBuild {
    this.disposeCurrent();
    const anchor = this.findDryAnchor(x, z, sampler);
    const root = new TransformNode("character-showcase-root", this.scene);
    root.position.set(anchor.x, anchor.y, anchor.z);
    root.metadata = {
      id: "home-character-showcase",
      label: "角色展示点",
      roles: SHOWCASE_ROLES.map((role) => characterDescriptor(role).displayName),
    };

    // The spawn-side approach is along +X. Put the three roles side-by-side on
    // screen (the Z axis), instead of stacking them along the camera depth axis.
    this.box(root, "showcase-platform", 8.2, 0.36, 21, new Vector3(0, 0.18, 0), "#4b5b52");
    this.box(root, "showcase-backboard", 0.22, 3.1, 20.2, new Vector3(-3.75, 2.0, 0), "#384940");
    const roles: CharacterShowcaseRole[] = [];
    for (let i = 0; i < SHOWCASE_ROLES.length; i += 1) {
      const role = SHOWCASE_ROLES[i];
      const descriptor = characterDescriptor(role);
      const slotZ = (i - 1) * 6.7;
      const pedestal = this.box(root, `showcase-pedestal-${role}`, 5.4, 0.32, 5.8, new Vector3(0, 0.52, slotZ), ROLE_COLORS[role]);
      pedestal.metadata = { role, displayName: descriptor.displayName, viewNotes: descriptor.views };
      const visual = buildCharacterVisual(this.scene, descriptor);
      visual.root.parent = root;
      visual.root.position.set(0, 0.72, slotZ);
      // Local character front is -Z; face the player approaching from the spawn side (+X).
      visual.root.rotation.y = -Math.PI / 2;
      const assetContract = characterAssetContract(role);
      visual.root.metadata = {
        role,
        displayName: descriptor.displayName,
        modules: descriptor.appearance.modules,
        assetId: assetContract.assetId,
        skeletonId: assetContract.skeletonId,
        assetSource: assetContract.source,
        replaceableSlots: assetContract.moduleSlots,
      };
      roles.push({ role, displayName: descriptor.displayName, root: visual.root, visual });
    }

    this.current = { root, center: { x: anchor.x, y: anchor.y, z: anchor.z }, roles };
    return this.current;
  }

  public get active(): CharacterShowcaseBuild | null {
    return this.current;
  }

  public dispose(): void {
    this.disposeCurrent();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  public clear(): void {
    this.disposeCurrent();
  }

  private disposeCurrent(): void {
    if (!this.current) return;
    if (!this.current.root.isDisposed()) this.current.root.dispose(false, false);
    this.current = null;
  }

  private findDryAnchor(x: number, z: number, sampler: TerrainSampler): { x: number; y: number; z: number } {
    const acceptable = (px: number, pz: number): number | null => {
      const sample = sampler.sample(px, pz);
      if (sample.waterDepth > 0.05 || sample.height < sampler.waterLevel + 0.8) return null;
      return sample.height;
    };
    const direct = acceptable(x, z);
    if (direct !== null) return { x, y: direct, z };
    for (let ring = 1; ring <= 8; ring += 1) {
      const radius = ring * 6;
      const steps = 8 + ring * 2;
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(angle) * radius;
        const pz = z + Math.sin(angle) * radius;
        const height = acceptable(px, pz);
        if (height !== null) return { x: px, y: height, z: pz };
      }
    }
    const fallback = sampler.sample(x, z);
    return { x, y: Math.max(fallback.height, sampler.waterLevel + 1), z };
  }

  private box(parent: TransformNode, name: string, width: number, height: number, depth: number, position: Vector3, hex: string): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = parent;
    mesh.position.copyFrom(position);
    mesh.material = this.material(hex);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  }

  private material(hex: string): StandardMaterial {
    const existing = this.materials.get(hex);
    if (existing) return existing;
    const created = new StandardMaterial(`showcase-material-${hex.slice(1)}`, this.scene);
    created.diffuseColor = Color3.FromHexString(hex);
    created.specularColor = new Color3(0.025, 0.025, 0.025);
    this.materials.set(hex, created);
    return created;
  }
}
