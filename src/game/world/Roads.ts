import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { ROAD_CONFIG } from "../config";
import { valueNoise2D } from "./noise";
import { roadEdgesFromTangent, type XZPoint } from "./geometry";
import type { TerrainSampler } from "./TerrainSampler";

interface RoadRibbonData {
  leftPath: Vector3[];
  rightPath: Vector3[];
  leftColors: Color4[];
  rightColors: Color4[];
}

interface RoadSpan {
  from: number;
  to: number;
}

/** Render-only road layer. Terrain flattening remains authoritative in TerrainSampler. */
export class RoadLayer {
  private readonly material: StandardMaterial;

  public constructor(private readonly scene: Scene, private readonly seed: number) {
    const material = new StandardMaterial("road-surface", scene);
    material.diffuseColor = new Color3(1, 1, 1);
    material.specularColor = new Color3(0.02, 0.02, 0.02);
    this.material = material;
  }

  public dispose(): void {
    this.material.dispose();
  }

  /** Build one valid Ribbon mesh per road crossing this chunk. */
  public build(sampler: TerrainSampler, centerX: number, centerZ: number, size: number): Mesh[] {
    const roads: Mesh[] = [];
    const half = size / 2;
    // The spine can move by windAmplitude between the chunk center and its edge.
    // Keep the broad-phase conservative so a curved road is never omitted at a
    // chunk boundary and leaves a visible gap in the ribbon.
    const roadExtent = ROAD_CONFIG.halfWidth + ROAD_CONFIG.windAmplitude + 0.5;

    const xBand = Math.floor(centerX / ROAD_CONFIG.spacing);
    for (let i = -1; i <= 1; i += 1) {
      const band = xBand + i;
      if (!sampler.roadLineAt(band, "vertical")) continue;
      const spineX = sampler.roadSpineCoordinate(band, "vertical", centerZ);
      if (Math.abs(spineX - centerX) > half + roadExtent) continue;
      // A vertical road may be close enough to two neighboring chunk centers
      // to pass the broad phase above. The chunk containing its center line is
      // the sole owner; otherwise adjacent chunks create identical ribbons.
      if (Math.floor(spineX / size) !== Math.floor(centerX / size)) continue;
      const data = this.traceSpine(
        sampler,
        band,
        "vertical",
        centerZ - half - ROAD_CONFIG.halfWidth,
        centerZ + half + ROAD_CONFIG.halfWidth,
      );
      for (const [part, ribbon] of data.entries()) {
        roads.push(this.createRoadMesh(`vertical-${band}-${part}`, centerX, centerZ, ribbon, sampler));
      }
    }

    const zBand = Math.floor(centerZ / ROAD_CONFIG.spacing);
    for (let i = -1; i <= 1; i += 1) {
      const band = zBand + i;
      if (!sampler.roadLineAt(band, "horizontal")) continue;
      const spineZ = sampler.roadSpineCoordinate(band, "horizontal", centerX);
      if (Math.abs(spineZ - centerZ) > half + roadExtent) continue;
      // Horizontal roads use the same half-open ownership rule on Z.
      if (Math.floor(spineZ / size) !== Math.floor(centerZ / size)) continue;
      const from = centerX - half - ROAD_CONFIG.halfWidth;
      const to = centerX + half + ROAD_CONFIG.halfWidth;
      const data = this.traceSpine(
        sampler,
        band,
        "horizontal",
        from,
        to,
        this.horizontalJunctionGaps(sampler, band, from, to),
      );
      for (const [part, ribbon] of data.entries()) {
        roads.push(this.createRoadMesh(`horizontal-${band}-${part}`, centerX, centerZ, ribbon, sampler));
      }
    }

    return roads;
  }

  private createRoadMesh(
    id: string,
    centerX: number,
    centerZ: number,
    data: RoadRibbonData,
    sampler: TerrainSampler,
  ): Mesh {
    // Critical invariant: each Ribbon contains exactly one road's left and right paths.
    const road = MeshBuilder.CreateRibbon(
      `road-${id}-${Math.round(centerX)}-${Math.round(centerZ)}`,
      {
        pathArray: [data.leftPath, data.rightPath],
        closeArray: false,
        closePath: false,
        sideOrientation: Mesh.FRONTSIDE,
        updatable: true,
      },
      this.scene,
    );
    this.raiseRibbonAboveTerrain(road, sampler);
    road.material = this.material;
    road.isPickable = false;
    road.checkCollisions = false;
    road.receiveShadows = false;

    const colors: number[] = [];
    for (const color of data.leftColors) colors.push(color.r, color.g, color.b, color.a);
    for (const color of data.rightColors) colors.push(color.r, color.g, color.b, color.a);
    road.setVerticesData("color", new Float32Array(colors), false, 4);
    return road;
  }

  /**
   * A Ribbon interpolates each quad diagonally, whereas the low-poly Ground
   * has its own nearby triangles. Edge-only height samples can therefore let
   * an interior terrain crest pierce the road. Inspect the Ribbon triangles
   * actually emitted by Babylon and raise only the affected local section.
   */
  private raiseRibbonAboveTerrain(road: Mesh, sampler: TerrainSampler): void {
    const positions = road.getVerticesData("position");
    const indices = road.getIndices();
    if (!positions || !indices) return;

    const vertexRaises = new Float32Array(positions.length / 3);
    const barycentricSamples: Array<readonly [number, number, number]> = [];
    const resolution = 5;
    for (let first = 0; first <= resolution; first += 1) {
      for (let second = 0; second <= resolution - first; second += 1) {
        const third = resolution - first - second;
        barycentricSamples.push([first / resolution, second / resolution, third / resolution]);
      }
    }

    for (let index = 0; index < indices.length; index += 3) {
      const first = indices[index];
      const second = indices[index + 1];
      const third = indices[index + 2];
      if (first === undefined || second === undefined || third === undefined) continue;
      const vertices = [first, second, third];
      let requiredRaise = 0;

      for (const weights of barycentricSamples) {
        const x = vertices.reduce((sum, vertex, point) => sum + positions[vertex * 3] * weights[point], 0);
        const y = vertices.reduce((sum, vertex, point) => sum + positions[vertex * 3 + 1] * weights[point], 0);
        const z = vertices.reduce((sum, vertex, point) => sum + positions[vertex * 3 + 2] * weights[point], 0);
        requiredRaise = Math.max(requiredRaise, sampler.height(x, z) + 0.08 - y);
      }

      if (requiredRaise <= 0) continue;
      for (const vertex of vertices) vertexRaises[vertex] = Math.max(vertexRaises[vertex], requiredRaise);
    }

    let changed = false;
    for (let vertex = 0; vertex < vertexRaises.length; vertex += 1) {
      if (vertexRaises[vertex] <= 0) continue;
      positions[vertex * 3 + 1] += vertexRaises[vertex];
      changed = true;
    }
    if (changed) {
      road.updateVerticesData("position", positions, false, false);
      road.refreshBoundingInfo();
    }
  }

  private traceSpine(
    sampler: TerrainSampler,
    band: number,
    axis: "vertical" | "horizontal",
    from: number,
    to: number,
    gaps: RoadSpan[] = [],
  ): RoadRibbonData[] {
    const ribbons: RoadRibbonData[] = [];
    for (const span of this.subtractGaps(from, to, gaps)) {
      ribbons.push(...this.traceDrySpine(sampler, band, axis, span.from, span.to));
    }
    return ribbons;
  }

  /** Split a road into contiguous dry pieces; one wet edge sample is enough to end the ribbon at the shore. */
  private traceDrySpine(
    sampler: TerrainSampler,
    band: number,
    axis: "vertical" | "horizontal",
    from: number,
    to: number,
  ): RoadRibbonData[] {
    const span = Math.max(0, to - from);
    const steps = Math.max(1, Math.ceil(span / ROAD_CONFIG.ribbonStep));
    const step = span / steps;
    const tangentDistance = Math.max(0.5, Math.min(1.5, step * 0.5));
    const ribbons: RoadRibbonData[] = [];
    let leftPath: Vector3[] = [];
    let rightPath: Vector3[] = [];
    let leftColors: Color4[] = [];
    let rightColors: Color4[] = [];

    const finishRibbon = (): void => {
      if (leftPath.length >= 2) ribbons.push({ leftPath, rightPath, leftColors, rightColors });
      leftPath = [];
      rightPath = [];
      leftColors = [];
      rightColors = [];
    };

    for (let index = 0; index <= steps; index += 1) {
      const coordinate = from + step * index;
      const center = this.spinePoint(sampler, band, axis, coordinate);
      const before = this.spinePoint(sampler, band, axis, Math.max(from, coordinate - tangentDistance));
      const after = this.spinePoint(sampler, band, axis, Math.min(to, coordinate + tangentDistance));
      const tangent: XZPoint = { x: after.x - before.x, z: after.z - before.z };
      const edges = roadEdgesFromTangent(center, tangent, ROAD_CONFIG.halfWidth);

      const leftSample = sampler.sample(edges.left.x, edges.left.z);
      const rightSample = sampler.sample(edges.right.x, edges.right.z);
      const centerSample = sampler.sample(center.x, center.z);
      // Water uses the post-road terrain height, so this condition prevents a
      // road from either rendering below a lake or bridging a lake basin by
      // visually continuing through it.
      if (centerSample.hasWater || leftSample.hasWater || rightSample.hasWater) {
        finishRibbon();
        continue;
      }
      const lift = ROAD_CONFIG.surfaceLift *
        (0.6 + Math.max(leftSample.roadInfluence, rightSample.roadInfluence) * 0.8);
      leftPath.push(new Vector3(edges.left.x, leftSample.height + lift, edges.left.z));
      rightPath.push(new Vector3(edges.right.x, rightSample.height + lift, edges.right.z));

      const wear = valueNoise2D(center.x / 22, center.z / 22, this.seed + 8123);
      const tone = 0.86 + wear * 0.22;
      leftColors.push(this.roadColor(tone * 0.86, 0));
      rightColors.push(this.roadColor(tone * 1.04, 1));
    }

    finishRibbon();
    return ribbons;
  }

  /**
   * Horizontal road ribbons yield the shared crossing footprint to vertical
   * ribbons. This removes coplanar road triangles without introducing a third
   * "intersection fan" whose topology could twist on sloped terrain.
   */
  private horizontalJunctionGaps(sampler: TerrainSampler, horizontalBand: number, from: number, to: number): RoadSpan[] {
    const firstBand = Math.floor((from - ROAD_CONFIG.windAmplitude) / ROAD_CONFIG.spacing) - 1;
    const lastBand = Math.floor((to + ROAD_CONFIG.windAmplitude) / ROAD_CONFIG.spacing) + 1;
    const gaps: RoadSpan[] = [];

    for (let verticalBand = firstBand; verticalBand <= lastBand; verticalBand += 1) {
      if (!sampler.roadLineAt(verticalBand, "vertical")) continue;
      const coordinate = this.horizontalVerticalCrossing(sampler, horizontalBand, verticalBand, from, to);
      if (coordinate === null) continue;

      const crossZ = sampler.roadSpineCoordinate(horizontalBand, "horizontal", coordinate);
      const horizontalTangent = this.spineTangent(sampler, horizontalBand, "horizontal", coordinate);
      const verticalTangent = this.spineTangent(sampler, verticalBand, "vertical", crossZ);
      const horizontalLength = Math.hypot(horizontalTangent.x, horizontalTangent.z) || 1;
      const verticalLength = Math.hypot(verticalTangent.x, verticalTangent.z) || 1;
      const dot = Math.abs((horizontalTangent.x * verticalTangent.x + horizontalTangent.z * verticalTangent.z) / (horizontalLength * verticalLength));
      const sine = Math.max(0.1, Math.abs((horizontalTangent.x * verticalTangent.z - horizontalTangent.z * verticalTangent.x) / (horizontalLength * verticalLength)));
      // The gap must clear both ribbons' finite widths, even when road wind
      // makes the meeting angle slightly different from 90 degrees.
      const clearance = ROAD_CONFIG.halfWidth * (1 + dot) / sine + 0.08;
      gaps.push({ from: coordinate - clearance, to: coordinate + clearance });
    }

    return gaps;
  }

  private horizontalVerticalCrossing(
    sampler: TerrainSampler,
    horizontalBand: number,
    verticalBand: number,
    from: number,
    to: number,
  ): number | null {
    const signedDistance = (coordinate: number): number => {
      const horizontalZ = sampler.roadSpineCoordinate(horizontalBand, "horizontal", coordinate);
      return coordinate - sampler.roadSpineCoordinate(verticalBand, "vertical", horizontalZ);
    };
    const steps = Math.max(4, Math.ceil((to - from) / ROAD_CONFIG.ribbonStep));
    let lower = from;
    let lowerValue = signedDistance(lower);
    if (Math.abs(lowerValue) <= 1e-6) return lower;

    for (let index = 1; index <= steps; index += 1) {
      let upper = from + ((to - from) * index) / steps;
      let upperValue = signedDistance(upper);
      if (Math.abs(upperValue) <= 1e-6) return upper;
      if (lowerValue * upperValue < 0) {
        for (let iteration = 0; iteration < 24; iteration += 1) {
          const middle = (lower + upper) / 2;
          const middleValue = signedDistance(middle);
          if (middleValue === 0) return middle;
          if (lowerValue * middleValue <= 0) {
            upper = middle;
            upperValue = middleValue;
          } else {
            lower = middle;
            lowerValue = middleValue;
          }
        }
        return (lower + upper) / 2;
      }
      lower = upper;
      lowerValue = upperValue;
    }
    return null;
  }

  private spineTangent(sampler: TerrainSampler, band: number, axis: "vertical" | "horizontal", coordinate: number): XZPoint {
    const delta = 0.75;
    const before = this.spinePoint(sampler, band, axis, coordinate - delta);
    const after = this.spinePoint(sampler, band, axis, coordinate + delta);
    return { x: after.x - before.x, z: after.z - before.z };
  }

  private subtractGaps(from: number, to: number, gaps: readonly RoadSpan[]): RoadSpan[] {
    const sorted = gaps
      .map((gap) => ({ from: Math.max(from, gap.from), to: Math.min(to, gap.to) }))
      .filter((gap) => gap.to > gap.from)
      .sort((first, second) => first.from - second.from);
    const spans: RoadSpan[] = [];
    let cursor = from;
    for (const gap of sorted) {
      if (gap.from > cursor) spans.push({ from: cursor, to: gap.from });
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < to) spans.push({ from: cursor, to });
    return spans;
  }

  private spinePoint(
    sampler: TerrainSampler,
    band: number,
    axis: "vertical" | "horizontal",
    coordinate: number,
  ): XZPoint {
    return axis === "vertical"
      ? { x: sampler.roadSpineCoordinate(band, "vertical", coordinate), z: coordinate }
      : { x: coordinate, z: sampler.roadSpineCoordinate(band, "horizontal", coordinate) };
  }

  private roadColor(tone: number, edge: number): Color4 {
    const base = edge === 0 ? [0.44, 0.38, 0.31] : [0.5, 0.44, 0.36];
    return new Color4(base[0] * tone, base[1] * tone, base[2] * tone, 1);
  }
}
