import { POI_CONFIG, WATER_CONFIG } from "../config";
import { hashInts } from "../utils/random";
import { rhythmAt } from "./ExplorationRhythm";
import type { TerrainSampler, TerrainSample } from "./TerrainSampler";

export type PoiKind =
  | "cabin"
  | "gasStation"
  | "warehouse"
  | "abandonedCamp"
  | "dock"
  | "woodBridge"
  | "roadBridge"
  | "mineShed"
  | "wreck"
  | "crashSite"
  | "hunterCamp"
  | "supplyCache"
  | "mineralOutcrop";

export type MineralType = "stone" | "iron" | "copper" | "rare";

export interface MineralNode {
  id: string;
  type: MineralType;
  amount: number;
  position: { x: number; y: number; z: number };
}

export interface PoiPlacement {
  id: string;
  kind: PoiKind;
  ownerCellX: number;
  ownerCellZ: number;
  x: number;
  z: number;
  groundY: number;
  rotation: number;
  roadDistance: number;
  minerals: MineralNode[];
  /** Only bridge placements use these; both are deck heights including the surface lift. */
  bridgeStartY?: number;
  bridgeEndY?: number;
}

export interface FootprintMetrics {
  maxSlope: number;
  heightRange: number;
  samples: number[];
}

const MINERAL_TYPES: readonly MineralType[] = ["stone", "iron", "copper", "rare"];

function unit(hash: number, shift: number): number {
  return ((hash >>> shift) & 0xff) / 255;
}

function isDryBuildingSite(sample: TerrainSample, sampler: TerrainSampler, roadDistance: number): boolean {
  return (
    sample.waterDepth <= 0.05 &&
    sample.height > sampler.waterLevel + 0.55 &&
    roadDistance >= POI_CONFIG.roadMinDistance
  );
}

function sampleRoadSide(
  sampler: TerrainSampler,
  idealX: number,
  idealZ: number,
  hash: number,
  offset: number,
): { x: number; z: number; sample: TerrainSample; roadDistance: number; rotation: number } | null {
  const road = sampler.nearestRoadSpine(idealX, idealZ);
  if (road.distance > POI_CONFIG.bridgeSearchDistance) return null;

  const side = unit(hash, 0) < 0.5 ? -1 : 1;
  const along = (unit(hash, 8) - 0.5) * 28;
  const x = road.direction === "vertical" ? road.x + side * offset : road.x + along;
  const z = road.direction === "vertical" ? road.z + along : road.z + side * offset;
  const sample = sampler.sample(x, z);
  if (!isDryBuildingSite(sample, sampler, road.distance + offset)) return null;
  return {
    x,
    z,
    sample,
    roadDistance: road.distance + offset,
    rotation: road.direction === "vertical" ? 0 : Math.PI / 2,
  };
}

function bridgeSite(
  sampler: TerrainSampler,
  idealX: number,
  idealZ: number,
): { x: number; z: number; y: number; rotation: number; bridgeStartY: number; bridgeEndY: number } | null {
  const road = sampler.nearestRoadSpine(idealX, idealZ);
  if (road.distance > POI_CONFIG.roadSearchDistance) return null;

  const halfLength = POI_CONFIG.bridgeHalfLength;
  const sampleAt = (distance: number): TerrainSample =>
    road.direction === "vertical"
      ? sampler.sample(road.x, road.z + distance)
      : sampler.sample(road.x + distance, road.z);
  const left = sampleAt(-halfLength);
  const right = sampleAt(halfLength);
  if (left.waterDepth > 0.05 || right.waterDepth > 0.05) return null;
  if (left.height < sampler.waterLevel + 0.35 || right.height < sampler.waterLevel + 0.35) return null;
  if (Math.abs(left.height - right.height) > POI_CONFIG.bridgeMaxEndHeightDifference) return null;

  let lowland = false;
  for (let index = 1; index < 6; index += 1) {
    const sample = sampleAt(-halfLength + (index * halfLength * 2) / 6);
    if (sample.waterDepth > 0.05 || sample.height < sampler.waterLevel + 0.8) {
      lowland = true;
      break;
    }
  }
  if (!lowland) return null;

  return {
    x: road.x,
    z: road.z,
    y: Math.max(left.height, right.height) + 0.16,
    rotation: road.direction === "vertical" ? 0 : Math.PI / 2,
    bridgeStartY: left.height + 0.16,
    bridgeEndY: right.height + 0.16,
  };
}

function dockSite(
  sampler: TerrainSampler,
  idealX: number,
  idealZ: number,
  hash: number,
): { x: number; z: number; y: number; rotation: number; lakeCellX: number; lakeCellZ: number } | null {
  const lake = sampler.nearestLakeCandidate(idealX, idealZ, POI_CONFIG.dockSearchRadius);
  if (!lake) return null;

  const angle = unit(hash, 16) * Math.PI * 2;
  for (const extra of [4, 8, 12, 16]) {
    const distance = lake.radius + extra;
    const x = lake.x + Math.cos(angle) * distance;
    const z = lake.z + Math.sin(angle) * distance;
    const sample = sampler.sample(x, z);
    if (sample.waterDepth <= 0.05 && sample.height > sampler.waterLevel + 0.1) {
      return {
        x,
        z,
        y: sampler.waterLevel + 0.16,
        rotation: angle,
        lakeCellX: Math.floor(lake.x / WATER_CONFIG.lake.spacing),
        lakeCellZ: Math.floor(lake.z / WATER_CONFIG.lake.spacing),
      };
    }
  }
  return null;
}

function mineralSite(
  sampler: TerrainSampler,
  idealX: number,
  idealZ: number,
  hash: number,
): { x: number; z: number; sample: TerrainSample } | null {
  const tryAt = (x: number, z: number): { x: number; z: number; sample: TerrainSample } | null => {
    const sample = sampler.sample(x, z);
    const highRock = sample.biome === "rocky" || sample.biome === "mountain" || sample.rockiness > 0.62;
    if (sample.zone !== "gravel" || !highRock || sample.waterDepth > 0.05 || sample.onRoad) return null;
    return { x, z, sample };
  };

  const direct = tryAt(idealX, idealZ);
  if (direct) return direct;
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + unit(hash, 8) * 0.3;
    const radius = 18 + index * 5;
    const result = tryAt(idealX + Math.cos(angle) * radius, idealZ + Math.sin(angle) * radius);
    if (result) return result;
  }
  return null;
}

function mineralNodes(cellX: number, cellZ: number, seed: number, x: number, z: number, sampler: TerrainSampler): MineralNode[] {
  const nodes: MineralNode[] = [];
  for (let index = 0; index < MINERAL_TYPES.length; index += 1) {
    const hash = hashInts(cellX * 17 + index, cellZ * 31 - index, seed + 91_007);
    const angle = unit(hash, 0) * Math.PI * 2;
    const radius = 1.2 + unit(hash, 8) * 4.8;
    const nodeX = x + Math.cos(angle) * radius;
    const nodeZ = z + Math.sin(angle) * radius;
    nodes.push({
      id: `mineral:${cellX}:${cellZ}:${index}`,
      type: MINERAL_TYPES[(index + (hash & 1)) % MINERAL_TYPES.length],
      amount: 2 + (hash % 7),
      position: { x: nodeX, y: sampler.height(nodeX, nodeZ), z: nodeZ },
    });
  }
  return nodes;
}

function placementForRoadKind(
  kind: PoiKind,
  sampler: TerrainSampler,
  idealX: number,
  idealZ: number,
  hash: number,
): { x: number; z: number; sample: TerrainSample; roadDistance: number; rotation: number } | null {
  const offset = kind === "gasStation" || kind === "warehouse" ? 16 : 12;
  return sampleRoadSide(sampler, idealX, idealZ, hash, offset);
}

/** Sample a rotated footprint without changing terrain geometry. */
export function footprintMetrics(
  sampler: TerrainSampler,
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation: number,
): FootprintMetrics {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const localPoints = [
    [-halfWidth, -halfDepth],
    [0, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, 0],
    [0, 0],
    [halfWidth, 0],
    [-halfWidth, halfDepth],
    [0, halfDepth],
    [halfWidth, halfDepth],
  ];
  const worldPoint = (localX: number, localZ: number): { x: number; z: number } => ({
    x: x + localX * cos - localZ * sin,
    z: z + localX * sin + localZ * cos,
  });
  const samples = localPoints.map(([localX, localZ]) => {
    const point = worldPoint(localX, localZ);
    return sampler.height(point.x, point.z);
  });
  let maxSlope = 0;
  const step = 2;
  for (const [localX, localZ] of localPoints) {
    const point = worldPoint(localX, localZ);
    const dx = sampler.height(point.x + step, point.z) - sampler.height(point.x - step, point.z);
    const dz = sampler.height(point.x, point.z + step) - sampler.height(point.x, point.z - step);
    maxSlope = Math.max(maxSlope, Math.hypot(dx, dz) / (step * 2));
  }
  return { maxSlope, heightRange: Math.max(...samples) - Math.min(...samples), samples };
}

/** Pure deterministic POI candidate resolver. */
export function poiPlacementAt(cellX: number, cellZ: number, sampler: TerrainSampler, seed: number): PoiPlacement | null {
  const hash = hashInts(cellX, cellZ, seed + 82_411);
  const rhythm = rhythmAt(
    (cellX + 0.5) * POI_CONFIG.cellSpacing,
    (cellZ + 0.5) * POI_CONFIG.cellSpacing,
    seed,
  );
  if (unit(hash, 0) > POI_CONFIG.chance * rhythm.poiDensity) return null;

  const idealX = (cellX + 0.2 + unit(hash, 8) * 0.6) * POI_CONFIG.cellSpacing;
  const idealZ = (cellZ + 0.2 + unit(hash, 16) * 0.6) * POI_CONFIG.cellSpacing;
  const selector = unit(hash, 24);
  const id = `poi:${cellX}:${cellZ}`;

  const bridge = bridgeSite(sampler, idealX, idealZ);
  if (bridge && selector < 0.42) {
    return {
      id,
      kind: selector < 0.21 ? "woodBridge" : "roadBridge",
      ownerCellX: cellX,
      ownerCellZ: cellZ,
      x: bridge.x,
      z: bridge.z,
      groundY: bridge.y,
      rotation: bridge.rotation,
      roadDistance: 0,
      minerals: [],
      bridgeStartY: bridge.bridgeStartY,
      bridgeEndY: bridge.bridgeEndY,
    };
  }

  const dock = dockSite(sampler, idealX, idealZ, hash);
  // The lake's own cell is the sole dock owner. This keeps one dock per lake
  // even though neighboring POI cells may search the same nearest lake.
  if (dock && cellX === dock.lakeCellX && cellZ === dock.lakeCellZ) {
    return { id, kind: "dock", ownerCellX: cellX, ownerCellZ: cellZ, x: dock.x, z: dock.z, groundY: dock.y, rotation: dock.rotation, roadDistance: Number.POSITIVE_INFINITY, minerals: [] };
  }

  const mineral = mineralSite(sampler, idealX, idealZ, hash);
  if (mineral && selector >= 0.3 && selector < 0.58) {
    const kind: PoiKind = selector < 0.44 ? "mineShed" : "mineralOutcrop";
    return { id, kind, ownerCellX: cellX, ownerCellZ: cellZ, x: mineral.x, z: mineral.z, groundY: mineral.sample.height, rotation: unit(hash, 16) * Math.PI * 2, roadDistance: mineral.sample.roadDistance, minerals: mineralNodes(cellX, cellZ, seed, mineral.x, mineral.z, sampler) };
  }

  const roadKinds: PoiKind[] = ["cabin", "gasStation", "warehouse", "abandonedCamp", "wreck", "crashSite", "hunterCamp", "supplyCache"];
  const kindHash = hashInts(cellX * 41 + 3, cellZ * 59 - 7, seed + 82_417);
  const roadKind = roadKinds[Math.min(roadKinds.length - 1, Math.floor(unit(kindHash, 0) * roadKinds.length))];
  const roadSite = placementForRoadKind(roadKind, sampler, idealX, idealZ, hash);
  if (!roadSite) return null;
  const metrics = footprintMetrics(sampler, roadSite.x, roadSite.z, roadKind === "gasStation" ? 18 : 14, roadKind === "warehouse" ? 20 : 14, roadSite.rotation);
  if (metrics.maxSlope > POI_CONFIG.buildingMaxSlope || metrics.heightRange > POI_CONFIG.buildingMaxHeightRange) return null;
  return { id, kind: roadKind, ownerCellX: cellX, ownerCellZ: cellZ, x: roadSite.x, z: roadSite.z, groundY: roadSite.sample.height, rotation: roadSite.rotation, roadDistance: roadSite.roadDistance, minerals: [] };
}
