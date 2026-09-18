/**
 * 全局数值配置。
 *
 * 世界生成是「分层」的，这里的常量按层分组：
 *   Terrain  地形基底 / 山体
 *   Water    水位、湖泊
 *   Road     路网
 *   Landmark 远景地标
 *   Detail   细节散布物
 *   Atmosphere 天空 / 雾 / 光照
 */
export const GAME_CONFIG = {
  chunkSize: 64,
  /**
   * 每 chunk 的地面细分数。24 表示顶点间距 64 / 24 ≈ 2.67m。
   * 这个值决定湖岸和地形细节能否稳定采样：顶点间距约 2.67m。
   */
  chunkSubdivisions: 24,
  /**
   * 以玩家所在 chunk 为中心的加载半径。
   * 半径 3 → 7×7 = 49 chunk，覆盖 448×448m；配合 atmosphere.fogDensity
   * 可以让最远处的地形边缘完全溶进雾里，看不到「世界边界」。
   */
  chunkRadius: 3,
  interactRange: 3.2,
  meleeRange: 2.4,
  meleeCooldownMs: 420,
  autosaveMs: 5000,
  seeds: {
    home: 18421,
    mission: 731993,
  },
} as const;

/** Minecraft-style square chunk loading radius (2r+1 by 2r+1 chunks). */
export type ChunkLoadRadius = 2 | 3 | 4 | 5 | 6;

/**
 * 玩家移动参数 —— 单位是真正的「米 / 秒」。
 *
 * 注意：这里刻意不使用 Babylon 自带的 `camera.speed` 移动公式
 * （`speed * sqrt(deltaTime / (fps * 100))`），因为那个值既不是米/秒也不是米/帧，
 * 实测配置 0.38 只能走出约 0.9 m/s。移动完全由 PlayerController 按 deltaTime 积分。
 */
export const MOVEMENT_CONFIG = {
  /** 步行速度。 */
  walkSpeed: 5.2,
  /** 冲刺速度。 */
  sprintSpeed: 9.2,
  /** 地面加速度（米/秒²）：越大手感越"跟手"，越小越飘。 */
  groundAcceleration: 48,
  /** 空中加速度：明显低于地面，跳跃后不能随意变向。 */
  airAcceleration: 14,
  /** 重力加速度（米/秒²）。 */
  gravity: -21,
  /** 终端下落速度。 */
  terminalVelocity: -55,
  /** 起跳初速度：约能跳起 1.2m。 */
  jumpVelocity: 7.1,
  /**
   * 爬台阶助力高度。
   * Babylon 的碰撞只有"贴合滑动"没有自动踏步，所以河岸这类
   * 半米高的坎会把人顶住；这个值决定能自动跨多高。
   */
  stepUpHeight: 0.95,
  stepUpCooldownMs: 140,
  /** 爬台阶时向前探测的距离（米）。 */
  stepUpProbeDistance: 1.6,
  /** 涉水速度倍率。 */
  waterSpeedMultiplier: 0.6,
  /**
   * 向下探测地面的射线长度。
   * 射线从碰撞体底部发出；平地静止时脚底到地面约有 0.9m 的间隙
   * （碰撞椭球底 + 地形网格的高度差），所以这个值要覆盖住它。
   */
  groundProbeDistance: 1.15,
  /**
   * 仅在玩家主动移动时施加的极轻贴地速度。
   * 静止时保持 0，避免每帧用碰撞器把相机重新顶回地面而造成画面微抖。
   */
  groundStickSpeed: 0.18,
  /** 单个物理子步的长度上限：掉帧时切成多个子步，而不是让游戏时间变慢。 */
  maxStepSeconds: 1 / 60,
  /** 单帧总时长上限：切窗口回来时避免一帧跑几秒。 */
  maxFrameSeconds: 0.5,
  /** 创造模式飞行：双击空格在这个时间窗内算"双击"。 */
  flightToggleWindowMs: 320,
  /** 飞行速度（米/秒）。 */
  flightSpeed: 16,
  flightSprintSpeed: 34,
  flightAcceleration: 42,
} as const;

/** ---------- Terrain：地形基底 ---------- */
export const TERRAIN_CONFIG = {
  /**
   * 全局高程偏移。
   *
   * 这一项很关键：分形噪声的均值天然偏中间值，如果不做偏移，
   * 整张地图的平均高度会落在水位之上，湖泊就永远看不到。
   * +2.4 把均值压到水位附近，于是低洼处自然积水、高处形成丘陵。
   */
  baseOffset: 5.2,
  /**
   * 大陆起伏：决定「这一片是高地还是洼地」。
   * 振幅 20、波长约 1200m，是地貌层次里最大的一层。
   */
  continent: { scale: 1200, amplitude: 20, octaves: 3 },
  /** 大丘陵：起伏的主力，振幅 12、波长约 300m。 */
  hills: { scale: 300, amplitude: 12, octaves: 3 },
  /**
   * 山地：用 ridged noise（1-|noise|）制造山脊。
   * 只在 mountainMask 高的地方生效，所以不会到处是山。
   */
  mountains: { scale: 620, amplitude: 22, octaves: 4, maskScale: 1500 },
  /** 细节起伏：给地面加小尺度不平整，避免「塑料平板」。 */
  detail: { scale: 46, amplitude: 0.85, octaves: 2 },
  /** 湿度：驱动草地 / 森林的分布。 */
  moisture: { scale: 420, octaves: 2 },
  /**
   * 岩地/山地遮罩的阈值与过渡带。
   * rockiness 超过 rockStart 后开始向岩地过渡，rockFull 处完全变岩地。
   */
  rockStart: 0.46,
  rockFull: 0.7,
  /**
   * 地形高度软夹取范围。
   * 注意：这不是硬夹取，超出部分会做对数压缩，
   * 所以不会出现平台状高原，但能挡住噪声尾部的极端值。
   */
  minHeight: -22,
  maxHeight: 46,
} as const;

/** ---------- Water：水体 ---------- */
export const WATER_CONFIG = {
  /** 全局湖面高度。Update 1.1 暂时只启用稳定湖泊。 */
  level: 0,
  /** 低模湖面视觉：只改变材质表现，不改变水面拓扑。 */
  visual: {
    waveAmplitude: 0.06,
    waveFrequency: [0.035, 0.022] as [number, number],
    waveSpeed: [0.38, 0.24] as [number, number],
    shoreFadeDepth: 1.6,
    reflectionStrength: 0.18,
  } as const,
  /** 水深小于该值就算「浅水」，玩家会减速但能走。 */
  shallowDepth: 1.15,
  /** 湖泊格点间距与生成概率，真实半径还会乘 rng。 */
  lake: {
    spacing: 470,
    chance: 0.8,
    radiusMin: 60,
    radiusMax: 112,
    /** 湖心下挖深度（米）。 */
    depth: 5.2,
    /** 岸边过渡带宽度（米），让湖岸是缓坡而不是碗壁。 */
    bankWidth: 18,
    /** 未雕刻基础地形在整个岸环上必须高于水面的安全裕量。 */
    shoreSafetyMargin: 0.6,
    /** 岸环均匀采样点数；必须足够覆盖低洼缺口。 */
    shoreSamples: 32,
  },
} as const;

/** ---------- Road：路网 ---------- */
export const ROAD_CONFIG = {
  /** 路网格点间距（米）。 */
  spacing: 232,
  /** 每条格线以该概率存在，形成主路 + 断头路（断头路留给未来接 POI）。 */
  chance: 0.74,
  /** 缠绕参数，避免笔直。 */
  windAmplitude: 26,
  windScale: 340,
  /** 路面半宽（米）。 */
  halfWidth: 3.2,
  /** 路面两侧的合理肩部宽度；地形影响半径由 halfWidth + shoulderWidth 推导。 */
  shoulderWidth: 2.6,
  /**
   * 压平强度（0~1），1 表示紧贴道路基线高程。
   *
   * 0.35 是刻意的"轻压平"：只把横向颠簸抹平一点，路面仍然跟着地形起伏。
   * 强度高时整条路会变成一道高架平台，边坡陡、还会填平沿途湖岸 ——
   * 低模风格里"路贴着地走"反而更好看。
   */
  flattenStrength: 0.35,
  /** 路面抬升量。要略大于地形网格的采样误差，否则路面会被地面"咬"出锯齿。 */
  surfaceLift: 0.14,
  /** 路径采样步长（米），保持在 2~4m 以避免弯道扭曲。 */
  ribbonStep: 3.2,
} as const;

/** ---------- Landmark：远景地标 ---------- */
export const LANDMARK_CONFIG = {
  /** 地标格点间距（米）：每 384m 一格，格内抖动放置，格间互不重叠。 */
  spacing: 384,
  /** 每格生成地标的概率。 */
  chance: 0.55,
  /** 地标距道路/水面太近时的重试偏移。 */
  minShoreDistance: 14,
  /** 指向最近地标的 HUD 指引刷新间隔（毫秒）。 */
  compassRefreshMs: 250,
} as const;

/** ---------- POI：主世界人工场景 ---------- */
export const POI_CONFIG = {
  /** 一个 POI cell 最多一个主体，保持无限世界稀疏且可发现。 */
  cellSpacing: 256,
  chance: 0.82,
  roadSearchDistance: 34,
  bridgeSearchDistance: 90,
  roadMinDistance: 8,
  buildingMaxSlope: 0.32,
  buildingMaxHeightRange: 2.4,
  bridgeMaxEndHeightDifference: 2.4,
  bridgeHalfLength: 24,
  dockSearchRadius: 2,
} as const;

/** ---------- Detail：细节散布物 ---------- */
export const DETAIL_CONFIG = {
  /** 每 chunk 的候选散布点数量（实际会按 biome 概率筛选）。 */
  candidatesPerChunk: 68,
  /** zone-aware low-poly placement weights; all choices remain deterministic. */
  zoneDensity: {
    forest: { tree: 0.42, bush: 0.2, grass: 0.15, log: 0.07 },
    grassland: { tree: 0.12, bush: 0.2, grass: 0.28, flower: 0.28 },
    wetland: { reed: 0.72, grass: 0.16, flower: 0.1 },
    mudflat: { grass: 0.24, flower: 0.28, reed: 0.2 },
    gravel: { rock: 0.74, pebble: 0.2 },
  },
  /** 距离道路中心线小于该值不放散布物。 */
  roadClearance: 5.5,
  /** 候选点与已放置物之间的最小间距（米）。 */
  minSpacing: 3.8,
  /**
   * 出生点净空半径（米）。
   * 主世界出生点是固定坐标，如果不做净空，玩家可能一睁眼就卡在树里。
   */
  spawnClearance: 16,
} as const;

/** ---------- Exploration：宏观探索节奏 ---------- */
export const EXPLORATION_CONFIG = {
  /** 一段探索节奏覆盖约五个 chunk，避免每格平均塞满内容。 */
  cellSize: 320,
} as const;

/** ---------- Atmosphere：天空 / 雾 / 光照 ---------- */
export const ATMOSPHERE_CONFIG = {
  /** 一次完整风格化日夜循环的真实秒数；用于演示，也可被将来的存档时钟替换。 */
  dayLengthSeconds: 720,
  /**
   * 太阳方向（由原点指向太阳，会被归一化）。
   * 抬高仰角后亮面 / 暗面分工明确，地形起伏才有体积感
   * （之前太阳偏得太多，画面整体发平）。
   */
  sunDirection: [-0.38, 0.72, 0.58] as [number, number, number],
  /** 主方向光负责低模面的明暗塑形；环境光只保留天空反射填充。 */
  sunIntensity: 1.18,
  sunLightColor: "#fff5e5",
  /**
   * 半球环境光：天空色（上）/ 地面反射色（下）。
   * 强度决定背光面有多黑 —— 太低陡坡会变成纯黑块。
   * 地面反射色用中性的暖灰绿：太饱和会让暗部发绿发脏。
   */
  ambientSky: "#d7e8ee",
  ambientGround: "#889281",
  ambientIntensity: 0.62,
  /** 仅覆盖玩家附近的级联阴影，避免无限 chunk 把浏览器阴影预算吃满。 */
  shadows: {
    mapSize: 1024,
    cascades: 3,
    maxDistance: 128,
    darkness: 0.58,
  },
  /** 程序化天空（自定义 shader，无需贴图）。 */
  sky: {
    /** 天顶色：偏深的蓝。 */
    zenithColor: "#5f9ed1",
    /** 地平线色：刻意接近雾色，做到"世界边缘溶进天空"。 */
    horizonColor: "#bed3df",
    /** 程序化日轮的暖白核心与金色边缘。 */
    sunCoreColor: "#fff9df",
    sunEdgeColor: "#ffd28a",
    /** 相机朝向日轮的距离与直径。 */
    sunDistance: 1800,
    sunDiameter: 72,
    /**
     * 地平线雾霾浓度。越大，地平线附近越白、越像有薄雾，
     * 远处地形与天空的衔接也越自然。
     */
    hazeFalloff: 2.2,
    cloudColor: "#e7edf0",
    cloudStrength: 0.18,
    cloudSpeed: 0.018,
  },
  /**
   * 指数雾。
   * 颜色必须等于天空在地平线方向的实际输出色（含雾霾与太阳光斑）——
   * 否则远处地形和天空之间会出现一条明显的接缝。
   * 这个值是按 sky shader 的公式算出来的，改天空参数时要同步更新。
   */
  fogDensity: 0.0028,
  fogColor: "#b8cbd0",
  /** 摄像机远裁剪面。 */
  cameraFar: 3200,
} as const;

export type FogDistancePreference = "near" | "standard" | "far";

export const RESOURCE_PRICES = {
  wood: 6,
  stone: 9,
  scrap: 18,
  relic: 70,
} as const;
