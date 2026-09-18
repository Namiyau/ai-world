import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MeshBuilder, NullEngine, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import {
  buildWaterTriangles,
  chunkBounds,
  clipTriangleToWater,
  expandIndexedTrianglesToFlat,
  groundTrianglesForCell,
  roadEdgesFromTangent,
} from "../src/game/world/geometry.ts";
import { ATMOSPHERE_CONFIG, GAME_CONFIG, ROAD_CONFIG, WATER_CONFIG } from "../src/game/config.ts";
import { buildTerrainGrid, type TerrainGrid, type TerrainGridVertex } from "../src/game/world/TerrainGrid.ts";
import { TerrainSampler } from "../src/game/world/TerrainSampler.ts";
import { RoadLayer } from "../src/game/world/Roads.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { Atmosphere } from "../src/game/world/Atmosphere.ts";

const source = async (relativePath: string): Promise<string> =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

type XZ = { x: number; z: number };

const signedArea = (points: readonly XZ[]): number =>
  points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - point.z * next.x;
  }, 0) / 2;

/** Clip a convex polygon against one directed edge; used only to detect real road-surface overlap. */
const clipAgainstEdge = (polygon: readonly XZ[], start: XZ, end: XZ, orientation: number): XZ[] => {
  const result: XZ[] = [];
  const side = (point: XZ): number => orientation * ((end.x - start.x) * (point.z - start.z) - (end.z - start.z) * (point.x - start.x));
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentSide = side(current);
    const nextSide = side(next);
    if (currentSide >= -1e-7) result.push(current);
    if ((currentSide >= 0) !== (nextSide >= 0)) {
      const t = currentSide / (currentSide - nextSide);
      result.push({ x: current.x + (next.x - current.x) * t, z: current.z + (next.z - current.z) * t });
    }
  }
  return result;
};

const projectedTriangleOverlapArea = (first: readonly XZ[], second: readonly XZ[]): number => {
  let clipped = [...first];
  const orientation = Math.sign(signedArea(second)) || 1;
  for (let index = 0; index < second.length && clipped.length > 0; index += 1) {
    clipped = clipAgainstEdge(clipped, second[index], second[(index + 1) % second.length], orientation);
  }
  return Math.abs(signedArea(clipped));
};

const roadTriangles = (mesh: ReturnType<RoadLayer["build"]>[number]): XZ[][] => {
  const positions = mesh.getVerticesData("position") ?? [];
  const indices = mesh.getIndices() ?? [];
  const triangles: XZ[][] = [];
  for (let index = 0; index < indices.length; index += 3) {
    triangles.push([0, 1, 2].map((offset) => {
      const vertex = indices[index + offset];
      return { x: positions[vertex * 3], z: positions[vertex * 3 + 2] };
    }));
  }
  return triangles;
};

test("road edges use a normalized perpendicular to the center-line tangent", () => {
  const edges = roadEdgesFromTangent({ x: 10, z: 20 }, { x: 0, z: 2 }, 3);
  assert.deepEqual(edges.left, { x: 7, z: 20 });
  assert.deepEqual(edges.right, { x: 13, z: 20 });

  const diagonal = roadEdgesFromTangent({ x: 0, z: 0 }, { x: 1, z: 1 }, 2);
  assert.equal(Math.hypot(diagonal.left.x, diagonal.left.z), 2);
  assert.equal(diagonal.left.x, -diagonal.right.x);
  assert.equal(diagonal.left.z, -diagonal.right.z);
});

test("flat triangle expansion gives every face independent vertices and normals", () => {
  const result = expandIndexedTrianglesToFlat(
    [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0],
    [0, 2, 1, 1, 3, 2],
  );

  assert.equal(result.positions.length, 18);
  assert.equal(result.normals.length, 18);
  assert.deepEqual(result.indices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.normals.slice(0, 3), [0, 1, 0]);
  assert.notDeepEqual(result.normals.slice(0, 3), result.normals.slice(9, 12));
});

test("flat ground normals stay upward with Babylon ground winding", () => {
  const result = expandIndexedTrianglesToFlat(
    [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1],
    [3, 1, 0],
  );
  assert.ok(result.normals[1] > 0);
});

test("chunk bounds use a half-open world range", () => {
  assert.deepEqual(chunkBounds(0, 64), { min: 0, max: 64, center: 32 });
  assert.deepEqual(chunkBounds(-1, 64), { min: -64, max: 0, center: -32 });
});

test("lake resolution is independent of query order", () => {
  const first = new TerrainSampler(18421);
  const second = new TerrainSampler(18421);
  const points = [
    [14, 16],
    [128, -96],
    [-210, 302],
    [470, 470],
  ] as const;

  const firstResults = points.map(([x, z]) => first.sample(x, z));
  [...points].reverse().forEach(([x, z]) => void second.sample(x, z));
  const secondResults = points.map(([x, z]) => second.sample(x, z));

  assert.deepEqual(secondResults, firstResults);
});

test("lake existence is based on the candidate center, not query-point height", async () => {
  const terrain = await source("src/game/world/TerrainSampler.ts");
  assert.match(terrain, /const centerBaseHeight = this\.baseElevation\(x, z\)\.base/);
  assert.doesNotMatch(terrain, /lakeAt\([^)]*baseHeight/);
  assert.doesNotMatch(terrain, /nearbyHeight/);
});

test("road flatten influence is derived from road width and shoulder", () => {
  assert.ok(ROAD_CONFIG.shoulderWidth > 0);
  assert.ok(ROAD_CONFIG.halfWidth + ROAD_CONFIG.shoulderWidth < 20);
  assert.equal("flattenWidth" in ROAD_CONFIG, false);
});

test("roads build one ribbon per road with exactly left and right paths", async () => {
  const roads = await source("src/game/world/Roads.ts");
  assert.match(roads, /pathArray:\s*\[[^\]]*left[^\]]*right[^\]]*\]/s);
  assert.doesNotMatch(roads, /paths\.push\(path\.points\)/);
  assert.doesNotMatch(roads, /points\.push\(new Vector3\(left/);
});

test("adjacent chunks do not duplicate the same world-space road ribbon", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const roads = new RoadLayer(scene, GAME_CONFIG.seeds.home);
  const sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  const leftChunk = roads.build(sampler, -224, -800, GAME_CONFIG.chunkSize);
  const rightChunk = roads.build(sampler, -160, -800, GAME_CONFIG.chunkSize);
  const signature = (mesh: ReturnType<RoadLayer["build"]>[number]): string => {
    const positions = mesh.getVerticesData("position") ?? [];
    return Array.from(positions, (value) => value.toFixed(4)).join(",");
  };
  const left = new Set(leftChunk.map(signature));
  const duplicates = rightChunk.map(signature).filter((value) => left.has(value));
  assert.equal(duplicates.length, 0, "neighboring chunks must not own identical road geometry");
  roads.dispose();
  scene.dispose();
  engine.dispose();
});

test("road junctions do not contain overlapping horizontal and vertical road triangles", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const roads = new RoadLayer(scene, GAME_CONFIG.seeds.home);
  const sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  const meshes = roads.build(sampler, -224, -224, GAME_CONFIG.chunkSize);
  const vertical = meshes.filter((mesh) => mesh.name.includes("vertical"));
  const horizontal = meshes.filter((mesh) => mesh.name.includes("horizontal"));
  assert.ok(vertical.length > 0 && horizontal.length > 0, "fixture must contain a real road junction");

  let overlapArea = 0;
  for (const verticalMesh of vertical) {
    for (const horizontalMesh of horizontal) {
      for (const verticalTriangle of roadTriangles(verticalMesh)) {
        for (const horizontalTriangle of roadTriangles(horizontalMesh)) {
          overlapArea += projectedTriangleOverlapArea(verticalTriangle, horizontalTriangle);
        }
      }
    }
  }
  assert.ok(overlapArea <= 1e-4, `road junction has ${overlapArea.toFixed(4)}m² of stacked surface`);
  roads.dispose();
  scene.dispose();
  engine.dispose();
});

test("lake terrain keeps a submerged road corridor below the water plane", () => {
  const sample = new TerrainSampler(GAME_CONFIG.seeds.home).sample(2552, -3512);
  assert.equal(sample.lakeMask, true, "fixture must stay in the validated lake basin");
  assert.equal(sample.hasWater, true, "road shaping must not convert lakebed into dry land");
  assert.ok(sample.height < WATER_CONFIG.level, `lakebed must remain below water, got ${sample.height}`);
});

test("road mesh does not render triangles inside a lake", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const roads = new RoadLayer(scene, GAME_CONFIG.seeds.home);
  const sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  const meshes = roads.build(sampler, 2528, -3488, GAME_CONFIG.chunkSize);
  assert.ok(meshes.length > 0, "fixture must contain the road that reaches the lake");

  for (const mesh of meshes) {
    for (const triangle of roadTriangles(mesh)) {
      const centroid = triangle.reduce((sum, point) => ({ x: sum.x + point.x / 3, z: sum.z + point.z / 3 }), { x: 0, z: 0 });
      assert.equal(sampler.sample(centroid.x, centroid.z).hasWater, false,
        `road triangle entered lake at ${centroid.x.toFixed(2)}, ${centroid.z.toFixed(2)}`);
    }
  }
  roads.dispose();
  scene.dispose();
  engine.dispose();
});

test("road surface stays above the terrain across its interpolated triangles", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const roads = new RoadLayer(scene, GAME_CONFIG.seeds.home);
  const sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  // This is the road segment from the reported X 2636 / Z -253 location.
  const meshes = roads.build(sampler, 2656, -224, GAME_CONFIG.chunkSize);
  assert.ok(meshes.length > 0, "fixture must contain the reported road");

  for (const mesh of meshes) {
    const positions = mesh.getVerticesData("position") ?? [];
    const indices = mesh.getIndices() ?? [];
    for (let index = 0; index < indices.length; index += 3) {
      const vertexIds = [indices[index], indices[index + 1], indices[index + 2]];
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        let x = 0;
        let y = 0;
        let z = 0;
        for (let point = 0; point < 3; point += 1) {
          const vertex = vertexIds[point];
          x += positions[vertex * 3] * weights[point];
          y += positions[vertex * 3 + 1] * weights[point];
          z += positions[vertex * 3 + 2] * weights[point];
        }
        assert.ok(y >= sampler.height(x, z) + 0.04,
          `road intersected terrain at ${x.toFixed(2)}, ${z.toFixed(2)}: road=${y.toFixed(3)}, ground=${sampler.height(x, z).toFixed(3)}`);
      }
    }
  }
  roads.dispose();
  scene.dispose();
  engine.dispose();
});

test("collecting an interaction removes its mesh and clears the prompt immediately", () => {
  const globalWithWindow = globalThis as typeof globalThis & { window?: Window };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let keydown: ((event: KeyboardEvent) => void) | null = null;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
        if (type === "keydown") keydown = listener;
      },
      removeEventListener: () => undefined,
    } as Pick<Window, "addEventListener" | "removeEventListener">,
  });

  try {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new UniversalCamera("test-camera", Vector3.Zero(), scene);
    const interactions = new InteractionSystem(camera);
    const stone = MeshBuilder.CreatePolyhedron("test-stone", { type: 1, size: 0.75 }, scene);
    let prompt: string | null = null;
    interactions.onPrompt((text) => { prompt = text; });
    interactions.register({
      id: "test-stone",
      mesh: stone,
      label: "收集 石料",
      onInteract: () => {
        interactions.unregister("test-stone");
        stone.dispose(false, false);
      },
    });
    interactions.update();
    assert.equal(prompt, "[E] 收集 石料");
    assert.ok(keydown, "interaction system must install a KeyE listener");
    keydown?.({ code: "KeyE", repeat: false } as KeyboardEvent);
    assert.equal(stone.isDisposed(), true);
    assert.equal(prompt, null);
    scene.dispose();
    engine.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalWithWindow.window;
  }
});

test("atmosphere sun uses an unlit camera-facing shader disc without a black StandardMaterial core", async () => {
  const atmosphere = await source("src/game/world/Atmosphere.ts");
  assert.match(atmosphere, /sun-disc/);
  assert.match(atmosphere, /SUN_DISC_FRAGMENT_SHADER/);
  assert.match(atmosphere, /sunDisc\.billboardMode = Mesh\.BILLBOARDMODE_ALL/);
  assert.doesNotMatch(atmosphere, /new StandardMaterial\("sun-disc-material"/);
  assert.doesNotMatch(atmosphere, /sunDiscMaterial\.diffuseColor = Color3\.Black/);
});

test("atmosphere prioritizes directional sun over restrained low-poly environment fill", () => {
  assert.ok(ATMOSPHERE_CONFIG.ambientIntensity >= 0.5);
  assert.ok(ATMOSPHERE_CONFIG.ambientIntensity < ATMOSPHERE_CONFIG.sunIntensity);
  const ground = ATMOSPHERE_CONFIG.ambientGround;
  assert.ok(!ground.startsWith("#4") && !ground.startsWith("#5"), `ambient ground is too dark: ${ground}`);
});

test("shadow casters do not become receivers and shadow darkness stays stylized", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera("test-camera", Vector3.Zero(), scene);
  const atmosphere = new Atmosphere(scene, camera);
  const caster = MeshBuilder.CreateBox("shadow-caster", { size: 1 }, scene);

  atmosphere.addShadowCaster(caster);
  assert.equal(caster.receiveShadows, false);
  atmosphere.setShadowReceiver(caster);
  assert.equal(caster.receiveShadows, true);
  assert.ok(ATMOSPHERE_CONFIG.shadows.darkness >= 0.45 && ATMOSPHERE_CONFIG.shadows.darkness <= 0.8);

  atmosphere.dispose();
  scene.dispose();
  engine.dispose();
});

test("river generation is absent from the terrain sampler", async () => {
  const terrain = await source("src/game/world/TerrainSampler.ts");
  assert.doesNotMatch(terrain, /riverDepth|sideChannelDepth|riverBandExists|riverWind/);
  assert.doesNotMatch(terrain, /WATER_CONFIG\.river/);
  assert.equal("river" in WATER_CONFIG, false);
});

test("water shader culls back faces and debug alpha is opaque", async () => {
  const water = await source("src/game/world/WaterLayer.ts");
  assert.doesNotMatch(water, /float surface = color\.a/);
  assert.match(water, /material\.backFaceCulling\s*=\s*true/);
  assert.match(water, /colors\.push\([^\n]*1\.0/);
  assert.match(water, /material\.needAlphaBlending\s*=\s*\(\)\s*=>\s*false/);
  assert.match(water, /material\.alphaMode\s*=\s*Constants\.ALPHA_DISABLE/);
  assert.doesNotMatch(water, /uNormalOffset/);
});

test("stylized water shader keeps opaque output and defines wave, depth, fresnel and reflection inputs", async () => {
  const water = await source("src/game/world/WaterLayer.ts");
  assert.match(water, /uTime/);
  assert.match(water, /uCameraPosition/);
  assert.match(water, /waterDepth|vWaterDepth/);
  assert.match(water, /Fresnel|fresnel/i);
  assert.match(water, /reflection|uSky/i);
  assert.match(water, /gl_FragColor\s*=\s*vec4\([^;]*,\s*1\.0\s*\)/);
  assert.match(water, /attributes:\s*\[[^\]]*waterDepth/);
  assert.match(water, /material\.backFaceCulling\s*=\s*true/);
});

test("ground cell triangles exactly match Babylon CreateGround topology", () => {
  const makeVertex = (id: string, x: number, z: number): TerrainGridVertex => ({
    id,
    x,
    z,
    height: 0,
    lakeMask: false,
    hasWater: false,
    waterDepth: 0,
    waterCoverage: 0,
    waterColor: [0.1, 0.2, 0.3],
    moisture: 0,
    rockiness: 0,
    onRoad: false,
  });
  const grid = {
    centerX: 0,
    centerZ: 0,
    size: 2,
    subdivisions: 1,
    step: 2,
    vertices: [
      makeVertex("c", -1, 1),
      makeVertex("d", 1, 1),
      makeVertex("a", -1, -1),
      makeVertex("b", 1, -1),
    ],
  } satisfies TerrainGrid;

  const triangles = groundTrianglesForCell(grid, 0, 0);
  assert.deepEqual(triangles.map((triangle) => triangle.vertices.map((vertex) => vertex.id)), [
    ["b", "d", "c"],
    ["a", "b", "c"],
  ]);
  assert.deepEqual(triangles.map((triangle) => triangle.diagonal), ["bdc", "abc"]);
});

test("water clipping follows the real ground triangle height plane", () => {
  const triangle: TerrainGridVertex[] = [
    { x: 0, z: 0, height: 1, lakeMask: true, hasWater: false, waterDepth: 0, waterCoverage: 0, waterColor: [0, 0, 0], moisture: 0, rockiness: 0, onRoad: false },
    { x: 1, z: 0, height: -1, lakeMask: true, hasWater: true, waterDepth: 1, waterCoverage: 0, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
    { x: 0, z: 1, height: -1, lakeMask: true, hasWater: true, waterDepth: 1, waterCoverage: 0, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
  ];
  const clipped = clipTriangleToWater({ vertices: triangle, indices: [0, 1, 2], diagonal: "bdc" }, 0);
  assert.equal(clipped?.length, 4);
  for (const point of clipped ?? []) assert.equal(point.y, 0);
  assert.deepEqual(clipped?.map((point) => [point.x, point.z]), [
    [0.5, 0],
    [1, 0],
    [0, 1],
    [0, 0.5],
  ]);
});

test("water clipping rejects below-water terrain outside a lake mask", () => {
  const triangle: TerrainGridVertex[] = [
    { x: 0, z: 0, height: -2, lakeMask: false, hasWater: false, waterDepth: 0, waterCoverage: 0, waterColor: [0, 0, 0], moisture: 0, rockiness: 0, onRoad: false },
    { x: 1, z: 0, height: -2, lakeMask: true, hasWater: true, waterDepth: 2, waterCoverage: 1, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
    { x: 0, z: 1, height: -2, lakeMask: true, hasWater: true, waterDepth: 2, waterCoverage: 1, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
  ];
  assert.equal(clipTriangleToWater({ vertices: triangle, indices: [0, 1, 2], diagonal: "abc" }, 0), null);
});

test("water clipping ignores visual coverage when building geometry", () => {
  const triangle: TerrainGridVertex[] = [
    { x: 0, z: 0, height: -1, lakeMask: true, hasWater: true, waterDepth: 0.01, waterCoverage: 0, waterColor: [0, 0, 0], moisture: 0, rockiness: 0, onRoad: false },
    { x: 1, z: 0, height: -1, lakeMask: true, hasWater: true, waterDepth: 2, waterCoverage: 0, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
    { x: 0, z: 1, height: -1, lakeMask: true, hasWater: true, waterDepth: 2, waterCoverage: 0, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
  ];
  const clipped = clipTriangleToWater({ vertices: triangle, indices: [0, 1, 2], diagonal: "abc" }, 0);
  assert.ok(clipped);
  assert.equal(clipped?.length, 3);
});

test("water clipping carries zero depth at the real shoreline and positive depth inside", () => {
  const triangle: TerrainGridVertex[] = [
    { x: 0, z: 0, height: 1, lakeMask: true, hasWater: false, waterDepth: 0, waterCoverage: 0, waterColor: [0, 0, 0], moisture: 0, rockiness: 0, onRoad: false },
    { x: 1, z: 0, height: -2, lakeMask: true, hasWater: true, waterDepth: 2, waterCoverage: 1, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
    { x: 0, z: 1, height: -4, lakeMask: true, hasWater: true, waterDepth: 4, waterCoverage: 1, waterColor: [1, 1, 1], moisture: 0, rockiness: 0, onRoad: false },
  ];
  const clipped = clipTriangleToWater({ vertices: triangle, indices: [0, 1, 2], diagonal: "abc" }, 0);
  assert.ok(clipped);
  assert.equal(clipped?.[0].waterDepth, 0);
  assert.ok((clipped?.[1].waterDepth ?? 0) > 0);
  assert.ok((clipped?.[2].waterDepth ?? 0) > 0);
});

test("water geometry source has no coverage topology gate", async () => {
  const geometry = await source("src/game/world/geometry.ts");
  assert.doesNotMatch(geometry, /LAKE_COVERAGE_THRESHOLD|clipPolygonToWaterCoverage|triangleWaterCoverage|isTriangleInLakeMask/);
  assert.doesNotMatch(geometry, /waterCoverage/);
});

test("lake profile has no abrupt 0.3m cutoff", async () => {
  const terrain = await source("src/game/world/TerrainSampler.ts");
  assert.doesNotMatch(terrain, /deepest\s*<\s*0\.3/);
  assert.match(terrain, /LAKE_DEPTH_EPSILON/);
});

test("shared terrain grid is deterministic and exposes the actual lake mask", () => {
  const first = buildTerrainGrid(new TerrainSampler(18421), -128, -704, GAME_CONFIG.chunkSize);
  const second = buildTerrainGrid(new TerrainSampler(18421), -128, -704, GAME_CONFIG.chunkSize);
  const nonLakeLowland = buildTerrainGrid(new TerrainSampler(18421), 160, -1184, GAME_CONFIG.chunkSize);
  assert.equal(first.vertices.length, 25 * 25);
  assert.deepEqual(second, first);
  assert.ok(first.vertices.some((vertex) => vertex.lakeMask));
  assert.ok(nonLakeLowland.vertices.some((vertex) => !vertex.lakeMask && vertex.height < WATER_CONFIG.level));
  assert.ok(first.vertices.every((vertex) => vertex.hasWater === (vertex.lakeMask && vertex.height < WATER_CONFIG.level)));
});

test("adjacent terrain grids share identical chunk-edge vertices", () => {
  const sampler = new TerrainSampler(18421);
  const left = buildTerrainGrid(sampler, 32, -1184, GAME_CONFIG.chunkSize);
  const right = buildTerrainGrid(sampler, 96, -1184, GAME_CONFIG.chunkSize);
  const cells = GAME_CONFIG.chunkSubdivisions + 1;
  for (let row = 0; row < cells; row += 1) {
    const leftVertex = left.vertices[row * cells + GAME_CONFIG.chunkSubdivisions];
    const rightVertex = right.vertices[row * cells];
    assert.deepEqual(rightVertex, leftVertex);
  }
});

test("every generated water triangle stays below the sampled ground triangle", () => {
  const grid = buildTerrainGrid(new TerrainSampler(18421), -128, -704, GAME_CONFIG.chunkSize);
  const waterTriangles = buildWaterTriangles(grid, WATER_CONFIG.level);
  assert.ok(waterTriangles.length > 0);

  for (const waterTriangle of waterTriangles) {
    const source = waterTriangle.source.vertices;
    for (const point of waterTriangle.points) assert.equal(point.y, WATER_CONFIG.level);
    const centroid = waterTriangle.points.reduce(
      (sum, point) => ({ x: sum.x + point.x / 3, z: sum.z + point.z / 3 }),
      { x: 0, z: 0 },
    );
    const weights = [
      ((source[1].x - centroid.x) * (source[2].z - centroid.z) - (source[1].z - centroid.z) * (source[2].x - centroid.x)),
      ((source[2].x - centroid.x) * (source[0].z - centroid.z) - (source[2].z - centroid.z) * (source[0].x - centroid.x)),
    ];
    const centroidArea = (source[1].x - source[0].x) * (source[2].z - source[0].z) - (source[1].z - source[0].z) * (source[2].x - source[0].x);
    const lakeWeight = (weights[0] / centroidArea) * (source[0].lakeMask ? 1 : 0) +
      (weights[1] / centroidArea) * (source[1].lakeMask ? 1 : 0) +
      (1 - weights[0] / centroidArea - weights[1] / centroidArea) * (source[2].lakeMask ? 1 : 0);
    assert.ok(lakeWeight > 0, `water centroid must stay in a lake basin at ${centroid.x},${centroid.z}`);

    const area = (source[1].x - source[0].x) * (source[2].z - source[0].z) - (source[1].z - source[0].z) * (source[2].x - source[0].x);
    for (const point of waterTriangle.points) {
      const w0 = ((source[1].x - point.x) * (source[2].z - point.z) - (source[1].z - point.z) * (source[2].x - point.x)) / area;
      const w1 = ((source[2].x - point.x) * (source[0].z - point.z) - (source[2].z - point.z) * (source[0].x - point.x)) / area;
      const w2 = 1 - w0 - w1;
      const groundHeight = w0 * source[0].height + w1 * source[1].height + w2 * source[2].height;
      assert.ok(groundHeight <= WATER_CONFIG.level + 1e-5);
    }
  }
});

test("accepted lake candidates have a dry, elevated uncarved shore ring", () => {
  const sampler = new TerrainSampler(18421);
  let accepted = 0;
  for (let gz = -8; gz <= 8; gz += 1) {
    for (let gx = -8; gx <= 8; gx += 1) {
      const candidate = sampler.lakeCandidateAt(gx, gz);
      if (!candidate) continue;
      accepted += 1;
      assert.ok(candidate.shoreSamples >= 24);
      assert.ok(candidate.minRimHeight > WATER_CONFIG.level + WATER_CONFIG.lake.shoreSafetyMargin);
    }
  }
  assert.ok(accepted > 0, "seed must produce at least one accepted lake candidate");
});

test("non-chunk water boundary edges contact the real Ground plane", () => {
  const grid = buildTerrainGrid(new TerrainSampler(18421), -128, -704, GAME_CONFIG.chunkSize);
  const waterTriangles = buildWaterTriangles(grid, WATER_CONFIG.level);
  const edges = new Map<string, { count: number; start: { x: number; z: number }; end: { x: number; z: number }; source: (typeof waterTriangles)[number]["source"] }>();
  const pointKey = (point: { x: number; z: number }): string => `${point.x.toFixed(6)},${point.z.toFixed(6)}`;
  const edgeKey = (start: { x: number; z: number }, end: { x: number; z: number }): string =>
    [pointKey(start), pointKey(end)].sort().join("|");

  for (const triangle of waterTriangles) {
    for (let index = 0; index < 3; index += 1) {
      const start = triangle.points[index];
      const end = triangle.points[(index + 1) % 3];
      const key = edgeKey(start, end);
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, { count: 1, start, end, source: triangle.source });
    }
  }

  const minX = grid.centerX - grid.size / 2;
  const maxX = grid.centerX + grid.size / 2;
  const minZ = grid.centerZ - grid.size / 2;
  const maxZ = grid.centerZ + grid.size / 2;
  const onChunkBoundary = (point: { x: number; z: number }): boolean =>
    Math.abs(point.x - minX) < 1e-5 || Math.abs(point.x - maxX) < 1e-5 ||
    Math.abs(point.z - minZ) < 1e-5 || Math.abs(point.z - maxZ) < 1e-5;
  const heightAt = (point: { x: number; z: number }, sourceTriangle: (typeof waterTriangles)[number]["source"]): number => {
    const [first, second, third] = sourceTriangle.vertices;
    const area = (second.x - first.x) * (third.z - first.z) - (second.z - first.z) * (third.x - first.x);
    const w0 = ((second.x - point.x) * (third.z - point.z) - (second.z - point.z) * (third.x - point.x)) / area;
    const w1 = ((third.x - point.x) * (first.z - point.z) - (third.z - point.z) * (first.x - point.x)) / area;
    const w2 = 1 - w0 - w1;
    return w0 * first.height + w1 * second.height + w2 * third.height;
  };

  let shorelineEdges = 0;
  for (const edge of edges.values()) {
    if (edge.count !== 1 || onChunkBoundary(edge.start) || onChunkBoundary(edge.end)) continue;
    shorelineEdges += 1;
    for (const t of [0, 0.5, 1]) {
      const point = {
        x: edge.start.x + (edge.end.x - edge.start.x) * t,
        z: edge.start.z + (edge.end.z - edge.start.z) * t,
      };
      const height = heightAt(point, edge.source);
      assert.ok(Math.abs(height - WATER_CONFIG.level) <= 0.03,
        `shoreline edge must intersect Ground at water level: ${JSON.stringify({ point, height })}`);
    }
  }
  assert.ok(shorelineEdges > 0, "test chunk must contain an internal lake shoreline");
});

test("water geometry uses chunk-local coordinates and no old quad shoreline algorithm", async () => {
  const water = await source("src/game/world/WaterLayer.ts");
  assert.match(water, /build\(grid: TerrainGrid\)/);
  assert.match(water, /point\.x - grid\.centerX/);
  assert.match(water, /point\.z - grid\.centerZ/);
  assert.doesNotMatch(water, /cornerOrder|centerWet|diagonalWet|interpolateWetEdge/);
  assert.doesNotMatch(water, /polygon\.length - 1/);
});

test("Game leaves fog and lights to Atmosphere", async () => {
  const game = await source("src/game/Game.ts");
  assert.doesNotMatch(game, /HemisphericLight|DirectionalLight|fogEnabled|fogDensity/);
});

test("default home spawn targets the validated lake basin", async () => {
  const game = await source("src/game/Game.ts");
  assert.match(game, /home:\s*\{\s*x:\s*-128,\s*y:\s*3,\s*z:\s*-704\s*\}/);
  const candidate = new TerrainSampler(18421).lakeCandidateAt(-1, -2);
  assert.ok(candidate, "the home seed must contain the selected valid lake candidate");
  assert.ok(Math.hypot(-128 - candidate.x, -704 - candidate.z) < 64);
});

test("nearest lake lookup is deterministic and returns a legal basin", () => {
  const first = new TerrainSampler(18421);
  const second = new TerrainSampler(18421);
  const firstTarget = first.nearestLakeCandidate(212, -1212);
  const secondTarget = second.nearestLakeCandidate(212, -1212);

  assert.ok(firstTarget, "the home seed must expose a reachable lake target");
  assert.deepEqual(secondTarget, firstTarget);
  assert.ok(firstTarget.minRimHeight > WATER_CONFIG.level + WATER_CONFIG.lake.shoreSafetyMargin);
  assert.ok(firstTarget.depth > 0);
  assert.ok(firstTarget.radius >= WATER_CONFIG.lake.radiusMin);
});

test("WorldManager uses half-open chunk centers and expanded flat normals", async () => {
  const world = await source("src/game/world/WorldManager.ts");
  assert.match(world, /chunkBounds\(cx, size\)\.center/);
  assert.match(world, /chunkBounds\(cz, size\)\.center/);
  assert.match(world, /expandIndexedTrianglesToFlat/);
  assert.doesNotMatch(world, /const sumX = new Float32Array/);
});
