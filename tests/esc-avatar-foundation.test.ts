import assert from "node:assert/strict";
import { test } from "node:test";
import { ArcRotateCamera, Mesh, NullEngine, Scene, ShaderMaterial, UniversalCamera, Vector3 } from "@babylonjs/core";
import { Atmosphere, TIME_PRESETS } from "../src/game/world/Atmosphere.ts";
import { ATMOSPHERE_CONFIG } from "../src/game/config.ts";
import { DEFAULT_PAUSE_SETTINGS, chunkCountForRadius, hardwareScalingForResolution, loadPauseSettings, savePauseSettings } from "../src/game/ui/PauseSettings.ts";
import { DEFAULT_PLAYER_AVATAR, PlayerAvatarAnchor, createPlayerAvatarSnapshot } from "../src/game/player/PlayerAvatar.ts";
import { collisionResolvedDisplacement } from "../src/game/player/PlayerController.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("time presets provide dawn noon dusk and midnight and update Atmosphere immediately", () => {
  assert.deepEqual(Object.keys(TIME_PRESETS), ["dawn", "noon", "dusk", "midnight"]);

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("test-camera", 0, 1.2, 8, Vector3.Zero(), scene);
  const atmosphere = new Atmosphere(scene, camera as never);

  atmosphere.setTimePreset("noon");
  const noon = atmosphere.visualState;
  atmosphere.setTimePreset("midnight");
  const midnight = atmosphere.visualState;

  assert.ok(noon.daylight > 0.8);
  assert.ok(midnight.daylight < 0.1);
  assert.notDeepEqual(noon.sunDirection, midnight.sunDirection);
  atmosphere.dispose();
  engine.dispose();
});

test("render resolution exposes explicit browser-safe scales and migrates legacy quality saves", () => {
  assert.equal(hardwareScalingForResolution("75"), 4 / 3);
  assert.equal(hardwareScalingForResolution("100"), 1);
  assert.equal(hardwareScalingForResolution("125"), 0.8);
  assert.equal(hardwareScalingForResolution("150"), 2 / 3);

  const storage = new MemoryStorage();
  storage.setItem("ai-world-pause-settings-v1", JSON.stringify({ renderQuality: "quality" }));
  assert.equal(loadPauseSettings(storage as never).renderResolution, "125");
});

test("chunk load radius maps to a square Minecraft-style window", () => {
  assert.equal(chunkCountForRadius(2), 25);
  assert.equal(chunkCountForRadius(3), 49);
  assert.equal(chunkCountForRadius(6), 169);
});

test("sun uses a camera-facing unlit shader disc with nearby cascaded shadows", () => {
  assert.ok(ATMOSPHERE_CONFIG.ambientIntensity < ATMOSPHERE_CONFIG.sunIntensity);
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("test-camera", 0, 1.2, 8, Vector3.Zero(), scene);
  const atmosphere = new Atmosphere(scene, camera as never);
  const sun = scene.getMeshByName("sun-disc");
  const halo = scene.getMeshByName("sun-halo");
  assert.ok(sun, "shader sun disc is required");
  assert.ok(halo, "soft sun halo is required");
  assert.equal(sun!.billboardMode, Mesh.BILLBOARDMODE_ALL);
  assert.ok(sun!.material instanceof ShaderMaterial);
  assert.equal((sun!.material as { fogEnabled: boolean }).fogEnabled, false);
  assert.equal((sun!.material as { disableDepthWrite: boolean }).disableDepthWrite, true);
  assert.equal((halo!.material as { fogEnabled: boolean }).fogEnabled, false);
  assert.equal(atmosphere.shadowStats.cascades, 3);
  assert.ok(atmosphere.shadowStats.maxDistance >= 90 && atmosphere.shadowStats.maxDistance <= 160);
  atmosphere.dispose();
  engine.dispose();
});

test("collision velocity uses resolved motion and avatar anchors at the ellipsoid foot", () => {
  const start = new Vector3(10, 5, -4);
  const requested = new Vector3(0, -0.025, 0.12);
  const resolved = new Vector3(10, 5, -3.94);
  const actual = collisionResolvedDisplacement(start, resolved);
  assert.equal(actual.x, 0);
  assert.equal(actual.y, 0);
  assert.ok(Math.abs(actual.z - 0.06) < 1e-9);
  assert.notDeepEqual(actual.asArray(), requested.asArray());

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera("avatar-foot-camera", new Vector3(2, 6, 3), scene);
  camera.ellipsoid = new Vector3(0.42, 0.9, 0.42);
  camera.ellipsoidOffset = new Vector3(0, 0.18, 0);
  const anchor = new PlayerAvatarAnchor(scene);
  anchor.update({ camera } as never);
  assert.ok(Math.abs(anchor.root.position.y - 5.28) < 1e-9);
  assert.equal(anchor.root.position.x, 2);
  assert.equal(anchor.root.position.z, 3);
  anchor.dispose();
  engine.dispose();
});

test("pause settings fall back safely and persist display camera and accessibility choices", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadPauseSettings(storage as never), DEFAULT_PAUSE_SETTINGS);
  assert.equal((loadPauseSettings(storage as never) as unknown as { chunkLoadRadius: number }).chunkLoadRadius, 3);
  storage.setItem("ai-world-pause-settings-v1", "not-json");
  assert.deepEqual(loadPauseSettings(storage as never), DEFAULT_PAUSE_SETTINGS);

  const selected = {
    renderResolution: "150" as const,
    chunkLoadRadius: 5 as const,
    fogDistance: "far" as const,
    fovDegrees: 96,
    sensitivity: 1.35,
    showHints: false,
    reducedMotion: true,
  };
  savePauseSettings(selected, storage as never);
  assert.deepEqual(loadPauseSettings(storage as never), selected);

  storage.setItem("ai-world-pause-settings-v1", JSON.stringify({ ...selected, chunkLoadRadius: 5 }));
  assert.equal((loadPauseSettings(storage as never) as unknown as { chunkLoadRadius: number }).chunkLoadRadius, 5);
  storage.setItem("ai-world-pause-settings-v1", JSON.stringify({ chunkLoadRadius: 99 }));
  assert.equal((loadPauseSettings(storage as never) as unknown as { chunkLoadRadius: number }).chunkLoadRadius, 3);
});

test("player avatar contract reserves stylized explorer appearance and serializable multiplayer-ready state", () => {
  assert.equal(DEFAULT_PLAYER_AVATAR.style, "stylized-low-poly");
  assert.equal(DEFAULT_PLAYER_AVATAR.outfit, "wilderness-explorer");
  assert.ok(DEFAULT_PLAYER_AVATAR.proportions.headScale > DEFAULT_PLAYER_AVATAR.proportions.bodyScale);

  const snapshot = createPlayerAvatarSnapshot("local-player", DEFAULT_PLAYER_AVATAR, { x: 12.5, y: 3, z: -8.25 }, 1.4, "flight");
  assert.deepEqual(snapshot.position, { x: 12.5, y: 3, z: -8.25 });
  assert.equal(snapshot.yaw, 1.4);
  assert.equal(snapshot.movementMode, "flight");
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});
