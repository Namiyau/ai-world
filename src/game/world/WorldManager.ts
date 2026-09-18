import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
  Vector3,
  type AbstractMesh,
  type Mesh as BabylonMesh,
  type Scene,
  type UniversalCamera,
} from "@babylonjs/core";
import { GAME_CONFIG, DETAIL_CONFIG, LANDMARK_CONFIG, POI_CONFIG, type ChunkLoadRadius, type FogDistancePreference } from "../config";
import type { ItemId, WorldId } from "../types";
import { mulberry32, hashInts } from "../utils/random";
import { InteractionSystem } from "../systems/InteractionSystem";
import { CombatSystem } from "../systems/CombatSystem";
import { Atmosphere, type TimePreset } from "./Atmosphere";
import { AmbientSoundscape, type AmbientSoundState } from "./AmbientSoundscape";
import { DetailLayer, type ClearZone } from "./Details";
import { LandmarkLayer, type LandmarkAnnotation } from "./Landmarks";
import { PoiLayer } from "./PoiLayer";
import { RoadLayer } from "./Roads";
import { TerrainSampler, type LakeCandidate, type TerrainSample } from "./TerrainSampler";
import { buildTerrainGrid, type TerrainGrid } from "./TerrainGrid";
import { WaterLayer } from "./WaterLayer";
import { CharacterShowcaseLayer, type CharacterShowcaseBuild } from "./CharacterShowcaseLayer";
import { rhythmAt } from "./ExplorationRhythm";
import { chunkBounds, expandIndexedTrianglesToFlat } from "./geometry";
import { AssetManager } from "../assets/AssetManager";
import { selectResourceVisual, type ResourceVisualKind } from "../assets/ResourceVisuals";
import { chunkWindowForCenter, chunkWindowSize, reconcilePendingChunks, type PendingChunkEntry } from "./ChunkStreaming";

interface ChunkRecord {
  meshes: AbstractMesh[];
  interactionIds: string[];
  damageableIds: string[];
  /** 该 chunk 负责构建的地标 cell（"cellX:cellZ"）。 */
  landmarkCells: string[];
  /** 该 chunk 负责构建的人工场景 cell（"cellX:cellZ"）。 */
  poiCells: string[];
  /** 敌人网格单独记录，避免每帧遍历所有 mesh。 */
  enemyMeshes: AbstractMesh[];
}

interface EnemyRecord {
  id: string;
  mesh: AbstractMesh;
  hp: number;
}

interface WorldManagerCallbacks {
  onCollect: (item: ItemId, amount: number) => void;
  onToast: (message: string) => void;
  onTravelRequest: (target: WorldId) => void;
  onSellRequest: () => void;
}

/**
 * 每帧给 Chunk 生成分配的主线程预算（毫秒）。
 * 单个 Chunk 的复杂度会因湖泊、道路、POI 和正式资产异步替换而变化，
 * 所以按时间预算比固定“每帧 3 个”更能避免低端浏览器出现生成尖峰。
 */
const CHUNK_BUILD_BUDGET_MS = 8;
/** 玩家所在 chunk 周围同步构建的半径（保证脚下一定有地面）。 */
const SYNC_BUILD_RADIUS = 1;

/** Warm the local formal-asset cache while the first chunk is being assembled. */
const FORMAL_ASSET_WARMUP = [
  "tree-round", "tree-pine", "tree-birch", "rock-large", "rock-small",
  "bush", "grass", "flower", "reed", "wood-resource", "stone-resource",
  "iron-ore", "copper-ore", "rare-ore", "scrap", "fence", "sign", "barrel",
  "crate", "cabin", "warehouse", "gas-station", "bridge", "dock", "tool",
] as const;

/**
 * 世界管理器：负责 chunk 流式加载 / 卸载，以及把各渲染层接进 chunk 生命周期。
 *
 * 分层结构：
 *   TerrainSampler  纯函数世界模型（地形 / 水体 / 道路基座）—— 无 Babylon 依赖
 *   ├─ 地面网格     顶点色 + 依据采样器抬升顶点
 *   ├─ WaterLayer   水面网格（固定水平湖面与雾）
 *   ├─ RoadLayer    路面 ribbon
 *   ├─ LandmarkLayer 远景地标（按 cell 归属，独立于 chunk 尺寸）
 *   ├─ PoiLayer      人工场景与矿物节点（按 owner chunk 归属）
 *   └─ DetailLayer  实例化散布物
 */
export class WorldManager {
  public currentWorld: WorldId = "home";

  private scene!: Scene;
  private camera!: UniversalCamera;
  private interactions!: InteractionSystem;
  private combat!: CombatSystem;
  private callbacks!: WorldManagerCallbacks;
  private collectedResourceIds!: Set<string>;

  private sampler!: TerrainSampler;
  private atmosphere!: Atmosphere;
  private water!: WaterLayer;
  private roads!: RoadLayer;
  private landmarks!: LandmarkLayer;
  private pois!: PoiLayer;
  private details!: DetailLayer;
  private characterShowcase!: CharacterShowcaseLayer;
  private assets!: AssetManager;
  /** Public asset-free cue mix for a future audio player. */
  public readonly soundscape = new AmbientSoundscape();
  public ambientAudio: AmbientSoundState = { forestWind: 0, birds: 0, shoreWater: 0, nightInsects: 0 };

  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly landmarkMeshes: AbstractMesh[] = [];
  private readonly landmarkInteractionIds: string[] = [];
  private readonly enemies: EnemyRecord[] = [];
  private pendingChunks: PendingChunkEntry[] = [];
  private readonly pendingChunkKeys = new Set<string>();
  private currentChunkLoadRadius: ChunkLoadRadius = GAME_CONFIG.chunkRadius as ChunkLoadRadius;
  private chunkBuildCount = 0;
  private chunkDisposeCount = 0;
  private lastChunkBuildMs = 0;
  private lastWindowRefreshMs = 0;

  /** 出生点锚点：周围保持净空，避免玩家卡在散布物里。 */
  private spawnAnchor: { x: number; z: number } | null = null;
  /** 商店 / 传送门等 POI 锚点：同样保持净空。 */
  private readonly poiAnchors: Array<{ x: number; z: number }> = [];

  private lastCenterChunk = "";
  private lastCenterX = 0;
  private lastCenterZ = 0;
  private lastCompassAt = 0;

  public constructor(
    scene: Scene,
    camera: UniversalCamera,
    interactions: InteractionSystem,
    combat: CombatSystem,
    collectedResourceIds: Set<string>,
    callbacks: WorldManagerCallbacks,
  ) {
    this.configure(scene, camera, interactions, combat, collectedResourceIds, callbacks);
    this.buildSystems();
  }

  /** 构造函数体量大，拆成两段便于阅读。 */
  private configure(
    scene: Scene,
    camera: UniversalCamera,
    interactions: InteractionSystem,
    combat: CombatSystem,
    collectedResourceIds: Set<string>,
    callbacks: WorldManagerCallbacks,
  ): void {
    this.scene = scene;
    this.camera = camera;
    this.interactions = interactions;
    this.combat = combat;
    this.collectedResourceIds = collectedResourceIds;
    this.callbacks = callbacks;
  }

  private buildSystems(): void {
    this.atmosphere = new Atmosphere(this.scene, this.camera);
    this.assets = new AssetManager(this.scene, {
      onFormalAsset: (root) => this.atmosphere.addShadowCaster(root, true),
    });
    void this.assets.preload(FORMAL_ASSET_WARMUP).catch((error: unknown) => {
      console.warn(`Formal asset warmup kept procedural fallbacks available: ${String(error)}`);
    });
    this.water = new WaterLayer(this.scene);
    this.roads = new RoadLayer(this.scene, GAME_CONFIG.seeds.home);
    this.landmarks = new LandmarkLayer(this.scene, GAME_CONFIG.seeds.home);
    this.pois = new PoiLayer(this.scene, GAME_CONFIG.seeds.home, this.assets);
    this.details = this.createDetailLayer(GAME_CONFIG.seeds.home);
    this.characterShowcase = new CharacterShowcaseLayer(this.scene);
    this.sampler = new TerrainSampler(GAME_CONFIG.seeds.home);
  }

  /** 世界种子变化时要重建与种子绑定的层（世界生成是 seed 驱动的）。 */
  private rebindSeedLayers(world: WorldId): void {
    const seed = this.seedFor(world);
    this.sampler = new TerrainSampler(seed);
    this.sampler.setRugged(world === "mission");
    // 这些层的几何位置都由种子决定，换世界必须整体重建材质与实例。
    this.roads.dispose();
    this.landmarks.dispose();
    this.pois.dispose();
    this.details.dispose();
    this.roads = new RoadLayer(this.scene, seed);
    this.landmarks = new LandmarkLayer(this.scene, seed);
    this.pois = new PoiLayer(this.scene, seed, this.assets);
    this.details = this.createDetailLayer(seed);
  }

  /** ---------- 生命周期 ---------- */

  public loadWorld(world: WorldId, around: Vector3): void {
    this.clearWorld();
    this.currentWorld = world;
    this.rebindSeedLayers(world);
    this.lastCenterX = around.x;
    this.lastCenterZ = around.z;
    // 先安置商店 / 传送门（同时登记净空锚点），再建 chunk，
    // 这样第一帧生成的地面就已经避开了这些位置。
    this.createWorldPois(world);
    // 记录传送落点作为出生点锚点；随后 Game 调用 findSafeSpawn 时会用真实落点刷新它。
    this.spawnAnchor = { x: around.x, z: around.z };
    if (world === "home") {
      const showcase = this.characterShowcase.build(-190, -730, this.sampler);
      this.atmosphere.addShadowCaster(showcase.root, true);
      // Only the display platform/pedestals receive the character silhouettes.
      // Character parts remain caster-only, avoiding per-part CSM self-shadow
      // bands while preserving a readable contact shadow on the ground display.
      for (const mesh of showcase.root.getChildMeshes(false)) {
        if (mesh.name.startsWith("showcase-platform") || mesh.name.startsWith("showcase-pedestal")) {
          this.atmosphere.setShadowReceiver(mesh);
        }
      }
    }
    // World switching must only build the central 3×3 synchronously. The
    // configured outer window is streamed by processPendingChunks so a new
    // world cannot freeze the browser while sampling all terrain at once.
    this.update(around, false, false);
  }

  public update(playerPosition: Vector3, force = false, processPending = true): void {
    this.lastCenterX = playerPosition.x;
    this.lastCenterZ = playerPosition.z;

    const cx = Math.floor(playerPosition.x / GAME_CONFIG.chunkSize);
    const cz = Math.floor(playerPosition.z / GAME_CONFIG.chunkSize);
    const centerKey = `${cx},${cz}`;

    if (force || centerKey !== this.lastCenterChunk) {
      this.lastCenterChunk = centerKey;
      this.refreshChunkWindow(cx, cz, force);
    }

    if (processPending) this.processPendingChunks();
    this.updateEnemies();
  }

  /** Apply the Minecraft-style square streaming distance from the pause menu. */
  public setChunkLoadRadius(radius: ChunkLoadRadius): void {
    if (radius === this.currentChunkLoadRadius) return;
    this.currentChunkLoadRadius = radius;
    if (!this.lastCenterChunk) return;
    const [cx, cz] = this.lastCenterChunk.split(",").map(Number);
    this.refreshChunkWindow(cx, cz, false);
    this.processPendingChunks();
  }

  public get chunkLoadRadius(): ChunkLoadRadius {
    return this.currentChunkLoadRadius;
  }

  /** 计算想要的 chunk 集合：立刻卸载超出的，新出现的进入构建队列。 */
  private refreshChunkWindow(cx: number, cz: number, force: boolean): void {
    const startedAt = this.now();
    const window = chunkWindowForCenter(cx, cz, this.currentChunkLoadRadius);
    const wanted = new Set(window.map(({ cx: chunkX, cz: chunkZ }) => this.chunkKey(chunkX, chunkZ)));

    if (force) {
      this.pendingChunks = [];
      this.pendingChunkKeys.clear();
    } else {
      const loadedCoordinates = new Set<string>();
      for (const key of this.chunks.keys()) {
        const [, chunkX, chunkZ] = key.split(":");
        loadedCoordinates.add(`${chunkX}:${chunkZ}`);
      }
      this.pendingChunks = reconcilePendingChunks(
        this.pendingChunks,
        window,
        loadedCoordinates,
      );
      this.pendingChunkKeys.clear();
      for (const item of this.pendingChunks) this.pendingChunkKeys.add(this.chunkKey(item.cx, item.cz));
    }

    for (const entry of window) {
      const chunkX = entry.cx;
      const chunkZ = entry.cz;
      const key = this.chunkKey(chunkX, chunkZ);
      if (this.chunks.has(key) || this.pendingChunkKeys.has(key)) continue;

      // 玩家脚下这一圈必须立刻建好，其余排队分摊到后续帧。
      const near = Math.abs(chunkX - cx) <= SYNC_BUILD_RADIUS && Math.abs(chunkZ - cz) <= SYNC_BUILD_RADIUS;
      if (near || force) this.createChunk(chunkX, chunkZ);
      else {
        this.pendingChunks.push({ cx: chunkX, cz: chunkZ });
        this.pendingChunkKeys.add(key);
      }
    }

    for (const [key, record] of this.chunks) {
      if (!wanted.has(key)) this.disposeChunk(key, record);
    }

    // 队列里可能出现已经不需要的 chunk；同步维护 key 集合，避免每次加入都 O(n) 扫描。
    const retained = this.pendingChunks.filter((item) => wanted.has(this.chunkKey(item.cx, item.cz)));
    this.pendingChunks = retained;
    this.pendingChunkKeys.clear();
    for (const item of retained) this.pendingChunkKeys.add(this.chunkKey(item.cx, item.cz));
    this.lastWindowRefreshMs = this.now() - startedAt;
  }

  private processPendingChunks(): void {
    const startedAt = this.now();
    let built = 0;
    while (this.pendingChunks.length > 0) {
      // Always make progress, but stop before a second expensive build once
      // the frame budget is spent. This keeps radius changes responsive while
      // allowing a cheap chunk to be built without wasting the frame.
      if (built > 0 && this.now() - startedAt >= CHUNK_BUILD_BUDGET_MS) break;
      const item = this.pendingChunks.shift();
      if (!item) break;
      this.pendingChunkKeys.delete(this.chunkKey(item.cx, item.cz));
      if (this.chunks.has(this.chunkKey(item.cx, item.cz))) continue;
      this.createChunk(item.cx, item.cz);
      built += 1;
    }
  }

  /** 水面材质 / 地标动画 / 天空同步。 */
  public updateVisuals(deltaSeconds: number, playerPosition: Vector3): void {
    this.atmosphere.update(deltaSeconds);
    this.water.update(deltaSeconds, this.camera.position.y, this.camera.position, this.atmosphere.visualState);
    this.landmarks.update(deltaSeconds);
    this.details.updateLod(playerPosition.x, playerPosition.z);
    const sample = this.sampler.sample(playerPosition.x, playerPosition.z);
    this.ambientAudio = this.soundscape.evaluate({
      biome: sample.biome,
      waterDepth: sample.waterDepth,
      daylight: this.atmosphere.visualState.daylight,
    });
  }

  public get nearestLandmark(): LandmarkAnnotation | null {
    return this.landmarks.nearest(this.lastCenterX, this.lastCenterZ, this.sampler);
  }

  public get characterShowcaseTarget(): { x: number; z: number } | null {
    const showcase = this.characterShowcase.active;
    return showcase ? { x: showcase.center.x, z: showcase.center.z } : null;
  }

  public get characterShowcaseBuild(): CharacterShowcaseBuild | null {
    return this.characterShowcase.active;
  }

  /** Changes the sole world clock even when gameplay simulation is paused. */
  public setTimePreset(preset: TimePreset): void {
    this.atmosphere.setTimePreset(preset);
    this.water.update(0, this.camera.position.y, this.camera.position, this.atmosphere.visualState);
  }

  public setFogDistance(preference: FogDistancePreference): void {
    this.atmosphere.setFogDistance(preference);
    this.water.update(0, this.camera.position.y, this.camera.position, this.atmosphere.visualState);
  }

  /** Read-only macro cadence for HUD/debug and browser acceptance. */
  public explorationRhythmAt(x: number, z: number) {
    return rhythmAt(x, z, this.seedFor(this.currentWorld));
  }

  /** 供 HUD 做指引时的节流。 */
  public shouldRefreshCompass(now: number, intervalMs: number): boolean {
    if (now - this.lastCompassAt < intervalMs) return false;
    this.lastCompassAt = now;
    return true;
  }

  /** ---------- 查询接口 ---------- */

  public getTerrainHeight(x: number, z: number, world = this.currentWorld): number {
    if (world !== this.currentWorld) {
      const sampler = new TerrainSampler(this.seedFor(world));
      sampler.setRugged(world === "mission");
      return sampler.height(x, z);
    }
    return this.sampler.height(x, z);
  }

  /** 完整地表采样（含水深 / 道路 / 分类），供移动、散布、HUD 使用。 */
  public sampleSurface(x: number, z: number): TerrainSample {
    return this.sampler.sample(x, z);
  }

  public get waterLevel(): number {
    return this.sampler.waterLevel;
  }

  /** 当前世界中距离玩家最近的合法湖盆，供临时导航 / 传送使用。 */
  public nearestLakeTarget(x: number, z: number): LakeCandidate | null {
    if (this.currentWorld !== "home") return null;
    return this.sampler.nearestLakeCandidate(x, z);
  }

  public isWaterAt(x: number, z: number): boolean {
    return this.sampler.sample(x, z).waterDepth > 0.05;
  }

  /** 找一个适合落脚的干燥地面（用于出生点与传送落点）。 */
  public findSafeSpawn(x: number, z: number, world: WorldId = this.currentWorld): Vector3 {
    const sampler = world === this.currentWorld ? this.sampler : this.buildSamplerFor(world);
    const isSafe = (px: number, pz: number): number | null => {
      const sample = sampler.sample(px, pz);
      if (sample.surface === "deepWater") return null;
      if (sample.waterDepth > 0.35) return null;
      // 低于全局水位的地方一律不用（湖泊中心）。
      if (sample.height < sampler.waterLevel + 0.8) return null;
      return sample.height;
    };

    const finish = (px: number, pz: number, height: number): Vector3 => {
      // 落点周围保持净空，避免玩家一睁眼就卡在树冠里。
      if (world === this.currentWorld) this.spawnAnchor = { x: px, z: pz };
      return new Vector3(px, height + 2.2, pz);
    };

    const direct = isSafe(x, z);
    if (direct !== null) return finish(x, z, direct);

    for (let ring = 1; ring <= 12; ring += 1) {
      const radius = ring * 6;
      const steps = 6 + ring * 2;
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(angle) * radius;
        const pz = z + Math.sin(angle) * radius;
        const height = isSafe(px, pz);
        if (height !== null) return finish(px, pz, height);
      }
    }

    // 极端兜底：抬到水位之上。
    return finish(x, z, Math.max(sampler.waterLevel + 3, sampler.height(x, z) + 2.2));
  }

  private buildSamplerFor(world: WorldId): TerrainSampler {
    const sampler = new TerrainSampler(this.seedFor(world));
    sampler.setRugged(world === "mission");
    return sampler;
  }

  public defaultSpawn(world: WorldId): Vector3 {
    return this.findSafeSpawn(0, world === "home" ? -8 : -9, world);
  }

  public snapshotCollectedIds(): string[] {
    return [...this.collectedResourceIds];
  }

  public get stats(): { chunks: number; pending: number; instances: number; enemies: number; landmarks: number; pois: number } {
    return {
      chunks: this.chunks.size,
      pending: this.pendingChunks.length,
      instances: this.details.instanceCount,
      enemies: this.enemies.length,
      landmarks: this.landmarkMeshes.length,
      pois: this.pois.activeCount,
    };
  }

  public get performanceSnapshot(): {
    chunkLoadRadius: ChunkLoadRadius;
    targetChunks: number;
    loadedChunks: number;
    pendingChunks: number;
    instances: number;
    sceneMeshes: number;
    activeMeshes: number;
    shadowCasters: number;
    chunkBuildCount: number;
    chunkDisposeCount: number;
    lastChunkBuildMs: number;
    lastWindowRefreshMs: number;
  } {
    return {
      chunkLoadRadius: this.currentChunkLoadRadius,
      targetChunks: chunkWindowSize(this.currentChunkLoadRadius),
      loadedChunks: this.chunks.size,
      pendingChunks: this.pendingChunks.length,
      instances: this.details.instanceCount,
      sceneMeshes: this.scene.meshes.length,
      activeMeshes: this.scene.getActiveMeshes().length,
      shadowCasters: this.atmosphere.shadowStats.casterCount,
      chunkBuildCount: this.chunkBuildCount,
      chunkDisposeCount: this.chunkDisposeCount,
      lastChunkBuildMs: this.lastChunkBuildMs,
      lastWindowRefreshMs: this.lastWindowRefreshMs,
    };
  }

  public dispose(): void {
    this.clearWorld();
    this.water.dispose();
    this.roads.dispose();
    this.landmarks.dispose();
    this.pois.dispose();
    this.details.dispose();
    this.characterShowcase.dispose();
    this.atmosphere.dispose();
    this.assets.dispose();
  }

  /** ---------- chunk 构建 ---------- */

  private createChunk(cx: number, cz: number): void {
    const startedAt = this.now();
    const record: ChunkRecord = {
      meshes: [],
      interactionIds: [],
      damageableIds: [],
      landmarkCells: [],
      poiCells: [],
      enemyMeshes: [],
    };
    const key = this.chunkKey(cx, cz);
    const size = GAME_CONFIG.chunkSize;
    const centerX = chunkBounds(cx, size).center;
    const centerZ = chunkBounds(cz, size).center;
    const terrainGrid = buildTerrainGrid(this.sampler, centerX, centerZ, size);

    const ground = this.buildGroundMesh(cx, cz, terrainGrid);
    record.meshes.push(ground);
    this.chunks.set(key, record);

    // 水面 / 路面挂在 chunk 上，随 chunk 一起卸载。
    const waterMesh = this.water.build(terrainGrid);
    if (waterMesh) record.meshes.push(waterMesh);

    const roadMeshes = this.roads.build(this.sampler, centerX, centerZ, size);
    for (const road of roadMeshes) this.atmosphere.setShadowReceiver(road);
    record.meshes.push(...roadMeshes);

    this.attachPoiCells(cx, cz, record);

    // 出生点与地标附近保持净空：否则玩家可能一睁眼就卡在树冠里。
    this.details.build(this.sampler, key, centerX, centerZ, size, this.clearZones(centerX, centerZ, size));
    this.spawnResources(cx, cz, centerX, centerZ, size, record);
    if (this.currentWorld === "mission") this.maybeSpawnEnemy(cx, cz, centerX, centerZ, size, record);
    this.attachLandmarkCells(cx, cz, record);
    this.chunkBuildCount += 1;
    this.lastChunkBuildMs = this.now() - startedAt;
  }

  /** 收集落在本 chunk 内的净空圆（出生点、商店、传送门、地标基座）。 */
  private clearZones(centerX: number, centerZ: number, size: number): ClearZone[] {
    const half = size / 2;
    const zones: ClearZone[] = [];
    const maxDistance = half + 24;

    const consider = (x: number, z: number, radius: number): void => {
      if (Math.abs(x - centerX) > maxDistance || Math.abs(z - centerZ) > maxDistance) return;
      zones.push({ x, z, radius });
    };

    if (this.spawnAnchor) {
      consider(this.spawnAnchor.x, this.spawnAnchor.z, DETAIL_CONFIG.spawnClearance);
    }
    for (const point of this.poiAnchors) {
      consider(point.x, point.z, 12);
    }
    return zones;
  }

  /** 由 POI 中心所在 chunk 负责构建，避免跨 chunk 重复或提前销毁。 */
  private attachPoiCells(cx: number, cz: number, record: ChunkRecord): void {
    const size = GAME_CONFIG.chunkSize;
    const xBounds = chunkBounds(cx, size);
    const zBounds = chunkBounds(cz, size);
    const spacing = POI_CONFIG.cellSpacing;
    // Dock candidates may resolve to a nearby lake rather than remain inside
    // their source cell, so broaden the lookup before applying owner-chunk test.
    const margin = spacing * (POI_CONFIG.dockSearchRadius + 3);
    const minCellX = Math.floor((xBounds.min - margin) / spacing) - 1;
    const maxCellX = Math.floor((xBounds.max + margin) / spacing) + 1;
    const minCellZ = Math.floor((zBounds.min - margin) / spacing) - 1;
    const maxCellZ = Math.floor((zBounds.max + margin) / spacing) + 1;

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const placement = this.pois.placementFor(cellX, cellZ, this.sampler);
        if (!placement) continue;
        if (Math.floor(placement.x / size) !== cx || Math.floor(placement.z / size) !== cz) continue;
        const mesh = this.pois.buildForCell(cellX, cellZ, this.sampler);
        if (!mesh) continue;
        this.atmosphere.addShadowCaster(mesh, true);
        record.meshes.push(mesh);
        record.poiCells.push(`${cellX}:${cellZ}`);
        this.poiAnchors.push({ x: placement.x, z: placement.z });
      }
    }
  }

  /**
   * 地面网格：用 TerrainSampler 抬升顶点，并把地表颜色写进顶点色。
   * 顶点色代替贴图 —— 低模卡通风格下这是性价比最高的做法。
   */
  private buildGroundMesh(cx: number, cz: number, grid: TerrainGrid): BabylonMesh {
    const ground = MeshBuilder.CreateGround(
      `ground-${this.currentWorld}-${cx}-${cz}`,
      { width: grid.size, height: grid.size, subdivisions: grid.subdivisions, updatable: true },
      this.scene,
    );
    ground.position.set(grid.centerX, 0, grid.centerZ);
    ground.checkCollisions = true;
    ground.material = this.getGroundMaterial();
    // 必须可拾取：PlayerController 用一条向下的射线判断"是否站在地面上"。
    ground.isPickable = true;

    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    const indices = ground.getIndices();
    if (!positions || !indices) throw new Error("Failed to build terrain chunk vertices.");

    const colors = new Float32Array((positions.length / 3) * 4);
    for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
      const vertex = grid.vertices[i / 3];
      positions[i] = vertex.x - grid.centerX;
      positions[i + 1] = vertex.height;
      positions[i + 2] = vertex.z - grid.centerZ;

      // 顶点色代替贴图：湿度/岩地遮罩随高程一起决定地表颜色。
      const [r, g, b] = this.sampler.surfaceColor(
        vertex.height,
        {
          moisture: vertex.moisture,
          rockiness: vertex.rockiness,
          waterDepth: vertex.waterDepth,
          onRoad: vertex.onRoad,
          zone: vertex.zone,
        },
        vertex.x,
        vertex.z,
      );
      colors[c] = r;
      colors[c + 1] = g;
      colors[c + 2] = b;
      colors[c + 3] = 1;
    }

    const flat = expandIndexedTrianglesToFlat(positions, indices);
    const flatColors = new Float32Array((flat.positions.length / 3) * 4);
    for (let i = 0; i < indices.length; i += 1) {
      const originalVertex = indices[i];
      const sourceColor = originalVertex * 4;
      const targetColor = i * 4;
      flatColors[targetColor] = colors[sourceColor];
      flatColors[targetColor + 1] = colors[sourceColor + 1];
      flatColors[targetColor + 2] = colors[sourceColor + 2];
      flatColors[targetColor + 3] = colors[sourceColor + 3];
    }

    // 展开索引后三个顶点只属于一个三角形，每个面拥有真正独立的法线。
    ground.setVerticesData(VertexBuffer.PositionKind, new Float32Array(flat.positions), false, 3);
    ground.setVerticesData(VertexBuffer.NormalKind, new Float32Array(flat.normals), false, 3);
    ground.setVerticesData(VertexBuffer.ColorKind, flatColors, false, 4);
    ground.setIndices(flat.indices, null, false);
    ground.refreshBoundingInfo();
    this.atmosphere.setShadowReceiver(ground);
    return ground;
  }

  /** ---------- 资源与敌人 ---------- */

  private spawnResources(cx: number, cz: number, centerX: number, centerZ: number, size: number, record: ChunkRecord): void {
    // 种子只依赖 chunk 坐标：即使之后调整生成算法，资源 id 也不会漂移，
    // 老存档里"已采集"的记录依然对得上。
    const rng = mulberry32(hashInts(cx, cz, this.seedFor(this.currentWorld) + 11_000));
    const count = 4 + Math.floor(rng() * 4);
    let placed = 0;

    for (let i = 0; i < count; i += 1) {
      const id = `${this.currentWorld}:${cx}:${cz}:resource:${i}`;
      // 先消耗随机数，保证同一 id 的位置永远一致（与是否已采集无关）。
      const ox = (rng() - 0.5) * (size - 8);
      const oz = (rng() - 0.5) * (size - 8);
      const roll = rng();

      if (this.collectedResourceIds.has(id)) continue;

      const x = centerX + ox;
      const z = centerZ + oz;
      const densityRoll = (hashInts(cx * 31 + i, cz * 17 - i, this.seedFor(this.currentWorld) + 11_009) >>> 0) / 0x1_0000_0000;
      if (densityRoll > rhythmAt(x, z, this.seedFor(this.currentWorld)).resourceDensity) continue;
      const sample = this.sampler.sample(x, z);
      // 水里、路面、陡坡上不放资源。
      if (sample.waterDepth > 0.05) continue;
      if (sample.roadDistance < 4.5) continue;

      let item: ItemId;
      if (this.currentWorld === "mission" && roll > 0.92) item = "relic";
      else if (roll > 0.73) item = "scrap";
      else if (sample.biome === "rocky" || sample.biome === "mountain" || roll > 0.48) item = "stone";
      else item = "wood";

      const mesh = this.createResourceMesh(item, new Vector3(x, sample.height, z), hashInts(cx, i, cz));
      this.atmosphere.addShadowCaster(mesh, true);
      record.meshes.push(mesh);
      record.interactionIds.push(id);
      placed += 1;

      this.interactions.register({
        id,
        mesh,
        label: `收集 ${this.itemName(item)}`,
        onInteract: () => {
          if (this.collectedResourceIds.has(id)) return;
          this.collectedResourceIds.add(id);
          this.callbacks.onCollect(item, 1);
          this.callbacks.onToast(`获得：${this.itemName(item)} ×1`);
          this.interactions.unregister(id);
          const assetSlot = mesh.metadata?.assetSlot as { dispose: () => void } | undefined;
          assetSlot?.dispose();
          mesh.dispose(false, false);
        },
      });
    }

    void placed;
  }

  private maybeSpawnEnemy(
    cx: number,
    cz: number,
    centerX: number,
    centerZ: number,
    size: number,
    record: ChunkRecord,
  ): void {
    if (cx === 0 && cz === 0) return;
    const rng = mulberry32(hashInts(cx, cz, this.seedFor("mission") + 90_000));
    if (rng() > 0.28) return;

    const x = centerX + (rng() - 0.5) * (size - 14);
    const z = centerZ + (rng() - 0.5) * (size - 14);
    const sample = this.sampler.sample(x, z);
    if (sample.waterDepth > 0.1) return;

    const enemy = MeshBuilder.CreateCapsule(
      `enemy-${cx}-${cz}`,
      { height: 1.8, radius: 0.45, tessellation: 8 },
      this.scene,
    );
    enemy.position.set(x, sample.height + 0.9, z);
    enemy.material = this.getMaterial("enemy", "#b94b45");
    enemy.isPickable = false;
    record.meshes.push(enemy);
    record.enemyMeshes.push(enemy);

    const id = `enemy:${cx}:${cz}`;
    record.damageableIds.push(id);
    const enemyRecord: EnemyRecord = { id, mesh: enemy, hp: 3 };
    this.enemies.push(enemyRecord);

    this.combat.register({
      id,
      mesh: enemy,
      health: enemyRecord.hp,
      position: () => enemy.getAbsolutePosition(),
      onDamage: (amount) => {
        if (enemy.isDisposed()) return;
        enemyRecord.hp -= amount;
        enemy.scaling.setAll(Math.max(0.78, 1 - (3 - enemyRecord.hp) * 0.06));
        if (enemyRecord.hp <= 0) {
          this.combat.unregister(id);
          this.removeEnemy(enemyRecord);
          this.callbacks.onCollect("scrap", 2);
          this.callbacks.onToast("击倒敌人：废料 ×2");
          enemy.dispose(false, false);
        } else {
          this.callbacks.onToast(`命中敌人 · HP ${enemyRecord.hp}/3`);
        }
      },
    });

    enemy.metadata = { prototypeEnemy: true };
    this.atmosphere.addShadowCaster(enemy, true);
  }

  private removeEnemy(record: EnemyRecord): void {
    const index = this.enemies.indexOf(record);
    if (index >= 0) this.enemies.splice(index, 1);
  }

  /** 敌人 AI：追击玩家、避水、贴地。 */
  private updateEnemies(): void {
    if (this.currentWorld !== "mission" || this.enemies.length === 0) return;
    const player = this.camera.position;

    for (const enemy of this.enemies) {
      const mesh = enemy.mesh;
      if (mesh.isDisposed()) continue;
      const delta = player.subtract(mesh.position);
      const horizontal = new Vector3(delta.x, 0, delta.z);
      const distance = horizontal.length();
      // 追击范围：太近停下（避免贴脸），太远放弃（节省计算）。
      if (distance < 2 || distance > 16) continue;
      horizontal.normalize();

      const nextX = mesh.position.x + horizontal.x * 0.022;
      const nextZ = mesh.position.z + horizontal.z * 0.022;
      const nextSample = this.sampler.sample(nextX, nextZ);
      if (nextSample.waterDepth > 0.6) continue;

      mesh.position.x = nextX;
      mesh.position.z = nextZ;
      mesh.position.y = nextSample.height + 0.9;
      mesh.rotation.y = Math.atan2(horizontal.x, horizontal.z);
    }
  }

  /** ---------- 地标归属 ---------- */

  /**
   * 地标归属。
   *
   * 地标格点间距（384m）远大于 chunk（64m），一个地标可能横跨多个 chunk、
   * 也可能中心落在还没加载的区域。归属规则：由「地标中心所在的那个 chunk」
   * 负责构建。于是：
   *   - 不会重复构建（只有owner会建）
   *   - 不会因为邻居 chunk 卸载而消失（销毁也由 owner 负责）
   *   - 地标比 chunk 加载范围大得多，所以玩家能看到远处的高塔轮廓
   */
  private attachLandmarkCells(cx: number, cz: number, record: ChunkRecord): void {
    const size = GAME_CONFIG.chunkSize;
    const spacing = LANDMARK_CONFIG.spacing;
    const centerX = chunkBounds(cx, size).center;
    const centerZ = chunkBounds(cz, size).center;

    const minCellX = Math.floor((centerX - size / 2) / spacing) - 1;
    const maxCellX = Math.floor((centerX + size / 2) / spacing) + 1;
    const minCellZ = Math.floor((centerZ - size / 2) / spacing) - 1;
    const maxCellZ = Math.floor((centerZ + size / 2) / spacing) + 1;

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const placement = this.landmarks.placementFor(cellX, cellZ, this.sampler);
        if (!placement) continue;
        // 只有中心落在本 chunk 的地标才由本 chunk 负责。
        if (Math.floor(placement.x / size) !== cx || Math.floor(placement.z / size) !== cz) continue;

        const mesh = this.landmarks.buildForCell(cellX, cellZ, this.sampler);
        if (!mesh) continue;
        this.atmosphere.addShadowCaster(mesh, true);
        record.meshes.push(mesh);
        record.landmarkCells.push(`${cellX}:${cellZ}`);
        this.landmarkMeshes.push(mesh);
      }
    }
  }

  /** ---------- POI（商店 / 传送门） ---------- */

  private createWorldPois(world: WorldId): void {
    if (world === "home") {
      this.createShopLandmark();
      this.createPortalLandmark("home-to-mission", 8, 0, "进入任务世界", () => this.callbacks.onTravelRequest("mission"));
    } else {
      this.createPortalLandmark("mission-to-home", 0, 0, "撤离并返回主世界", () => this.callbacks.onTravelRequest("home"));
    }
  }

  private createShopLandmark(): void {
    const x = -7;
    const z = 0;
    const spawn = this.findSafeSpawn(x, z);
    this.poiAnchors.push({ x: spawn.x, z: spawn.z });
    const shop = MeshBuilder.CreateBox("shop-terminal", { width: 2.6, height: 2.4, depth: 1.6 }, this.scene);
    shop.position.set(spawn.x, spawn.y - 1.1, spawn.z);
    shop.material = this.getMaterial("shop", "#2f7466", "#173f37");
    shop.isPickable = false;
    this.atmosphere.addShadowCaster(shop, true);
    this.landmarkMeshes.push(shop);
    this.landmarkInteractionIds.push("landmark:shop");

    this.interactions.register({
      id: "landmark:shop",
      mesh: shop,
      label: "出售背包内全部资源",
      range: 3.8,
      onInteract: this.callbacks.onSellRequest,
    });
  }

  private createPortalLandmark(id: string, x: number, z: number, label: string, onInteract: () => void): void {
    const spawn = this.findSafeSpawn(x, z);
    this.poiAnchors.push({ x: spawn.x, z: spawn.z });
    const portal = MeshBuilder.CreateTorus(id, { diameter: 3.6, thickness: 0.3, tessellation: 20 }, this.scene);
    portal.position.set(spawn.x, spawn.y + 0.6, spawn.z);
    portal.rotation.x = Math.PI / 2;
    portal.material = this.getMaterial(
      `portal-${this.currentWorld}`,
      this.currentWorld === "home" ? "#46b9d6" : "#e3a44d",
      this.currentWorld === "home" ? "#0b586f" : "#7c4b0d",
    );
    portal.isPickable = false;
    this.atmosphere.addShadowCaster(portal, true);
    this.landmarkMeshes.push(portal);
    const interactionId = `landmark:${id}`;
    this.landmarkInteractionIds.push(interactionId);
    this.interactions.register({ id: interactionId, mesh: portal, label, range: 4.5, onInteract });
  }

  /** ---------- 资源网格 ---------- */

  private createResourceMesh(item: ItemId, position: Vector3, variantSeed: number): Mesh {
    if (item === "relic") {
      const relic = MeshBuilder.CreatePolyhedron("relic", { type: 0, size: 0.65 }, this.scene);
      relic.position.copyFrom(position).addInPlaceFromFloats(0, 0.75, 0);
      relic.material = this.getMaterial("relic", "#d9bf59", "#8b6e13");
      return relic;
    }

    const kind: ResourceVisualKind = item === "wood" ? "wood" : item === "stone" ? "stone" : "scrap";
    const visual = selectResourceVisual(kind, variantSeed);
    const root = new Mesh(`resource-${kind}-${variantSeed}`, this.scene);
    root.position.copyFrom(position);
    root.isPickable = false;
    root.checkCollisions = false;
    root.metadata = { resourceVisual: visual };
    const fallback = new TransformNode(`resource-fallback-${kind}-${variantSeed}`, this.scene);
    fallback.parent = root;

    if (kind === "wood") {
      const firstLog = this.resourceCylinder(fallback, "wood-log-a", 2.2, 0.42, new Vector3(-0.38, 0.34, 0), "wood", Math.PI / 2);
      firstLog.rotation.y = 0.12;
      const secondLog = this.resourceCylinder(fallback, "wood-log-b", 1.7, 0.36, new Vector3(0.35, 0.3, 0.18), "wood", Math.PI / 2);
      secondLog.rotation.y = -0.18;
      this.resourceCylinder(fallback, "wood-stump", 0.55, 0.58, new Vector3(0.05, 0.3, -0.28), "woodLight");
      this.resourceBox(fallback, "wood-block", 0.72, 0.42, 0.62, new Vector3(0.05, 0.82, 0.1), "woodLight");
    } else if (kind === "stone") {
      const mother = this.resourcePoly(fallback, "stone-mother", 1, 0.95, new Vector3(0, 0.55, 0), "stone");
      mother.scaling.y = 0.78;
      const stoneA = this.resourcePoly(fallback, "stone-cluster-a", 1, 0.64, new Vector3(-0.58, 0.34, 0.18), "stone");
      stoneA.scaling.y = 0.72;
      const stoneB = this.resourcePoly(fallback, "stone-cluster-b", 1, 0.52, new Vector3(0.56, 0.28, -0.15), "stone");
      stoneB.scaling.y = 0.68;
    } else {
      this.resourceBox(fallback, "scrap-iron-plate", 1.0, 0.18, 0.72, new Vector3(-0.28, 0.12, 0.14), "metal");
      this.resourceCylinder(fallback, "scrap-pipe", 0.22, 0.95, new Vector3(0.35, 0.3, -0.16), "rust", Math.PI / 2);
      const gear = this.resourcePoly(fallback, "scrap-gear", 1, 0.36, new Vector3(0.42, 0.24, 0.36), "metal");
      gear.rotation.z = Math.PI / 2;
      this.resourceCylinder(fallback, "scrap-damaged-can", 0.5, 0.5, new Vector3(-0.18, 0.38, -0.3), "scrap");
    }

    const slot = this.assets.createSlot(visual.profile.assetId, variantSeed, [], { parent: root, fallbackOwner: fallback });
    slot.root.scaling.setAll(slot.selection.variant.nominalScale);
    root.metadata = { ...root.metadata, assetSlot: slot, assetSelection: slot.selection, visualVariant: visual.variantId };
    this.atmosphere.addShadowCaster(root, true);
    return root;
  }

  private resourceBox(parent: TransformNode, name: string, width: number, height: number, depth: number, position: Vector3, materialKey: string): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = parent;
    mesh.position.copyFrom(position);
    mesh.material = this.getMaterial(materialKey, materialKey === "metal" ? "#68777a" : materialKey === "rust" ? "#9a5f47" : "#a9774c");
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  }

  private resourceCylinder(parent: TransformNode, name: string, height: number, diameter: number, position: Vector3, materialKey: string, rotationZ = 0): Mesh {
    const mesh = MeshBuilder.CreateCylinder(name, { height, diameter, tessellation: 6 }, this.scene);
    mesh.parent = parent;
    mesh.position.copyFrom(position);
    mesh.rotation.z = rotationZ;
    mesh.material = this.getMaterial(materialKey, materialKey === "rust" ? "#9a5f47" : materialKey === "woodLight" ? "#a9774c" : "#8e623f");
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  }

  private resourcePoly(parent: TransformNode, name: string, type: number, size: number, position: Vector3, materialKey: string): Mesh {
    const mesh = MeshBuilder.CreatePolyhedron(name, { type, size }, this.scene);
    mesh.parent = parent;
    mesh.position.copyFrom(position);
    mesh.material = this.getMaterial(materialKey, materialKey === "metal" ? "#68777a" : "#7d8587");
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  }

  /** ---------- 材质 ---------- */

  private getGroundMaterial(): StandardMaterial {
    return this.getMaterial("terrain", "#ffffff", undefined, (material) => {
      // 地面靠 mesh 上的顶点色上色（StandardMaterial 会自动使用），材质保持中性白。
      material.specularColor = new Color3(0.02, 0.02, 0.02);
    });
  }

  private getMaterial(
    key: string,
    diffuseHex: string,
    emissiveHex?: string,
    configure?: (material: StandardMaterial) => void,
  ): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new StandardMaterial(key, this.scene);
    material.diffuseColor = Color3.FromHexString(diffuseHex);
    material.specularColor = new Color3(0.06, 0.06, 0.06);
    if (emissiveHex) material.emissiveColor = Color3.FromHexString(emissiveHex);
    configure?.(material);
    this.materials.set(key, material);
    return material;
  }

  /** ---------- 卸载 ---------- */

  private disposeChunk(key: string, record: ChunkRecord): void {
    for (const id of record.interactionIds) this.interactions.unregister(id);
    for (const id of record.damageableIds) this.combat.unregister(id);
    for (const mesh of record.enemyMeshes) {
      const index = this.enemies.findIndex((enemy) => enemy.mesh === mesh);
      if (index >= 0) this.enemies.splice(index, 1);
    }
    for (const mesh of record.meshes) {
      this.atmosphere.removeShadowCaster(mesh, true);
      if (!mesh.isDisposed()) mesh.dispose(false, false);
    }
    for (const cell of record.landmarkCells) {
      this.landmarks.disposeCell(...(cell.split(":").map(Number) as [number, number]));
    }
    for (const cell of record.poiCells) {
      this.pois.disposeCell(...(cell.split(":").map(Number) as [number, number]));
    }
    this.details.disposeChunk(key);
    this.chunks.delete(key);
    this.chunkDisposeCount += 1;
  }

  private clearWorld(): void {
    for (const [key, record] of [...this.chunks]) this.disposeChunk(key, record);
    for (const id of this.landmarkInteractionIds) this.interactions.unregister(id);
    for (const mesh of this.landmarkMeshes) {
      this.atmosphere.removeShadowCaster(mesh, true);
      if (!mesh.isDisposed()) mesh.dispose(false, false);
    }
    this.landmarkInteractionIds.length = 0;
    this.landmarkMeshes.length = 0;
    this.poiAnchors.length = 0;
    this.spawnAnchor = null;
    this.enemies.length = 0;
    this.pendingChunks.length = 0;
    this.pendingChunkKeys.clear();
    this.landmarks.disposeAll();
    this.pois.disposeAll();
    this.details.disposeAll();
    const showcase = this.characterShowcase.active;
    if (showcase) this.atmosphere.removeShadowCaster(showcase.root, true);
    this.characterShowcase.clear();
    this.lastCenterChunk = "";
  }

  private chunkKey(cx: number, cz: number): string {
    return `${this.currentWorld}:${cx}:${cz}`;
  }

  private seedFor(world: WorldId): number {
    return world === "home" ? GAME_CONFIG.seeds.home : GAME_CONFIG.seeds.mission;
  }

  private createDetailLayer(seed: number): DetailLayer {
    return new DetailLayer(this.scene, seed, (mesh, enabled) => {
      if (enabled) this.atmosphere.addShadowCaster(mesh, false);
      else this.atmosphere.removeShadowCaster(mesh, false);
    }, this.assets);
  }

  private itemName(item: ItemId): string {
    return { wood: "木材", stone: "石料", scrap: "废料", relic: "遗物" }[item];
  }

  private now(): number {
    return globalThis.performance?.now?.() ?? Date.now();
  }
}
