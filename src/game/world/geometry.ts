import type { TerrainGrid, TerrainGridVertex } from "./TerrainGrid";

export interface XZPoint {
  x: number;
  z: number;
}

export interface RoadEdges {
  left: XZPoint;
  right: XZPoint;
}

export interface FlatTriangleGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
}

export type GroundTriangleDiagonal = "bdc" | "abc";

export interface TerrainGridTriangle {
  vertices: [TerrainGridVertex, TerrainGridVertex, TerrainGridVertex];
  indices: [number, number, number];
  diagonal: GroundTriangleDiagonal;
}

export interface WaterPolygonPoint {
  x: number;
  y: number;
  z: number;
  waterDepth: number;
  waterColor: [number, number, number];
}

export interface WaterTriangleGeometry {
  points: [WaterPolygonPoint, WaterPolygonPoint, WaterPolygonPoint];
  source: TerrainGridTriangle;
}

/** Return the exact two triangles emitted by Babylon CreateGround for a cell. */
export function groundTrianglesForCell(grid: TerrainGrid, ix: number, iz: number): [TerrainGridTriangle, TerrainGridTriangle] {
  const cells = grid.subdivisions + 1;
  const a = (iz + 1) * cells + ix;
  const b = (iz + 1) * cells + ix + 1;
  const c = iz * cells + ix;
  const d = iz * cells + ix + 1;

  return [
    {
      vertices: [grid.vertices[b], grid.vertices[d], grid.vertices[c]],
      indices: [b, d, c],
      diagonal: "bdc",
    },
    {
      vertices: [grid.vertices[a], grid.vertices[b], grid.vertices[c]],
      indices: [a, b, c],
      diagonal: "abc",
    },
  ];
}

const WATER_CLIP_EPSILON = 1e-7;

const isWaterVertex = (vertex: TerrainGridVertex, waterLevel: number): boolean =>
  vertex.lakeMask && vertex.hasWater && vertex.height < waterLevel - WATER_CLIP_EPSILON;

const interpolateWaterPoint = (
  start: TerrainGridVertex,
  end: TerrainGridVertex,
  waterLevel: number,
): WaterPolygonPoint | null => {
  const denominator = end.height - start.height;
  if (Math.abs(denominator) <= WATER_CLIP_EPSILON) return null;
  const t = (waterLevel - start.height) / denominator;
  if (t < -WATER_CLIP_EPSILON || t > 1 + WATER_CLIP_EPSILON) return null;
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    x: start.x + (end.x - start.x) * clampedT,
    y: waterLevel,
    z: start.z + (end.z - start.z) * clampedT,
    // This point is the exact Ground/water-plane intersection, so its visual
    // depth is zero even when the neighboring below-water vertex is deep.
    waterDepth: 0,
    waterColor: [
      start.waterColor[0] + (end.waterColor[0] - start.waterColor[0]) * clampedT,
      start.waterColor[1] + (end.waterColor[1] - start.waterColor[1]) * clampedT,
      start.waterColor[2] + (end.waterColor[2] - start.waterColor[2]) * clampedT,
    ],
  };
};

/** Clip one real Ground triangle against the horizontal water plane. */
export function clipTriangleToWater(
  triangle: TerrainGridTriangle,
  waterLevel: number,
): WaterPolygonPoint[] | null {
  const [first, second, third] = triangle.vertices;
  const vertices = [first, second, third];
  const inside = vertices.map((vertex) => isWaterVertex(vertex, waterLevel));
  if (!inside.some(Boolean)) return null;

  // A below-water non-lake vertex is a mask boundary that cannot be inferred
  // from height alone. Reject the source triangle rather than inventing water.
  if (vertices.some((vertex) => vertex.height < waterLevel - WATER_CLIP_EPSILON && !(vertex.lakeMask && vertex.hasWater))) return null;

  const polygon: WaterPolygonPoint[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length;
    const current = vertices[index];
    const next = vertices[nextIndex];
    const currentInside = inside[index];
    const nextInside = inside[nextIndex];

    if (currentInside) {
      polygon.push({
        x: current.x,
        y: waterLevel,
        z: current.z,
        waterDepth: Math.max(0, waterLevel - current.height),
        waterColor: [...current.waterColor],
      });
    }

    if (currentInside !== nextInside) {
      const intersection = interpolateWaterPoint(current, next, waterLevel);
      if (!intersection) return null;
      polygon.push(intersection);
    }
  }

  return polygon.length >= 3 ? polygon : null;
}

/** Build water triangles by clipping each of the two Ground triangles independently. */
export function buildWaterTriangles(grid: TerrainGrid, waterLevel: number): WaterTriangleGeometry[] {
  const result: WaterTriangleGeometry[] = [];
  for (let iz = 0; iz < grid.subdivisions; iz += 1) {
    for (let ix = 0; ix < grid.subdivisions; ix += 1) {
      for (const source of groundTrianglesForCell(grid, ix, iz)) {
        const polygon = clipTriangleToWater(source, waterLevel);
        if (!polygon) continue;
        if (polygon.length === 3) {
          const points: [WaterPolygonPoint, WaterPolygonPoint, WaterPolygonPoint] = [polygon[0], polygon[1], polygon[2]];
          result.push({ points, source });
        } else if (polygon.length === 4) {
          const first: [WaterPolygonPoint, WaterPolygonPoint, WaterPolygonPoint] = [polygon[0], polygon[1], polygon[2]];
          const second: [WaterPolygonPoint, WaterPolygonPoint, WaterPolygonPoint] = [polygon[0], polygon[2], polygon[3]];
          result.push({ points: first, source });
          result.push({ points: second, source });
        }
      }
    }
  }
  return result;
}

/** Return the two road edges from an XZ center point and its tangent. */
export function roadEdgesFromTangent(center: XZPoint, tangent: XZPoint, halfWidth: number): RoadEdges {
  const tangentLength = Math.hypot(tangent.x, tangent.z) || 1;
  const tx = tangent.x / tangentLength;
  const tz = tangent.z / tangentLength;
  const nx = -tz;
  const nz = tx;

  return {
    left: { x: center.x + nx * halfWidth, z: center.z + nz * halfWidth },
    right: { x: center.x - nx * halfWidth, z: center.z - nz * halfWidth },
  };
}

/** Expand an indexed triangle list so every triangle owns its three vertices and normal. */
export function expandIndexedTrianglesToFlat(
  positions: readonly number[] | Float32Array,
  indices: readonly number[] | Int32Array | Uint16Array | Uint32Array,
): FlatTriangleGeometry {
  const flatPositions: number[] = [];
  const flatNormals: number[] = [];
  const flatIndices: number[] = [];

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (a === undefined || b === undefined || c === undefined) break;

    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const by = positions[b * 3 + 1];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    const cz = positions[c * 3 + 2];

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    // Babylon CreateGround uses an upward-facing winding, so use e1 x e2.
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-8) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }

    const faceVertices = [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ];
    const first = flatPositions.length / 3;
    for (const [x, y, z] of faceVertices) {
      flatPositions.push(x, y, z);
      flatNormals.push(nx, ny, nz);
    }
    flatIndices.push(first, first + 1, first + 2);
  }

  return { positions: flatPositions, normals: flatNormals, indices: flatIndices };
}

export function chunkBounds(index: number, size: number): { min: number; max: number; center: number } {
  const min = index * size;
  const max = (index + 1) * size;
  return { min, max, center: (min + max) / 2 };
}
