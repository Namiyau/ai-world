import { TERRAIN_CONFIG, ROAD_CONFIG, WATER_CONFIG } from "../config";
import { hashInts, mulberry32 } from "../utils/random";
import { clamp01, fractalNoise2D, lerpValue, ridgedNoise2D, smoothstep, smootherstep, valueNoise2D } from "./noise";

/**
 * 地表分类。用于「能不能走 / 要不要减速 / 该刷什么物件 / 该给什么颜色」。
 */
export type SurfaceKind =
  | "deepWater"
  | "shallowWater"
  | "shore"
  | "road"
  | "grass"
  | "forest"
  | "rock"
  | "mountain";

export type BiomeId = "grass" | "forest" | "rocky" | "mountain";
export type TerrainZone = "grassland" | "forestFloor" | "mudflat" | "gravel" | "shore";

export interface TerrainSample {
  /** 最终地表高度（已包含水体下挖与道路压平）。 */
  height: number;
  /**
   * 该点的水面高度；无水时等于地表高度。
   * Update 1.1 只保留湖泊，全局水位由 WATER_CONFIG.level 决定。
   */
  waterLevel: number;
  /** 水深（米），0 表示无水。 */
  waterDepth: number;
  /** 水体覆盖度 0~1，用于水面淡出。 */
  waterCoverage: number;
  /** 是否属于一个通过岸环验证的湖盆。 */
  lakeMask: boolean;
  /** 最终地形是否低于固定湖面；道路抬高后这里可以为 false。 */
  hasWater: boolean;
  /** 到最近道路中心线的距离；无路时为一个很大的值。 */
  roadDistance: number;
  /** 道路压平权重 0~1。 */
  roadInfluence: number;
  /** 是否是路面（roadInfluence 超过阈值）。 */
  onRoad: boolean;
  /** 湿度与岩地遮罩，调色时直接复用，避免重复采样。 */
  moisture: number;
  rockiness: number;
  biome: BiomeId;
  zone: TerrainZone;
  surface: SurfaceKind;
}

export interface TerrainColorContext {
  moisture: number;
  rockiness: number;
  waterDepth: number;
  onRoad: boolean;
  zone: TerrainZone;
}

interface BaseElevation {
  /** 基础地表高程（未做湖泊下挖，未做道路压平）。 */
  base: number;
  moisture: number;
  rockiness: number;
}

interface WaterField {
  /** 湖泊下挖深度。 */
  lakeDepth: number;
  /** 是否落在通过岸环验证的湖盆 profile 内。 */
  lakeMask: boolean;
  /** 该点的湖面高度。 */
  surface: number;
}

interface RoadField {
  distance: number;
  influence: number;
  /** 道路中心线处的地表高程（已对水体下挖做衰减，保证路不会被淹）。 */
  spineElevation: number;
}

/** 湖泊格点抖动后的单个湖泊。 */
export interface LakeCandidate {
  x: number;
  z: number;
  radius: number;
  depth: number;
  minRimHeight: number;
  shoreSamples: number;
}

type LakeInfo = LakeCandidate;

/** 道路基线取样用的单点缓存。 */
type CachedBase = (x: number, z: number) => BaseElevation;

const FAR_AWAY = 1e6;

/** 湖泊水面 = 全局水位。 */
const WATER_LEVEL = WATER_CONFIG.level;
const LAKE_DEPTH_EPSILON = 1e-6;

/**
 * 世界生成的唯一权威采样器。
 *
 * 分层顺序（后面的层依赖前面的层，但不回头修改）：
 *   1. 基础高程   baseOffset + continent + hills + mountains(mask) + detail
 *   2. 湿度 / 岩地遮罩
   *   3. 水体       湖泊下挖
 *   4. 道路       压平到道路基线高程
 *   5. 水面       在「压平后的地表」之上结算，因此水面永远贴着地面
 *
 * 所有函数都是 (x, z) 的纯函数，所以：
 *   - chunk 之间天然无缝（共享顶点由同一函数计算）
 *   - 玩家走多远都不会累积误差
 *   - 卸载再加载完全一致，不需要持久化地形
 */
export class TerrainSampler {
  /**
   * 世界种子。传入不同种子即可得到完全不同的世界，
   * 但主世界 / 任务世界共用同一套生成规则。
   */
  public constructor(private readonly seed: number) {}

  /** 是否使用「更凶险」的地貌参数（任务世界用）。 */
  private rugged = false;
  private readonly lakeCache = new Map<string, LakeInfo | null>();

  public setRugged(rugged: boolean): void {
    if (this.rugged === rugged) return;
    this.rugged = rugged;
    this.lakeCache.clear();
  }

  /** ---------- 对外：单点完整采样 ---------- */
  public sample(x: number, z: number): TerrainSample {
    const baseAt = this.memoizedBase();
    const base = baseAt(x, z);

    const water = this.waterField(x, z, base);
    const carved = this.carvedHeight(base, water);
    const road = this.roadField(x, z, baseAt);
    const height = this.applyRoad(base, carved, water, road);

    // 水体判定：水位由「河床 / 湖盆」推出，所以只要最终地表还在水面之下，
    // 这里就真的有水。若地表被垫到了水面之上（例如道路把这一段抬高），
    // 就判定为无水 —— 而不是把水位夹到地表高度，那样会把水深抹成 0
    // 并留下一块贴在地面上的假水面。
    const hasWater = water.lakeMask && height < water.surface;
    const resolvedSurface = hasWater ? water.surface : height;
    const waterDepth = hasWater ? Math.max(0, water.surface - height) : 0;
    const cover = hasWater ? this.waterCoverage(waterDepth) : 0;
    const onRoad = road.influence > 0.5 && waterDepth < 0.25;

    const biome = this.biomeFor(base.moisture, base.rockiness);
    const surface = this.surfaceFor(height, waterDepth, onRoad, biome, resolvedSurface);
    const zone = this.zoneFor(height, waterDepth, onRoad, biome, base.moisture, base.rockiness, water.surface);

    return {
      height,
      waterLevel: resolvedSurface,
      waterDepth,
      waterCoverage: cover,
      lakeMask: water.lakeMask,
      hasWater,
      roadDistance: road.distance,
      roadInfluence: road.influence,
      onRoad,
      moisture: base.moisture,
      rockiness: base.rockiness,
      biome,
      zone,
      surface,
    };
  }

  /** 只要高度时走这条捷径，避免构造整个 TerrainSample 对象。 */
  public height(x: number, z: number): number {
    const baseAt = this.memoizedBase();
    const base = baseAt(x, z);
    const water = this.waterField(x, z, base);
    const carved = this.carvedHeight(base, water);
    const road = this.roadField(x, z, baseAt);
    return this.applyRoad(base, carved, water, road);
  }

  public biomeAt(x: number, z: number): BiomeId {
    const base = this.baseElevation(x, z);
    return this.biomeFor(base.moisture, base.rockiness);
  }

  public colorContext(x: number, z: number): TerrainColorContext {
    const baseAt = this.memoizedBase();
    const base = baseAt(x, z);
    const water = this.waterField(x, z, base);
    const carved = this.carvedHeight(base, water);
    const road = this.roadField(x, z, baseAt);
    const height = this.applyRoad(base, carved, water, road);
    const hasWater = water.lakeMask && height < water.surface;
    const waterDepth = hasWater ? Math.max(0, water.surface - height) : 0;
    const onRoad = road.influence > 0.5 && waterDepth < 0.25;
    const biome = this.biomeFor(base.moisture, base.rockiness);
    return {
      moisture: base.moisture,
      rockiness: base.rockiness,
      waterDepth,
      onRoad,
      zone: this.zoneFor(height, waterDepth, onRoad, biome, base.moisture, base.rockiness, water.surface),
    };
  }

  /** 全局水位（湖泊水面高度）。 */
  public get waterLevel(): number {
    return WATER_LEVEL;
  }

  /** 是否处于湖面之下。 */
  public isSubmerged(x: number, z: number, eyeY: number): boolean {
    const sample = this.sample(x, z);
    return sample.waterDepth > 0.05 && eyeY < sample.waterLevel - 0.05;
  }

  /**
   * 求给定点最近的「道路基线点」。
   *
   * 路网是格线状的：纵向路满足 x = band * spacing + wind(z)，
   * 所以把 (x, z) 投影回中心线只需要把 x 换成算出来的 centerX，z 保持不变
   * —— 结果一定落在真正的中心线上，可以直接当作路面 ribbon 的采样点。
   */
  public nearestRoadSpine(x: number, z: number): {
    x: number;
    z: number;
    distance: number;
    direction: "vertical" | "horizontal";
  } {
    const cfg = ROAD_CONFIG;
    let best = { x, z, distance: FAR_AWAY, direction: "vertical" as "vertical" | "horizontal" };

    const xBand = Math.floor(x / cfg.spacing);
    for (let i = -1; i <= 1; i += 1) {
      const band = xBand + i;
      if (!this.roadLineExists(band)) continue;
      const centerX = band * cfg.spacing + this.roadWind(z, band);
      const distance = Math.abs(x - centerX);
      if (distance < best.distance) best = { x: centerX, z, distance, direction: "vertical" };
    }

    const zBand = Math.floor(z / cfg.spacing);
    for (let i = -1; i <= 1; i += 1) {
      const band = zBand + i;
      if (!this.roadLineExists(band + 1_700_000)) continue;
      const centerZ = band * cfg.spacing + this.roadWind(x, band + 3_000_000);
      const distance = Math.abs(z - centerZ);
      if (distance < best.distance) best = { x, z: centerZ, distance, direction: "horizontal" };
    }

    return best;
  }

  /** 道路中心线处的地表高程（已对水体下挖做衰减，因此路面上不会积水）。 */
  public roadElevation(x: number, z: number): number {
    const base = this.baseElevation(x, z);
    const water = this.waterField(x, z, base);
    const damped = water.lakeDepth * 0.35;
    return base.base - damped;
  }

  /** 道路存在性查询（路面 ribbon 需要知道某条格线上到底有没有路）。 */
  public roadLineAt(band: number, axis: "vertical" | "horizontal"): boolean {
    return this.roadLineExists(axis === "vertical" ? band : band + 1_700_000);
  }

  /** 道路中心线方程：纵向路返回 x（z 为自变量），横向路返回 z（x 为自变量）。 */
  public roadSpineCoordinate(band: number, axis: "vertical" | "horizontal", coordinate: number): number {
    return axis === "vertical"
      ? band * ROAD_CONFIG.spacing + this.roadWind(coordinate, band)
      : band * ROAD_CONFIG.spacing + this.roadWind(coordinate, band + 3_000_000);
  }

  /**
   * 地表顶点颜色（低模卡通的关键：用顶点色代替贴图）。
   * 输入湿度 / 岩地遮罩 / 高程，输出统一的调色板颜色。
   */
  public surfaceColor(height: number, ctx: TerrainColorContext, x: number, z: number): [number, number, number] {
    const palette = this.paletteFor(ctx.rockiness, ctx.moisture);
    const shade = this.macroShade(x, z);
    const grain = this.detailGrain(x, z);

    let r = palette[0];
    let g = palette[1];
    let b = palette[2];

    const zonePalette: Record<TerrainZone, [number, number, number]> = {
      grassland: [0.52, 0.69, 0.38],
      forestFloor: [0.28, 0.39, 0.27],
      mudflat: [0.42, 0.36, 0.28],
      gravel: [0.48, 0.47, 0.43],
      shore: [0.49, 0.61, 0.42],
    };
    const zoneColor = zonePalette[ctx.zone];
    const zoneMix = ctx.zone === "grassland" ? 0.35 : 0.62;
    r = lerpValue(r, zoneColor[0], zoneMix);
    g = lerpValue(g, zoneColor[1], zoneMix);
    b = lerpValue(b, zoneColor[2], zoneMix);

    // 大尺度色斑：避免大片同色地面看起来像塑料。
    r *= shade;
    g *= shade;
    b *= shade;

    // 细颗粒：草地的明暗斑点。
    const grainAmount = 0.06 * (1 - ctx.rockiness);
    r += (grain - 0.5) * grainAmount;
    g += (grain - 0.5) * grainAmount;
    b += (grain - 0.5) * grainAmount * 0.6;

    // 高处岩石偏灰亮，低处偏暗。
    const heightTint = clamp01((height + 6) / 42);
    r += heightTint * 0.06;
    g += heightTint * 0.055;
    b += heightTint * 0.05;

    // 水下地表压暗，避免水看起来"半透明地浮在亮地上"。
    // 压暗幅度刻意收敛：水本身已经不透明，地表只是透出一点轮廓。
    if (ctx.waterDepth > 0.05) {
      const submerged = clamp01(ctx.waterDepth / 3.2);
      const dark = 1 - submerged * 0.3;
      r *= dark;
      g *= dark;
      b *= dark * 1.05;
    }

    // 路肩压灰：让路面 ribbon 的边缘不出现亮绿描边。
    if (ctx.onRoad) {
      const t = 0.55;
      r = lerpValue(r, 0.44, t);
      g = lerpValue(g, 0.39, t);
      b = lerpValue(b, 0.32, t);
    }

    return [clamp01(r), clamp01(g), clamp01(b)];
  }

  /** 水体颜色：浅水偏青绿，深水偏深蓝。 */
  public waterColor(depth: number): [number, number, number] {
    const t = clamp01(depth / 5);
    const shallow: [number, number, number] = [0.22, 0.5, 0.57];
    const deep: [number, number, number] = [0.045, 0.19, 0.34];
    return [
      lerpValue(shallow[0], deep[0], t),
      lerpValue(shallow[1], deep[1], t),
      lerpValue(shallow[2], deep[2], t),
    ];
  }

  /** ---------- 1. 基础高程 ---------- */
  private baseElevation(x: number, z: number): BaseElevation {
    const seed = this.seed;
    const continentCfg = TERRAIN_CONFIG.continent;
    const hillCfg = TERRAIN_CONFIG.hills;
    const mountainCfg = TERRAIN_CONFIG.mountains;
    const detailCfg = TERRAIN_CONFIG.detail;

    // 大陆层：噪声 0~1 → -1~1，决定"这一带整体是高地还是洼地"。
    const continent =
      (fractalNoise2D(x / continentCfg.scale, z / continentCfg.scale, seed, continentCfg.octaves) * 2 - 1) *
      continentCfg.amplitude;

    // 丘陵层：地貌起伏的主力。
    const hills =
      (fractalNoise2D(x / hillCfg.scale, z / hillCfg.scale, seed + 5077, hillCfg.octaves) * 2 - 1) * hillCfg.amplitude;

    // 山脉遮罩：只在少数区域出现山，且用 ridged noise 造出山脊。
    const mountainMask = clamp01(
      (fractalNoise2D(x / mountainCfg.maskScale, z / mountainCfg.maskScale, seed + 20443, 2) - 0.5) * 2.6,
    );
    const ridge = ridgedNoise2D(x / mountainCfg.scale, z / mountainCfg.scale, seed + 9011, mountainCfg.octaves);
    const mountains = ridge * mountainMask * mountainCfg.amplitude * (this.rugged ? 1.25 : 1);

    // 细节层：小尺度不平整，避免地面像塑料板。
    const detail =
      (valueNoise2D(x / detailCfg.scale, z / detailCfg.scale, seed + 13337) - 0.5) * detailCfg.octaves * detailCfg.amplitude;

    const elevationScale = this.rugged ? 1.18 : 1;
    // baseOffset 决定"平均地面相对水位的高度"：
    // 它让低洼处低于水位形成湖泊，高处堆成丘陵与山地。
    let base = TERRAIN_CONFIG.baseOffset + (continent + hills) * elevationScale + mountains + detail;

    // 软夹取：超出范围时用对数压缩，避免出现平台状的高原。
    base = this.softClamp(base, TERRAIN_CONFIG.minHeight, TERRAIN_CONFIG.maxHeight);

    const moistureCfg = TERRAIN_CONFIG.moisture;
    const moisture = clamp01(
      (fractalNoise2D(x / moistureCfg.scale, z / moistureCfg.scale, seed + 6101, moistureCfg.octaves) - 0.5) * 2.2 + 0.5,
    );

    // 岩地遮罩：高程 + 独立噪声。高程权重刻意压低 ——
    // 否则整片丘陵都会被判成岩地，画面变成一大块灰褐色。
    const rockNoise = fractalNoise2D(x / 520, z / 520, seed + 31337, 2);
    const rockiness = clamp01(
      smoothstep(TERRAIN_CONFIG.rockStart, TERRAIN_CONFIG.rockFull, rockNoise * 0.72 + clamp01((base - 6) / 34) * 0.33),
    );

    return { base, moisture, rockiness };
  }

  private softClamp(value: number, min: number, max: number): number {
    if (value < min) return min - Math.log1p(min - value) * 2.2;
    if (value > max) return max + Math.log1p(value - max) * 2.2;
    return value;
  }

  /**
   * 单点 memo 包装：一次采样里 baseElevation 会被反复用到
   * （自身一次 + 道路基线上的投影点一次），缓存住可以省掉一整轮噪声。
   */
  private memoizedBase(): CachedBase {
    let hasValue = false;
    let lastX = 0;
    let lastZ = 0;
    let lastValue: BaseElevation = { base: 0, moisture: 0, rockiness: 0 };
    return (x: number, z: number) => {
      if (hasValue && x === lastX && z === lastZ) return lastValue;
      lastValue = this.baseElevation(x, z);
      lastX = x;
      lastZ = z;
      hasValue = true;
      return lastValue;
    };
  }

  /** ---------- 2. 水体 ---------- */
  private waterField(x: number, z: number, base: BaseElevation): WaterField {
    void base;
    const lake = this.lakeDepth(x, z);
    const lakeMask = lake > LAKE_DEPTH_EPSILON;

    return {
      lakeDepth: lake,
      lakeMask,
      surface: WATER_LEVEL,
    };
  }

  private carvedHeight(base: BaseElevation, water: WaterField): number {
    return base.base - water.lakeDepth;
  }

  private lakeDepth(x: number, z: number): number {
    const cfg = WATER_CONFIG.lake;
    let deepest = 0;

    const gx = Math.floor(x / cfg.spacing);
    const gz = Math.floor(z / cfg.spacing);

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const lake = this.lakeAt(gx + dx, gz + dz);
        if (!lake) continue;
        const dist = Math.hypot(x - lake.x, z - lake.z);
        if (dist >= lake.radius) continue;
        // 岸边 bankWidth 内用 smootherstep 抬升到水面以上，形成缓坡湖岸。
        const rim = clamp01((lake.radius - dist) / cfg.bankWidth);
        const depth = lake.depth * smootherstep(rim);
        if (depth > deepest) deepest = depth;
      }
    }

    return deepest <= LAKE_DEPTH_EPSILON ? 0 : deepest;
  }

  /** 湖泊格点是否生成湖泊；用抖动保证不会整齐排列。 */
  private lakeAt(gx: number, gz: number): LakeInfo | null {
    const cacheKey = `${gx},${gz}`;
    if (this.lakeCache.has(cacheKey)) return this.lakeCache.get(cacheKey) ?? null;

    const cfg = WATER_CONFIG.lake;
    const rng = mulberry32(hashInts(gx, gz, this.seed + 777));
    if (rng() > cfg.chance) {
      this.lakeCache.set(cacheKey, null);
      return null;
    }

    const x = (gx + 0.2 + rng() * 0.6) * cfg.spacing;
    const z = (gz + 0.2 + rng() * 0.6) * cfg.spacing;
    const radius = cfg.radiusMin + rng() * (cfg.radiusMax - cfg.radiusMin);
    // 湖泊只出现在低洼地带；资格只依赖候选湖中心的基础高度，
    // 不能随着当前查询点移动而变化。
    const centerBaseHeight = this.baseElevation(x, z).base;
    const lowland = clamp01((20 - centerBaseHeight) / 24);
    if (rng() > lowland) {
      this.lakeCache.set(cacheKey, null);
      return null;
    }

    const shoreSamples = cfg.shoreSamples;
    let minRimHeight = Number.POSITIVE_INFINITY;
    for (let index = 0; index < shoreSamples; index += 1) {
      const angle = (index / shoreSamples) * Math.PI * 2;
      const rimHeight = this.baseElevation(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
      ).base;
      minRimHeight = Math.min(minRimHeight, rimHeight);
    }

    if (!(minRimHeight > WATER_LEVEL + cfg.shoreSafetyMargin)) {
      this.lakeCache.set(cacheKey, null);
      return null;
    }

    const depth = cfg.depth * (0.75 + rng() * 0.5);
    // A valid candidate must actually reach the fixed water plane after carving;
    // a high dry depression is a basin mask, not a lake.
    if (centerBaseHeight - depth >= WATER_LEVEL) {
      this.lakeCache.set(cacheKey, null);
      return null;
    }

    const candidate = {
      x,
      z,
      radius,
      depth,
      minRimHeight,
      shoreSamples,
    };
    this.lakeCache.set(cacheKey, candidate);
    return candidate;
  }

  /** Expose deterministic candidate facts to geometry tests without exposing mutable cache state. */
  public lakeCandidateAt(gx: number, gz: number): LakeCandidate | null {
    const candidate = this.lakeAt(gx, gz);
    return candidate ? { ...candidate } : null;
  }

  /**
   * 返回距离给定位置最近的合法湖盆。
   * 这里只扫描候选湖的格点，与湖泊生成本身共享同一套 seed + cell 判定。
   */
  public nearestLakeCandidate(x: number, z: number, maxCellRadius = 16): LakeCandidate | null {
    const spacing = WATER_CONFIG.lake.spacing;
    const centerCellX = Math.floor(x / spacing);
    const centerCellZ = Math.floor(z / spacing);
    let nearest: LakeCandidate | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let dz = -maxCellRadius; dz <= maxCellRadius; dz += 1) {
      for (let dx = -maxCellRadius; dx <= maxCellRadius; dx += 1) {
        const candidate = this.lakeAt(centerCellX + dx, centerCellZ + dz);
        if (!candidate) continue;
        const distance = Math.hypot(x - candidate.x, z - candidate.z);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }
    }

    return nearest ? { ...nearest } : null;
  }

  /** 水体覆盖度：仅用于颜色/浅水视觉，不参与 Water topology。 */
  private waterCoverage(waterDepth: number): number {
    return waterDepth <= LAKE_DEPTH_EPSILON ? 0 : clamp01(waterDepth / 0.9);
  }

  /** ---------- 3. 道路 ---------- */
  private roadField(x: number, z: number, baseAt: CachedBase): RoadField {
    const cfg = ROAD_CONFIG;
    let bestDistance = FAR_AWAY;
    let bestSpine: { x: number; z: number } | null = null;

    // 纵向路（沿 Z 延伸，在 X 方向等距）。
    const xBand = Math.floor(x / cfg.spacing);
    for (let i = -1; i <= 1; i += 1) {
      const band = xBand + i;
      if (!this.roadLineExists(band)) continue;
      const centerX = band * cfg.spacing + this.roadWind(z, band);
      const distance = Math.abs(x - centerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSpine = { x: centerX, z };
      }
    }

    // 横向路（沿 X 延伸，在 Z 方向等距）。
    const zBand = Math.floor(z / cfg.spacing);
    for (let i = -1; i <= 1; i += 1) {
      const band = zBand + i;
      if (!this.roadLineExists(band + 1_700_000)) continue;
      const centerZ = band * cfg.spacing + this.roadWind(x, band + 3_000_000);
      const distance = Math.abs(z - centerZ);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSpine = { x, z: centerZ };
      }
    }

    const influenceRadius = cfg.halfWidth + cfg.shoulderWidth;
    if (!bestSpine || bestDistance > influenceRadius) {
      return { distance: bestDistance, influence: 0, spineElevation: 0 };
    }

    // 基线高程在"道路中心线投影点"处取样 —— 这样路面不会沿着路起伏，
    // 而是跟随大地形平滑地上下坡。
    const spineBase = baseAt(bestSpine.x, bestSpine.z);
    const spineWater = this.waterField(bestSpine.x, bestSpine.z, spineBase);
    // 路要跨湖岸：把湖盆下挖衰减到 35%，让路面不会被湖水吞没。
    const dampedCarve = spineWater.lakeDepth * 0.35;
    const spineElevation = spineBase.base - dampedCarve;

    const influence = smootherstep(1 - bestDistance / influenceRadius) * cfg.flattenStrength;

    return { distance: bestDistance, influence, spineElevation };
  }

  private applyRoad(base: BaseElevation, carved: number, water: WaterField, road: RoadField): number {
    if (road.influence <= 0) return carved;
    // Lake carving is authoritative below the fixed water plane. Letting the
    // road shoulder blend back toward its dry spine elevation would otherwise
    // form a raised land tongue through the lake and force WaterLayer to stop.
    if (water.lakeMask && carved < water.surface - LAKE_DEPTH_EPSILON) return carved;
    const flattened = lerpValue(carved, road.spineElevation, road.influence);
    // 路肩不应被抬得比原地面高太多，否则会出现"堤坝"。
    const ceiling = base.base + 2.4;
    return Math.min(flattened, ceiling);
  }

  private roadLineExists(band: number): boolean {
    return hashInts(band, 5150, this.seed + 7717) % 1000 < ROAD_CONFIG.chance * 1000;
  }

  private roadWind(coordinate: number, band: number): number {
    const cfg = ROAD_CONFIG;
    return (valueNoise2D(coordinate / cfg.windScale, band * 11.7, this.seed + 24601) - 0.5) * cfg.windAmplitude * 2;
  }

  /** ---------- 4. 分类与配色 ---------- */
  private biomeFor(moisture: number, rockiness: number): BiomeId {
    if (rockiness > 0.62) return rockiness > 0.86 ? "mountain" : "rocky";
    return moisture > 0.54 ? "forest" : "grass";
  }

  private zoneFor(
    height: number,
    waterDepth: number,
    onRoad: boolean,
    biome: BiomeId,
    moisture: number,
    rockiness: number,
    waterSurface: number,
  ): TerrainZone {
    if (onRoad) return "gravel";
    if (waterDepth > 0.05 || height < waterSurface + 0.85) return "shore";
    if (biome === "rocky" || biome === "mountain" || rockiness > 0.62) return "gravel";
    if (height < waterSurface + 2.2 && moisture > 0.48) return "mudflat";
    if (biome === "forest" && moisture > 0.5) return "forestFloor";
    return "grassland";
  }

  private surfaceFor(
    height: number,
    waterDepth: number,
    onRoad: boolean,
    biome: BiomeId,
    waterSurface: number,
  ): SurfaceKind {
    if (waterDepth > WATER_CONFIG.shallowDepth) return "deepWater";
    if (waterDepth > 0.08) return "shallowWater";
    if (onRoad) return "road";
    if (height < waterSurface + 0.85) return "shore";
    if (biome === "mountain") return "mountain";
    if (biome === "rocky") return "rock";
    if (biome === "forest") return "forest";
    return "grass";
  }

  private paletteFor(rockiness: number, moisture: number): [number, number, number] {
    // 基础色：草地 → 森林 → 岩地。
    // 基色整体调亮：低模风格里深色地表一旦进入背光面就会糊成黑块。
    const grass: [number, number, number] = [0.55, 0.72, 0.4];
    const forest: [number, number, number] = [0.34, 0.55, 0.32];

    const moistureMix = clamp01((moisture - 0.34) / 0.42);
    let r = lerpValue(grass[0], forest[0], moistureMix);
    let g = lerpValue(grass[1], forest[1], moistureMix);
    let b = lerpValue(grass[2], forest[2], moistureMix);

    const rock: [number, number, number] = [0.52, 0.5, 0.45];
    const rockMix = clamp01((rockiness - 0.35) / 0.5);
    r = lerpValue(r, rock[0], rockMix);
    g = lerpValue(g, rock[1], rockMix);
    b = lerpValue(b, rock[2], rockMix);

    return [r, g, b];
  }

  /** 大尺度色斑（±8%），打破"整片一个色"的塑料感。 */
  private macroShade(x: number, z: number): number {
    return 0.92 + valueNoise2D(x / 95, z / 95, this.seed + 4801) * 0.16;
  }

  /** 细颗粒。 */
  private detailGrain(x: number, z: number): number {
    return valueNoise2D(x / 7.5, z / 7.5, this.seed + 6607);
  }
}
