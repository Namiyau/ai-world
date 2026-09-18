import { EXPLORATION_CONFIG } from "../config";
import { hashInts } from "../utils/random";

/** Large-scale content cadence, intentionally independent of terrain sampling. */
export type ExplorationPhase = "quiet" | "lush" | "landmark";

export interface ExplorationRhythm {
  phase: ExplorationPhase;
  detailDensity: number;
  resourceDensity: number;
  poiDensity: number;
  landmarkDensity: number;
}

const PHASE_VALUES: Record<ExplorationPhase, Omit<ExplorationRhythm, "phase">> = {
  quiet: { detailDensity: 0.22, resourceDensity: 0.28, poiDensity: 0.16, landmarkDensity: 0.22 },
  lush: { detailDensity: 0.96, resourceDensity: 0.86, poiDensity: 0.72, landmarkDensity: 0.5 },
  landmark: { detailDensity: 0.5, resourceDensity: 0.44, poiDensity: 0.32, landmarkDensity: 0.98 },
};

/**
 * Deterministic macro field shared by details, resources, POIs and landmarks.
 * It only gates otherwise legal candidates, so it cannot change terrain, water
 * geometry, road clearance or chunk-edge topology.
 */
export function rhythmAt(x: number, z: number, seed: number): ExplorationRhythm {
  const cellSize = EXPLORATION_CONFIG.cellSize;
  const cellX = Math.floor(x / cellSize);
  const cellZ = Math.floor(z / cellSize);
  const hash = hashInts(cellX, cellZ, seed + 113_807);
  const roll = (hash >>> 0) / 0x1_0000_0000;
  const phase: ExplorationPhase = roll < 0.34 ? "quiet" : roll < 0.79 ? "lush" : "landmark";
  return { phase, ...PHASE_VALUES[phase] };
}
