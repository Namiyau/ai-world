import {
  Color3,
  Color4,
  Constants,
  CascadedShadowGenerator,
  DirectionalLight,
  Effect,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  Vector3,
  AbstractMesh,
  type TransformNode,
  type UniversalCamera,
} from "@babylonjs/core";
import { ATMOSPHERE_CONFIG, type FogDistancePreference } from "../config";

export interface DayState {
  daylight: number;
  sunDirection: { x: number; y: number; z: number };
}

export interface AtmosphereVisualState extends DayState {
  fogDensity: number;
  skyReflectionColor: Color3;
  isNight: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export type TimePreset = "dawn" | "noon" | "dusk" | "midnight";

const cycleSecondAtAngle = (angle: number): number => {
  const normalized = ((angle - 0.25) / (Math.PI * 2) + 1) % 1;
  return normalized * ATMOSPHERE_CONFIG.dayLengthSeconds;
};

/** Fixed positions on the same day clock used by the live cycle. */
export const TIME_PRESETS: Record<TimePreset, number> = {
  dawn: cycleSecondAtAngle(0),
  noon: cycleSecondAtAngle(Math.PI / 2),
  dusk: cycleSecondAtAngle(Math.PI),
  midnight: cycleSecondAtAngle(Math.PI * 1.5),
};

export const TIME_PRESET_LABELS: Record<TimePreset, string> = {
  dawn: "日出",
  noon: "正午",
  dusk: "傍晚",
  midnight: "午夜",
};

/** Pure day clock: the small phase offset gives the starting scene an early-morning mood. */
export function dayStateAt(elapsedSeconds: number): DayState {
  const period = ATMOSPHERE_CONFIG.dayLengthSeconds;
  const cycle = ((elapsedSeconds % period) + period) % period;
  const angle = (cycle / period) * Math.PI * 2 + 0.25;
  const sunDirection = new Vector3(Math.cos(angle) * 0.55, Math.sin(angle) * 0.78, 0.58).normalize();
  return {
    daylight: clamp01((sunDirection.y + 0.1) / 1.1),
    sunDirection: { x: sunDirection.x, y: sunDirection.y, z: sunDirection.z },
  };
}

/**
 * 程序化天空着色器。
 *
 * 为什么不用 SkyMaterial：它属于 @babylonjs/materials 附加包，
 * 而本项目只依赖 @babylonjs/core。自己写一个梯度天空只需要几十行，
 * 而且渐变颜色、太阳位置、地平线雾色可以精确对齐（这恰恰是"世界边缘融进天空"的关键）。
 */
const SKY_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec3 position;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vWorldPosition;

void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldPosition;

uniform vec3 uCameraPosition;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uCloudColor;
uniform float uHazeFalloff;
uniform float uFogDensity;
uniform float uCloudStrength;
uniform float uCloudTime;

// Deliberately simple analytic noise: a soft, drifting stylized cloud layer
// without a texture lookup or a second sky mesh.
float cloudField(vec2 point) {
  float broad = sin(point.x * 0.58 + sin(point.y * 0.21));
  float detail = sin(point.y * 0.86 - point.x * 0.33) * 0.42;
  float wisps = sin(point.x * 1.31 + point.y * 0.49) * 0.18;
  return broad + detail + wisps;
}

void main(void) {
  vec3 viewDirection = normalize(vWorldPosition - uCameraPosition);

  // 以仰角作为渐变参数：地平线附近是 horizon 色，天顶是 zenith 色。
  float elevation = clamp(viewDirection.y, 0.0, 1.0);

  // 地平线附近额外压一层雾霾，让天空和雾的颜色在地平线处完全一致。
  float haze = exp(-elevation * 900.0 * uHazeFalloff * 0.001);
  vec3 color = mix(uHorizonColor, uZenithColor, pow(elevation, 0.55));
  color = mix(color, uHorizonColor, haze * 0.65);

  vec2 cloudUv = viewDirection.xz / max(0.24, viewDirection.y + 0.34);
  cloudUv += vec2(uCloudTime, uCloudTime * 0.38);
  float cloudAltitude = smoothstep(0.06, 0.2, elevation) * (1.0 - smoothstep(0.68, 0.9, elevation));
  float cloud = smoothstep(0.48, 0.82, cloudField(cloudUv)) * cloudAltitude;
  color = mix(color, uCloudColor, cloud * uCloudStrength);

  // 地平线以下（理论上看不到，除非镜头在水面下抬头）也给个底色，避免出现黑边。
  color = mix(color, uHorizonColor * 0.82, clamp(-viewDirection.y * 6.0, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;

const SUN_HALO_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec2 vUv;

void main(void) {
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const SUN_HALO_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec3 uColor;
uniform float uAlpha;

void main(void) {
  float radius = length(vUv * 2.0 - 1.0);
  float softness = 1.0 - smoothstep(0.28, 1.0, radius);
  gl_FragColor = vec4(uColor, softness * uAlpha);
}
`;

// The old sun used a black-diffuse StandardMaterial sphere. This unlit shader
// disc owns every pixel it draws, so the core cannot inherit a dark face or a
// mesh-lighting artifact from the scene.
const SUN_DISC_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec3 uCoreColor;
uniform vec3 uEdgeColor;
uniform float uIntensity;

void main(void) {
  float radius = length(vUv * 2.0 - 1.0);
  if (radius > 1.0) discard;

  float rim = smoothstep(0.52, 0.98, radius);
  float core = 1.0 - smoothstep(0.0, 0.72, radius);
  vec3 color = mix(uCoreColor, uEdgeColor, rim);
  color += vec3(0.075) * core;
  gl_FragColor = vec4(color * uIntensity, 1.0);
}
`;

/**
 * 氛围层：天空、雾、光照。
 *
 * 三件事合在一起决定画面的"第一印象"：
 *   1. 程序化梯度天空（自定义 shader，零贴图资源）
 *   2. 指数雾 —— 颜色刻意等于天空地平线色，于是远处地形会"溶进天空"。
 *      这一条同时解决了三件事：chunk 边缘不可见、远景有纵深、地标像剪影。
 *   3. 光照：半球环境光（天空蓝 / 地面反射）+ 定向太阳光
 */
export class Atmosphere {
  public readonly sunDirection: Vector3;
  public visualState!: AtmosphereVisualState;
  private readonly skyDome: Mesh;
  private readonly sunDisc: Mesh;
  private readonly sunDiscMaterial: ShaderMaterial;
  private readonly sunHalo: Mesh;
  private readonly sunHaloMaterial: ShaderMaterial;
  private readonly skyMaterial: ShaderMaterial;
  private readonly ambient: HemisphericLight;
  private readonly sun: DirectionalLight;
  /** NullEngine cannot allocate CSM textures; browsers always receive the generator. */
  public readonly shadowGenerator: CascadedShadowGenerator | null;
  private readonly camera: UniversalCamera;
  private readonly scene: Scene;
  /** All eligible scene meshes; only the nearby subset is put into the CSM render list. */
  private readonly shadowCandidates = new Set<AbstractMesh>();
  private readonly shadowCasters = new Set<AbstractMesh>();
  private readonly lastShadowCenter = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  /** New games begin in a readable late-morning state, then advance normally. */
  private elapsedSeconds = 130;
  private fogMultiplier = 1;

  public constructor(scene: Scene, camera: UniversalCamera) {
    this.scene = scene;
    this.camera = camera;
    const config = ATMOSPHERE_CONFIG;
    this.sunDirection = new Vector3(...config.sunDirection).normalize();

    const fogColor = Color3.FromHexString(config.fogColor);

    // ---- 天空穹顶 ----
    // 半径取固定值并由相机跟随，等价于"无限远"，同时避免远裁剪面裁掉它。
    const skyDome = MeshBuilder.CreateSphere(
      "sky-dome",
      { diameter: 2, segments: 24, sideOrientation: Mesh.BACKSIDE },
      scene,
    );
    skyDome.scaling.setAll(3200);
    skyDome.isPickable = false;
    // 先画天空，让地形覆盖它。
    skyDome.alphaIndex = -10;
    skyDome.infiniteDistance = false;

    const skyMaterial = new ShaderMaterial(
      "sky",
      scene,
      { vertexSource: SKY_VERTEX_SHADER, fragmentSource: SKY_FRAGMENT_SHADER },
      {
        attributes: ["position"],
        uniforms: [
          "world",
          "worldViewProjection",
          "uCameraPosition",
          "uZenithColor",
          "uHorizonColor",
          "uCloudColor",
          "uHazeFalloff",
          "uFogDensity",
          "uCloudStrength",
          "uCloudTime",
        ],
        defines: ["#define PROCEDURAL_SKY"],
      },
    );

    const zenith = Color3.FromHexString(config.sky.zenithColor);
    const horizon = Color3.FromHexString(config.sky.horizonColor);
    const sunCoreColor = Color3.FromHexString(config.sky.sunCoreColor);
    const sunEdgeColor = Color3.FromHexString(config.sky.sunEdgeColor);

    skyMaterial.setColor3("uZenithColor", zenith);
    skyMaterial.setColor3("uHorizonColor", horizon);
    skyMaterial.setColor3("uCloudColor", Color3.FromHexString(config.sky.cloudColor));
    skyMaterial.setFloat("uHazeFalloff", config.sky.hazeFalloff);
    skyMaterial.setFloat("uFogDensity", config.fogDensity);
    skyMaterial.backFaceCulling = false;
    skyDome.material = skyMaterial;
    skyDome.parent = camera;

    this.skyDome = skyDome;
    this.skyMaterial = skyMaterial;

    // 太阳不再画在天空球 shader 上，也不再使用 StandardMaterial 球体。
    // 相机朝向的程序化圆盘没有球面明暗、黑色 diffuse 或透视椭圆问题。
    const sunDisc = MeshBuilder.CreatePlane(
      "sun-disc",
      { size: config.sky.sunDiameter, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    sunDisc.position.copyFrom(camera.position).addInPlaceFromFloats(
      this.sunDirection.x * config.sky.sunDistance,
      this.sunDirection.y * config.sky.sunDistance,
      this.sunDirection.z * config.sky.sunDistance,
    );
    sunDisc.isPickable = false;
    sunDisc.infiniteDistance = false;
    sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sunDisc.alphaIndex = -9;
    const sunDiscMaterial = new ShaderMaterial(
      "sun-disc-material",
      scene,
      { vertexSource: SUN_HALO_VERTEX_SHADER, fragmentSource: SUN_DISC_FRAGMENT_SHADER },
      {
        attributes: ["position", "uv"],
        uniforms: ["world", "worldViewProjection", "uCoreColor", "uEdgeColor", "uIntensity"],
      },
    );
    sunDiscMaterial.backFaceCulling = false;
    sunDiscMaterial.fogEnabled = false;
    sunDiscMaterial.disableDepthWrite = true;
    sunDiscMaterial.setColor3("uCoreColor", sunCoreColor);
    sunDiscMaterial.setColor3("uEdgeColor", sunEdgeColor);
    sunDiscMaterial.setFloat("uIntensity", 1);
    sunDisc.material = sunDiscMaterial;
    this.sunDisc = sunDisc;
    this.sunDiscMaterial = sunDiscMaterial;

    // A camera-facing radial gradient supplies a soft, cheap stylized glow.
    // It remains separate from the opaque shader disc, so the core stays crisp.
    const sunHalo = MeshBuilder.CreatePlane(
      "sun-halo",
      { size: config.sky.sunDiameter * 3.1, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    sunHalo.position.copyFrom(sunDisc.position);
    sunHalo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sunHalo.isPickable = false;
    sunHalo.infiniteDistance = false;
    sunHalo.alphaIndex = -8;
    const sunHaloMaterial = new ShaderMaterial(
      "sun-halo-material",
      scene,
      { vertexSource: SUN_HALO_VERTEX_SHADER, fragmentSource: SUN_HALO_FRAGMENT_SHADER },
      {
        attributes: ["position", "uv"],
        uniforms: ["world", "worldViewProjection", "uColor", "uAlpha"],
      },
    );
    sunHaloMaterial.backFaceCulling = false;
    sunHaloMaterial.fogEnabled = false;
    sunHaloMaterial.disableDepthWrite = true;
    sunHaloMaterial.needAlphaBlending = () => true;
    sunHaloMaterial.alphaMode = Constants.ALPHA_ADD;
    sunHaloMaterial.setColor3("uColor", sunEdgeColor);
    sunHaloMaterial.setFloat("uAlpha", 0.22);
    sunHalo.material = sunHaloMaterial;
    this.sunHalo = sunHalo;
    this.sunHaloMaterial = sunHaloMaterial;

    // ---- 雾 ----
    scene.fogEnabled = true;
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = config.fogDensity;
    scene.fogColor = fogColor;
    // clearColor 只在天空失效时可见，取雾色最安全。
    scene.clearColor = new Color4(fogColor.r, fogColor.g, fogColor.b, 1);

    // ---- 光照 ----
    const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
    ambient.intensity = config.ambientIntensity;
    ambient.diffuse = Color3.FromHexString(config.ambientSky);
    ambient.groundColor = Color3.FromHexString(config.ambientGround);
    this.ambient = ambient;

    const sun = new DirectionalLight("sun", this.sunDirection.scale(-1), scene);
    sun.intensity = config.sunIntensity;
    sun.diffuse = Color3.FromHexString(config.sunLightColor);
    this.sun = sun;

    if (CascadedShadowGenerator.IsSupported) {
      const shadows = new CascadedShadowGenerator(config.shadows.mapSize, sun, false, camera);
      shadows.numCascades = config.shadows.cascades;
      shadows.shadowMaxZ = config.shadows.maxDistance;
      shadows.setMinMaxDistance(0, config.shadows.maxDistance);
      shadows.stabilizeCascades = true;
      shadows.lambda = 0.72;
      shadows.cascadeBlendPercentage = 0.12;
      shadows.usePercentageCloserFiltering = true;
      // Keep contact shadows stable after removing self-receiving casters.
      // A modest normal bias avoids acne without lifting shadows visibly off
      // the ground; partial darkness keeps stylized shadows from reading as
      // black animated bars while the camera crosses cascade tiles.
      shadows.bias = 0.0012;
      shadows.normalBias = 0.018;
      shadows.darkness = config.shadows.darkness;
      this.shadowGenerator = shadows;
    } else {
      this.shadowGenerator = null;
    }

    // 远景需要更大的远裁剪面，否则地标会被裁掉。
    camera.maxZ = config.cameraFar;
    camera.minZ = 0.08;

    // 记录一份 shader 源码，便于 Effect 复用同一份编译结果。
    Effect.ShadersStore["proceduralSkyVertexShader"] ??= SKY_VERTEX_SHADER;
    Effect.ShadersStore["proceduralSkyFragmentShader"] ??= SKY_FRAGMENT_SHADER;
    this.applyVisualState(this.elapsedSeconds);
    this.refreshShadowCasters(true);
  }

  /** 天空盒挂在摄像机上，只需同步它的世界坐标（shader 用它反推视线方向）。 */
  public update(deltaSeconds = 0): void {
    this.elapsedSeconds += Math.max(0, deltaSeconds);
    this.applyVisualState(this.elapsedSeconds);
    this.skyMaterial.setVector3("uCameraPosition", this.skyDome.getAbsolutePosition());
    this.updateSunPosition();
    this.refreshShadowCasters();
  }

  /** Set a stable point in the cycle; useful for pause-menu photo/exploration control. */
  public setTimePreset(preset: TimePreset): void {
    this.elapsedSeconds = TIME_PRESETS[preset];
    this.applyVisualState(this.elapsedSeconds);
    this.updateSunPosition();
  }

  public setFogDistance(preference: FogDistancePreference): void {
    this.fogMultiplier = preference === "near" ? 1.22 : preference === "far" ? 0.78 : 1;
    this.applyVisualState(this.elapsedSeconds);
  }

  /** Register only meaningful nearby-world silhouettes as shadow casters. */
  public addShadowCaster(source: AbstractMesh | TransformNode, includeDescendants = true): void {
    for (const mesh of this.shadowMeshes(source, includeDescendants)) {
      if (mesh.isDisposed()) continue;
      this.shadowCandidates.add(mesh);
      // Babylon instances inherit their source material but do not own a
      // receiveShadows flag. Setting it logs a warning every frame; they are
      // caster-only here. Receivers are opted into explicitly by
      // setShadowReceiver so characters and props cannot self-shadow.
      this.syncShadowCandidate(mesh, this.camera.globalPosition);
    }
  }

  public removeShadowCaster(source: AbstractMesh | TransformNode, includeDescendants = true): void {
    for (const mesh of this.shadowMeshes(source, includeDescendants)) {
      this.shadowCandidates.delete(mesh);
      if (!this.shadowCasters.delete(mesh)) continue;
      this.shadowGenerator?.removeShadowCaster(mesh, false);
    }
  }

  /** Terrain, roads and substantial props receive the nearby cascade shadows. */
  public setShadowReceiver(source: AbstractMesh | TransformNode, includeDescendants = false): void {
    for (const mesh of this.shadowMeshes(source, includeDescendants)) mesh.receiveShadows = true;
  }

  public get shadowStats(): { cascades: number; maxDistance: number; casterCount: number } {
    return {
      cascades: this.shadowGenerator?.numCascades ?? ATMOSPHERE_CONFIG.shadows.cascades,
      maxDistance: this.shadowGenerator?.shadowMaxZ ?? ATMOSPHERE_CONFIG.shadows.maxDistance,
      casterCount: this.shadowCasters.size,
    };
  }

  private shadowMeshes(source: AbstractMesh | TransformNode, includeDescendants: boolean): AbstractMesh[] {
    const meshes = source instanceof AbstractMesh ? [source] : [];
    if (includeDescendants) meshes.push(...source.getChildMeshes(false));
    return meshes;
  }

  /** Keep the CSM render list bounded even though the world keeps 7×7 chunks alive. */
  private refreshShadowCasters(force = false): void {
    const position = this.camera.globalPosition;
    if (!force && Vector3.DistanceSquared(position, this.lastShadowCenter) < 16) return;
    this.lastShadowCenter.copyFrom(position);
    const range = ATMOSPHERE_CONFIG.shadows.maxDistance + 20;
    const rangeSquared = range * range;
    for (const mesh of [...this.shadowCandidates]) {
      if (mesh.isDisposed()) {
        this.shadowCandidates.delete(mesh);
        this.shadowCasters.delete(mesh);
        continue;
      }
      this.syncShadowCandidate(mesh, position, rangeSquared);
    }
  }

  private syncShadowCandidate(mesh: AbstractMesh, position: Vector3, rangeSquared?: number): void {
    const range = rangeSquared ?? (ATMOSPHERE_CONFIG.shadows.maxDistance + 20) ** 2;
    const center = mesh.getBoundingInfo().boundingSphere.centerWorld;
    const shouldCast = Vector3.DistanceSquared(center, position) <= range;
    const registered = this.shadowCasters.has(mesh);
    if (shouldCast && !registered) {
      this.shadowGenerator?.addShadowCaster(mesh, false);
      this.shadowCasters.add(mesh);
    } else if (!shouldCast && registered) {
      this.shadowGenerator?.removeShadowCaster(mesh, false);
      this.shadowCasters.delete(mesh);
    }
  }

  private applyVisualState(elapsedSeconds: number): void {
    const day = dayStateAt(elapsedSeconds);
    const daylight = day.daylight;
    const horizon = Color3.Lerp(Color3.FromHexString("#536575"), Color3.FromHexString(ATMOSPHERE_CONFIG.sky.horizonColor), daylight);
    const zenith = Color3.Lerp(Color3.FromHexString("#17263d"), Color3.FromHexString(ATMOSPHERE_CONFIG.sky.zenithColor), daylight);
    const fogColor = Color3.Lerp(Color3.FromHexString("#51616d"), Color3.FromHexString(ATMOSPHERE_CONFIG.fogColor), daylight);
    const fogDensity = ATMOSPHERE_CONFIG.fogDensity * (1.16 - daylight * 0.28) * this.fogMultiplier;
    this.visualState = {
      ...day,
      fogDensity,
      skyReflectionColor: horizon,
      isNight: daylight < 0.1,
    };

    this.sunDirection.copyFromFloats(day.sunDirection.x, day.sunDirection.y, day.sunDirection.z);
    this.sun.direction.copyFrom(this.sunDirection).scaleInPlace(-1);
    this.sun.intensity = ATMOSPHERE_CONFIG.sunIntensity * (0.1 + daylight * 0.9);
    this.ambient.intensity = ATMOSPHERE_CONFIG.ambientIntensity * (0.66 + daylight * 0.34);
    this.skyMaterial.setColor3("uZenithColor", zenith);
    this.skyMaterial.setColor3("uHorizonColor", horizon);
    this.skyMaterial.setFloat("uFogDensity", fogDensity);
    this.skyMaterial.setFloat("uCloudStrength", ATMOSPHERE_CONFIG.sky.cloudStrength * (0.35 + daylight * 0.65));
    this.skyMaterial.setFloat("uCloudTime", elapsedSeconds * ATMOSPHERE_CONFIG.sky.cloudSpeed);
    this.scene.fogDensity = fogDensity;
    this.scene.fogColor.copyFrom(fogColor);
    this.scene.clearColor = new Color4(fogColor.r, fogColor.g, fogColor.b, 1);
    this.sunDiscMaterial.setColor3("uCoreColor", Color3.FromHexString(ATMOSPHERE_CONFIG.sky.sunCoreColor));
    this.sunDiscMaterial.setColor3("uEdgeColor", Color3.FromHexString(ATMOSPHERE_CONFIG.sky.sunEdgeColor));
    this.sunDiscMaterial.setFloat("uIntensity", 0.78 + daylight * 0.22);
    this.sunHaloMaterial.setColor3("uColor", Color3.FromHexString(ATMOSPHERE_CONFIG.sky.sunEdgeColor));
    this.sunHaloMaterial.setFloat("uAlpha", 0.055 + daylight * 0.12);
    this.sunDisc.setEnabled(daylight > 0.015);
    this.sunHalo.setEnabled(daylight > 0.015);
  }

  private updateSunPosition(): void {
    const distance = ATMOSPHERE_CONFIG.sky.sunDistance;
    this.sunDisc.position.copyFrom(this.camera.position).addInPlaceFromFloats(
      this.sunDirection.x * distance,
      this.sunDirection.y * distance,
      this.sunDirection.z * distance,
    );
    this.sunHalo.position.copyFrom(this.sunDisc.position);
  }

  public dispose(): void {
    this.shadowGenerator?.dispose();
    this.skyDome.material?.dispose();
    this.skyDome.dispose(false, false);
    this.sunDiscMaterial.dispose();
    this.sunDisc.dispose(false, false);
    this.sunHaloMaterial.dispose();
    this.sunHalo.dispose(false, false);
  }
}
