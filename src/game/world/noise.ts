import { hashInts } from "../utils/random";

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 五次平滑插值，比 smooth() 更圆滑，用于道路 / 河岸的过渡带。 */
export function smootherstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  return smootherstep((x - edge0) / (edge1 - edge0));
}

export function lerpValue(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function randomGrid(ix: number, iz: number, seed: number): number {
  return hashInts(ix, iz, seed) / 0xffffffff;
}

export function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);

  const a = randomGrid(x0, z0, seed);
  const b = randomGrid(x0 + 1, z0, seed);
  const c = randomGrid(x0, z0 + 1, seed);
  const d = randomGrid(x0 + 1, z0 + 1, seed);

  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

/** 可指定倍频数的分形噪声（默认 4 层，保持向后兼容）。 */
export function fractalNoise2D(x: number, z: number, seed: number, octaves = 4): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise2D(x * frequency, z * frequency, seed + octave * 977) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return sum / norm;
}

/**
 * 山脊噪声：1 - |2n - 1|，把噪声的「峰」变成「脊」。
 * 返回 0~1，越接近 1 越接近山脊线。
 */
export function ridgedNoise2D(x: number, z: number, seed: number, octaves = 4): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const n = valueNoise2D(x * frequency, z * frequency, seed + octave * 1361);
    sum += (1 - Math.abs(n * 2 - 1)) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return sum / norm;
}
