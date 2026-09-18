import { GAME_CONFIG } from "../config";
import type { TerrainSampler, TerrainZone } from "./TerrainSampler";

/** One terrain vertex shared by Ground and Water. Coordinates are world X/Z. */
export interface TerrainGridVertex {
  /** Optional test label; never populated by production generation. */
  id?: string;
  x: number;
  z: number;
  height: number;
  lakeMask: boolean;
  hasWater: boolean;
  waterDepth: number;
  waterCoverage: number;
  waterColor: [number, number, number];
  moisture: number;
  rockiness: number;
  onRoad: boolean;
  zone: TerrainZone;
}

/** One chunk's terrain samples in Babylon CreateGround vertex order. */
export interface TerrainGrid {
  centerX: number;
  centerZ: number;
  size: number;
  subdivisions: number;
  step: number;
  /** Row 0 is +Z (Babylon's CreateGround order), then rows descend toward -Z. */
  vertices: TerrainGridVertex[];
}

/**
 * Build the single source of truth for one chunk's rendered terrain vertices.
 * Babylon CreateGround enumerates each row from maxZ to minZ, so this order is
 * intentionally not the usual minZ-to-maxZ mathematical grid order.
 */
export function buildTerrainGrid(
  sampler: TerrainSampler,
  centerX: number,
  centerZ: number,
  size: number,
): TerrainGrid {
  const subdivisions = GAME_CONFIG.chunkSubdivisions;
  const step = size / subdivisions;
  const half = size / 2;
  const vertices: TerrainGridVertex[] = [];

  for (let iz = 0; iz <= subdivisions; iz += 1) {
    for (let ix = 0; ix <= subdivisions; ix += 1) {
      const x = centerX - half + ix * step;
      const z = centerZ + half - iz * step;
      const sample = sampler.sample(x, z);
      vertices.push({
        x,
        z,
        height: sample.height,
        lakeMask: sample.lakeMask,
        hasWater: sample.hasWater,
        waterDepth: sample.waterDepth,
        waterCoverage: sample.waterCoverage,
        waterColor: sampler.waterColor(sample.waterDepth),
        moisture: sample.moisture,
        rockiness: sample.rockiness,
        onRoad: sample.onRoad,
        zone: sample.zone,
      });
    }
  }

  return { centerX, centerZ, size, subdivisions, step, vertices };
}
