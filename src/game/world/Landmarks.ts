import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Scene,
} from "@babylonjs/core";
import { LANDMARK_CONFIG } from "../config";
import { hashInts } from "../utils/random";
import { rhythmAt } from "./ExplorationRhythm";
import type { TerrainSampler } from "./TerrainSampler";

export type LandmarkKind = "radioTower" | "windmill" | "monolith" | "greatTree" | "summitOutpost" | "distantBridge";

export interface LandmarkPlacement {
  id: string;
  kind: LandmarkKind;
  cellX: number;
  cellZ: number;
  x: number;
  z: number;
  groundY: number;
  /** 地标高度，用于 HUD 估算可视性。 */
  height: number;
}

export interface LandmarkAnnotation {
  kind: LandmarkKind;
  label: string;
  distance: number;
  bearingDegrees: number;
  direction: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
}

interface LandmarkBuild {
  root: Mesh;
  /** 需要逐帧旋转的部件（风车叶片）。 */
  rotor?: Mesh;
  /** 需要逐帧脉冲的自发光材质（塔顶航标灯）。 */
  beacon?: StandardMaterial;
}

const KIND_LABEL: Record<LandmarkKind, string> = {
  radioTower: "无线电塔",
  windmill: "风车",
  monolith: "巨石阵",
  greatTree: "巨树",
  summitOutpost: "山顶瞭望屋",
  distantBridge: "远景石桥",
};

/**
 * 远景地标层。
 *
 * 生成方式：把世界切成 spacing 米见方的格子，每格按概率放一个地标，
 * 位置在格内抖动。这样能同时保证两件事：
 *   - 任意方向走出去都会遇到地标（不会出现"永远看不到目标"的死区）
 *   - 两个地标之间有最小间距（不会挤成一堆）
 *
 * 地标本身是低模几何体拼的，用共享材质 + 少量网格，
 * 单个地标大约 10~20 个 mesh，且在 chunk 卸载时整体销毁。
 */
export class LandmarkLayer {
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly builds = new Map<string, LandmarkBuild>();
  private time = 0;

  public constructor(private readonly scene: Scene, private readonly seed: number) {}

  /** 每帧动画：风车转动 + 航标灯脉冲。 */
  public update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    for (const build of this.builds.values()) {
      if (build.root.isDisposed()) continue;
      if (build.rotor && !build.rotor.isDisposed()) {
        build.rotor.rotation.z += deltaSeconds * 0.55;
      }
      if (build.beacon) {
        const pulse = 0.55 + 0.45 * Math.sin(this.time * 2.4);
        build.beacon.emissiveColor.set(pulse * 1.0, pulse * 0.32, pulse * 0.2);
      }
    }
  }

  /**
   * 列出以 (centerX, centerZ) 为中心、radius 米内可能存在的所有地标。
   * 只做位置计算，不创建网格 —— HUD 的"最近地标指引"直接用这个。
   */
  public query(centerX: number, centerZ: number, radius: number, sampler: TerrainSampler): LandmarkPlacement[] {
    const spacing = LANDMARK_CONFIG.spacing;
    const minCellX = Math.floor((centerX - radius) / spacing) - 1;
    const maxCellX = Math.floor((centerX + radius) / spacing) + 1;
    const minCellZ = Math.floor((centerZ - radius) / spacing) - 1;
    const maxCellZ = Math.floor((centerZ + radius) / spacing) + 1;

    const found: LandmarkPlacement[] = [];
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const placement = this.placementAt(cellX, cellZ, sampler);
        if (!placement) continue;
        const dx = placement.x - centerX;
        const dz = placement.z - centerZ;
        if (dx * dx + dz * dz > radius * radius) continue;
        found.push(placement);
      }
    }
    return found;
  }

  /** 最近地标（用于 HUD 指引）。 */
  public nearest(centerX: number, centerZ: number, sampler: TerrainSampler): LandmarkAnnotation | null {
    const candidates = this.query(centerX, centerZ, LANDMARK_CONFIG.spacing * 2.5, sampler);
    if (candidates.length === 0) return null;

    let best = candidates[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.x - centerX, candidate.z - centerZ);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return {
      kind: best.kind,
      label: KIND_LABEL[best.kind],
      distance: bestDistance,
      bearingDegrees: bearingBetween(centerX, centerZ, best.x, best.z),
      direction: compassFromBearing(bearingBetween(centerX, centerZ, best.x, best.z)),
    };
  }

  /**
   * 按地块（cell）构建地标。调用方在 chunk 创建 / 卸载时驱动，
   * 保证同一个地标只有一个实例，且离开后一定被销毁。
   */
  public buildForCell(cellX: number, cellZ: number, sampler: TerrainSampler): Mesh | null {
    const placement = this.placementAt(cellX, cellZ, sampler);
    if (!placement) return null;
    if (this.builds.has(placement.id)) return null;

    const build = this.construct(placement);
    this.builds.set(placement.id, build);
    return build.root;
  }

  public disposeCell(cellX: number, cellZ: number): void {
    const id = `${cellX}:${cellZ}`;
    const build = this.builds.get(id);
    if (!build) return;
    if (!build.root.isDisposed()) build.root.dispose(false, false);
    this.builds.delete(id);
  }

  /** 单个地块的放置信息（WorldManager 用它判断归属，不需要构造 3×3 邻域）。 */
  public placementFor(cellX: number, cellZ: number, sampler: TerrainSampler): LandmarkPlacement | null {
    return this.placementAt(cellX, cellZ, sampler);
  }

  public disposeAll(): void {
    for (const build of this.builds.values()) {
      if (!build.root.isDisposed()) build.root.dispose(false, false);
    }
    this.builds.clear();
  }

  public dispose(): void {
    this.disposeAll();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  /** 地块归属（地标由这个 chunk 负责构建和销毁）。 */
  public static cellOf(x: number, z: number): { cellX: number; cellZ: number } {
    const spacing = LANDMARK_CONFIG.spacing;
    return { cellX: Math.floor(x / spacing), cellZ: Math.floor(z / spacing) };
  }

  /** ---------- 位置计算 ---------- */
  private placementAt(cellX: number, cellZ: number, sampler: TerrainSampler): LandmarkPlacement | null {
    const spacing = LANDMARK_CONFIG.spacing;
    const hash = hashInts(cellX, cellZ, this.seed + 60_013);

    // 用哈希的位段当作几个独立的随机数，避免为每个格子造 rng 对象。
    const roll = (hash & 0xffff) / 0xffff;
    const rhythm = rhythmAt((cellX + 0.5) * spacing, (cellZ + 0.5) * spacing, this.seed);
    if (roll > LANDMARK_CONFIG.chance * rhythm.landmarkDensity) return null;

    const jitterX = (((hash >>> 16) & 0xff) / 0xff - 0.5) * 0.72;
    const jitterZ = (((hash >>> 8) & 0xff) / 0xff - 0.5) * 0.72;
    const idealX = (cellX + 0.5 + jitterX) * spacing;
    const idealZ = (cellZ + 0.5 + jitterZ) * spacing;

    const snapped = this.snapToLand(idealX, idealZ, spacing, sampler);
    if (!snapped) return null;

    const kind = this.pickKind(hash, snapped.biome);

    return {
      id: `${cellX}:${cellZ}`,
      kind,
      cellX,
      cellZ,
      x: snapped.x,
      z: snapped.z,
      groundY: snapped.y,
      height: LANDMARK_HEIGHT[kind],
    };
  }

  /**
   * 把理想位置挪到干燥、离路远的陆地上：
   * 优先用理想点，不行就按同心环螺旋外扩找候选点。
   */
  private snapToLand(
    idealX: number,
    idealZ: number,
    spacing: number,
    sampler: TerrainSampler,
  ): { x: number; z: number; y: number; biome: string } | null {
    const tryPos = (x: number, z: number): { x: number; z: number; y: number; biome: string } | null => {
      const sample = sampler.sample(x, z);
      if (sample.waterDepth > 0.2) return null;
      if (sample.height < sampler.waterLevel + 1.2) return null;
      if (sample.roadDistance < LANDMARK_CONFIG.minShoreDistance) return null;
      return { x, z, y: sample.height, biome: sample.biome };
    };

    const direct = tryPos(idealX, idealZ);
    if (direct) return direct;

    for (let ring = 1; ring <= 4; ring += 1) {
      const radius = ring * (spacing / 9);
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2;
        const result = tryPos(idealX + Math.cos(angle) * radius, idealZ + Math.sin(angle) * radius);
        if (result) return result;
      }
    }
    return null;
  }

  private pickKind(hash: number, biome: string): LandmarkKind {
    const selector = ((hash >>> 24) & 0xff) / 0xff;
    if (biome === "mountain" && selector > 0.28) return "summitOutpost";
    if (biome === "rocky" && selector > 0.82) return "summitOutpost";
    if (selector > 0.92) return "distantBridge";
    if (biome === "forest" && selector > 0.55) return "greatTree";
    if (biome === "rocky" && selector > 0.5) return "monolith";
    if (biome === "mountain" && selector > 0.4) return "radioTower";
    if (selector < 0.3) return "radioTower";
    if (selector < 0.6) return "windmill";
    if (selector < 0.82) return "greatTree";
    return "monolith";
  }

  /** ---------- 几何构建 ---------- */
  private construct(placement: LandmarkPlacement): LandmarkBuild {
    const root = new Mesh(`landmark-${placement.id}`, this.scene);
    root.position.set(placement.x, placement.groundY, placement.z);
    root.isPickable = false;

    switch (placement.kind) {
      case "radioTower":
        return this.buildRadioTower(root);
      case "windmill":
        return this.buildWindmill(root);
      case "monolith":
        return this.buildMonolith(root);
      case "summitOutpost":
        return this.buildSummitOutpost(root);
      case "distantBridge":
        return this.buildDistantBridge(root);
      default:
        return this.buildGreatTree(root);
    }
  }

  private buildRadioTower(root: Mesh): LandmarkBuild {
    const mast = MeshBuilder.CreateCylinder("mast", { height: 26, diameterTop: 0.5, diameterBottom: 2.2, tessellation: 6 }, this.scene);
    mast.position.y = 13;
    mast.parent = root;
    mast.material = this.material("landmark-metal", "#68707a");

    // 三道横撑，让塔的轮廓在远处可辨认。
    for (const [y, radius] of [[9, 1.5], [17, 1.05], [24, 0.7]] as const) {
      const brace = MeshBuilder.CreateTorus("brace", { diameter: radius * 2, thickness: 0.14, tessellation: 8 }, this.scene);
      brace.position.y = y;
      brace.rotation.x = Math.PI / 2;
      brace.parent = root;
      brace.material = this.material("landmark-metal", "#68707a");
    }

    const beaconMaterial = this.material("landmark-beacon", "#ff8a5c", "#ff4422");
    const beacon = MeshBuilder.CreatePolyhedron("beacon", { type: 0, size: 0.55 }, this.scene);
    beacon.position.y = 26.6;
    beacon.parent = root;
    beacon.material = beaconMaterial;

    // 底座，避免塔"插"在地里显得悬空。
    const base = MeshBuilder.CreateCylinder("tower-base", { height: 0.9, diameter: 4.2, tessellation: 8 }, this.scene);
    base.position.y = 0.35;
    base.parent = root;
    base.material = this.material("landmark-concrete", "#8d8c85");

    return { root, beacon: beaconMaterial };
  }

  private buildWindmill(root: Mesh): LandmarkBuild {
    const tower = MeshBuilder.CreateCylinder("tower", { height: 15, diameterTop: 2.4, diameterBottom: 4.4, tessellation: 8 }, this.scene);
    tower.position.y = 7.5;
    tower.parent = root;
    tower.material = this.material("landmark-wall", "#ddd6c4");

    const roof = MeshBuilder.CreateCylinder("roof", { height: 2.4, diameterTop: 0.2, diameterBottom: 3.2, tessellation: 8 }, this.scene);
    roof.position.y = 16.2;
    roof.parent = root;
    roof.material = this.material("landmark-roof", "#8a4a3a");

    // 叶片挂在转子上，update() 里整体绕 Z 轴旋转，形成持续转动的风车。
    const rotor = new Mesh("rotor", this.scene);
    rotor.parent = root;
    rotor.position.set(0, 15.0, -1.9);
    rotor.isPickable = false;

    const hub = MeshBuilder.CreatePolyhedron("hub", { type: 3, size: 0.5 }, this.scene);
    hub.parent = rotor;
    hub.material = this.material("landmark-wood", "#6b4a33");

    const sail = this.material("landmark-sail", "#f2ead6");
    const spar = this.material("landmark-wood", "#6b4a33");

    for (let i = 0; i < 4; i += 1) {
      const arm = new Mesh(`blade-${i}`, this.scene);
      arm.parent = rotor;
      arm.rotation.z = (i / 4) * Math.PI * 2;
      arm.isPickable = false;

      // 骨架：从轮毂伸出的长条。
      const beam = MeshBuilder.CreateBox("beam", { width: 0.22, height: 6.2, depth: 0.22 }, this.scene);
      beam.position.y = 3.3;
      beam.parent = arm;
      beam.material = spar;

      // 帆布：贴在骨架一侧，形成明显的叶片面。
      const canvas = MeshBuilder.CreateBox("sail", { width: 1.15, height: 5.2, depth: 0.12 }, this.scene);
      canvas.position.set(0.62, 3.6, 0.09);
      canvas.parent = arm;
      canvas.material = sail;
    }

    return { root, rotor };
  }

  private buildMonolith(root: Mesh): LandmarkBuild {
    const stone = this.material("landmark-stone", "#8d8f92");
    const sizes = [2.6, 1.7, 1.15];
    let y = 0;
    for (let i = 0; i < sizes.length; i += 1) {
      const size = sizes[i];
      const block = MeshBuilder.CreatePolyhedron("monolith", { type: 1, size }, this.scene);
      const height = size * 1.15;
      block.position.y = y + height / 2;
      block.rotation.y = i * 0.7;
      block.scaling.set(1 - i * 0.12, 1.9 - i * 0.35, 1 - i * 0.12);
      block.parent = root;
      block.material = stone;
      y += height * (1.9 - i * 0.35) * 0.92;
    }

    // 周围散落几块碎石，强化"巨石阵"的感觉。
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2 + 0.4;
      const rock = MeshBuilder.CreatePolyhedron("shard", { type: 1, size: 0.5 + (i % 3) * 0.18 }, this.scene);
      rock.position.set(Math.cos(angle) * 4.6, 0.3, Math.sin(angle) * 4.6);
      rock.rotation.y = angle;
      rock.parent = root;
      rock.material = stone;
    }

    return { root };
  }

  private buildGreatTree(root: Mesh): LandmarkBuild {
    const trunk = MeshBuilder.CreateCylinder("trunk", { height: 18, diameterTop: 2.0, diameterBottom: 4.0, tessellation: 7 }, this.scene);
    trunk.position.y = 9;
    trunk.parent = root;
    trunk.material = this.material("landmark-bark", "#6f5039");

    const leaves = this.material("landmark-canopy", "#3f6b36");
    const crowns: Array<[number, number, number]> = [
      [0, 20.5, 7.2],
      [4.4, 18.2, 4.6],
      [-4.0, 18.8, 4.9],
      [1.6, 23.4, 4.4],
      [-2.4, 22.0, 4.2],
    ];
    for (const [dx, dy, size] of crowns) {
      const canopy = MeshBuilder.CreatePolyhedron("canopy", { type: 2, size }, this.scene);
      canopy.position.set(dx, dy, dx * 0.4);
      canopy.rotation.y = dx * 0.3;
      canopy.parent = root;
      canopy.material = leaves;
    }

    // 露出地面的树根。
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const rootMesh = MeshBuilder.CreateCylinder("root", { height: 3.2, diameterTop: 0.8, diameterBottom: 0.25, tessellation: 5 }, this.scene);
      rootMesh.position.set(Math.cos(angle) * 1.7, 0.9, Math.sin(angle) * 1.7);
      rootMesh.rotation.z = Math.cos(angle) * 0.7;
      rootMesh.rotation.x = -Math.sin(angle) * 0.7;
      rootMesh.parent = root;
      rootMesh.material = this.material("landmark-bark", "#6f5039");
    }

    return { root };
  }

  private buildSummitOutpost(root: Mesh): LandmarkBuild {
    const wall = MeshBuilder.CreateBox("outpost-wall", { width: 8, height: 4.6, depth: 7 }, this.scene);
    wall.position.y = 2.3;
    wall.parent = root;
    wall.material = this.material("landmark-wood", "#6b4a33");
    const roof = MeshBuilder.CreateCylinder("outpost-roof", { height: 2.1, diameterTop: 0.2, diameterBottom: 6.8, tessellation: 4 }, this.scene);
    roof.position.y = 5.2;
    roof.rotation.y = Math.PI / 4;
    roof.parent = root;
    roof.material = this.material("landmark-roof", "#8a4a3a");
    const beaconMaterial = this.material("outpost-beacon", "#ffd08a", "#ffbd55");
    const beacon = MeshBuilder.CreatePolyhedron("outpost-beacon", { type: 0, size: 0.46 }, this.scene);
    beacon.position.set(0, 7.2, 0);
    beacon.parent = root;
    beacon.material = beaconMaterial;
    for (const side of [-1, 1]) {
      const post = MeshBuilder.CreateCylinder("outpost-post", { height: 8, diameter: 0.32, tessellation: 5 }, this.scene);
      post.position.set(side * 5.1, 4, 0);
      post.parent = root;
      post.material = this.material("landmark-wood", "#6b4a33");
    }
    return { root, beacon: beaconMaterial };
  }

  private buildDistantBridge(root: Mesh): LandmarkBuild {
    const stone = this.material("landmark-bridge-stone", "#7b807b");
    const deck = MeshBuilder.CreateBox("distant-bridge-deck", { width: 42, height: 1.1, depth: 5.6 }, this.scene);
    deck.position.y = 7.1;
    deck.parent = root;
    deck.material = stone;
    for (const x of [-14, 0, 14]) {
      const pier = MeshBuilder.CreateCylinder("distant-bridge-pier", { height: 13.4, diameterTop: 2.5, diameterBottom: 3.8, tessellation: 6 }, this.scene);
      pier.position.set(x, 3.2, 0);
      pier.parent = root;
      pier.material = stone;
    }
    for (const side of [-1, 1]) {
      const rail = MeshBuilder.CreateBox("distant-bridge-rail", { width: 42, height: 0.45, depth: 0.18 }, this.scene);
      rail.position.set(0, 8.3, side * 2.55);
      rail.parent = root;
      rail.material = this.material("landmark-metal", "#68707a");
    }
    return { root };
  }

  private material(key: string, diffuseHex: string, emissiveHex?: string): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new StandardMaterial(key, this.scene);
    material.diffuseColor = Color3.FromHexString(diffuseHex);
    material.specularColor = new Color3(0.04, 0.04, 0.04);
    if (emissiveHex) material.emissiveColor = Color3.FromHexString(emissiveHex);
    this.materials.set(key, material);
    return material;
  }
}

/** 各地标的近似高度，用于 HUD 指引（不做精确包围盒计算）。 */
const LANDMARK_HEIGHT: Record<LandmarkKind, number> = {
  radioTower: 27,
  windmill: 17,
  monolith: 9,
  greatTree: 26,
  summitOutpost: 9,
  distantBridge: 9,
};

/** 计算 (fromX, fromZ) → (toX, toZ) 的罗盘方位角（0 = 正北 / -Z，顺时针）。 */
export function bearingBetween(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  // 屏幕坐标里 -Z 是"前"，所以北是 -Z 方向。
  const angle = Math.atan2(dx, -dz);
  const degrees = (angle * 180) / Math.PI;
  return (degrees + 360) % 360;
}

export function compassFromBearing(bearing: number): "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" {
  const sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return sectors[Math.round(bearing / 45) % 8];
}

export function landmarkLabel(kind: LandmarkKind): string {
  return KIND_LABEL[kind];
}
