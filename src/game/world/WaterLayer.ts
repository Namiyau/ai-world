import {
  Color3,
  Constants,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { ATMOSPHERE_CONFIG, WATER_CONFIG } from "../config";
import { buildWaterTriangles, type WaterTriangleGeometry } from "./geometry";
import type { TerrainGrid } from "./TerrainGrid";
import type { AtmosphereVisualState } from "./Atmosphere";

const WATER_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
attribute float waterDepth;

uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform float uTime;
uniform float uWaveAmplitude;
uniform vec2 uWaveFrequency;
uniform vec2 uWaveSpeed;
uniform float uShoreFadeDepth;

varying vec3 vColor;
varying float vFogDepth;
varying float vCoverage;
varying float vWaterDepth;
varying vec3 vWorldPosition;
varying vec3 vWaveNormal;

void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  float waveA = sin(worldPos.x * uWaveFrequency.x + worldPos.z * 0.017 + uTime * uWaveSpeed.x);
  float waveB = sin(worldPos.z * uWaveFrequency.y - worldPos.x * 0.013 + uTime * uWaveSpeed.y);
  float shoreFade = smoothstep(0.0, uShoreFadeDepth, waterDepth);
  worldPos.y += (waveA * 0.65 + waveB * 0.35) * uWaveAmplitude * shoreFade;
  vec4 viewPos = view * worldPos;
  gl_Position = projection * viewPos;

  vColor = color.rgb;
  vCoverage = color.a;
  vWaterDepth = waterDepth;
  vWorldPosition = worldPos.xyz;
  float slopeX = (waveA * 0.65 * uWaveFrequency.x - waveB * 0.35 * 0.013) * uWaveAmplitude * shoreFade;
  float slopeZ = (waveA * 0.65 * 0.017 + waveB * 0.35 * uWaveFrequency.y) * uWaveAmplitude * shoreFade;
  vWaveNormal = normalize(vec3(-slopeX, 1.0, -slopeZ));
  vFogDepth = -viewPos.z;
}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying float vFogDepth;
varying float vCoverage;
varying float vWaterDepth;
varying vec3 vWorldPosition;
varying vec3 vWaveNormal;

uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uCameraY;
uniform float uWaterLevel;
uniform vec3 uSunDirection;
uniform float uTime;
uniform vec3 uCameraPosition;
uniform vec3 uSkyReflectionColor;
uniform float uReflectionStrength;

float expFogFactor(float depth, float density) {
  float fog = density * depth;
  return 1.0 / pow(2.718281828459045, fog * fog);
}

void main(void) {
  vec3 color = vColor;
  float depthT = smoothstep(0.08, 5.0, vWaterDepth);
  vec3 shallowColor = vec3(0.22, 0.50, 0.57);
  vec3 deepColor = vec3(0.045, 0.19, 0.34);
  vec3 depthColor = mix(shallowColor, deepColor, depthT);
  // Keep the sampler's per-vertex color as a gentle local variation, but let
  // the continuous depth profile define the main water appearance. This
  // removes the hard cyan shoreline band while preserving stylized color.
  color = mix(color, depthColor, 0.7);
  float facing = clamp(dot(vWaveNormal, normalize(uSunDirection)), 0.0, 1.0);
  color += vec3(0.055, 0.06, 0.05) * facing;

  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float edge = 1.0 - clamp(dot(viewDirection, vWaveNormal), 0.0, 1.0);
  float fresnel = pow(edge, 3.0);
  color = mix(color, uSkyReflectionColor, fresnel * uReflectionStrength);
  float rippleA = sin(vWorldPosition.x * 0.12 + vWorldPosition.z * 0.07 + uTime * 0.45);
  float rippleB = sin(vWorldPosition.x * 0.24 - vWorldPosition.z * 0.11 - uTime * 0.31);
  float rippleField = rippleA * 0.6 + rippleB * 0.4;
  float rippleCrest = smoothstep(0.56, 0.94, rippleField * 0.5 + 0.5);
  color += vec3(0.028, 0.038, 0.041) * rippleField * (0.35 + depthT * 0.65);
  color += vec3(0.032, 0.042, 0.044) * rippleCrest * (0.18 + depthT * 0.42);

  vec3 halfDirection = normalize(normalize(uSunDirection) + viewDirection);
  float sunGlint = pow(max(dot(vWaveNormal, halfDirection), 0.0), 24.0);
  color += vec3(0.11, 0.14, 0.14) * sunGlint * 0.16;

  float submerged = step(uCameraY, uWaterLevel);
  color = mix(color, color * vec3(0.42, 0.55, 0.68), submerged);

  float fog = expFogFactor(vFogDepth, uFogDensity);
  vec3 finalColor = mix(uFogColor, color, fog);
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

/** Stable horizontal lake surface renderer sharing Ground's triangle topology. */
export class WaterLayer {
  private readonly material: ShaderMaterial;
  private elapsedSeconds = 0;

  public constructor(private readonly scene: Scene) {
    const material = new ShaderMaterial(
      "water",
      scene,
      { vertexSource: WATER_VERTEX_SHADER, fragmentSource: WATER_FRAGMENT_SHADER },
      {
        attributes: ["position", "normal", "color", "waterDepth"],
        uniforms: [
          "world",
          "worldView",
          "worldViewProjection",
          "view",
          "projection",
          "uTime",
          "uWaveAmplitude",
          "uWaveFrequency",
          "uWaveSpeed",
          "uShoreFadeDepth",
          "uFogColor",
          "uFogDensity",
          "uCameraY",
          "uWaterLevel",
          "uSunDirection",
          "uCameraPosition",
          "uSkyReflectionColor",
          "uReflectionStrength",
        ],
        defines: ["#define WATER_LAYER"],
      },
    );

    material.setColor3("uFogColor", Color3.FromHexString(ATMOSPHERE_CONFIG.fogColor));
    material.setFloat("uFogDensity", ATMOSPHERE_CONFIG.fogDensity);
    material.setVector3("uSunDirection", new Vector3(...ATMOSPHERE_CONFIG.sunDirection).normalize());
    material.setFloat("uWaterLevel", WATER_CONFIG.level);
    material.setFloat("uWaveAmplitude", WATER_CONFIG.visual.waveAmplitude);
    material.setVector2("uWaveFrequency", new Vector2(...WATER_CONFIG.visual.waveFrequency));
    material.setVector2("uWaveSpeed", new Vector2(...WATER_CONFIG.visual.waveSpeed));
    material.setFloat("uShoreFadeDepth", WATER_CONFIG.visual.shoreFadeDepth);
    material.setColor3("uSkyReflectionColor", Color3.FromHexString(ATMOSPHERE_CONFIG.sky.horizonColor));
    material.setFloat("uReflectionStrength", WATER_CONFIG.visual.reflectionStrength);
    material.setVector3("uCameraPosition", Vector3.Zero());
    material.setFloat("uTime", 0);

    // Development invariant: never render the underside of the lake mesh.
    material.backFaceCulling = true;
    // Alpha is fixed to 1.0 while validating geometry. Keep the material in the
    // opaque queue so depth testing cannot make a shoreline triangle appear on
    // top of a nearer Ground face.
    material.needAlphaBlending = () => false;
    material.needAlphaTesting = () => false;
    material.alphaMode = Constants.ALPHA_DISABLE;
    this.material = material;
  }

  public update(deltaSeconds: number, cameraY: number, cameraPosition?: Vector3, atmosphere?: AtmosphereVisualState): void {
    this.elapsedSeconds += Math.max(0, deltaSeconds);
    this.material.setFloat("uTime", this.elapsedSeconds);
    this.material.setFloat("uCameraY", cameraY);
    if (cameraPosition) this.material.setVector3("uCameraPosition", cameraPosition);
    if (atmosphere) {
      this.material.setFloat("uFogDensity", atmosphere.fogDensity);
      this.material.setVector3("uSunDirection", new Vector3(
        atmosphere.sunDirection.x,
        atmosphere.sunDirection.y,
        atmosphere.sunDirection.z,
      ));
      this.material.setColor3("uSkyReflectionColor", atmosphere.skyReflectionColor);
    }
  }

  public dispose(): void {
    this.material.dispose();
  }

  public build(grid: TerrainGrid): Mesh | null {
    const waterTriangles = buildWaterTriangles(grid, WATER_CONFIG.level);
    if (waterTriangles.length === 0) return null;

    const positions: number[] = [];
    const colors: number[] = [];
    const waterDepths: number[] = [];
    const indices: number[] = [];
    const metadataTriangles: Array<{
      points: Array<{ x: number; y: number; z: number }>;
      source: {
        diagonal: WaterTriangleGeometry["source"]["diagonal"];
        vertices: Array<{ x: number; z: number; height: number; lakeMask: boolean; hasWater: boolean; waterCoverage: number }>;
      };
    }> = [];

    for (const triangle of waterTriangles) {
      const first = positions.length / 3;
      metadataTriangles.push({
        points: triangle.points.map((point) => ({
          x: point.x - grid.centerX,
          y: point.y,
          z: point.z - grid.centerZ,
        })),
        source: {
          diagonal: triangle.source.diagonal,
          vertices: triangle.source.vertices.map((vertex) => ({
            x: vertex.x,
            z: vertex.z,
            height: vertex.height,
            lakeMask: vertex.lakeMask,
            hasWater: vertex.hasWater,
            waterCoverage: vertex.waterCoverage,
          })),
        },
      });

      for (const point of triangle.points) {
        positions.push(point.x - grid.centerX, WATER_CONFIG.level, point.z - grid.centerZ);
        waterDepths.push(point.waterDepth);
        // Development validation deliberately uses opaque water; no shoreline film.
        colors.push(point.waterColor[0], point.waterColor[1], point.waterColor[2], 1.0);
      }
      indices.push(first, first + 1, first + 2);
    }

    const water = new Mesh(`water-${Math.round(grid.centerX)}-${Math.round(grid.centerZ)}`, this.scene);
    water.setVerticesData("position", new Float32Array(positions), false, 3);
    water.setVerticesData("color", new Float32Array(colors), false, 4);
    water.setVerticesData("waterDepth", new Float32Array(waterDepths), false, 1);
    water.setIndices(indices, null, false);

    const normals = new Float32Array((positions.length / 3) * 3);
    for (let index = 0; index < positions.length / 3; index += 1) normals[index * 3 + 1] = 1;
    water.setVerticesData("normal", normals, false, 3);

    water.position.x = grid.centerX;
    water.position.y = 0;
    water.position.z = grid.centerZ;
    water.material = this.material;
    water.isPickable = false;
    water.checkCollisions = false;
    water.alphaIndex = 10;
    water.hasVertexAlpha = false;
    water.metadata = {
      chunkCenterX: grid.centerX,
      chunkCenterZ: grid.centerZ,
      chunkSize: grid.size,
      triangles: metadataTriangles,
    };
    water.refreshBoundingInfo();
    return water;
  }
}
