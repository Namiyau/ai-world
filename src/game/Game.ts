import {
  Engine,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { GAME_CONFIG, LANDMARK_CONFIG } from "./config";
import { PlayerController } from "./player/PlayerController";
import { PlayerAvatarAnchor, type PlayerAvatarSnapshot } from "./player/PlayerAvatar";
import { CombatSystem } from "./systems/CombatSystem";
import { EconomySystem } from "./systems/EconomySystem";
import { InteractionSystem } from "./systems/InteractionSystem";
import { InventorySystem } from "./systems/InventorySystem";
import { SaveSystem } from "./systems/SaveSystem";
import type { PositionData, SaveStateV1, WorldId } from "./types";
import { Hud } from "./ui/Hud";
import { MainMenu, type MainMenuSettings } from "./ui/MainMenu";
import { hardwareScalingForResolution, type PauseSettings } from "./ui/PauseSettings";
import { landmarkLabel } from "./world/Landmarks";
import { TIME_PRESET_LABELS, type TimePreset } from "./world/Atmosphere";
import { WorldManager } from "./world/WorldManager";

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly hud: Hud;
  private readonly mainMenu: MainMenu;
  private readonly canvas: HTMLCanvasElement;
  private readonly saveSystem = new SaveSystem();
  private readonly inventory: InventorySystem;
  private readonly economy: EconomySystem;
  private readonly collectedIds: Set<string>;
  private readonly player: PlayerController;
  private readonly avatar: PlayerAvatarAnchor;
  private readonly interactions: InteractionSystem;
  private readonly combat: CombatSystem;
  private readonly world: WorldManager;
  private readonly positions: Record<WorldId, PositionData>;
  private lastSaveAt = 0;
  private lastLakeGuideAt = 0;
  /** ESC 面板打开时暂停世界推进（但继续渲染，玩家能看到背后的世界）。 */
  private paused = true;

  public constructor(canvas: HTMLCanvasElement, hudRoot: HTMLDivElement, mainMenuRoot: HTMLDivElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, {
      adaptToDeviceRatio: true,
      stencil: true,
      useLargeWorldRendering: true,
    });
    this.scene = new Scene(this.engine);
    // 重力由 PlayerController 自己积分，这里保持为零避免双重叠加。
    this.scene.gravity = new Vector3(0, 0, 0);
    this.scene.collisionsEnabled = true;

    const loaded = this.saveSystem.load();
    this.inventory = new InventorySystem(loaded?.inventory);
    this.economy = new EconomySystem(loaded?.money ?? 120);
    this.collectedIds = new Set(loaded?.collectedResourceIds ?? []);
    this.positions = loaded?.positions ?? {
      // 默认出生点落在已通过 shore-ring 验证的湖盆附近；findSafeSpawn
      // 会在这个锚点周围选择真正干燥的岸边落脚点。
      home: { x: -128, y: 3, z: -704 },
      mission: { x: 0, y: 3, z: -9 },
    };

    this.player = new PlayerController(
      this.scene,
      canvas,
      new Vector3(-128, 8, -704),
      (x, z) => this.world.sampleSurface(x, z),
      (mode) => this.hud.setFlightMode(mode === "flight"),
    );
    this.avatar = new PlayerAvatarAnchor(this.scene);
    this.avatar.update(this.player);
    this.interactions = new InteractionSystem(this.player.camera);
    this.combat = new CombatSystem(this.player.camera);
    this.hud = new Hud(hudRoot, {
      onResume: () => this.resumeFromPause(),
      onToggleFlight: () => this.player.toggleFlight(),
      onReturnToSpawn: () => this.returnToSpawn(),
      onTeleportToLake: () => this.teleportToLake(),
      onSetTimePreset: (preset) => this.setTimePreset(preset),
      onPauseSettingsChanged: (settings) => this.applyPauseSettings(settings),
    });
    this.mainMenu = new MainMenu(mainMenuRoot, {
      onStartSinglePlayer: () => this.startSinglePlayer(),
      onNewSinglePlayer: () => this.startNewSinglePlayer(),
      onSettingsChanged: (settings) => this.applyMenuSettings(settings),
    }, loaded !== null);
    this.hud.setVisible(false);

    this.world = new WorldManager(
      this.scene,
      this.player.camera,
      this.interactions,
      this.combat,
      this.collectedIds,
      {
        onCollect: (item, amount) => {
          this.inventory.add(item, amount);
          this.refreshHud();
        },
        onToast: (message) => this.hud.toast(message),
        onTravelRequest: (target) => this.travel(target),
        onSellRequest: () => this.sellAll(),
      },
    );
    this.applyPauseSettings(this.hud.settings);

    this.interactions.onPrompt((text) => this.hud.setPrompt(text));
    this.combat.onAttack((hit) => this.hud.meleeFeedback(hit));

    window.addEventListener("resize", () => {
      this.engine.resize();
      this.hud.setRenderResolutionStatus(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    });
    window.addEventListener("beforeunload", () => this.saveNow());

    // Esc 是打开 / 关闭菜单的唯一权威入口。
    //
    // 为什么不依赖 pointerlockchange：指针锁生效时，浏览器会把所有鼠标事件
    // 都路由给被锁定的 canvas，菜单按钮永远收不到点击（实测 CDP 合成事件
    // 一个 DOM 事件都到不了）。所以必须由 Esc 自己驱动状态机 ——
    // Esc 按下的同时浏览器会自动释放指针锁，两者正好同步。
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.code !== "Escape") return;
        event.preventDefault();
        if (this.paused) this.resumeFromPause();
        else this.setPaused(true);
      },
      true,
    );

    // 指针锁被动丢失（切窗口、点别的应用）时，清掉按键并弹菜单。
    // 注意：只有在锁真的不在我们手上时才这样做。
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) return;
      this.player.setInputEnabled(false);
      this.setPaused(true);
    });
  }

  /**
   * 暂停 / 恢复。
   * 暂停时仍然渲染（玩家能看到背后的世界），但冻结一切推进。
   */
  public setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.hud.setPaused(paused);
    this.player.setInputEnabled(!paused);
    if (paused) this.saveNow();
    else this.lastSaveAt = performance.now();
  }

  private resumeFromPause(): void {
    // 先解除暂停，再请求指针锁 —— 顺序反了的话，
    // pointerlockchange 回调会把状态又按"未锁定 = 暂停"推回去。
    this.setPaused(false);
    if (document.pointerLockElement !== this.canvas) {
      const request = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      // 有些浏览器返回 Promise，失败时给出提示而不是静默卡住。
      if (request && typeof request.catch === "function") {
        request.catch(() => this.hud.toast("点击画面即可继续操作"));
      }
    }
  }

  /** 面板功能切换飞行（按钮入口）。 */
  public toggleFlight(): void {
    this.player.toggleFlight();
  }

  /**
   * 面板功能：卡在地形里时的自救 —— 回到主世界出生点上方。
   */
  private returnToSpawn(): void {
    if (this.world.currentWorld === "home") {
      const spawn = this.safeSpawn("home", this.positions.home);
      this.player.teleport(spawn);
      this.hud.toast("已返回主世界出生点");
    } else {
      this.hud.toast("请先撤离回主世界");
    }
    this.resumeFromPause();
  }

  /** 临时导航功能：先加载湖泊所在区域，再把玩家放到合法湖岸的干燥点。 */
  private teleportToLake(): void {
    if (this.world.currentWorld !== "home") {
      this.hud.toast("请先撤离回主世界");
      this.resumeFromPause();
      return;
    }

    const current = this.player.camera.position;
    const target = this.world.nearestLakeTarget(current.x, current.z);
    if (!target) {
      this.hud.toast("当前搜索范围内没有合法湖泊");
      this.resumeFromPause();
      return;
    }

    // 先同步构建目标周围 chunk；落点放在湖盆外侧约 12m，
    // 再由 findSafeSpawn 做最终的地形 / 道路 / 水深安全校验。
    const lakeCenter = new Vector3(target.x, 3, target.z);
    this.world.loadWorld("home", lakeCenter);
    const shore = this.world.findSafeSpawn(target.x + target.radius + 12, target.z, "home");
    this.player.teleport(shore);
    this.hud.setPrompt(null);
    this.refreshHud();
    this.updateLakeNavigation(true);
    this.hud.toast(`已到达湖岸 · 目标 X ${Math.round(target.x)} Z ${Math.round(target.z)}`);
    this.saveNow();
    this.resumeFromPause();
  }

  private setTimePreset(preset: TimePreset): void {
    this.world.setTimePreset(preset);
    this.hud.setTimePreset(preset);
    this.hud.toast(`时间已切换至${TIME_PRESET_LABELS[preset]}`);
  }

  public async start(): Promise<void> {
    this.world.loadWorld("home", this.vectorFrom(this.positions.home));
    const spawn = this.safeSpawn("home", this.positions.home);
    this.player.teleport(spawn);
    this.refreshHud();
    this.mainMenu.show();

    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;
      if (!this.paused) {
        this.player.update(deltaSeconds);
        this.avatar.update(this.player);
        this.world.update(this.player.camera.position);
        this.world.updateVisuals(deltaSeconds, this.player.camera.position);
        this.interactions.update();
        this.updateCompass();
        this.updateLakeNavigation();
        this.hud.setUnderwater(this.player.isUnderwater);

        const now = performance.now();
        if (now - this.lastSaveAt >= GAME_CONFIG.autosaveMs) {
          this.saveNow();
          this.lastSaveAt = now;
        }
      }
      this.scene.render();
    });
  }

  private startSinglePlayer(): void {
    this.mainMenu.hide();
    this.hud.setVisible(true);
    this.resumeFromPause();
  }

  private startNewSinglePlayer(): void {
    this.saveSystem.clear();
    window.location.reload();
  }

  private applyMenuSettings(settings: MainMenuSettings): void {
    this.hud.setHintsVisible(settings.showHints);
  }

  private applyPauseSettings(settings: PauseSettings): void {
    this.engine.setHardwareScalingLevel(hardwareScalingForResolution(settings.renderResolution));
    this.engine.resize();
    this.hud.setRenderResolutionStatus(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    this.player.setCameraPreferences(settings.fovDegrees, settings.sensitivity);
    this.world.setChunkLoadRadius(settings.chunkLoadRadius);
    this.world.setFogDistance(settings.fogDistance);
    this.hud.setHintsVisible(settings.showHints);
    this.hud.setChunkLoadStatus(this.world.stats.chunks, this.world.stats.pending);
    document.documentElement.dataset.reducedMotion = settings.reducedMotion ? "true" : "false";
  }

  /**
   * HUD 的「最近地标」指引。
   * 每帧查询会遍历 3×3 地标格点，没必要，所以按冷却时间节流。
   */
  private updateCompass(): void {
    if (this.world.currentWorld !== "home") {
      this.hud.setLandmarkGuide(null);
      return;
    }
    if (!this.world.shouldRefreshCompass(performance.now(), LANDMARK_CONFIG.compassRefreshMs)) return;

    const landmark = this.world.nearestLandmark;
    if (!landmark) {
      this.hud.setLandmarkGuide(null);
      return;
    }
    this.hud.setLandmarkGuide({
      label: landmarkLabel(landmark.kind),
      distance: landmark.distance,
      direction: landmark.direction,
    });
  }

  private updateLakeNavigation(force = false): void {
    if (!force && performance.now() - this.lastLakeGuideAt < 500) return;
    this.lastLakeGuideAt = performance.now();

    const position = this.player.camera.position;
    this.hud.setCoordinates(position.x, position.z);
    const target = this.world.nearestLakeTarget(position.x, position.z);
    this.hud.setLakeTarget(target ? { x: target.x, z: target.z, distance: Math.hypot(position.x - target.x, position.z - target.z) } : null);
    const showcase = this.world.characterShowcaseTarget;
    this.hud.setCharacterShowcaseTarget(showcase ? { x: showcase.x, z: showcase.z, distance: Math.hypot(position.x - showcase.x, position.z - showcase.z) } : null);
  }

  private travel(target: WorldId): void {
    this.storeCurrentPosition();
    this.world.loadWorld(target, this.vectorFrom(this.positions[target]));
    const spawn = this.safeSpawn(target, this.positions[target]);
    this.player.teleport(spawn);
    this.hud.setPrompt(null);
    this.refreshHud();
    this.hud.toast(target === "home" ? "已返回主世界" : "已进入任务世界");
    this.saveNow();
  }

  private sellAll(): void {
    if (this.inventory.isEmpty()) {
      this.hud.toast("背包里没有可出售资源");
      return;
    }

    const earned = this.economy.sellAll(this.inventory);
    this.hud.toast(`出售完成 +$${earned}`);
    this.refreshHud();
    this.saveNow();
  }

  private refreshHud(): void {
    this.hud.setWorld(this.world.currentWorld);
    this.hud.setMoney(this.economy.money);
    this.hud.setInventory(this.inventory.snapshot());
    this.hud.setChunkLoadStatus(this.world.stats.chunks, this.world.stats.pending);
    this.updateLakeNavigation(true);
  }

  /**
   * 出生 / 传送落点。
   * 现在地形里有湖泊，所以落点不能直接用存档坐标 ——
   * 交给 WorldManager 找一个「干燥、在水面之上」的位置。
   */
  private safeSpawn(world: WorldId, desired: PositionData): Vector3 {
    const x = Number.isFinite(desired.x) ? desired.x : 0;
    const z = Number.isFinite(desired.z) ? desired.z : world === "home" ? -8 : -9;
    return this.world.findSafeSpawn(x, z, world);
  }

  private storeCurrentPosition(): void {
    const p = this.player.camera.position;
    this.positions[this.world.currentWorld] = { x: p.x, y: p.y, z: p.z };
  }

  private saveNow(): void {
    this.storeCurrentPosition();
    const state: SaveStateV1 = {
      version: 1,
      money: this.economy.money,
      inventory: this.inventory.snapshot(),
      collectedResourceIds: this.world.snapshotCollectedIds(),
      positions: this.positions,
    };
    this.saveSystem.save(state);
  }

  private vectorFrom(position: PositionData): Vector3 {
    return new Vector3(position.x, position.y, position.z);
  }

  /** Stable debug/network hand-off shape. It intentionally contains no Babylon objects. */
  public get avatarSnapshot(): PlayerAvatarSnapshot {
    return this.avatar.snapshot(this.player);
  }
}
