import type { BiomeId } from "./TerrainSampler";

/** Asset-free mixer state for a future browser audio implementation. */
export interface AmbientSoundState {
  forestWind: number;
  birds: number;
  shoreWater: number;
  nightInsects: number;
}

export interface AmbientSoundContext {
  biome: BiomeId;
  waterDepth: number;
  /** 0 = night, 1 = full daylight. */
  daylight: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Pure environmental-audio selector. It deliberately does not allocate Audio
 * nodes or fetch sound files: the game can later map these weights to optional
 * loops while keeping autoplay permissions and loading policy outside world code.
 */
export class AmbientSoundscape {
  public evaluate(context: AmbientSoundContext): AmbientSoundState {
    const daylight = clamp01(context.daylight);
    const shore = clamp01(context.waterDepth / 0.65);
    const forest = context.biome === "forest" ? 1 : context.biome === "mountain" ? 0.35 : 0.12;
    return {
      forestWind: forest * (0.32 + 0.42 * daylight),
      birds: (context.biome === "forest" || context.biome === "grass" ? 0.46 : 0.18) * daylight,
      shoreWater: shore * 0.72,
      nightInsects: (1 - daylight) * (context.waterDepth > 0.05 ? 0.34 : 0.74),
    };
  }
}
