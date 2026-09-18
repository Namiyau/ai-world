import type { ChunkLoadRadius } from "../config";

export interface ChunkWindowEntry {
  cx: number;
  cz: number;
  distanceSquared: number;
  manhattanDistance: number;
}

export interface PendingChunkEntry {
  cx: number;
  cz: number;
}

export function chunkWindowSize(radius: ChunkLoadRadius | number): number {
  const safeRadius = Math.max(0, Math.floor(radius));
  const diameter = safeRadius * 2 + 1;
  return diameter * diameter;
}

export function chunkWindowForCenter(cx: number, cz: number, radius: number): ChunkWindowEntry[] {
  const safeRadius = Math.max(0, Math.floor(radius));
  const result: ChunkWindowEntry[] = [];
  for (let dz = -safeRadius; dz <= safeRadius; dz += 1) {
    for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
      result.push({
        cx: cx + dx,
        cz: cz + dz,
        distanceSquared: dx * dx + dz * dz,
        manhattanDistance: Math.abs(dx) + Math.abs(dz),
      });
    }
  }
  return result.sort((a, b) =>
    a.distanceSquared - b.distanceSquared ||
    a.manhattanDistance - b.manhattanDistance ||
    a.cz - b.cz ||
    a.cx - b.cx,
  );
}

export function reconcilePendingChunks(
  pending: readonly PendingChunkEntry[],
  wanted: readonly ChunkWindowEntry[],
  existingKeys: ReadonlySet<string>,
): PendingChunkEntry[] {
  const wantedByKey = new Map<string, ChunkWindowEntry>(wanted.map((entry): [string, ChunkWindowEntry] => [`${entry.cx}:${entry.cz}`, entry]));
  const seen = new Set<string>();
  return pending
    .filter((entry) => {
      const key = `${entry.cx}:${entry.cz}`;
      if (!wantedByKey.has(key) || existingKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const left = wantedByKey.get(`${a.cx}:${a.cz}`)!;
      const right = wantedByKey.get(`${b.cx}:${b.cz}`)!;
      return left.distanceSquared - right.distanceSquared ||
        left.manhattanDistance - right.manhattanDistance ||
        a.cz - b.cz ||
        a.cx - b.cx;
    });
}
