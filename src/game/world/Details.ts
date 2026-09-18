import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type AbstractMesh,
  type InstancedMesh,
  type Scene,
} from "@babylonjs/core";
import { AssetManager, type AssetSlot } from "../assets/AssetManager";
import { DETAIL_CONFIG } from "../config";
import { hashInts, mulberry32 } from "../utils/random";
import { rhythmAt } from "./ExplorationRhythm";
import type { BiomeId, TerrainSampler, TerrainZone } from "./TerrainSampler";

export type DetailKind =
  | "treeRound"
  | "treePine"
  | "treeBirch"
  | "bush"
  | "grass"
  | "flower"
  | "reed"
  | "log"
  | "rock"
  | "pebble";

export interface DetailSampleForPlacement {
  zone: TerrainZone;
  biome: BiomeId;
  moisture: number;
  height: number;
  waterDepth: number;
  roadDistance: number;
  roadInfluence: number;
}

/** Visibility distance by prop family; silhouettes survive farther than ground cover. */
export function detailLodDistance(kind: DetailKind | string): number {
  if (kind.startsWith("tree-") || kind.startsWith("tree")) return 190;
  if (kind === "rock" || kind === "log") return 178;
  if (kind === "bush" || kind === "pebble") return 145;
  if (kind === "reed") return 112;
  return 92;
}

/** Small ground cover is deliberately absent from the shadow map render list. */
export function castsDetailShadow(masterKey: string): boolean {
  return masterKey.startsWith("tree-") || masterKey === "rock" || masterKey === "log";
}

const SCALE_RANGE: Record<DetailKind, [number, number]> = {
  treeRound: [0.85, 1.5],
  treePine: [0.8, 1.35],
  treeBirch: [0.82, 1.4],
  rock: [0.6, 1.6],
  pebble: [0.45, 0.9],
  bush: [0.7, 1.3],
  grass: [0.72, 1.2],
  flower: [0.7, 1.1],
  reed: [0.8, 1.4],
  log: [0.75, 1.25],
};

/** Pure, deterministic detail policy shared by the chunk scatterer and tests. */
export function chooseDetailKind(sample: DetailSampleForPlacement, slope: number, roll: number): DetailKind | null {
  if (sample.waterDepth > 1.2) return null;
  if (sample.roadDistance < DETAIL_CONFIG.roadClearance || sample.roadInfluence > 0.35) return null;

  if (sample.waterDepth > 0.12) {
    const wetland = DETAIL_CONFIG.zoneDensity.wetland;
    if (sample.zone !== "shore" && sample.zone !== "mudflat") return null;
    if (roll < wetland.reed) return "reed";
    if (roll < wetland.reed + wetland.grass) return "grass";
    if (roll < wetland.reed + wetland.grass + wetland.flower) return "flower";
    return null;
  }

  if (sample.zone === "gravel") {
    const gravel = DETAIL_CONFIG.zoneDensity.gravel;
    if (roll < gravel.rock) return "rock";
    if (roll < gravel.rock + gravel.pebble) return "pebble";
    return null;
  }
  if (slope >= 0.55) return null;

  if (sample.zone === "forestFloor" && sample.biome === "forest" && sample.moisture >= 0.5 && sample.height < 24 && slope < 0.42) {
    const forest = DETAIL_CONFIG.zoneDensity.forest;
    if (roll < forest.tree * 0.5) return "treeRound";
    if (roll < forest.tree * 0.75) return "treePine";
    if (roll < forest.tree) return "treeBirch";
    if (roll < forest.tree + forest.bush) return "bush";
    if (roll < forest.tree + forest.bush + forest.grass) return "grass";
    if (roll < forest.tree + forest.bush + forest.grass + forest.log) return "log";
    return null;
  }

  if (sample.zone === "grassland") {
    const grassland = DETAIL_CONFIG.zoneDensity.grassland;
    if (sample.height < 18 && slope < 0.35 && roll < grassland.tree) return "treeRound";
    if (roll < grassland.tree + grassland.bush) return "bush";
    if (roll < grassland.tree + grassland.bush + grassland.grass) return "grass";
    if (roll < grassland.tree + grassland.bush + grassland.grass + grassland.flower) return "flower";
    return null;
  }

  if (sample.zone === "mudflat") {
    const mudflat = DETAIL_CONFIG.zoneDensity.mudflat;
    if (roll < mudflat.grass) return "grass";
    if (roll < mudflat.grass + mudflat.flower) return "flower";
    if (roll < mudflat.grass + mudflat.flower + mudflat.reed) return "reed";
  }

  return null;
}

/** 需要保持净空的圆形区域。 */
export interface ClearZone {
  x: number;
  z: number;
  radius: number;
}

interface DetailChunkVisuals {
  instances: InstancedMesh[];
  slots: AssetSlot[];
}

function insideClearZone(zones: ClearZone[], x: number, z: number): boolean {
  for (const zone of zones) {
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz < zone.radius * zone.radius) return true;
  }
  return false;
}

/**
 * Chunk-local low-poly environment details.
 *
 * Each visual type owns one hidden Babylon mesh and all placed objects are
 * instances of that mesh. The sampling policy is pure and seeded, so detail
 * layouts remain stable while chunks stream in and out.
 */
export class DetailLayer {
  private readonly masters = new Map<string, Mesh>();
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly instances = new Map<string, DetailChunkVisuals>();
  private instanceSerial = 0;
  private lastLodPosition: { x: number; z: number } | null = null;
  private readonly shadowedInstances = new Set<InstancedMesh>();
  private readonly formalShadowMeshes = new Map<AssetSlot, AbstractMesh[]>();

  public constructor(
    private readonly scene: Scene,
    private readonly seed: number,
    private readonly setShadowCaster: ((mesh: AbstractMesh, enabled: boolean) => void) | undefined = undefined,
    private readonly assetManager: AssetManager | undefined = undefined,
  ) {
    // Keep one disabled shared prototype for every supported natural prop.
    // This is a fixed, tiny cost (no visible instances) and avoids a sparse
    // "quiet" chunk making a supported prop look unavailable to the catalog.
    for (const key of [
      "tree-trunk", "tree-trunk-light", "tree-canopy-round", "tree-canopy-pine", "tree-canopy-birch",
      "bush", "grass", "flower-stem", "flower-head", "reed", "log", "rock", "pebble",
    ]) this.master(key);
  }

  public build(
    sampler: TerrainSampler,
    chunkKey: string,
    centerX: number,
    centerZ: number,
    size: number,
    keepClear: ClearZone[] = [],
  ): void {
    this.disposeChunk(chunkKey);
    this.lastLodPosition = null;

    const rng = mulberry32(hashInts(Math.round(centerX), Math.round(centerZ), this.seed + 20_771));
    const placed: Array<{ x: number; z: number }> = [];
    const list: InstancedMesh[] = [];
    const slots: AssetSlot[] = [];

    for (let i = 0; i < DETAIL_CONFIG.candidatesPerChunk; i += 1) {
      const x = centerX + (rng() - 0.5) * size;
      const z = centerZ + (rng() - 0.5) * size;
      if (insideClearZone(keepClear, x, z)) continue;
      if (rng() > rhythmAt(x, z, this.seed).detailDensity) continue;

      const sample = sampler.sample(x, z);
      if (this.withinSpacing(placed, x, z)) continue;

      const kind = chooseDetailKind(
        {
          zone: sample.zone,
          biome: sample.biome,
          moisture: sample.moisture,
          height: sample.height,
          waterDepth: sample.waterDepth,
          roadDistance: sample.roadDistance,
          roadInfluence: sample.roadInfluence,
        },
        this.slopeAt(sampler, x, z),
        rng(),
      );
      if (!kind) continue;

      placed.push({ x, z });
      this.place(kind, x, sample.height, z, rng, list, slots);
    }

    this.instances.set(chunkKey, { instances: list, slots });
  }

  public disposeChunk(chunkKey: string): void {
    const chunk = this.instances.get(chunkKey);
    if (!chunk) return;
    for (const slot of chunk.slots) {
      const formalMeshes = this.formalShadowMeshes.get(slot) ?? [];
      for (const mesh of formalMeshes) this.setShadowCaster?.(mesh, false);
      this.formalShadowMeshes.delete(slot);
      slot.dispose();
    }
    for (const instance of chunk.instances) {
      this.updateShadowCaster(instance, false);
      if (!instance.isDisposed()) instance.dispose(false, false);
    }
    this.instances.delete(chunkKey);
  }

  public disposeAll(): void {
    for (const key of [...this.instances.keys()]) this.disposeChunk(key);
  }

  public dispose(): void {
    this.disposeAll();
    for (const master of this.masters.values()) master.dispose(false, false);
    this.masters.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.formalShadowMeshes.clear();
  }

  public get instanceCount(): number {
    let total = 0;
    for (const chunk of this.instances.values()) total += chunk.instances.length;
    return total;
  }

  /**
   * CPU-side detail LOD. It only runs after the player moves 8m, while chunk
   * streaming owns creation/disposal. This avoids spending draw calls on tiny
   * grass and flowers hidden by fog in distant chunks.
   */
  public updateLod(centerX: number, centerZ: number): void {
    if (this.lastLodPosition && Math.hypot(centerX - this.lastLodPosition.x, centerZ - this.lastLodPosition.z) < 8) return;
    this.lastLodPosition = { x: centerX, z: centerZ };
    for (const chunk of this.instances.values()) {
      for (const instance of chunk.instances) {
        if (instance.isDisposed()) continue;
        const limit = detailLodDistance(instance.name.split("-i-")[0]);
        const visible = Math.hypot(instance.position.x - centerX, instance.position.z - centerZ) <= limit;
        if (instance.isEnabled() !== visible) instance.setEnabled(visible);
        const nearShadowRange = Math.hypot(instance.position.x - centerX, instance.position.z - centerZ) <= 128;
        this.updateShadowCaster(instance, visible && nearShadowRange);
      }
      for (const slot of chunk.slots) {
        if (slot.root.isDisposed()) continue;
        const kind = slot.selection.category === "trees" ? "tree" : slot.selection.category === "rocks" ? "rock" : "log";
        const limit = detailLodDistance(kind);
        const visible = Math.hypot(slot.root.position.x - centerX, slot.root.position.z - centerZ) <= limit;
        if (slot.root.isEnabled() !== visible) slot.root.setEnabled(visible);
        const nearShadowRange = Math.hypot(slot.root.position.x - centerX, slot.root.position.z - centerZ) <= 128;
        for (const mesh of this.formalShadowMeshes.get(slot) ?? []) this.setShadowCaster?.(mesh, visible && nearShadowRange);
      }
    }
  }

  public get visibleInstanceCount(): number {
    let total = 0;
    for (const chunk of this.instances.values()) {
      for (const instance of chunk.instances) if (!instance.isDisposed() && instance.isEnabled()) total += 1;
      for (const slot of chunk.slots) if (!slot.root.isDisposed() && slot.root.isEnabled()) total += slot.root.getChildMeshes().length;
    }
    return total;
  }

  private place(kind: DetailKind, x: number, y: number, z: number, rng: () => number, list: InstancedMesh[], slots: AssetSlot[]): void {
    const scale = SCALE_RANGE[kind][0] + rng() * (SCALE_RANGE[kind][1] - SCALE_RANGE[kind][0]);
    const rotation = rng() * Math.PI * 2;

    if (kind === "treeRound" || kind === "treePine" || kind === "treeBirch") {
      const canopyKey = kind === "treeRound" ? "tree-canopy-round" : kind === "treePine" ? "tree-canopy-pine" : "tree-canopy-birch";
      const trunkKey = kind === "treeBirch" ? "tree-trunk-light" : "tree-trunk";
      const assetId = kind === "treeRound" ? "tree-round" : kind === "treePine" ? "tree-pine" : "tree-birch";
      if (this.assetManager) {
        const trunk = this.instance(trunkKey, 0, 2.7 * scale, 0, 1, rotation, true);
        const canopy = this.instance(canopyKey, Math.sin(rotation) * 0.15 * scale, 5.3 * scale, 0, 1, rotation + 0.6, true);
        const slot = this.formalSlot(assetId, hashInts(Math.round(x * 10), Math.round(z * 10), this.seed), x, y, z, scale, rotation, [trunk, canopy], kind);
        slots.push(slot);
        list.push(trunk, canopy);
        return;
      }
      const trunk = this.instance(trunkKey, x, y + 2.7 * scale, z, scale, rotation);
      const canopy = this.instance(canopyKey, x + Math.sin(rotation) * 0.15 * scale, y + 5.3 * scale, z, scale, rotation + 0.6);
      list.push(trunk, canopy);
      return;
    }

    if (kind === "grass") {
      for (let i = 0; i < 3; i += 1) {
        const offset = (i - 1) * 0.12 * scale;
        const blade = this.instance("grass", x + offset, y + 0.28 * scale, z + offset * 0.7, scale * (0.85 + i * 0.08), rotation + i * 0.8);
        blade.rotation.z = (i - 1) * 0.16;
        list.push(blade);
      }
      return;
    }

    if (kind === "flower") {
      const stem = this.instance("flower-stem", x, y + 0.3 * scale, z, scale, rotation);
      const head = this.instance("flower-head", x, y + 0.68 * scale, z, scale, rotation);
      list.push(stem, head);
      return;
    }

    if (kind === "reed") {
      for (let i = 0; i < 3; i += 1) {
        const angle = rotation + i * 2.1;
        const offset = 0.16 * scale;
        const reed = this.instance("reed", x + Math.cos(angle) * offset, y + 0.78 * scale, z + Math.sin(angle) * offset, scale * (0.85 + i * 0.08), angle);
        reed.rotation.z = (i - 1) * 0.08;
        list.push(reed);
      }
      return;
    }

    const key = kind === "log" ? "log" : kind;
    const assetId = kind === "rock" ? "rock-large" : kind === "log" ? "wood-resource" : undefined;
    if (assetId && this.assetManager) {
      const fallback = this.instance(key, 0, (kind === "log" ? 0.34 : 0.42) * scale, 0, 1, rotation, true);
      if (kind === "log") fallback.rotation.z = Math.PI / 2;
      const slot = this.formalSlot(assetId, hashInts(Math.round(x * 10), Math.round(z * 10), this.seed), x, y, z, scale, rotation, [fallback], kind);
      slots.push(slot);
      list.push(fallback);
      return;
    }
    const instance = this.instance(key, x, y + (kind === "log" ? 0.34 : kind === "rock" ? 0.42 : 0.16) * scale, z, scale, rotation);
    if (kind === "log") instance.rotation.z = Math.PI / 2;
    list.push(instance);
  }

  private instance(key: string, x: number, y: number, z: number, scale: number, rotation: number, local = false): InstancedMesh {
    const master = this.master(key);
    const instance = master.createInstance(`${key}-i-${this.instanceSerial++}`);
    instance.position.set(local ? 0 : x, y, local ? 0 : z);
    instance.rotation.y = rotation;
    instance.scaling.setAll(scale);
    instance.isPickable = false;
    instance.checkCollisions = false;
    return instance;
  }

  private formalSlot(
    assetId: string,
    seed: number,
    x: number,
    y: number,
    z: number,
    scale: number,
    rotation: number,
    fallbackRoots: readonly AbstractMesh[],
    kind: DetailKind,
  ): AssetSlot {
    const slot = this.assetManager!.createSlot(assetId, seed, fallbackRoots);
    slot.root.position.set(x, y, z);
    slot.root.rotation.y = rotation;
    slot.root.scaling.setAll(scale * slot.selection.variant.nominalScale);
    void slot.ready.then((formal) => {
      if (!formal || slot.root.isDisposed() || !castsDetailShadow(kind)) return;
      const meshes = slot.root.getChildMeshes();
      this.formalShadowMeshes.set(slot, meshes);
      for (const mesh of meshes) this.setShadowCaster?.(mesh, true);
    });
    return slot;
  }

  private updateShadowCaster(instance: InstancedMesh, enabled: boolean): void {
    if (!this.setShadowCaster || instance.isDisposed()) return;
    const canCast = castsDetailShadow(instance.name.split("-i-")[0]);
    const registered = this.shadowedInstances.has(instance);
    if (enabled && canCast && !registered) {
      this.setShadowCaster(instance, true);
      this.shadowedInstances.add(instance);
    } else if ((!enabled || !canCast) && registered) {
      this.setShadowCaster(instance, false);
      this.shadowedInstances.delete(instance);
    }
  }

  private master(key: string): Mesh {
    const existing = this.masters.get(key);
    if (existing) return existing;

    let mesh: Mesh;
    switch (key) {
      case "tree-trunk":
        mesh = MeshBuilder.CreateCylinder(key, { height: 5.4, diameterTop: 0.42, diameterBottom: 0.78, tessellation: 5 }, this.scene);
        mesh.material = this.material("bark", "#7a5940");
        break;
      case "tree-trunk-light":
        mesh = MeshBuilder.CreateCylinder(key, { height: 5.2, diameterTop: 0.38, diameterBottom: 0.68, tessellation: 5 }, this.scene);
        mesh.material = this.material("bark-light", "#a87550");
        break;
      case "tree-canopy-round":
        mesh = MeshBuilder.CreatePolyhedron(key, { type: 2, size: 2.35 }, this.scene);
        mesh.material = this.material("canopy", "#4c7a3f");
        break;
      case "tree-canopy-pine":
        mesh = MeshBuilder.CreateCylinder(key, { height: 3.8, diameterTop: 0.22, diameterBottom: 2.8, tessellation: 5 }, this.scene);
        mesh.material = this.material("canopy-pine", "#355f3d");
        break;
      case "tree-canopy-birch":
        mesh = MeshBuilder.CreatePolyhedron(key, { type: 1, size: 2.2 }, this.scene);
        mesh.material = this.material("canopy-light", "#6f9d56");
        break;
      case "bush":
        mesh = MeshBuilder.CreatePolyhedron(key, { type: 2, size: 0.95 }, this.scene);
        mesh.scaling.y = 0.7;
        mesh.material = this.material("bush", "#5c8347");
        break;
      case "grass":
        mesh = MeshBuilder.CreateCylinder(key, { height: 0.65, diameterTop: 0.035, diameterBottom: 0.2, tessellation: 4 }, this.scene);
        mesh.material = this.material("grass", "#6f9b4f");
        break;
      case "flower-stem":
        mesh = MeshBuilder.CreateCylinder(key, { height: 0.62, diameterTop: 0.025, diameterBottom: 0.06, tessellation: 4 }, this.scene);
        mesh.material = this.material("flower-stem", "#5c874a");
        break;
      case "flower-head":
        mesh = MeshBuilder.CreatePolyhedron(key, { type: 1, size: 0.18 }, this.scene);
        mesh.material = this.material("flower-head", "#d59b58");
        break;
      case "reed":
        mesh = MeshBuilder.CreateCylinder(key, { height: 1.7, diameterTop: 0.035, diameterBottom: 0.12, tessellation: 4 }, this.scene);
        mesh.material = this.material("reed", "#7d9a4e");
        break;
      case "log":
        mesh = MeshBuilder.CreateCylinder(key, { height: 2.5, diameterTop: 0.34, diameterBottom: 0.48, tessellation: 6 }, this.scene);
        mesh.material = this.material("log", "#6e513c");
        break;
      case "rock":
        mesh = MeshBuilder.CreatePolyhedron(key, { type: 1, size: 1.1 }, this.scene);
        mesh.scaling.y = 0.72;
        mesh.material = this.material("boulder", "#83817c");
        break;
      default:
        mesh = MeshBuilder.CreatePolyhedron(key, { type: 1, size: 0.42 }, this.scene);
        mesh.scaling.y = 0.65;
        mesh.material = this.material("pebble", "#98958c");
        break;
    }

    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.setEnabled(false);
    this.masters.set(key, mesh);
    return mesh;
  }

  private material(key: string, diffuseHex: string): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new StandardMaterial(`detail-${key}`, this.scene);
    material.diffuseColor = Color3.FromHexString(diffuseHex);
    material.specularColor = new Color3(0.03, 0.03, 0.03);
    this.materials.set(key, material);
    return material;
  }

  private slopeAt(sampler: TerrainSampler, x: number, z: number): number {
    const step = 3;
    const height = sampler.height(x, z);
    const dx = sampler.height(x + step, z) - height;
    const dz = sampler.height(x, z + step) - height;
    return Math.hypot(dx, dz) / step;
  }

  private withinSpacing(placed: Array<{ x: number; z: number }>, x: number, z: number): boolean {
    const limit = DETAIL_CONFIG.minSpacing * DETAIL_CONFIG.minSpacing;
    for (const other of placed) {
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < limit) return true;
    }
    return false;
  }
}
