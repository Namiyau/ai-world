import type { ChunkLoadRadius, FogDistancePreference } from "../config";

/** Internal render-buffer scale relative to the current browser canvas. */
export type RenderResolution = "75" | "100" | "125" | "150";
export type { ChunkLoadRadius } from "../config";

export interface PauseSettings {
  renderResolution: RenderResolution;
  chunkLoadRadius: ChunkLoadRadius;
  fogDistance: FogDistancePreference;
  fovDegrees: number;
  sensitivity: number;
  showHints: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_PAUSE_SETTINGS: PauseSettings = {
  renderResolution: "100",
  chunkLoadRadius: 3,
  fogDistance: "standard",
  fovDegrees: 86,
  sensitivity: 1,
  showHints: true,
  reducedMotion: false,
};

/** Babylon's value is inverse scale: 4/3 produces a 75% render buffer. */
export function hardwareScalingForResolution(resolution: RenderResolution): number {
  if (resolution === "75") return 4 / 3;
  if (resolution === "125") return 0.8;
  if (resolution === "150") return 2 / 3;
  return 1;
}

const STORAGE_KEY = "ai-world-pause-settings-v1";

const finiteInRange = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

function legacyResolution(value: unknown): RenderResolution {
  if (value === "performance") return "75";
  if (value === "quality") return "125";
  return "100";
}

function validResolution(value: unknown): value is RenderResolution {
  return value === "75" || value === "100" || value === "125" || value === "150";
}

export function chunkCountForRadius(radius: ChunkLoadRadius): number {
  const diameter = radius * 2 + 1;
  return diameter * diameter;
}

export function validChunkLoadRadius(value: unknown): value is ChunkLoadRadius {
  return value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

export function loadPauseSettings(storage: Pick<Storage, "getItem"> = window.localStorage): PauseSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PAUSE_SETTINGS };
    const value = JSON.parse(raw) as Partial<PauseSettings> & { renderQuality?: unknown };
    return {
      renderResolution: validResolution(value.renderResolution) ? value.renderResolution : legacyResolution(value.renderQuality),
      chunkLoadRadius: validChunkLoadRadius(value.chunkLoadRadius) ? value.chunkLoadRadius : DEFAULT_PAUSE_SETTINGS.chunkLoadRadius,
      fogDistance: value.fogDistance === "near" || value.fogDistance === "far" ? value.fogDistance : "standard",
      fovDegrees: finiteInRange(value.fovDegrees, 70, 105, DEFAULT_PAUSE_SETTINGS.fovDegrees),
      sensitivity: finiteInRange(value.sensitivity, 0.45, 2, DEFAULT_PAUSE_SETTINGS.sensitivity),
      showHints: typeof value.showHints === "boolean" ? value.showHints : DEFAULT_PAUSE_SETTINGS.showHints,
      reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : DEFAULT_PAUSE_SETTINGS.reducedMotion,
    };
  } catch {
    return { ...DEFAULT_PAUSE_SETTINGS };
  }
}

export function savePauseSettings(settings: PauseSettings, storage: Pick<Storage, "setItem"> = window.localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
