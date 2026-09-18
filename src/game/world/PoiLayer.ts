import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type InstancedMesh,
  type Scene,
} from "@babylonjs/core";
import { POI_CONFIG } from "../config";
import { AssetManager, type AssetSlot } from "../assets/AssetManager";
import { hashInts } from "../utils/random";
import { selectResourceVisual, type ResourceVisualKind } from "../assets/ResourceVisuals";
import type { TerrainSampler } from "./TerrainSampler";
import {
  footprintMetrics,
  poiPlacementAt,
  type MineralNode,
  type MineralType,
  type PoiPlacement,
} from "./PoiRules";

const MINERAL_COLORS: Record<MineralType, string> = {
  stone: "#858b8b",
  iron: "#8b5a4d",
  copper: "#b26e45",
  rare: "#a88bd0",
};

const MATERIAL_COLORS: Record<string, string> = {
  wood: "#76523d",
  woodLight: "#a9774c",
  roof: "#4c5553",
  metal: "#68777a",
  rust: "#9a5f47",
  concrete: "#878986",
  glass: "#4a8790",
  yellow: "#cfaa45",
  white: "#d7d4c4",
  red: "#a24f44",
  green: "#5d7d4b",
  lamp: "#f2c971",
  dirt: "#5f4b3e",
};

type MasterKey =
  | "fence"
  | "sign"
  | "utility-pole"
  | "street-lamp"
  | "crate"
  | "barrel"
  | "pallet"
  | "trash-bin"
  | "bench";

/**
 * Deterministic hand-made scene layer. POI rules stay pure in PoiRules.ts;
 * this class owns only Babylon meshes, material caching, and chunk disposal.
 */
export class PoiLayer {
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly masters = new Map<MasterKey, Mesh>();
  private readonly builds = new Map<string, Mesh>();
  private readonly assetSlots = new Map<string, AssetSlot>();
  private instanceSerial = 0;

  public constructor(
    private readonly scene: Scene,
    private readonly seed: number,
    private readonly assetManager: AssetManager | undefined = undefined,
  ) {}

  public placementFor(cellX: number, cellZ: number, sampler: TerrainSampler): PoiPlacement | null {
    return poiPlacementAt(cellX, cellZ, sampler, this.seed);
  }

  public query(centerX: number, centerZ: number, radius: number, sampler: TerrainSampler): PoiPlacement[] {
    const spacing = POI_CONFIG.cellSpacing;
    const minCellX = Math.floor((centerX - radius) / spacing) - 1;
    const maxCellX = Math.floor((centerX + radius) / spacing) + 1;
    const minCellZ = Math.floor((centerZ - radius) / spacing) - 1;
    const maxCellZ = Math.floor((centerZ + radius) / spacing) + 1;
    const result: PoiPlacement[] = [];

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const placement = this.placementFor(cellX, cellZ, sampler);
        if (!placement) continue;
        if (Math.hypot(placement.x - centerX, placement.z - centerZ) <= radius) result.push(placement);
      }
    }
    return result;
  }

  public buildForCell(cellX: number, cellZ: number, sampler: TerrainSampler): Mesh | null {
    const placement = this.placementFor(cellX, cellZ, sampler);
    if (!placement || this.builds.has(placement.id)) return null;

    const root = new Mesh(`poi-${placement.id}`, this.scene);
    root.metadata = {
      poiPlacement: placement,
      poiKind: placement.kind,
      mineralNodes: placement.minerals,
    };
    root.isPickable = false;
    root.checkCollisions = false;

    switch (placement.kind) {
      case "cabin":
        this.buildCabin(root, placement);
        break;
      case "gasStation":
        this.buildGasStation(root, placement);
        break;
      case "warehouse":
        this.buildWarehouse(root, placement);
        break;
      case "abandonedCamp":
        this.buildAbandonedCamp(root, placement);
        break;
      case "dock":
        this.buildDock(root, placement);
        break;
      case "woodBridge":
      case "roadBridge":
        this.buildBridge(root, placement);
        break;
      case "mineShed":
        this.buildMineShed(root, placement);
        break;
      case "wreck":
        this.buildWreck(root, placement);
        break;
      case "crashSite":
        this.buildCrashSite(root, placement);
        break;
      case "hunterCamp":
        this.buildHunterCamp(root, placement);
        break;
      case "supplyCache":
        this.buildSupplyCache(root, placement);
        break;
      case "mineralOutcrop":
        this.buildMineralOutcrop(root, placement);
        break;
    }

    this.attachFormalBaseAsset(root, placement);

    this.builds.set(placement.id, root);
    return root;
  }

  public disposeCell(cellX: number, cellZ: number): void {
    const root = this.builds.get(`poi:${cellX}:${cellZ}`);
    if (!root) return;
    this.assetSlots.get(root.name.slice("poi-".length))?.dispose();
    this.assetSlots.delete(root.name.slice("poi-".length));
    if (!root.isDisposed()) root.dispose(false, false);
    this.builds.delete(`poi:${cellX}:${cellZ}`);
  }

  public disposeAll(): void {
    for (const root of this.builds.values()) {
      this.assetSlots.get(root.name.slice("poi-".length))?.dispose();
      if (!root.isDisposed()) root.dispose(false, false);
    }
    this.builds.clear();
    this.assetSlots.clear();
  }

  public dispose(): void {
    this.disposeAll();
    for (const master of this.masters.values()) master.dispose(false, false);
    this.masters.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  /** Used by browser acceptance without exposing mutable build state. */
  public get activeCount(): number {
    return this.builds.size;
  }

  private attachFormalBaseAsset(root: Mesh, placement: PoiPlacement): void {
    const assetByKind: Partial<Record<PoiPlacement["kind"], string>> = {
      cabin: "cabin",
      warehouse: "warehouse",
      gasStation: "gas-station",
      woodBridge: "bridge",
      roadBridge: "bridge",
      dock: "dock",
    };
    const assetId = assetByKind[placement.kind];
    if (!assetId || !this.assetManager) return;
    const slot = this.assetManager.createSlot(
      assetId,
      hashInts(Math.round(placement.x), Math.round(placement.z), this.seed),
      [],
      {
        parent: root,
        position: new Vector3(placement.x, placement.groundY, placement.z),
        fallbackOwner: root,
      },
    );
    slot.root.rotation.y = placement.rotation;
    slot.root.scaling.setAll(slot.selection.variant.nominalScale);
    root.metadata = { ...root.metadata, formalAsset: slot.selection };
    this.assetSlots.set(placement.id, slot);
  }

  private buildCabin(root: Mesh, placement: PoiPlacement): void {
    this.box(root, "cabin-wall", placement.x, placement.groundY + 2.1, placement.z, 10, 4.2, 8, "wood", placement.rotation);
    this.box(root, "cabin-roof", placement.x, placement.groundY + 4.65, placement.z, 11.2, 0.45, 9.2, "roof", placement.rotation);
    this.cylinder(root, "cabin-chimney", placement.x + 2.4, placement.groundY + 5.2, placement.z - 1.2, 0.55, 1.4, "concrete");
    this.box(root, "cabin-porch", placement.x, placement.groundY + 0.22, placement.z + 5.1, 5.5, 0.45, 2.4, "woodLight", placement.rotation);
    this.decorateRoadside(root, placement, ["fence", "sign", "crate", "bench"]);
  }

  private buildGasStation(root: Mesh, placement: PoiPlacement): void {
    this.box(root, "gasStation-shop", placement.x, placement.groundY + 2, placement.z, 10, 4, 8, "concrete", placement.rotation);
    this.box(root, "gasStation-canopy", placement.x, placement.groundY + 5, placement.z + 4.5, 14, 0.55, 7, "yellow", placement.rotation);
    for (const side of [-1, 1]) {
      const offset = new Vector3(Math.cos(placement.rotation) * side * 3.4, 0, Math.sin(placement.rotation) * side * 3.4);
      this.cylinder(root, "gasStation-pump", placement.x + offset.x, placement.groundY + 1.1, placement.z + offset.z + 4.5, 0.55, 2.2, "red");
    }
    this.decorateRoadside(root, placement, ["sign", "street-lamp", "barrel", "trash-bin"]);
  }

  private buildWarehouse(root: Mesh, placement: PoiPlacement): void {
    this.box(root, "warehouse-wall", placement.x, placement.groundY + 2.5, placement.z, 12, 5, 18, "metal", placement.rotation);
    this.box(root, "warehouse-roof", placement.x, placement.groundY + 5.2, placement.z, 12.6, 0.45, 18.6, "roof", placement.rotation);
    this.box(root, "warehouse-door", placement.x, placement.groundY + 2.1, placement.z + 9.15, 6.2, 4.2, 0.25, "rust", placement.rotation);
    this.decorateRoadside(root, placement, ["fence", "crate", "pallet", "barrel", "utility-pole"]);
  }

  private buildAbandonedCamp(root: Mesh, placement: PoiPlacement): void {
    this.poly(root, "camp-tent", placement.x, placement.groundY + 1.5, placement.z, 1, 3.8, "woodLight", placement.rotation);
    this.cylinder(root, "camp-fire", placement.x + 3, placement.groundY + 0.35, placement.z + 1, 0.7, 0.7, "dirt", 7);
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      this.poly(root, "camp-stone", placement.x + 3 + Math.cos(angle) * 1.2, placement.groundY + 0.22, placement.z + 1 + Math.sin(angle) * 1.2, 1, 0.35, "concrete", angle);
    }
    this.decorateRoadside(root, placement, ["fence", "crate", "bench", "trash-bin"]);
  }

  private buildDock(root: Mesh, placement: PoiPlacement): void {
    const towardLake = new Vector3(-Math.cos(placement.rotation), 0, -Math.sin(placement.rotation));
    for (let index = 0; index < 7; index += 1) {
      const along = index * 2.6;
      const x = placement.x + towardLake.x * along;
      const z = placement.z + towardLake.z * along;
      this.box(root, "dock-plank", x, placement.groundY, z, 4.8, 0.3, 2.3, "woodLight", placement.rotation);
    }
    for (const side of [-1, 1]) {
      const x = placement.x + Math.cos(placement.rotation) * side * 1.7;
      const z = placement.z + Math.sin(placement.rotation) * side * 1.7;
      this.cylinder(root, "dock-post", x, placement.groundY - 0.8, z, 0.22, 2.4, "wood");
    }
    this.decorateRoadside(root, placement, ["sign", "bench", "crate"]);
  }

  private buildBridge(root: Mesh, placement: PoiPlacement): void {
    const halfLength = POI_CONFIG.bridgeHalfLength;
    const segmentCount = 8;
    const segmentLength = (halfLength * 2) / segmentCount;
    const startY = placement.bridgeStartY ?? placement.groundY;
    const endY = placement.bridgeEndY ?? placement.groundY;
    const deckTilt = Math.atan2(endY - startY, halfLength * 2);
    for (let index = 0; index < segmentCount; index += 1) {
      const along = -halfLength + segmentLength * (index + 0.5);
      const t = (along + halfLength) / (halfLength * 2);
      const deckY = startY + (endY - startY) * t;
      const x = placement.x + Math.sin(placement.rotation) * along;
      const z = placement.z + Math.cos(placement.rotation) * along;
      const deck = this.box(root, "bridge-deck", x, deckY, z, 6, 0.38, segmentLength, "woodLight", placement.rotation);
      deck.rotation.x = deckTilt;
    }
    for (const side of [-1, 1]) {
      const along = side * halfLength * 0.72;
      const x = placement.x + Math.sin(placement.rotation) * along;
      const z = placement.z + Math.cos(placement.rotation) * along;
      const t = (along + halfLength) / (halfLength * 2);
      const deckY = startY + (endY - startY) * t;
      this.cylinder(root, "bridge-pier", x, deckY - 1.7, z, 0.35, 3.4, "wood");
    }
    this.decorateRoadside(root, placement, ["sign", "fence"]);
  }

  private buildMineShed(root: Mesh, placement: PoiPlacement): void {
    this.box(root, "mineShed-wall", placement.x, placement.groundY + 1.8, placement.z, 8, 3.6, 7, "wood", placement.rotation);
    this.box(root, "mineShed-roof", placement.x, placement.groundY + 3.9, placement.z, 9, 0.4, 8, "roof", placement.rotation);
    this.box(root, "mineShed-door", placement.x, placement.groundY + 1.5, placement.z + 3.6, 3.2, 3, 0.2, "metal", placement.rotation);
    this.buildMinerals(root, placement.minerals);
    this.decorateRoadside(root, placement, ["fence", "pallet", "barrel", "crate", "utility-pole"]);
  }

  private buildWreck(root: Mesh, placement: PoiPlacement): void {
    this.box(root, "wreck-body", placement.x, placement.groundY + 0.75, placement.z, 3.2, 1.2, 6.2, "rust", placement.rotation);
    this.box(root, "wreck-cabin", placement.x, placement.groundY + 1.65, placement.z - 0.7, 2.8, 1.2, 2.1, "metal", placement.rotation);
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const sideOffset = new Vector3(Math.cos(placement.rotation) * side * 1.7, 0, Math.sin(placement.rotation) * side * 1.7);
        const endOffset = new Vector3(Math.sin(placement.rotation) * end * 1.9, 0, Math.cos(placement.rotation) * end * 1.9);
        this.cylinder(root, "wreck-wheel", placement.x + sideOffset.x + endOffset.x, placement.groundY + 0.35, placement.z + sideOffset.z + endOffset.z, 0.48, 0.3, "metal", 8, Math.PI / 2);
      }
    }
    this.decorateRoadside(root, placement, ["barrel", "trash-bin"]);
  }

  private buildCrashSite(root: Mesh, placement: PoiPlacement): void {
    this.buildWreck(root, placement);
    this.box(root, "crash-crate", placement.x - 3.2, placement.groundY + 0.48, placement.z + 2.4, 1.1, 0.96, 0.9, "woodLight", placement.rotation + 0.5);
    this.box(root, "crash-scattered-panel", placement.x + 3.6, placement.groundY + 0.18, placement.z - 2.1, 2.2, 0.22, 1.15, "rust", placement.rotation - 0.35);
    this.decorateRoadside(root, placement, ["barrel", "crate", "pallet", "trash-bin"]);
  }

  private buildHunterCamp(root: Mesh, placement: PoiPlacement): void {
    this.buildAbandonedCamp(root, placement);
    const log = this.cylinder(root, "hunter-log", placement.x - 3.5, placement.groundY + 0.34, placement.z - 1.5, 0.42, 3.4, "wood", 6, Math.PI / 2);
    log.rotation.z = placement.rotation + 0.3;
    this.box(root, "hunter-bedroll", placement.x - 1.6, placement.groundY + 0.18, placement.z + 3.1, 1.25, 0.24, 2.5, "green", placement.rotation);
    this.decorateRoadside(root, placement, ["bench", "crate", "fence"]);
  }

  private buildSupplyCache(root: Mesh, placement: PoiPlacement): void {
    this.box(root, "supply-tarp", placement.x, placement.groundY + 1.2, placement.z, 5.5, 0.26, 4.2, "green", placement.rotation);
    this.box(root, "supply-crate-a", placement.x - 1.2, placement.groundY + 0.52, placement.z, 1.1, 1.04, 0.92, "woodLight", placement.rotation);
    this.box(root, "supply-crate-b", placement.x + 1.15, placement.groundY + 0.48, placement.z + 0.8, 0.95, 0.96, 0.82, "woodLight", placement.rotation + 0.2);
    this.decorateRoadside(root, placement, ["pallet", "barrel", "crate", "sign"]);
  }

  private buildMineralOutcrop(root: Mesh, placement: PoiPlacement): void {
    this.buildMinerals(root, placement.minerals);
    this.decorateRoadside(root, placement, ["sign", "crate", "pallet"]);
  }

  private buildMinerals(root: Mesh, nodes: MineralNode[]): void {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const visualKind = node.type as ResourceVisualKind;
      const visual = selectResourceVisual(visualKind, hashInts(Math.round(node.position.x), Math.round(node.position.z), this.seed + index));
      const nodeRoot = new TransformNode(`mineral-node-${node.id}`, this.scene);
      nodeRoot.parent = root;
      nodeRoot.position.set(node.position.x, node.position.y, node.position.z);
      nodeRoot.metadata = { mineralNode: node, resourceVisual: visual };

      const base = new TransformNode(`mineral-base-${node.id}`, this.scene);
      base.parent = nodeRoot;
      const accents = new TransformNode(`mineral-accents-${node.id}`, this.scene);
      accents.parent = nodeRoot;
      const size = node.type === "rare" ? 0.9 : 0.75;
      const materialKey = `mineral-${node.type}`;
      const mother = this.poly(base, `mineral-mother-${node.type}`, 0, size * 0.45, 0, 1, size, "concrete");
      mother.scaling.y = 0.76;

      if (node.type === "stone") {
        this.poly(base, "stone-cluster-a", -size * 0.8, size * 0.3, size * 0.2, 1, size * 0.7, materialKey).scaling.y = 0.7;
        this.poly(base, "stone-cluster-b", size * 0.75, size * 0.24, -size * 0.25, 1, size * 0.55, materialKey).scaling.y = 0.66;
      } else if (node.type === "iron" || node.type === "copper") {
        for (let veinIndex = 0; veinIndex < 3; veinIndex += 1) {
          const offset = (veinIndex - 1) * size * 0.34;
          const vein = this.poly(accents, `${node.type}-vein-${veinIndex}`, offset, size * (0.7 - Math.abs(offset) * 0.16), -size * 0.42, 1, size * 0.25, materialKey);
          vein.scaling.set(1.7, 0.28, 0.42);
          vein.rotation.y = (veinIndex - 1) * 0.25;
        }
      } else {
        for (let crystalIndex = 0; crystalIndex < 3; crystalIndex += 1) {
          const angle = crystalIndex * 2.1;
          const crystal = this.poly(accents, `rare-crystal-${crystalIndex}`, Math.cos(angle) * size * 0.42, size * 0.78, Math.sin(angle) * size * 0.42, 0, size * 0.34, materialKey);
          crystal.scaling.y = 1.6;
          crystal.rotation.y = angle;
        }
      }

      if (this.assetManager) {
        const slot = this.assetManager.createSlot(
          visual.profile.assetId,
          visual.seed,
          [],
          { parent: nodeRoot, fallbackOwner: base },
        );
        slot.root.scaling.setAll(slot.selection.variant.nominalScale);
        nodeRoot.metadata = { ...nodeRoot.metadata, assetSelection: slot.selection, visualVariant: visual.variantId, assetSlot: slot };
      }
    }
  }

  private decorateRoadside(root: Mesh, placement: PoiPlacement, keys: MasterKey[]): void {
    const right = new Vector3(Math.cos(placement.rotation), 0, Math.sin(placement.rotation));
    const forward = new Vector3(Math.sin(placement.rotation), 0, Math.cos(placement.rotation));
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const offset = index - (keys.length - 1) / 2;
      const lift: Record<MasterKey, number> = {
        fence: 0.55,
        sign: 0.9,
        "utility-pole": 2.75,
        "street-lamp": 1.8,
        crate: 0.45,
        barrel: 0.6,
        pallet: 0.12,
        "trash-bin": 0.48,
        bench: 0.18,
      };
      const position = new Vector3(
        placement.x + right.x * offset * 2.8 + forward.x * 7,
        placement.groundY + lift[key],
        placement.z + right.z * offset * 2.8 + forward.z * 7,
      );
      this.instance(root, key, position, key === "utility-pole" ? 1.35 : 1, placement.rotation);
    }
  }

  private box(root: TransformNode, name: string, x: number, y: number, z: number, width: number, height: number, depth: number, materialKey: string, rotation = 0): Mesh {
    const mesh = MeshBuilder.CreateBox(`${name}-${this.instanceSerial++}`, { width, height, depth }, this.scene);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.material = this.material(materialKey);
    return this.attach(root, mesh);
  }

  private cylinder(root: TransformNode, name: string, x: number, y: number, z: number, diameter: number, height: number, materialKey: string, tessellation = 6, rotationX = 0): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`${name}-${this.instanceSerial++}`, { height, diameter, tessellation }, this.scene);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotationX;
    mesh.material = this.material(materialKey);
    return this.attach(root, mesh);
  }

  private poly(root: TransformNode, name: string, x: number, y: number, z: number, type: number, size: number, materialKey: string, rotation = 0): Mesh {
    const mesh = MeshBuilder.CreatePolyhedron(`${name}-${this.instanceSerial++}`, { type, size }, this.scene);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.material = this.material(materialKey);
    return this.attach(root, mesh);
  }

  private attach(root: TransformNode, mesh: Mesh): Mesh {
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  }

  private instance(root: TransformNode, key: MasterKey, position: Vector3, scale: number, rotation: number): InstancedMesh {
    const master = this.master(key);
    const instance = master.createInstance(`poi-${key}-${this.instanceSerial++}`);
    instance.position.copyFrom(position);
    instance.rotation.y = rotation;
    instance.scaling.setAll(scale);
    instance.parent = root;
    instance.isPickable = false;
    instance.checkCollisions = false;
    return instance;
  }

  private master(key: MasterKey): Mesh {
    const existing = this.masters.get(key);
    if (existing) return existing;
    let mesh: Mesh;
    switch (key) {
      case "fence":
        mesh = MeshBuilder.CreateBox(key, { width: 3.2, height: 1.1, depth: 0.14 }, this.scene);
        break;
      case "sign":
        mesh = MeshBuilder.CreateBox(key, { width: 0.9, height: 1.4, depth: 0.12 }, this.scene);
        break;
      case "utility-pole":
        mesh = MeshBuilder.CreateCylinder(key, { height: 5.5, diameter: 0.24, tessellation: 5 }, this.scene);
        break;
      case "street-lamp":
        mesh = MeshBuilder.CreateCylinder(key, { height: 3.6, diameter: 0.18, tessellation: 5 }, this.scene);
        break;
      case "crate":
        mesh = MeshBuilder.CreateBox(key, { size: 0.9 }, this.scene);
        break;
      case "barrel":
        mesh = MeshBuilder.CreateCylinder(key, { height: 1.2, diameter: 0.75, tessellation: 8 }, this.scene);
        break;
      case "pallet":
        mesh = MeshBuilder.CreateBox(key, { width: 1.8, height: 0.18, depth: 1.2 }, this.scene);
        break;
      case "trash-bin":
        mesh = MeshBuilder.CreateCylinder(key, { height: 0.95, diameterTop: 0.55, diameterBottom: 0.7, tessellation: 6 }, this.scene);
        break;
      case "bench":
        mesh = MeshBuilder.CreateBox(key, { width: 2.3, height: 0.35, depth: 0.55 }, this.scene);
        break;
    }
    mesh.material = this.material(key);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.setEnabled(false);
    this.masters.set(key, mesh);
    return mesh;
  }

  private material(key: string): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const diffuse = key.startsWith("mineral-") ? MINERAL_COLORS[key.slice("mineral-".length) as MineralType] : MATERIAL_COLORS[key] ?? "#808080";
    const material = new StandardMaterial(`poi-${key}`, this.scene);
    material.diffuseColor = Color3.FromHexString(diffuse);
    material.specularColor = new Color3(0.04, 0.04, 0.04);
    if (key === "street-lamp" || key === "lamp") material.emissiveColor = Color3.FromHexString(MATERIAL_COLORS.lamp);
    this.materials.set(key, material);
    return material;
  }

  /** Re-exported here so browser checks can validate the same footprint rule. */
  public footprintPasses(sampler: TerrainSampler, placement: PoiPlacement): boolean {
    const size = placement.kind === "gasStation" ? [18, 14] : [14, placement.kind === "warehouse" ? 20 : 14];
    const metrics = footprintMetrics(sampler, placement.x, placement.z, size[0], size[1], placement.rotation);
    return metrics.maxSlope <= POI_CONFIG.buildingMaxSlope && metrics.heightRange <= POI_CONFIG.buildingMaxHeightRange;
  }
}
